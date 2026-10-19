import type { VoiceClient, VoicePipelineMetrics } from '@cloudflare/voice/client';
import { createVoiceAPI, VoiceAPIError, callDuration, channelLabel, voiceSocketURL,
  type Receptionist, type VoiceCall, type VoiceConfig, type VoiceLogic, type VoiceMessage, type VoiceSpeechOptions, type VoiceModel, type VoiceLanguage } from './voice-api.ts';
import { CallTransport } from './voice-transport.ts';
import { initializeNumberSearch } from './voice-number-search.ts';

export function initializeVoice({ apiOrigin, readSession }: {
  apiOrigin: string;
  readSession: () => Promise<{ user: unknown } | null>;
}) {
  const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const main = element('main');
  const content = element('voice-content');
  const loading = element('voice-loading');
  const error = element('voice-error');
  const retry = element<HTMLButtonElement>('voice-retry');
  const signIn = element('voice-signin');
  const form = element<HTMLFormElement>('voice-agent-form');
  const fields = element<HTMLFieldSetElement>('voice-fields');
  const save = element<HTMLButtonElement>('voice-save');
  const saveStatus = element('voice-save-status');
  const agentName = element<HTMLInputElement>('voice-name');
  const business = element<HTMLInputElement>('voice-business');
  const greeting = element<HTMLTextAreaElement>('voice-greeting');
  const instructions = element<HTMLTextAreaElement>('voice-instructions');
  const speaker = element<HTMLSelectElement>('voice-speaker');
  const voiceModel = element<HTMLSelectElement>('voice-model');
  const language = element<HTMLSelectElement>('voice-language');
  const languageHint = element('voice-language-hint');
  const voiceLogic = element<HTMLSelectElement>('voice-logic');
  const mode = element<HTMLFieldSetElement>('voice-test-mode');
  const start = element<HTMLButtonElement>('voice-start');
  const mute = element<HTMLButtonElement>('voice-mute');
  const end = element<HTMLButtonElement>('voice-end');
  const callStatus = element('voice-call-status');
  const duration = element('voice-call-duration');
  const stateDot = element('voice-state-dot');
  const testError = element('voice-test-error');
  const testHint = element('voice-test-hint');
  const transcript = element('voice-transcript');
  const transcriptEmpty = element('voice-transcript-empty');
  const transcriptScroll = element('voice-transcript-scroll');
  const interim = element('voice-interim');
  const messageForm = element<HTMLFormElement>('voice-message-form');
  const messageInput = element<HTMLInputElement>('voice-message');
  const send = element<HTMLButtonElement>('voice-send');
  const metricsLabel = element('voice-metrics');
  const refreshCalls = element<HTMLButtonElement>('voice-refresh-calls');
  const callsStatus = element('voice-calls-status');
  const callsList = element<HTMLTableSectionElement>('voice-calls-list');
  const callsScroll = element('voice-calls-scroll');
  const dialog = element<HTMLDialogElement>('voice-call-dialog');
  const dialogStatus = element('voice-dialog-status');
  const api = createVoiceAPI(apiOrigin);
  let config: VoiceConfig | null = null;
  const legacySpeech: VoiceSpeechOptions = { languages: [{code:'en',name:'English'}], models: [
    {id:'aura-1',name:'Aura-1',available:true,unavailableReason:null,languages:[{code:'en',voices:[
      {id:'asteria',name:'Asteria'},{id:'luna',name:'Luna'},{id:'athena',name:'Athena'},
    ]}]},
  ] };
  function speechOptions() { return config?.speech ?? legacySpeech; }
  function modelAvailable(model: VoiceModel = 'aura-1') { return Boolean(speechOptions().models.find(option => option.id===model)?.available); }

  function renderSpeechOptions(model = voiceModel.value, code = language.value, voice = speaker.value) {
    const options = speechOptions();
    voiceModel.replaceChildren(...options.models.map(item => {
      const option = new Option(`${item.name}${item.available ? '' : ` · ${item.unavailableReason || 'Unavailable'}`}`, item.id);
      option.disabled = !item.available;
      return option;
    }));
    voiceModel.value = options.models.some(item=>item.id===model) ? model : 'aura-1';
    const selected = options.models.find(item=>item.id===voiceModel.value)!;
    const supported = new Set(selected.languages.map(item=>item.code));
    language.replaceChildren(...options.languages.map(item=>{
      const option = new Option(`${item.name}${supported.has(item.code) ? '' : ' · Not supported'}`, item.code);
      option.disabled = !supported.has(item.code);
      return option;
    }));
    language.value = supported.has(code as VoiceLanguage) ? code : selected.languages[0].code;
    const voices = selected.languages.find(item=>item.code===language.value)!.voices;
    speaker.replaceChildren(...voices.map(item=>new Option(item.name,item.id)));
    speaker.value = voices.some(item=>item.id===voice) ? voice : voices[0].id;
    languageHint.textContent = selected.available
      ? `${selected.languages.length} of ${options.languages.length} languages supported.`
      : 'This model is currently unavailable. Choose another model to save or start a call.';
  }
  voiceModel.addEventListener('change',()=>{renderSpeechOptions(); controls();});
  language.addEventListener('change',()=>{renderSpeechOptions(); controls();});
  let agent: Receptionist | null = null;
  let client: VoiceClient | null = null;
  let activeCall: VoiceCall | null = null;
  let savedValue = '';
  let saving = false;
  let starting = false;
  let ending = false;
  let loadingCalls = false;
  let disposed = false;
  let turnPending = false;
  let startedAt = 0;
  let clock: ReturnType<typeof setInterval> | undefined;
  let connectAbort: AbortController | null = null;
  let selectedMode: 'browser' | 'text' = 'browser';
  const disposeNumberSearch = initializeNumberSearch(api, { isDisposed: () => disposed,
    onAuthError: caught => showError(error, caught, 'Sign in again to search numbers.') });

  function draft(): Omit<Receptionist, 'id' | 'updatedAt' | 'voiceLogic'> & { voiceLogic: VoiceLogic } {
    return { name: agentName.value.trim(), businessName: business.value.trim(), greeting: greeting.value.trim(),
      instructions: instructions.value.trim(), voice: speaker.value,
      model: voiceModel.value as VoiceModel, language: language.value as VoiceLanguage,
      voiceLogic: voiceLogic.value as VoiceLogic, transferNumber: null };
  }

  function isDirty() { return JSON.stringify(draft()) !== savedValue; }

  function showError(target: HTMLElement, caught: unknown, fallback: string) {
    if (disposed) return;
    target.textContent = caught instanceof Error ? caught.message : fallback;
    target.hidden = false;
    if (caught instanceof VoiceAPIError && caught.status === 401) {
      content.hidden = true;
      signIn.hidden = false;
      disposed = true;
      disconnect();
      if (activeCall) void finishCall();
    }
  }

  function controls() {
    const busy = starting || ending;
    fields.disabled = saving || busy || disposed;
    save.disabled = saving || busy || disposed || !modelAvailable(voiceModel.value as VoiceModel) || (agent !== null && !isDirty());
    mode.disabled = busy || activeCall !== null;
    start.disabled = !agent || !modelAvailable(agent.model) || !config?.enabled || !config.browserCalling || busy || saving || disposed;
    start.hidden = activeCall !== null || selectedMode === 'text';
    mute.hidden = !activeCall || activeCall.channel !== 'browser';
    mute.disabled = busy;
    end.hidden = !activeCall;
    end.disabled = ending;
    messageForm.hidden = selectedMode !== 'text';
    messageInput.disabled = busy || saving || !agent || !modelAvailable(agent.model) || !config?.enabled || !config.browserCalling || turnPending || disposed;
    send.disabled = messageInput.disabled || !messageInput.value.trim();
    stateDot.dataset.active = String(activeCall !== null);
    if (!activeCall && !busy) callStatus.textContent = !agent ? 'Save your receptionist to start testing.'
      : !config?.enabled || !config.browserCalling ? 'Calling is not enabled yet.'
      : !modelAvailable(agent.model) ? 'Choose an available voice model and save your settings.' : 'Ready to test';
    testHint.textContent = selectedMode === 'text' ? 'Try your instructions without using a microphone.' : 'Use your microphone to have a real conversation.';
  }

  function renderTranscript(target: HTMLElement, messages: VoiceMessage[]) {
    while (target.children.length > messages.length) target.lastElementChild!.remove();
    messages.forEach((message, index) => {
      let entry = target.children[index] as HTMLElement | undefined;
      if (!entry) {
        entry = document.createElement('div');
        entry.className = 'voice-transcript-entry';
        entry.append(document.createElement('strong'), document.createElement('p'));
        target.append(entry);
      }
      const label = message.role === 'user' ? 'Caller' : agent?.name || 'Receptionist';
      if (entry.children[0].textContent !== label) entry.children[0].textContent = label;
      if (entry.children[1].textContent !== message.text) entry.children[1].textContent = message.text;
    });
  }

  function renderLiveTranscript(messages: VoiceMessage[]) {
    const wasNearEnd = transcriptScroll.scrollHeight - transcriptScroll.scrollTop - transcriptScroll.clientHeight < 80;
    transcriptEmpty.hidden = messages.length !== 0;
    renderTranscript(transcript, messages);
    if (wasNearEnd) transcriptScroll.scrollTop = transcriptScroll.scrollHeight;
  }

  function renderPhone() {
    if (!config) return;
    const phone = config.telephony;
    const status = element('voice-phone-status');
    status.textContent = phone.configured ? 'Connected' : 'Not connected';
    status.dataset.connected = String(phone.configured);
    element('voice-phone-description').textContent = phone.configured
      ? 'Incoming calls to this number are answered by your saved receptionist.'
      : 'Connect a Twilio phone number to receive calls. You can test in the browser while you set this up.';
    const phoneNumber = element('voice-phone-number');
    phoneNumber.hidden = !phone.phoneNumber;
    phoneNumber.querySelector('dd')!.textContent = phone.phoneNumber;
    element('voice-webhook').hidden = !phone.webhookUrl;
    element<HTMLInputElement>('voice-webhook-url').value = phone.webhookUrl ?? '';
    element('voice-phone-setup').textContent = !agent ? 'Save your receptionist to get its incoming call webhook.'
      : phone.configured ? 'Call your number to test the connection. The transcript will appear in call history.'
      : 'Phone credentials and the number must be configured on the Voice backend before inbound calls can be answered.';
    element('voice-model-label').textContent = config.models.llm.replace(/^@cf\//, '');
    element('voice-stt-label').textContent = config.models.stt.includes('nova-3') ? 'Deepgram Nova-3' : 'Deepgram Flux';
    element('voice-tts-label').textContent = config.models.tts.startsWith('cartesia/') ? 'Cartesia Sonic 3.6'
      : config.models.tts.includes('aura-2') ? 'Deepgram Aura-2' : 'Deepgram Aura-1';
  }

  async function load() {
    if (disposed) return;
    loading.hidden = false;
    error.hidden = true;
    retry.hidden = true;
    main.setAttribute('aria-busy', 'true');
    try {
      const session = await readSession();
      if (disposed) return;
      if (!session?.user) {
        signIn.hidden = false;
        content.hidden = true;
        return;
      }
      const [settings, result] = await Promise.all([api.config(), api.agent()]);
      if (disposed) return;
      if (!('agent' in result) || !settings.models || !settings.telephony) throw new Error('Could not load Voice. Please try again.');
      config = settings;
      agent = result.agent;
      if (agent) {
        agentName.value = agent.name;
        business.value = agent.businessName;
        greeting.value = agent.greeting;
        instructions.value = agent.instructions;
        renderSpeechOptions(agent.model ?? 'aura-1',agent.language ?? 'en',agent.voice);
        voiceLogic.value = agent.voiceLogic === 'reply_right_away' ? 'reply_right_away' : 'original_no_reply';
        savedValue = JSON.stringify(draft());
      } else {
        renderSpeechOptions('aura-1','en','asteria');
        voiceLogic.value = 'original_no_reply';
        savedValue = JSON.stringify(draft());
      }
      content.hidden = false;
      signIn.hidden = true;
      renderPhone();
      controls();
      selectTab(location.hash.slice(1));
    } catch (caught) {
      showError(error, caught, 'Could not load Voice. Please try again.');
      retry.hidden = false;
    } finally {
      loading.hidden = true;
      main.setAttribute('aria-busy', 'false');
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || starting || ending || disposed || !form.reportValidity()) return;
    saving = true;
    error.hidden = true;
    saveStatus.textContent = '';
    save.textContent = 'Saving…';
    controls();
    try {
      const result = await api.saveAgent(draft());
      if (disposed) return;
      agent = result.agent;
      savedValue = JSON.stringify(draft());
      saveStatus.textContent = 'Saved. New calls will use these settings.';
      try { config = await api.config(); renderPhone(); }
      catch (caught) { if (caught instanceof VoiceAPIError && caught.status === 401) showError(error, caught, 'Sign in again to continue.'); }
    } catch (caught) {
      showError(error, caught, 'Could not save your receptionist. Please try again.');
    } finally {
      saving = false;
      save.textContent = 'Save receptionist';
      controls();
    }
  });
  form.addEventListener('input', () => {
    saveStatus.textContent = isDirty() ? 'Unsaved changes' : '';
    controls();
  });

  function waitForConnection(current: VoiceClient, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('The call could not connect. Please try again.')), 12000);
      const connected = (ready: boolean) => { if (ready) finish(); };
      const failed = (message: string | null) => { if (message) finish(new Error('The call could not connect. Please try again.')); };
      const abort = () => finish(new Error('The test was cancelled.'));
      function finish(cause?: Error) {
        clearTimeout(timeout);
        current.removeEventListener('connectionchange', connected);
        current.removeEventListener('error', failed);
        signal.removeEventListener('abort', abort);
        if (cause) reject(cause); else resolve();
      }
      current.addEventListener('connectionchange', connected);
      current.addEventListener('error', failed);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else if (current.connected) finish();
      else current.connect();
    });
  }

  const billingMessages = [
    'Your credits have run out. Add funds to continue.',
    'Your spending limit has been reached.',
    'Voice billing is unavailable. The call has ended.',
    'Calling stopped because account credits or billing are unavailable.',
  ];

  async function beginCall(): Promise<VoiceClient | null> {
    if (starting || ending || !agent || disposed) return null;
    starting = true;
    testError.hidden = true;
    metricsLabel.hidden = true;
    duration.hidden = true;
    renderLiveTranscript([]);
    callStatus.textContent = 'Connecting…';
    start.textContent = 'Connecting…';
    controls();
    const controller = new AbortController();
    connectAbort = controller;
    try {
      const { VoiceClient } = await import('@cloudflare/voice/client');
      if (disposed || controller.signal.aborted) return null;
      const session = await api.start(selectedMode);
      activeCall = session.call;
      if (disposed || controller.signal.aborted) { await finishCall(); return null; }
      controls();
      const current = new VoiceClient({ agent: 'ReceptionistCall', name: session.call.id,
        transport: new CallTransport(voiceSocketURL(session.websocketUrl, apiOrigin)) });
      client = current;
      current.addEventListener('transcriptchange', messages => {
        if (client !== current || disposed) return;
        renderLiveTranscript(messages);
      });
      current.addEventListener('interimtranscript', text => {
        if (client !== current || disposed) return;
        interim.textContent = text;
        interim.hidden = !text;
      });
      current.addEventListener('statuschange', status => {
        if (client !== current || disposed || ending) return;
        const labels = { idle: 'Connected', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' };
        callStatus.textContent = labels[status];
        turnPending = status === 'thinking' || status === 'speaking';
        controls();
      });
      current.addEventListener('metricschange', metrics => renderMetrics(metrics));
      current.addEventListener('mutechange', muted => {
        mute.textContent = muted ? 'Unmute mic' : 'Mute mic';
        mute.setAttribute('aria-pressed', String(muted));
      });
      current.addEventListener('error', message => {
        if (!message || client !== current || disposed || starting || ending) return;
        turnPending = false;
        showError(testError, new Error(billingMessages.includes(message) ? message : 'The call encountered a problem. End this test and try again.'), 'The call encountered a problem.');
        controls();
      });
      current.addEventListener('connectionchange', connected => {
        if (connected || client !== current || starting || ending || disposed) return;
        if (testError.hidden) showError(testError, new Error('The call disconnected. You can start a new test.'), 'The call disconnected.');
        void finishCall();
      });
      await waitForConnection(current, controller.signal);
      if (controller.signal.aborted || disposed || client !== current) return null;
      if (selectedMode === 'browser') {
        await current.startCall();
        if (current.error) throw new Error(current.error.toLowerCase().includes('microphone')
          ? 'Could not access your microphone. Check your browser permissions and audio device, or try a text test.'
          : 'Could not start the call. Please try again.');
      } else callStatus.textContent = 'Connected';
      if (!current.connected) throw new Error('The call disconnected. Please try again.');
      if (disposed || controller.signal.aborted || client !== current) { current.disconnect(); return null; }
      startedAt = Date.parse(session.call.startedAt);
      if (!Number.isFinite(startedAt)) startedAt = Date.now();
      duration.hidden = false;
      clock = setInterval(() => { duration.textContent = callDuration((Date.now() - startedAt) / 1000); }, 1000);
      duration.textContent = '0:00';
      return current;
    } catch (caught) {
      const cause = client?.error && billingMessages.includes(client.error) ? new Error(client.error)
        : caught instanceof DOMException && caught.name === 'NotAllowedError'
        ? new Error('Microphone access was denied. Allow microphone access in your browser, or try a text test.')
        : caught instanceof DOMException && caught.name === 'NotFoundError'
          ? new Error('No microphone was found. Connect one, or try a text test.') : caught;
      if (!controller.signal.aborted) showError(testError, cause, 'Could not start the test. Please try again.');
      await finishCall();
      return null;
    } finally {
      if (connectAbort === controller) connectAbort = null;
      starting = false;
      start.textContent = 'Start test call';
      controls();
    }
  }

  function renderMetrics(metrics: VoicePipelineMetrics | null) {
    metricsLabel.hidden = !metrics;
    if (metrics) metricsLabel.textContent = `Latest response · ${Math.round(metrics.first_audio_ms)} ms to first server audio`;
  }

  function disconnect() {
    connectAbort?.abort();
    connectAbort = null;
    const current = client;
    client = null;
    current?.disconnect();
    if (clock) clearInterval(clock);
    clock = undefined;
    interim.hidden = true;
    turnPending = false;
  }

  async function finishCall() {
    if (ending) return;
    ending = true;
    const call = activeCall;
    disconnect();
    activeCall = null;
    controls();
    try {
      if (call) {
        const result = await api.end(call.id);
        if (!disposed && result.call.transcript?.length) renderLiveTranscript(result.call.transcript);
      }
    } catch (caught) {
      showError(testError, caught, 'The call ended, but its final status could not be refreshed. Check call history.');
    } finally {
      ending = false;
      if (!disposed) {
        callStatus.textContent = call ? 'Call ended' : 'Ready to test';
        mute.textContent = 'Mute mic';
        mute.setAttribute('aria-pressed', 'false');
        controls();
        if (!element('panel-calls').hidden) void loadCalls();
      }
    }
  }

  start.addEventListener('click', () => { void beginCall(); });
  end.addEventListener('click', () => { void finishCall(); });
  mute.addEventListener('click', () => client?.toggleMute());
  mode.addEventListener('change', () => {
    selectedMode = mode.querySelector<HTMLInputElement>('input:checked')!.value as typeof selectedMode;
    testError.hidden = true;
    controls();
  });
  messageInput.addEventListener('input', controls);
  messageForm.addEventListener('submit', async event => {
    event.preventDefault();
    const text = messageInput.value.trim();
    if (!text || turnPending || starting || ending || disposed) return;
    testError.hidden = true;
    const current = client ?? await beginCall();
    if (!current || !current.connected || disposed) return;
    current.sendText(text);
    messageInput.value = '';
    turnPending = true;
    callStatus.textContent = 'Thinking…';
    controls();
  });

  async function loadCalls() {
    if (loadingCalls || disposed) return;
    loadingCalls = true;
    refreshCalls.disabled = true;
    callsStatus.hidden = false;
    callsStatus.textContent = 'Loading calls…';
    try {
      const { calls } = await api.calls();
      if (disposed) return;
      if (!Array.isArray(calls)) throw new Error('Could not load your calls. Please try again.');
      callsList.replaceChildren();
      calls.forEach(call => {
        const row = document.createElement('tr');
        const values = [new Date(call.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
          channelLabel(call.channel), callDuration(call.durationSeconds), { active: 'In progress', completed: 'Completed', failed: 'Failed' }[call.status]];
        values.forEach((value, index) => {
          const cell = document.createElement('td');
          cell.textContent = value;
          if (index === 3) { cell.className = 'voice-call-status'; cell.dataset.status = call.status; }
          row.append(cell);
        });
        const action = document.createElement('td');
        const view = document.createElement('button');
        view.type = 'button';
        view.className = 'dashboard-retry';
        view.textContent = 'View';
        view.setAttribute('aria-label', `View transcript of ${channelLabel(call.channel).toLowerCase()} from ${values[0]}`);
        view.addEventListener('click', () => { void viewCall(call); });
        action.append(view);
        row.append(action);
        callsList.append(row);
      });
      callsScroll.hidden = calls.length === 0;
      callsStatus.textContent = calls.length ? 'Showing your 50 most recent calls.' : 'No calls yet.';
      callsStatus.hidden = calls.length > 0 && calls.length < 50;
    } catch (caught) {
      callsStatus.textContent = caught instanceof Error ? caught.message : 'Could not load your calls. Please try again.';
      callsStatus.hidden = false;
      if (caught instanceof VoiceAPIError && caught.status === 401) showError(error, caught, 'Sign in again to continue.');
    } finally {
      loadingCalls = false;
      refreshCalls.disabled = false;
    }
  }

  async function viewCall(call: VoiceCall) {
    const details = element('voice-dialog-details');
    details.textContent = `${channelLabel(call.channel)} · ${new Date(call.startedAt).toLocaleString()} · ${callDuration(call.durationSeconds)}`;
    dialogStatus.textContent = 'Loading transcript…';
    element('voice-dialog-transcript').replaceChildren();
    dialog.showModal();
    dialog.dataset.callId = call.id;
    try {
      const result = await api.call(call.id);
      if (!dialog.open || dialog.dataset.callId !== call.id || disposed) return;
      renderTranscript(element('voice-dialog-transcript'), result.call.transcript);
      dialogStatus.textContent = result.call.transcript.length ? '' : 'No transcript was recorded for this call.';
    } catch (caught) {
      if (!dialog.open || dialog.dataset.callId !== call.id) return;
      dialogStatus.textContent = caught instanceof Error ? caught.message : 'Could not load this transcript. Close and try again.';
    }
  }

  function selectTab(value: string) {
    const sections = ['agent', 'calls', 'phone', 'numbers'];
    const tab = sections.includes(value) ? value : 'agent';
    sections.forEach(name => {
      const button = element(`tab-${name}`);
      button.setAttribute('aria-selected', String(name === tab));
      button.tabIndex = name === tab ? 0 : -1;
      element(`panel-${name}`).hidden = name !== tab;
    });
    if (tab === 'calls' && !content.hidden) void loadCalls();
  }

  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.voice-tabs [role="tab"]')];
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      const name = tab.id.replace('tab-', '');
      history.replaceState(null, '', `${location.pathname}${location.search}${name === 'agent' ? '' : `#${name}`}`);
      selectTab(name);
    });
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      tabs[next].focus();
      tabs[next].click();
    });
  });
  window.addEventListener('hashchange', () => selectTab(location.hash.slice(1)));
  refreshCalls.addEventListener('click', () => { void loadCalls(); });
  retry.addEventListener('click', () => { void load(); });
  element('voice-copy-webhook').addEventListener('click', async () => {
    const input = element<HTMLInputElement>('voice-webhook-url');
    if (!input.value) return;
    try {
      await navigator.clipboard.writeText(input.value);
      element('voice-copy-status').textContent = 'Webhook copied.';
    } catch {
      input.focus(); input.select();
      element('voice-copy-status').textContent = 'Select and copy the webhook URL.';
    }
  });
  window.addEventListener('beforeunload', event => {
    if (!disposed && (!content.hidden && isDirty() || activeCall !== null)) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => {
    disposeNumberSearch();
    disposed = true;
    const call = activeCall;
    activeCall = null;
    disconnect();
    if (call) void api.end(call.id, true).catch(() => {});
  });
  window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
  window.addEventListener('auth-change', event => {
    if ((event as CustomEvent<{ user: unknown }>).detail?.user !== null) return;
    disposeNumberSearch();
    content.hidden = true;
    signIn.hidden = false;
    disposed = true;
    dialog.close();
    const call = activeCall;
    activeCall = null;
    disconnect();
    if (call) void api.end(call.id).catch(() => {});
  });
  void load();
}
