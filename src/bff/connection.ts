import type { Table, TablePolicy } from './app-data.ts';

type OwnerApi = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type BrowserKey = { id: string; name: string; prefix: string; origins: string[]; tables: Record<string, string[]>; functions: Record<string, number> };
type IssuedKey = { key: BrowserKey; token: string };
type Button = (text: string, action: string, value?: string, primary?: boolean, disabled?: boolean) => string;
type DataTable = (headers: string[], rows: string[][], caption: string, empty?: string) => string;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function createAppConnection(apiOrigin: string, owner: OwnerApi) {
  let keys: BrowserKey[] = [], issued: IssuedKey | undefined, generation = 0;
  let name = 'Frontend app', origins = 'http://localhost:5173';
  const base = (projectId: string) => `/projects/${projectId}`;
  function reset() {
    generation++; keys = []; issued = undefined; name = 'Frontend app'; origins = 'http://localhost:5173';
  }
  async function load(projectId: string) {
    const token = generation;
    const result = await owner<{ keys: BrowserKey[] }>(`${base(projectId)}/api-keys`);
    if (token !== generation) return;
    keys = result.keys;
    if (issued && !keys.some(key => key.id === issued!.key.id)) issued = undefined;
  }
  async function create(projectId: string, table: string) {
    const allowed = [...new Set(origins.split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
    if (!name.trim() || name.trim().length > 80) throw new Error('Enter a key name of 1–80 characters.');
    if (!allowed.length || allowed.length > 10 || allowed.some(value => {
      try { const url = new URL(value); return !['https:', 'http:'].includes(url.protocol) || url.origin !== value; }
      catch { return true; }
    })) throw new Error('Enter 1–10 exact http:// or https:// origins, one per line, without paths or trailing slashes.');
    if (!table) throw new Error('Select a table first.');
    const token = generation;
    const result = await owner<IssuedKey>(`${base(projectId)}/api-keys`, 'POST', {
      name: name.trim(), origins: allowed, tables: { [table]: ['select'] },
    });
    if (token !== generation) return;
    issued = result; keys.push(result.key);
  }
  async function enablePublicReads(projectId: string, table: string) {
    const { policies } = await owner<{ policies: TablePolicy[] }>(`${base(projectId)}/policies`);
    const current = policies.find(policy => policy.table === table);
    await owner(`${base(projectId)}/policies/${encodeURIComponent(table)}`, 'PUT', {
      select: 'public', insert: current?.insert ?? 'none', update: current?.update ?? 'none',
      delete: current?.delete ?? 'none', ownerColumn: current?.ownerColumn ?? null,
    });
  }
  async function revoke(projectId: string, keyId: string) {
    const token = generation;
    await owner(`${base(projectId)}/api-keys/${encodeURIComponent(keyId)}`, 'DELETE');
    if (token !== generation) return;
    keys = keys.filter(key => key.id !== keyId);
    if (issued?.key.id === keyId) issued = undefined;
  }
  function config(projectId: string, table: string) {
    return { apiOrigin: apiOrigin.replace(/\/$/, ''), projectId,
      publicKey: issued?.key.tables[table]?.includes('select') ? issued.token : 'YOUR_BFF_BROWSER_KEY', table };
  }
  function snippet(projectId: string, table: string) {
    return `const config = ${JSON.stringify(config(projectId, table), null, 2)};

const response = await fetch(
  \`\${config.apiOrigin}/bff/data/\${config.projectId}/tables/\${config.table}?select=*\`,
  { headers: { apikey: config.publicKey }, credentials: 'omit' }
);
const result = await response.json();
if (!response.ok) throw new Error(result.error || 'Could not load data.');
const { data } = result;`;
  }
  async function copy(projectId: string, table: string, format: 'config' | 'javascript') {
    if (!issued?.key.tables[table]?.includes('select')) throw new Error('Create a browser key for this table first.');
    try { await navigator.clipboard.writeText(format === 'config' ? JSON.stringify(config(projectId, table), null, 2) : snippet(projectId, table)); }
    catch { throw new Error('Could not copy. Select and copy the frontend code below.'); }
  }
  function render(projectId: string, tables: Table[], selected: string, policies: TablePolicy[], button: Button, table: DataTable, busy: boolean, disabled: boolean) {
    const readable = policies.some(policy => policy.table === selected && policy.select === 'public');
    const hasToken = !!issued?.key.tables[selected]?.includes('select');
    let html = `<dl class="bff-detail-list"><div><dt>API origin</dt><dd><code>${escape(apiOrigin)}</code></dd></div><div><dt>Project ID</dt><dd><code>${escape(projectId)}</code></dd></div></dl>`;
    if (!tables.length) html += `<p class="bff-empty">${disabled ? 'Tables are available when the project is ready and running.' : 'Create a table in Database to connect your frontend.'}</p>`;
    else {
      html += `<div class="bff-toolbar"><label for="bff-connect-table">Table</label><select id="bff-connect-table" ${busy ? 'disabled' : ''}>${tables.map(item => `<option value="${escape(item.name)}" ${item.name === selected ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select></div>`;
      html += readable ? '<p class="bff-muted">Public reads enabled. Browser keys with read access can read every row and column in this table.</p>'
        : `<p class="bff-muted">Public reads are disabled for this table.</p><div class="bff-toolbar">${button('Enable public reads', 'connect-enable-reads', '', false, disabled)}</div>`;
      html += `<form id="bff-connect-form" class="bff-section bff-connect-form"><div class="bff-field"><label for="bff-connect-name">Key name</label><input id="bff-connect-name" name="name" value="${escape(name)}" maxlength="80" required ${busy || disabled ? 'disabled' : ''}></div><div class="bff-field"><label for="bff-connect-origins">Allowed frontend origins</label><textarea id="bff-connect-origins" name="origins" rows="2" aria-describedby="bff-connect-origin-hint" spellcheck="false" required ${busy || disabled ? 'disabled' : ''}>${escape(origins)}</textarea><p id="bff-connect-origin-hint" class="bff-footnote">One exact origin per line, including the port for local development. No paths or trailing slashes. Up to 10 origins.</p></div><button type="submit" class="button button-small" ${busy || disabled || !readable ? 'disabled' : ''}>Create browser key</button><p class="bff-footnote">Read-only access to ${escape(selected)}. Use this scoped public key in your frontend.</p></form>`;
      html += `<section class="bff-section"><div class="bff-subheading"><h3>Frontend code</h3><div class="bff-actions">${button('Copy config', 'connect-copy-config', '', false, !hasToken)}${button('Copy JavaScript', 'connect-copy-javascript', '', false, !hasToken)}</div></div><p class="bff-muted">${hasToken ? 'Copy this key now. Its full value is only available in this workspace session.' : 'Create a browser key to fill in publicKey. Existing keys cannot be retrieved.'}</p><pre class="bff-code-output" tabindex="0" aria-label="Frontend JavaScript example"><code>${escape(snippet(projectId, selected))}</code></pre><p class="bff-footnote">No user login is needed for public reads. Responses contain data and meta. Reads return up to 100 rows; use limit, offset, and order to paginate.</p></section>`;
    }
    html += `<section class="bff-section"><h3>Browser keys</h3>${table(['Name / key prefix', 'Allowed origins', 'Access', ''], keys.map(key => [
      `${escape(key.name)}<span class="bff-cell-detail"><code>${escape(key.prefix)}…</code></span>`, key.origins.map(escape).join('<br>'),
      [...Object.entries(key.tables).map(([name, operations]) => `${escape(name)}: ${escape(operations.join(', '))}`), ...Object.entries(key.functions).map(([name, version]) => `${escape(name)}: v${escape(version)}`)].join('<br>'),
      `<button type="button" class="dashboard-retry bff-destructive" data-action="connect-revoke" data-value="${escape(key.id)}" ${busy ? 'disabled' : ''}>Revoke</button>`,
    ]), 'Project browser keys', 'No browser keys yet.')}</section>`;
    return html;
  }
  return { reset, load, create, enablePublicReads, revoke, copy, render,
    keyName: (id: string) => keys.find(key => key.id === id)?.name,
    setName(value: string) { name = value; }, setOrigins(value: string) { origins = value; } };
}
