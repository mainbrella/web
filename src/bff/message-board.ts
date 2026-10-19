type Row = { id: string; user_id: string; body: string; created_at: string };
type User = { id: string; name: string };
type OwnerApi = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Session = { session: { id: string }; token: string };
type BrowserKey = { key: { id: string }; token: string };
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

// This owner-only workspace demo uses the same browser credentials and Data API
// as an external app. No owner credential is sent to a table request.
export function createMessageBoardDemo(apiOrigin: string, owner: OwnerApi) {
  let projectId = '', key: BrowserKey | undefined, session: Session | undefined, generation = 0;
  let users: User[] = [], messages: Row[] = [], userId = '', draft = '', editingId = '', feedback = '';
  const base = () => `/projects/${projectId}`;
  async function request<T>(suffix: string, method = 'GET', body?: unknown): Promise<T> {
    const token = generation;
    const response = await fetch(`${apiOrigin}/bff/data/${projectId}${suffix}`, {
      method, credentials: 'omit', headers: { apikey: key!.token, ...(session ? { authorization: `Bearer ${session.token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (token !== generation) throw new Error('The selected project changed.');
    if (!response.ok) throw new Error(response.status === 401 ? 'The demo session expired. End the demo and start again.'
      : response.status === 403 ? 'The current permissions do not allow this action.' : 'The message board request failed. Refresh and try again.');
    return result as T;
  }
  async function load() {
    messages = (await request<{ data: Row[] }>('/tables/messages?order=created_at.desc')).data;
  }
  async function switchUser(id: string) {
    const next = await owner<Session>(`${base()}/sessions`, 'POST', { userId: id });
    if (session) await owner(`${base()}/sessions/${session.session.id}`, 'DELETE');
    session = next; userId = id; editingId = ''; draft = ''; feedback = '';
    await load();
  }
  async function start(id: string) {
    projectId = id;
    if (!key) key = await owner<BrowserKey>(`${base()}/api-keys`, 'POST', {
      name: 'Message board demo', origins: [window.location.origin], tables: { users: ['select'], messages: ['select', 'insert', 'update', 'delete'] },
    });
    users = (await request<{ data: User[] }>('/tables/users')).data;
    if (!users.length) throw new Error('Add a user to the users table before starting the demo.');
    await switchUser(users[0].id);
  }
  async function stop() {
    if (session) await owner(`${base()}/sessions/${session.session.id}`, 'DELETE');
    if (key) await owner(`${base()}/api-keys/${key.key.id}`, 'DELETE');
    key = undefined; session = undefined; users = []; messages = []; userId = ''; draft = ''; editingId = ''; feedback = '';
  }
  function reset() {
    generation++;
    // Project switches and sign-out discard all demo credentials. Revocation is
    // best effort if the owner's session has already ended; user tokens expire.
    const paths = [...(session ? [`${base()}/sessions/${session.session.id}`] : []), ...(key ? [`${base()}/api-keys/${key.key.id}`] : [])];
    for (const path of paths) void fetch(`${apiOrigin}/bff${path}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    projectId = ''; key = undefined; session = undefined; users = []; messages = []; userId = ''; draft = ''; editingId = ''; feedback = '';
  }
  async function submit() {
    const body = draft.trim();
    if (!body || body.length > 2000) throw new Error('Enter a message of 1–2000 characters.');
    const result = await request<{ data: Row[] }>(`/tables/messages${editingId ? `?id=eq.${encodeURIComponent(editingId)}` : ''}`, editingId ? 'PATCH' : 'POST', { body });
    feedback = result.data.length ? (editingId ? 'Message updated.' : 'Message posted.') : '0 messages changed. You can only edit your own messages.';
    if (result.data.length) { draft = ''; editingId = ''; }
    await load();
  }
  async function remove(id: string) {
    const result = await request<{ meta: { changes: number } }>(`/tables/messages?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    feedback = result.meta.changes ? 'Message deleted.' : '0 messages changed. You can only delete your own messages.';
    await load();
  }
  function edit(id: string) {
    const message = messages.find(row => row.id === id);
    if (message) { editingId = id; draft = message.body; feedback = ''; }
  }
  function render(button: (text: string, action: string, value?: string, primary?: boolean, disabled?: boolean) => string,
    table: (headers: string[], rows: string[][], caption: string, empty?: string) => string, disabled: boolean) {
    let html = '<section class="bff-section"><h3>Message board demo</h3>';
    if (!session) return html + `<p class="bff-muted">Try posting as Alice or Bob. The Data API checks ownership on every write.</p><div class="bff-toolbar">${button('Start demo', 'demo-start', '', true, disabled)}${key ? button('End demo', 'demo-stop') : ''}</div></section>`;
    html += `<div class="bff-toolbar"><label for="bff-demo-user">Act as</label><select id="bff-demo-user" ${disabled ? 'disabled' : ''}>${users.map(user => `<option value="${escape(user.id)}" ${user.id === userId ? 'selected' : ''}>${escape(user.name)}</option>`).join('')}</select>${button('Refresh messages', 'demo-refresh', '', false, disabled)}${button('End demo', 'demo-stop')}</div>`;
    html += `<label class="bff-editor-label" for="bff-demo-body">${editingId ? 'Edit message' : 'New message'}</label><textarea id="bff-demo-body" class="bff-message-input" rows="2" maxlength="2000" ${disabled ? 'disabled' : ''}>${escape(draft)}</textarea><div class="bff-toolbar">${button(editingId ? 'Save message' : 'Post message', 'demo-submit', '', true, disabled)}${editingId ? button('Cancel edit', 'demo-cancel') : ''}</div>`;
    html += `<p class="bff-muted" role="status">${escape(feedback || 'Try editing another user’s post to see the ownership rule in action.')}</p>`;
    html += table(['User', 'Message', ''], messages.map(row => [escape(users.find(user => user.id === row.user_id)?.name || row.user_id), escape(row.body),
      `${button('Edit', 'demo-edit', row.id, false, disabled)} ${button('Delete', 'demo-delete', row.id, false, disabled)}`]), 'Message board', 'No messages yet.');
    return html + '</section>';
  }
  return { start, stop, reset, switchUser, submit, remove, edit, load, render,
    setDraft(value: string) { draft = value; }, cancelEdit() { editingId = ''; draft = ''; } };
}
