import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createDemoApi, type Board as BoardRecord, type DemoSession, type Message } from './api.ts';
import type { DemoUser } from './config.ts';
import { CreateMessageDialog } from './CreateMessageDialog.tsx';
import { CreateBoardDialog } from './CreateBoardDialog.tsx';
import { BoardLink } from './BoardLink.tsx';
import { MessageLink, messageHref } from './MessageLink.tsx';
import { BoardNavigation, RecentMessages, boardTone } from './BoardSidebars.tsx';
import { readStoredSession, writeStoredSession } from './session.ts';

type BoardApi = ReturnType<typeof createDemoApi>;
const defaultApi = createDemoApi();
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Try again.';

export function App({ api = defaultApi, basePath = '/', sessionKey = 'message-board:session', initialBoardSlug, initialMessageId }: { api?: BoardApi; basePath?: string; sessionKey?: string; initialBoardSlug?: string; initialMessageId?: string }) {
  const [session, setSession] = useState<DemoSession | null>(() => readStoredSession(sessionKey));
  const [user, setUser] = useState<DemoUser>(session?.session.user_id ?? 'alice');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const generation = useRef(0);
  const busy = useRef(false);
  const loginSelect = useRef<HTMLSelectElement>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const afterLogin = useRef<(() => void) | null>(null);
  const loginOpener = useRef<HTMLElement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (loginOpen) loginSelect.current?.focus();
  }, [loginOpen]);

  function requireLogin(action?: () => void) {
    if (busy.current) return;
    if (session) { action?.(); return; }
    loginOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    afterLogin.current = action ?? null;
    setError('');
    setLoginOpen(true);
  }

  function restoreLoginOpener() {
    const opener = loginOpener.current;
    const target = opener?.isConnected ? opener : opener?.id ? document.getElementById(opener.id) : null;
    (target ?? document.getElementById('create-message'))?.focus();
  }

  function cancelLogin() {
    afterLogin.current = null;
    setLoginOpen(false);
    setError('');
    requestAnimationFrame(restoreLoginOpener);
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy.current || session) return;
    const request = ++generation.current;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const created = await api.login(user);
      if (request !== generation.current) {
        void api.logout(created).catch(() => {});
        return;
      }
      writeStoredSession(sessionKey, created);
      setSession(created);
      setLoginOpen(false);
      const resume = afterLogin.current;
      afterLogin.current = null;
      requestAnimationFrame(() => { restoreLoginOpener(); resume?.(); });
    } catch (cause) {
      if (request === generation.current) setError(errorText(cause));
    } finally {
      if (request === generation.current) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  async function logout() {
    if (!session || busy.current) return;
    const ended = session;
    const request = ++generation.current;
    busy.current = true;
    afterLogin.current = null;
    setLoginOpen(false);
    setCreateOpen(false);
    setSearch('');
    writeStoredSession(sessionKey, null);
    setSession(null);
    setPending(true);
    setError('');
    try {
      await api.logout(ended);
    } catch (cause) {
      if (request === generation.current) setError(`You are logged out in this browser, but the server could not revoke the session: ${errorText(cause)}`);
    } finally {
      if (request === generation.current) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className={`topbar${!loginOpen ? ' topbar--authenticated' : ''}`}>
      <a className="wordmark" href="https://mainbrella.com/bff/" aria-label="BFF home">bff<span aria-hidden="true">.</span></a>
      {!loginOpen ? <>
        <label className="topbar-search" htmlFor="global-message-search">
          <span className="visually-hidden">Search messages</span>
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
          <input id="global-message-search" type="search" placeholder="Search messages" autoComplete="off" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <div id="session-controls" className="session-controls">
          <button id="create-message" className="primary-button create-message-button" type="button" disabled={pending} onClick={() => requireLogin(() => setCreateOpen(true))}>
            <span aria-hidden="true">+</span> Create
          </button>
          {session ? <><span id="current-user" className="current-user"><span className="user-avatar" aria-hidden="true">{session.session.user_id.slice(0, 1).toUpperCase()}</span>{session.session.user_id}</span>
          <button id="logout" className="secondary-button" type="button" disabled={pending} onClick={() => void logout()}>Log out</button></>
            : <button id="login" className="secondary-button" type="button" disabled={pending} onClick={() => requireLogin()}>Log in</button>}
        </div>
      </> : <a className="back-link" href="https://mainbrella.com/bff/">Back to BFF <span aria-hidden="true">↗</span></a>}
    </header>
    <main id="main" className={`workspace${!loginOpen ? ' workspace--authenticated' : ''}`}>
      <div hidden={loginOpen}>
        {error && !loginOpen && <p className="login-feedback" role="alert">{error}</p>}
        <Board api={api} basePath={basePath} session={session} requireLogin={requireLogin} initialBoardSlug={initialBoardSlug} initialMessageId={initialMessageId} search={search} onSearch={setSearch} createOpen={createOpen} onCloseCreate={() => setCreateOpen(false)} />
      </div>
      {loginOpen && <>
        <div className="page-heading">
          <div><h1>Log in</h1><p>Log in to create a board, post, or edit a message.</p></div>
        </div>
        <section id="login-panel" className="login-panel" aria-label="Demo login">
          <form id="login-form" className="login-form" onSubmit={event => void login(event)}>
            <label className="user-control" htmlFor="login-user">
              <span className="toolbar-label">Demo user</span>
              <select ref={loginSelect} id="login-user" name="user" autoComplete="off" value={user} disabled={pending}
                onChange={event => setUser(event.target.value as DemoUser)}>
                <option value="alice">Alice</option><option value="bob">Bob</option>
              </select>
            </label>
            <button id="login-button" className="primary-button" type="submit" disabled={pending}>Log in</button>
          </form>
          <button className="secondary-button" type="button" disabled={pending} onClick={cancelLogin}>Back to messages</button>
          {error && <p id="login-feedback" className="login-feedback" role="alert">{error}</p>}
        </section></>}
    </main>
  </>;
}

function Board({ api, basePath, session, requireLogin, initialBoardSlug, initialMessageId, search, onSearch, createOpen, onCloseCreate }: { api: BoardApi; basePath: string; session: DemoSession | null; requireLogin: (action: () => void) => void; initialBoardSlug?: string; initialMessageId?: string; search: string; onSearch: (value: string) => void; createOpen: boolean; onCloseCreate: () => void }) {
  const [createBoardOpen, setCreateBoardOpen] = useState(false);
  const [data, setData] = useState<{ messages: Message[]; loaded: boolean; updated?: Date; error: string }>({ messages: [], loaded: false, error: '' });
  const [boards, setBoards] = useState<BoardRecord[]>([]);
  const [boardLookup, setBoardLookup] = useState<'loading' | 'available' | 'unavailable'>('loading');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'all' | 'mine'>(() => typeof window !== 'undefined' && session && new URLSearchParams(window.location.search).get('view') === 'mine' ? 'mine' : 'all');
  const [sort, setSort] = useState('newest');
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState('');
  const [editError, setEditError] = useState('');
  const [feedback, setFeedback] = useState('');
  const active = useRef(false);
  const serial = useRef(0);
  const boardSerial = useRef(0);
  const busy = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocus = useRef('');
  const restoredFragment = useRef('');

  function onCreated(message: Message, board?: BoardRecord) {
    boardSerial.current++;
    // Invalidate a feed refresh so it cannot overwrite this row. Keep an
    // in-flight edit's request serial and busy state intact so its completion
    // can still update the row and release the edit controls.
    if (loading && !saving) {
      serial.current++;
      busy.current = false;
      setLoading(false);
    }
    setData(previous => ({
      ...previous,
      messages: [message, ...previous.messages.filter(row => row.id !== message.id)],
      loaded: true,
      updated: new Date(),
      error: '',
    }));
    if (board) setBoards(previous => [...previous.filter(row => row.id !== board.id), board]);
    void loadBoards();
    setView('all');
    onSearch('');
    setSort('newest');
    setFeedback('Message posted.');
  }

  const loadBoards = useCallback(async () => {
    const request = ++boardSerial.current;
    setBoardLookup('loading');
    try {
      const result = await api.listBoards(session);
      if (active.current && request === boardSerial.current) {
        setBoards(result);
        setBoardLookup('available');
      }
    } catch {
      // Board metadata is supplementary: keep the message feed available.
      if (active.current && request === boardSerial.current) setBoardLookup('unavailable');
    }
  }, [api, session]);

  const load = useCallback(async () => {
    if (busy.current) return;
    void loadBoards();
    const request = ++serial.current;
    busy.current = true;
    setLoading(true);
    setFeedback('');
    setData(previous => ({ ...previous, error: '' }));
    try {
      const messages = await api.list(session, initialMessageId);
      if (active.current && request === serial.current) setData({ messages, loaded: true, updated: new Date(), error: '' });
    } catch (cause) {
      if (active.current && request === serial.current) setData(previous => ({ ...previous,
        error: navigator.onLine === false ? 'You appear to be offline. Reconnect and try again.' : errorText(cause),
      }));
    } finally {
      if (active.current && request === serial.current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [api, session, loadBoards, initialMessageId]);

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; serial.current++; boardSerial.current++; busy.current = false; };
  }, [load]);

  useEffect(() => {
    const hash = window.location.hash;
    if (!initialBoardSlug || !data.loaded || !hash || restoredFragment.current === hash) return;
    const rawId = hash.slice(1);
    let decodedId = rawId;
    try { decodedId = decodeURIComponent(rawId); } catch { /* Keep the literal fragment when it is malformed. */ }
    const target = document.getElementById(rawId) ?? document.getElementById(decodedId);
    if (!target) return;
    restoredFragment.current = hash;
    target.scrollIntoView({ block: 'start' });
  }, [data.loaded, initialBoardSlug, boards]);

  useEffect(() => {
    if (editingId && !saving) textarea.current?.focus();
    else if (!editingId && restoreFocus.current) {
      editButtons.current.get(restoreFocus.current)?.focus();
      restoreFocus.current = '';
    }
  }, [editingId, saving, editError]);

  useEffect(() => {
    if (!session) {
      setCreateBoardOpen(false);
      setSaving(false);
      setFeedback('');
      setEditingId('');
      setDraft('');
      setEditError('');
      setView('all');
    }
  }, [session]);

  function finishEditing() {
    restoreFocus.current = editingId;
    setEditingId('');
    setDraft('');
    setEditError('');
  }

  async function save(event: FormEvent, message: Message) {
    event.preventDefault();
    if (!session || busy.current || editingId !== message.id) return;
    const body = draft.trim();
    if (!body || body.length > 2000) {
      setEditError('Enter a message of 1–2000 characters.');
      textarea.current?.focus();
      return;
    }
    const request = ++serial.current;
    busy.current = true;
    setSaving(true);
    setEditError('');
    setFeedback('');
    try {
      const updated = await api.update(session, message, body);
      if (!active.current || request !== serial.current) return;
      if (!updated) { setEditError('No message was updated. Your edit was not saved.'); return; }
      setData(previous => ({ ...previous, messages: previous.messages.map(row => row.id === updated.id ? updated : row), updated: new Date() }));
      finishEditing();
      setFeedback('Message updated.');
    } catch (cause) {
      if (active.current && request === serial.current) setEditError(errorText(cause));
    } finally {
      if (active.current && request === serial.current) { busy.current = false; setSaving(false); }
    }
  }

  const term = search.trim().toLocaleLowerCase();
  const boardById = new Map(boards.map(board => [board.id, board]));
  const activeBoard = boards.find(board => board.slug === initialBoardSlug);
  const messagesInView = data.messages.filter(message => (!initialBoardSlug || activeBoard?.id === message.board_id)
    && (initialMessageId === undefined || message.id === initialMessageId)
    && (view === 'all' || message.user_id === session?.session.user_id));
  const visible = messagesInView.filter(message => {
    const board = boardById.get(message.board_id ?? '');
    return !term || message.user_id.toLocaleLowerCase().includes(term)
      || message.title.toLocaleLowerCase().includes(term) || message.body.toLocaleLowerCase().includes(term)
      || Boolean(board && `board/${board.slug}`.toLocaleLowerCase().includes(term));
  })
    .sort((a, b) => sort === 'oldest' ? Date.parse(a.created_at) - Date.parse(b.created_at) : Date.parse(b.created_at) - Date.parse(a.created_at));
  const boardCounts = new Map<string, number>();
  data.messages.forEach(message => { if (message.board_id) boardCounts.set(message.board_id, (boardCounts.get(message.board_id) ?? 0) + 1); });
  const boardLabel = (message: Message) => {
    if (!message.board_id) return 'No board';
    const board = boardById.get(message.board_id);
    return board ? `board/${board.slug}` : boardLookup === 'loading' ? 'Loading board…' : 'Board unavailable';
  };
  const count = `${messagesInView.length} ${messagesInView.length === 1 ? 'post' : 'posts'}`;
  const status = loading ? (data.loaded ? 'Refreshing messages…' : 'Loading messages…') : !data.loaded ? 'Message board unavailable' :
    `${term ? `${visible.length} of ` : ''}${count}${data.error ? ' · Showing last loaded data' : data.updated ? ` · Updated at ${data.updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`;

  return <div className="board-layout">
    {session && <CreateMessageDialog api={api} session={session} open={createOpen} onClose={onCloseCreate} onCreated={onCreated} />}
    {session && createBoardOpen && <CreateBoardDialog api={api} session={session} onClose={() => setCreateBoardOpen(false)}
      onCreated={board => { boardSerial.current++; setBoards(previous => [...previous.filter(row => row.id !== board.id), board]); setView('all'); setCreateBoardOpen(false); setFeedback(`Board “${board.name}” created.`); void loadBoards(); }} />}
    <BoardNavigation boards={boards} boardCounts={boardCounts} basePath={basePath} activeSlug={initialBoardSlug} view={view} onViewChange={initialBoardSlug ? undefined : setView} showMyMessages={Boolean(session)} boardLookup={boardLookup}
      footerHref="https://mainbrella.com/bff/" actions={<button id="create-board-button" className="board-nav-item create-board-button" type="button"
        onClick={() => requireLogin(() => setCreateBoardOpen(true))}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Create board
      </button>} />
    <div className="board-feed">
      <section id="board-panel" className="board" aria-labelledby="board-title">
        <div className={`feed-toolbar${initialBoardSlug ? ' feed-toolbar--board-detail' : ''}`}>
          <div><h1 id="board-title">{view === 'mine' ? 'My posts' : initialBoardSlug ? `board/${initialBoardSlug}` : 'All posts'}</h1>
          </div>
          <label className="sort-control" htmlFor="message-sort"><span className="visually-hidden">Sort by</span>
            <select id="message-sort" value={sort} onChange={event => setSort(event.target.value)}>
              <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
            </select>
          </label>
          <button id="refresh" className="refresh-button" type="button" aria-label="Refresh messages" disabled={loading || saving} onClick={() => void load()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.2 8a6.5 6.5 0 0 0-11.8-2L2.8 8M2.8 4.8V8h3.3M3.8 12a6.5 6.5 0 0 0 11.8 2l1.6-2M17.2 15.2V12h-3.3" /></svg><span>Refresh</span>
          </button>
        </div>
        {initialBoardSlug && activeBoard?.description && <p className="board-description board-detail-description">{activeBoard.description}</p>}
        <p id="board-status" className="status-line" role="status" aria-live="polite">{status}</p>
        <p id="board-feedback" className="board-feedback" role="status" aria-live="polite">{feedback}</p>
        {data.loaded && data.error && <p id="refresh-error" className="inline-error" role="alert">{data.error}</p>}
        <div id="message-list" className="message-list" aria-busy={loading}>
          {loading && !data.loaded ? Array.from({ length: 3 }, (_, index) => <div key={index} className="skeleton-row" aria-hidden="true">
            <span className="skeleton-circle" /><span className="skeleton-copy"><span className="skeleton-line short" /><span className="skeleton-line long" /></span>
          </div>) : visible.map(message => <article key={message.id} id={`message-${encodeURIComponent(message.id)}`} className="message-row" tabIndex={-1}>
            <div className="message-content">
              <div className="post-header">
                <span className={`board-icon board-icon--${boardTone(boardById.get(message.board_id ?? '')?.slug ?? '')}`} aria-hidden="true">{boardById.get(message.board_id ?? '')?.slug.charAt(0).toUpperCase() ?? '?'}</span>
                {boardById.has(message.board_id ?? '') ? <BoardLink basePath={basePath} className="message-board" board={boardById.get(message.board_id!)!} />
                  : <span className="message-board">{boardLabel(message)}</span>}
                <span className="meta-dot" aria-hidden="true">·</span>
                <time className="message-time" dateTime={message.created_at} title={new Date(message.created_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}>{formatRelative(message.created_at)}</time>
              </div>
              <h2 className="message-title"><MessageLink message={message} board={boardById.get(message.board_id ?? '')} basePath={basePath} /></h2>
              {editingId === message.id ? <form className="message-edit-form" onSubmit={event => void save(event, message)}>
                <label className="editor-label" htmlFor="edit-message">Edit message</label>
                <textarea ref={textarea} id="edit-message" name="body" rows={3} maxLength={2000} value={draft} disabled={saving}
                  aria-describedby={editError ? 'edit-error' : undefined} onChange={event => setDraft(event.target.value)} />
                {editError && <p id="edit-error" className="edit-error" role="alert">{editError}</p>}
                <div className="edit-actions">
                  <button className="primary-button" type="submit" disabled={saving || loading}>{saving ? 'Saving…' : 'Save message'}</button>
                  <button className="secondary-button" type="button" disabled={saving} onClick={finishEditing}>Cancel</button>
                </div>
              </form> : <p className="message-body">{message.body}</p>}
              <footer className="post-footer">
                <span className="message-author">{message.user_id}{session?.session.user_id === message.user_id && <> <span className="message-you">(you)</span></>}</span>
                <span className="post-actions">
                  {editingId !== message.id && <button ref={button => { if (button) editButtons.current.set(message.id, button); else editButtons.current.delete(message.id); }}
                    className="post-action" type="button" data-edit-id={message.id} disabled={saving || Boolean(editingId)}
                    onClick={() => requireLogin(() => { setEditingId(message.id); setDraft(message.body); setEditError(''); setFeedback(''); })}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10.8 2.2 3 3M2.5 13.5l2.8-.6 7.8-7.8a1.4 1.4 0 0 0-2-2l-7.8 7.8-.8 2.6Z" /></svg>Edit
                  </button>}
                  <a className="post-action" href={boardById.has(message.board_id ?? '') ? messageHref(boardById.get(message.board_id!)!.slug, message.id, basePath) : `#message-${encodeURIComponent(message.id)}`}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.2 9.8 9.8 6.2M5.4 11.6l-1 1a2.3 2.3 0 0 1-3.2-3.2l3-3a2.3 2.3 0 0 1 3.2 0M10.6 4.4l1-1a2.3 2.3 0 0 1 3.2 3.2l-3 3a2.3 2.3 0 0 1-3.2 0" /></svg>Link
                  </a>
                </span>
              </footer>
            </div>
          </article>)}
        </div>
        {!loading && (!data.loaded || visible.length === 0) && <div id="board-state" className="board-state">
          <strong>{!data.loaded ? 'Could not load messages' : term ? 'No matching messages' : view === 'mine' ? "You don't have any messages yet." : 'No messages yet'}</strong>
          {(!data.loaded || term || view === 'all') && <span>{!data.loaded ? data.error : term ? 'Try another name or search term.' : 'New public messages will appear here.'}</span>}
          {!data.loaded && <button className="state-action" type="button" onClick={() => void load()}>Try again</button>}
        </div>}
      </section>
    </div>
    <RecentMessages messages={initialBoardSlug ? data.messages : visible} boards={boards} basePath={basePath}
      loaded={data.loaded} loading={loading && !data.loaded} emptyText={term ? 'No matching messages.' : 'No messages yet.'} />
  </div>;
}

function formatRelative(value: string): string {
  const difference = (Date.parse(value) - Date.now()) / 1000;
  if (!Number.isFinite(difference)) return 'Date unavailable';
  const absolute = Math.abs(difference);
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] = absolute < 60 ? [Math.round(difference), 'second']
    : absolute < 3600 ? [Math.round(difference / 60), 'minute']
      : absolute < 86400 ? [Math.round(difference / 3600), 'hour']
        : absolute < 604800 ? [Math.round(difference / 86400), 'day']
          : absolute < 2629800 ? [Math.round(difference / 604800), 'week']
            : absolute < 31557600 ? [Math.round(difference / 2629800), 'month'] : [Math.round(difference / 31557600), 'year'];
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit);
}
