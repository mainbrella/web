import './app.css';
import { deferred, navigation, type Execution, type Migration, type Project, type QueryResult, type SavedFunction, type Table, type TablePolicy } from './app-data.ts';
import { createBffApi } from './api.ts';
import { createMessageBoardDemo } from './message-board.ts';
import { createAppConnection } from './connection.ts';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const formatValue = (value: unknown) => value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const heading = (title: string, description = '', actions = '') => `<div class="bff-section-heading"><div><h2 id="bff-view-title" tabindex="-1">${escape(title)}</h2>${description ? `<p class="bff-muted">${escape(description)}</p>` : ''}</div><div class="bff-actions">${actions}</div></div>`;
const table = (headers: string[], rows: string[][], caption: string, empty = 'No rows.') => `<div class="bff-table-scroll" tabindex="0" role="region" aria-label="${escape(caption)}"><table class="bff-table"><caption class="visually-hidden">${escape(caption)}</caption><thead><tr>${headers.map(h => `<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="bff-muted">${escape(empty)}</td></tr>`}</tbody></table></div>`;
type Field = { name: string; label: string; value?: string; type?: string; hint?: string };
type Editor = { title: string; fields: Field[]; submit: string; save(values: Record<string, string>): Promise<void> };

export function initializeBff({ readSession, apiOrigin }: { readSession: () => Promise<{ user: { id?: string } } | null>; apiOrigin: string }) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const main = el('main'), content = el('bff-content'), view = el('bff-view'), nav = el('bff-navigation');
  const loading = el('bff-loading'), error = el('bff-error'), retry = el('bff-retry'), signIn = el('bff-signin');
  const dialog = el<HTMLDialogElement>('bff-dialog'), feedback = el('bff-feedback');
  let authenticated = false, userId: string | undefined, generation = 0, busy = false;
  let projects: Project[] = [], project: Project | undefined;
  let tables: Table[] = [], migrations: Migration[] = [], functions: SavedFunction[] = [], executions: Execution[] = [];
  let usage = { day: '', queries: 0, invocations: 0 }, available = false, functionsAvailable = false;
  let section = 'overview', tab = 'rows', selectedTable = '', rows: Record<string, unknown>[] = [], truncated = false;
  let sql = '', sqlResult: QueryResult | null = null;
  let editingName = '', editingVersion = 0, source = '', access = 'none', input = '{}', functionResult: unknown;
  let activeEditor: Editor | null = null, workspaceError = '';
  let policies: TablePolicy[] = [], users: Record<string, unknown>[] = [];
  const demo = createMessageBoardDemo(apiOrigin, api);
  const connection = createAppConnection(apiOrigin, api);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  function hideWorkspace() {
    authenticated = false; generation++; busy = false; activeEditor = null; content.hidden = true; dialog.close();
    loading.hidden = true; main.setAttribute('aria-busy', 'false');
    projects = []; project = undefined; clearData(); view.replaceChildren(); feedback.textContent = '';
    clearTimeout(feedbackTimer);
  }
  async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const token = generation;
    const client = createBffApi(apiOrigin, () => { if (token === generation) { hideWorkspace(); signIn.hidden = false; } });
    const response = await client<T>(path, method, body);
    if (token !== generation || !authenticated) throw new Error('Your session changed.');
    return response;
  }
  const path = (suffix = '') => `/projects/${project!.id}${suffix}`;
  const button = (text: string, action: string, value = '', primary = false, disabled = false) => `<button type="button" class="${primary ? 'button button-small' : 'dashboard-retry'}" data-action="${action}" data-value="${escape(value)}" ${busy || disabled ? 'disabled' : ''}>${escape(text)}</button>`;
  const canEdit = () => !!project && project.state === 'ready' && !project.suspended && available;

  function clearData() {
    demo.reset(); connection.reset(); policies = []; users = [];
    tables = []; migrations = []; functions = []; executions = []; rows = []; truncated = false;
    usage = { day: '', queries: 0, invocations: 0 }; selectedTable = ''; sql = ''; sqlResult = null;
    editingName = ''; editingVersion = 0; source = ''; input = '{}'; access = 'none'; functionResult = undefined; workspaceError = '';
  }
  function announce(message: string) {
    clearTimeout(feedbackTimer); feedback.textContent = message;
    feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 7_000);
  }
  function showError(caught: unknown) {
    workspaceError = caught instanceof Error ? caught.message : 'The operation failed. Try again.';
  }
  function resultTable(result: QueryResult) {
    const headers = [...new Set(result.results.flatMap(row => Object.keys(row)))];
    return headers.length ? table(headers, result.results.map(row => headers.map(key => escape(formatValue(row[key])))), 'Query results') : `<p class="bff-empty">0 rows returned.${result.meta?.changes ? ` ${escape(result.meta.changes)} changes.` : ''}</p>`;
  }
  function tabs(items: [string, string][]) {
    return `<div class="bff-local-tabs">${items.map(([id, label]) => `<button type="button" class="bff-tab" data-action="tab" data-value="${id}" aria-pressed="${tab === id}" ${busy ? 'disabled' : ''}>${label}</button>`).join('')}</div>`;
  }
  function overview() {
    return heading('Project overview', project ? project.name : 'No projects yet.', project ? button('Connect app', 'open-connect') : '') +
      `<dl class="bff-metrics">${[['Tables', tables.length], [truncated ? 'Rows (first 50 tables)' : 'Rows', tables.reduce((sum, item) => sum + item.count, 0)], [migrations.length === 100 ? 'Migrations (latest 100)' : 'Migrations', migrations.length], ['Functions', functions.length]].map(([label, value]) => `<div><dt>${label}${label === 'Tables' && truncated ? ' (first 50)' : ''}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>` +
      (project ? `<dl class="bff-detail-list"><div><dt>Project ID</dt><dd><code>${escape(project.id)}</code></dd></div><div><dt>Status</dt><dd>${project.suspended ? 'Paused' : escape(project.state)}</dd></div></dl>` : button('Create project', 'create-project', '', true, !available)) +
      (migrations.some(item => item.name === 'message_board') ? `<div class="bff-toolbar">${button('Try message board and row permissions', 'open-permissions')}</div>` : '') +
      `<section class="bff-section"><h3>Recent function executions</h3>${executionTable()}</section>`;
  }
  function permissions() {
    return heading('Permissions', 'Public reads and ownership rules are enforced by the Data API and function database calls.') +
      table(['Table', 'Read', 'Insert', 'Update', 'Delete', 'Ownership column'], policies.map(policy => [escape(policy.table), policy.select === 'public' ? 'Everyone' : 'Denied',
        ...[policy.insert, policy.update, policy.delete].map(value => value === 'own' ? 'Own rows' : 'Denied'), escape(policy.ownerColumn || '—')]), 'Table permissions', 'No table policies. Browser access is denied.') +
      (migrations.some(item => item.name === 'message_board') ? demo.render(button, table, busy || !canEdit()) : '');
  }
  function authentication() {
    return heading('Authentication', 'Project users. The owner can issue one-hour demo sessions through the API; public signup and password login are not configured.') +
      table(['User ID', 'Name', 'Created'], users.map(user => [escape(user.id), escape(user.name), escape(user.created_at)]), 'Application users', 'No application users.');
  }
  function database() {
    const rowCount = tables.reduce((sum, item) => sum + item.count, 0);
    let html = heading('Database', `${tables.length} ${tables.length === 1 ? 'table' : 'tables'} · ${rowCount} ${rowCount === 1 ? 'row' : 'rows'}`, button('New table', 'new-table', '', true, !canEdit()));
    html += tabs([['rows', 'Table editor'], ['schema', 'Schema'], ['migrations', 'Migrations'], ['backups', 'Backups']]);
    if (tab === 'migrations') return html + table(['Number', 'Migration', 'Applied', ''], migrations.map(item => [String(item.sequence), escape(item.name), escape(item.applied_at), button('View SQL', 'view-migration', String(item.sequence))]), 'Applied migrations', '0 migrations applied.') + `<div class="bff-toolbar">${button('Create migration', 'new-migration', '', true, !canEdit())}</div>`;
    if (tab === 'backups') return html + '<p class="bff-empty">Backup management is not available in v0.0.1.</p>';
    const selected = tables.find(item => item.name === selectedTable);
    if (!selected) return html + table(['Table', 'Rows'], [], 'Database tables', '0 tables. Create a table or apply a migration to get started.');
    html += `<div class="bff-toolbar"><label for="bff-table-select">Table</label><select id="bff-table-select" ${busy ? 'disabled' : ''}>${tables.map(item => `<option ${item.name === selectedTable ? 'selected' : ''} value="${escape(item.name)}">${escape(item.name)}</option>`).join('')}</select><span class="bff-muted">${selected.count} rows</span></div>`;
    if (tab === 'schema') return html + table(['Column', 'Type', 'Required', 'Default', 'Primary key'], selected.columns.map(column => [escape(column.name), escape(column.type), column.notnull ? 'Yes' : 'No', escape(formatValue(column.dflt_value)), column.pk ? 'Yes' : 'No']), `${selected.name} schema`) + `<pre class="bff-code-output">${escape(selected.sql)}</pre>`;
    return html + `<div class="bff-toolbar">${button('Insert row', 'insert-row', '', false, !canEdit())}<span class="bff-muted">Showing ${rows.length} of ${selected.count} rows · first 100</span></div>` + table(selected.columns.map(column => column.name), rows.map(row => selected.columns.map(column => escape(formatValue(row[column.name])))), `${selected.name} rows`, '0 rows.');
  }
  function sqlEditor() {
    return heading('SQL editor', 'One SELECT, INSERT, UPDATE, or DELETE statement. Apply schema changes through migrations.') +
      `<label for="bff-sql" class="bff-editor-label">SQL · SQLite</label><textarea id="bff-sql" class="bff-code-editor" rows="8" spellcheck="false" placeholder="Enter SQL…">${escape(sql)}</textarea><div class="bff-toolbar">${button('Run SQL', 'run-sql', '', true, !canEdit() || !sql.trim())}${button('Create migration', 'new-migration', '', false, !canEdit())}</div>` + (sqlResult ? resultTable(sqlResult) : '<p class="bff-empty">0 results. Run a query to see its results.</p>');
  }
  function functionView() {
    let html = heading('Functions', `${functions.length} functions · isolated JavaScript · outbound networking disabled`, button('New function', 'new-function', '', true, !canEdit()));
    html += table(['Function', 'Version', 'Database access', 'Updated', ''], functions.map(fn => [escape(fn.name), String(fn.version), escape(fn.database_access), escape(fn.created_at), button('Open', 'open-function', fn.name)]), 'Saved functions', '0 functions.');
    if (!editingName) return html;
    return html + `<section class="bff-section"><h3>${escape(editingName)} · ${editingVersion ? `version ${editingVersion}` : 'unsaved'}</h3><label for="bff-function-source" class="bff-editor-label">JavaScript ES module · export default async function(input, ctx)</label><textarea id="bff-function-source" class="bff-code-editor" rows="12" spellcheck="false">${escape(source)}</textarea><div class="bff-toolbar"><label for="bff-function-access">Database access</label><select id="bff-function-access" ${busy ? 'disabled' : ''}>${['none', 'read', 'write'].map(value => `<option ${value === access ? 'selected' : ''}>${value}</option>`).join('')}</select>${button('Save version', 'save-function', '', true, !canEdit())}</div><p class="bff-footnote">ctx.db supports select(table, filters, limit), insert(table, row), update(table, filters, row), and remove(table, filters). No raw SQL. 50 ms CPU · 5 seconds · 10 database calls.</p><label for="bff-function-input" class="bff-editor-label">Input · JSON</label><textarea id="bff-function-input" class="bff-code-editor" rows="3" spellcheck="false">${escape(input)}</textarea><div class="bff-toolbar">${button(`Run saved version${editingVersion ? ` ${editingVersion}` : ''}`, 'invoke-function', '', false, !canEdit() || !editingVersion || !functionsAvailable)}</div>${functionResult === undefined ? '' : `<pre class="bff-code-output">${escape(JSON.stringify(functionResult, null, 2))}</pre>`}</section>`;
  }
  function executionTable() {
    return table(['Time', 'Function', 'Version', 'Status', 'Duration'], executions.map(item => [escape(item.created_at), escape(item.function_name), String(item.version), escape(item.status), item.duration_ms === null ? '—' : `${item.duration_ms} ms`]), 'Function executions', '0 executions.');
  }
  function settings() {
    return heading('Settings') + (project ? `<dl class="bff-detail-list"><div><dt>Name</dt><dd>${escape(project.name)}</dd></div><div><dt>Created</dt><dd>${escape(project.created_at)}</dd></div><div><dt>Access</dt><dd>Project owner only</dd></div><div><dt>Functions</dt><dd>Networking denied; database access granted per function</dd></div><div><dt>Status</dt><dd>${project.suspended ? 'Paused' : escape(project.state)} ${button(project.suspended ? 'Resume project' : 'Pause project', 'pause-project')}</dd></div></dl>` : '<p class="bff-empty">No project selected.</p>');
  }
  function render(focus = false) {
    if (!authenticated) return;
    nav.innerHTML = `<label class="visually-hidden" for="bff-section-select">Workspace section</label><select id="bff-section-select" class="bff-mobile-nav" ${busy ? 'disabled' : ''}>${navigation.flatMap(group => group.items).map(([id, label]) => `<option value="${id}" ${section === id ? 'selected' : ''}>${label}</option>`).join('')}</select><div class="bff-nav-groups">${navigation.map(group => `<div class="bff-nav-group">${group.label ? `<p>${group.label}</p>` : ''}${group.items.map(([id, label]) => `<a href="#${id}" ${section === id ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</div>`).join('')}</div>`;
    el('bff-project-name').textContent = project?.name || 'No project';
    el('bff-project-description').textContent = project ? `${project.suspended ? 'Paused' : project.state} · Owner access` : 'Create your first project';
    el('bff-project-mark').textContent = project?.name.charAt(0).toUpperCase() || 'B';
    el<HTMLButtonElement>('bff-create-project').disabled = busy || !available;
    el<HTMLButtonElement>('bff-project-picker').disabled = busy || !projects.length;
    const renderers: Record<string, () => string> = {
      overview, database, permissions, auth: authentication, sql: sqlEditor, functions: functionView, logs: () => heading('Logs', 'Most recent 100 function executions. Inputs and results are not stored.') + executionTable(), settings,
      connect: () => heading('Connect app', 'Read your project’s data from your frontend with a scoped public key.') + (project ? connection.render(project.id, tables, selectedTable, policies, button, table, busy, !canEdit()) : '<p class="bff-empty">Create a project to connect your frontend.</p>'),
      usage: () => heading('Usage', usage.day ? `${usage.day} · UTC` : 'No usage yet.') + table(['Resource', 'Used today', 'Daily limit'], [['Database statements', String(usage.queries), '10,000'], ['Function invocations', String(usage.invocations), '1,000']], 'Daily usage'),
    };
    const unavailable = deferred[section];
    const status = !available ? '<p class="bff-muted">BFF is not configured on this server.</p>' : project && project.state !== 'ready' ? `<p class="bff-muted">Database ${project.state === 'error' ? 'provisioning failed' : 'not provisioned'}. ${button('Provision database', 'provision', '', false, project.suspended)}</p>` : project?.suspended ? '<p class="bff-muted">This project is paused. Resume it in Settings.</p>' : '';
    view.innerHTML = `${workspaceError ? `<p class="dashboard-error" role="alert">${escape(workspaceError)} ${button('Refresh', 'refresh')}</p>` : ''}${status}${busy ? '<p class="bff-muted" role="status">Working…</p>' : ''}${unavailable ? heading(unavailable.title, 'Not available in v0.0.1.') + table(unavailable.headers, [], unavailable.title, `0 rows. ${unavailable.empty}`) : (renderers[section] || overview)()}${truncated && section === 'database' ? '<p class="bff-footnote">Showing the first 50 tables. Other tables remain accessible through SQL.</p>' : ''}`;
    if (focus) el('bff-view-title').focus();
  }

  async function loadRows(token = generation) {
    const selected = tables.find(item => item.name === selectedTable);
    if (!selected || !canEdit()) { rows = []; return; }
    const response = await api<{ result: QueryResult }>(path('/query'), 'POST', { sql: `SELECT * FROM ${quote(selected.name)} LIMIT 100` });
    if (token === generation) rows = response.result.results;
  }
  async function refresh(token = generation) {
    if (!project) return;
    const base = path();
    const latest = await api<{ project: Project }>(base);
    if (token !== generation) return;
    project = latest.project; projects = projects.map(item => item.id === project!.id ? project! : item);
    if (!canEdit()) {
      tables = []; rows = []; migrations = []; functions = []; policies = []; users = []; demo.reset();
      const [logs, counts] = await Promise.all([api<{ executions: Execution[] }>(`${base}/executions`), api<typeof usage>(`${base}/usage`), connection.load(project.id)]);
      if (token === generation) { executions = logs.executions; usage = counts; }
      return;
    }
    const [schema, history, saved, logs, rules] = await Promise.all([
      api<{ tables: Table[]; truncated: boolean }>(`${base}/schema`), api<{ migrations: Migration[] }>(`${base}/migrations`),
      api<{ functions: SavedFunction[] }>(`${base}/functions`), api<{ executions: Execution[] }>(`${base}/executions`),
      api<{ policies: TablePolicy[] }>(`${base}/policies`),
      connection.load(project.id),
    ]);
    if (token !== generation) return;
    tables = schema.tables; truncated = schema.truncated; migrations = history.migrations; functions = saved.functions; executions = logs.executions;
    policies = rules.policies; users = [];
    if (tables.some(item => item.name === 'users' && ['id', 'name', 'created_at'].every(name => item.columns.some(column => column.name === name)))) {
      users = (await api<{ result: QueryResult }>(`${base}/query`, 'POST', { sql: 'SELECT id,name,created_at FROM users LIMIT 100' })).result.results;
    }
    if (!tables.some(item => item.name === selectedTable)) selectedTable = tables[0]?.name || '';
    await loadRows(token);
    if (token === generation) usage = await api<typeof usage>(`${base}/usage`);
  }
  async function work(task: () => Promise<void>) {
    if (busy) return;
    const token = generation;
    busy = true; workspaceError = ''; main.setAttribute('aria-busy', 'true'); render();
    try { await task(); } catch (caught) { if (token === generation) showError(caught); }
    finally { if (token === generation) { busy = false; main.setAttribute('aria-busy', 'false'); render(); } }
  }
  function editor(next: Editor) {
    activeEditor = next; el('bff-dialog-title').textContent = next.title;
    el('bff-dialog-body').innerHTML = `<form id="bff-editor-form">${next.fields.map(field => `<div class="bff-field"><label for="bff-field-${field.name}">${escape(field.label)}</label>${field.type === 'textarea' ? `<textarea id="bff-field-${field.name}" name="${field.name}" rows="7" required spellcheck="false">${escape(field.value || '')}</textarea>` : `<input id="bff-field-${field.name}" name="${field.name}" type="${field.type || 'text'}" value="${escape(field.value || '')}" required />`}${field.hint ? `<p class="bff-footnote">${escape(field.hint)}</p>` : ''}</div>`).join('')}<p id="bff-editor-error" class="dashboard-error" role="alert" hidden></p><button class="button button-small" type="submit">${escape(next.submit)}</button></form>`;
    dialog.showModal();
  }
  function migrationEditor(sqlValue = '', nameValue = '') {
    const sequence = (migrations[0]?.sequence || 0) + 1;
    editor({ title: 'Apply migration', fields: [{ name: 'sequence', label: 'Sequence', value: String(sequence), type: 'number' }, { name: 'name', label: 'Migration name', value: nameValue, hint: 'Letters, numbers, and underscores; start with a letter.' }, { name: 'sql', label: 'SQL', type: 'textarea', value: sqlValue, hint: 'All statements apply atomically. Applied migrations are immutable.' }], submit: 'Apply migration', async save(values) {
      await api(path('/migrations'), 'POST', { ...values, sequence: Number(values.sequence) });
      dialog.close(); await refresh(); announce('Migration applied.');
    } });
  }
  async function action(name: string, value: string) {
    if (name === 'close-dialog') { if (!busy) dialog.close(); return; }
    if (busy || !authenticated) return;
    if (name === 'tab') { tab = value; render(); return; }
    if (name === 'open-permissions') { location.hash = 'permissions'; return; }
    if (name === 'open-connect') { location.hash = 'connect'; return; }
    if (name === 'connect-enable-reads' && project && selectedTable && canEdit()) {
      const projectId = project.id, tableName = selectedTable;
      editor({ title: `Enable public reads for ${tableName}?`, fields: [], submit: 'Enable public reads', async save() {
        await connection.enablePublicReads(projectId, tableName); dialog.close(); await refresh(); announce('Public reads enabled.');
      } });
      el('bff-editor-form').insertAdjacentHTML('afterbegin', '<p class="bff-dialog-note">Every row and column, including future additions, will be readable by anyone holding a browser key with read access to this table. Existing keys with read access will also gain access. Write permissions stay the same.</p>');
      return;
    }
    if (name === 'connect-revoke' && project) {
      const projectId = project.id;
      editor({ title: `Revoke ${connection.keyName(value) || 'browser key'}?`, fields: [], submit: 'Revoke key', async save() {
        await connection.revoke(projectId, value); dialog.close(); announce('Browser key revoked.');
      } });
      el('bff-editor-form').insertAdjacentHTML('afterbegin', '<p class="bff-dialog-note">Apps using this key will lose access. This cannot be undone.</p>');
      el<HTMLFormElement>('bff-editor-form').querySelector('button')!.classList.add('bff-destructive');
      return;
    }
    if (name === 'demo-edit') { demo.edit(value); render(); el('bff-demo-body').focus(); return; }
    if (name === 'demo-cancel') { demo.cancelEdit(); render(); return; }
    if (name === 'demo-delete') {
      editor({ title: 'Delete message?', fields: [], submit: 'Delete message', async save() {
        await demo.remove(value); dialog.close();
      } }); return;
    }
    if (name === 'create-project') {
      editor({ title: 'Create project', fields: [{ name: 'name', label: 'Project name' }], submit: 'Create project', async save(values) {
        const response = await api<{ project: Project }>('/projects', 'POST', values);
        if (!authenticated) return;
        project = response.project; if (!projects.some(item => item.id === project!.id)) projects.push(project);
        clearData(); dialog.close();
        const ready = await api<{ project: Project }>(path('/provision'), 'POST'); project = ready.project;
        await refresh(); announce('Project created.');
      } }); return;
    }
    if (name === 'projects') {
      editor({ title: 'Select project', fields: [], submit: 'Close', async save() { dialog.close(); } });
      el('bff-editor-form').insertAdjacentHTML('afterbegin', table(['Project', 'Status', ''], projects.map(item => [escape(item.name), item.suspended ? 'Paused' : escape(item.state), button('Open', 'select-project', item.id)]), 'Your projects'));
      return;
    }
    if (name === 'select-project') {
      project = projects.find(item => item.id === value); generation++; clearData(); dialog.close(); await work(() => refresh()); return;
    }
    if (name === 'new-migration') { migrationEditor(); return; }
    if (name === 'new-table') {
      editor({ title: 'Create table', fields: [{ name: 'name', label: 'Table name', hint: 'Letters, numbers, and underscores; start with a letter.' }], submit: 'Review migration', async save(values) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(values.name)) throw new Error('Enter a valid table name.');
        migrationEditor(`CREATE TABLE ${quote(values.name)} (\n  id TEXT PRIMARY KEY NOT NULL\n);`, `create_${values.name}`.slice(0, 63));
      } }); return;
    }
    if (name === 'view-migration') {
      const migration = migrations.find(item => item.sequence === Number(value));
      if (migration) { editor({ title: migration.name, fields: [], submit: 'Close', async save() { dialog.close(); } }); el('bff-editor-form').insertAdjacentHTML('afterbegin', `<pre class="bff-code-output">${escape(migration.sql)}</pre><p class="bff-footnote">SHA-256: ${escape(migration.checksum)}</p>`); }
      return;
    }
    if (name === 'insert-row') {
      editor({ title: `Insert into ${selectedTable}`, fields: [{ name: 'row', label: 'Row · JSON object', type: 'textarea', value: '{}', hint: 'Omit columns to use their SQLite defaults.' }], submit: 'Insert row', async save(values) {
        const row = JSON.parse(values.row) as Record<string, unknown>;
        const selected = tables.find(item => item.name === selectedTable)!;
        if (!row || Array.isArray(row) || typeof row !== 'object' || !Object.keys(row).length) throw new Error('Enter a nonempty JSON object.');
        const keys = Object.keys(row);
        if (keys.some(key => !selected.columns.some(column => column.name === key))) throw new Error('Use columns from this table.');
        await api(path('/query'), 'POST', { sql: `INSERT INTO ${quote(selectedTable)} (${keys.map(quote).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, params: keys.map(key => row[key]) });
        dialog.close(); await refresh(); announce('Row inserted.');
      } }); return;
    }
    if (name === 'new-function') {
      editor({ title: 'New function', fields: [{ name: 'name', label: 'Function name', hint: 'Letters, numbers, and underscores; start with a letter.' }], submit: 'Open editor', async save(values) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(values.name) || functions.some(fn => fn.name === values.name)) throw new Error('Enter a valid, unused function name.');
        editingName = values.name; editingVersion = 0; access = 'none'; source = 'export default async function(input, ctx) {\n  return input;\n}\n'; functionResult = undefined;
        dialog.close();
      } }); return;
    }
    if (!project) return;
    await work(async () => {
      switch (name) {
        case 'connect-copy-config': await connection.copy(project!.id, selectedTable, 'config'); announce('Frontend config copied.'); break;
        case 'connect-copy-javascript': await connection.copy(project!.id, selectedTable, 'javascript'); announce('JavaScript copied.'); break;
        case 'demo-start': await demo.start(project!.id); break;
        case 'demo-stop': await demo.stop(); break;
        case 'demo-refresh': await demo.load(); break;
        case 'demo-submit': await demo.submit(); break;
        case 'refresh': await refresh(); break;
        case 'provision': project = (await api<{ project: Project }>(path('/provision'), 'POST')).project; await refresh(); break;
        case 'run-sql': {
          sqlResult = (await api<{ result: QueryResult }>(path('/query'), 'POST', { sql })).result;
          await refresh(); announce('SQL completed.'); break;
        }
        case 'open-function': {
          const response = await api<{ function: SavedFunction }>(path(`/functions/${encodeURIComponent(value)}`));
          editingName = response.function.name; editingVersion = response.function.version; source = response.function.source || ''; access = response.function.database_access; functionResult = undefined; break;
        }
        case 'save-function': {
          const response = await api<{ version: number }>(path(`/functions/${editingName}`), 'PUT', { source, databaseAccess: access, expectedVersion: editingVersion });
          editingVersion = response.version; await refresh(); announce(`Version ${editingVersion} saved.`); break;
        }
        case 'invoke-function': {
          let parsed: unknown;
          try { parsed = JSON.parse(input); } catch { throw new Error('Enter valid JSON input.'); }
          functionResult = await api(path(`/functions/${editingName}/invoke`), 'POST', { input: parsed, version: editingVersion }); await refresh(); break;
        }
        case 'pause-project': {
          project = (await api<{ project: Project }>(path(), 'PATCH', { suspended: !project!.suspended })).project;
          await refresh(); announce(project.suspended ? 'Project paused.' : 'Project resumed.'); break;
        }
      }
    });
  }

  document.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (target && !target.disabled) void action(target.dataset.action!, target.dataset.value || '');
  });
  document.addEventListener('submit', event => {
    const form = event.target as HTMLFormElement;
    if (form.id === 'bff-connect-form') {
      event.preventDefault();
      if (!busy && authenticated && project && canEdit() && policies.some(policy => policy.table === selectedTable && policy.select === 'public')) {
        void work(async () => { await connection.create(project!.id, selectedTable); announce('Browser key created. Copy your frontend code now.'); });
      }
      return;
    }
    if (form.getAttribute('id') !== 'bff-editor-form' || !activeEditor || !authenticated) return;
    event.preventDefault(); if (busy) return;
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const previous = activeEditor, token = generation;
    busy = true; form.querySelectorAll<HTMLButtonElement>('button').forEach(item => { item.disabled = true; }); render();
    void previous.save(values).then(() => { if (activeEditor === previous) { dialog.close(); activeEditor = null; } }).catch(caught => {
      if (token !== generation) return;
      if (!dialog.open) showError(caught);
      else { el('bff-editor-error').textContent = caught instanceof Error ? caught.message : 'Could not save. Try again.'; el('bff-editor-error').hidden = false; }
    }).finally(() => { if (token === generation) { busy = false; form.querySelectorAll<HTMLButtonElement>('button').forEach(item => { item.disabled = false; }); render(); } });
  });
  view.addEventListener('input', event => {
    const target = event.target as HTMLInputElement;
    if (target.id === 'bff-sql') { sql = target.value; sqlResult = null; view.querySelector<HTMLButtonElement>('[data-action="run-sql"]')!.disabled = busy || !canEdit() || !sql.trim(); }
    if (target.id === 'bff-function-source') source = target.value;
    if (target.id === 'bff-function-input') input = target.value;
    if (target.id === 'bff-demo-body') demo.setDraft(target.value);
    if (target.id === 'bff-connect-name') connection.setName(target.value);
    if (target.id === 'bff-connect-origins') connection.setOrigins(target.value);
  });
  view.addEventListener('change', event => {
    const target = event.target as HTMLSelectElement;
    if (target.id === 'bff-table-select') { selectedTable = target.value; void work(() => loadRows()); }
    if (target.id === 'bff-connect-table') { selectedTable = target.value; void work(() => loadRows()).then(() => el('bff-connect-table')?.focus()); }
    if (target.id === 'bff-function-access') access = target.value;
    if (target.id === 'bff-demo-user') void work(() => demo.switchUser(target.value));
  });
  nav.addEventListener('change', event => { const target = event.target as HTMLSelectElement; if (target.id === 'bff-section-select') location.hash = target.value; });
  function navigate() {
    const requested = location.hash.slice(1);
    section = navigation.some(group => group.items.some(([id]) => id === requested)) ? requested : 'overview';
    tab = 'rows'; render(true);
  }
  window.addEventListener('hashchange', navigate);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });

  async function load() {
    const token = ++generation;
    loading.hidden = false; error.hidden = true; retry.hidden = true; signIn.hidden = true; main.setAttribute('aria-busy', 'true');
    try {
      const session = await readSession();
      if (token !== generation) return;
      if (!session?.user) { hideWorkspace(); signIn.hidden = false; loading.hidden = true; main.setAttribute('aria-busy', 'false'); return; }
      userId = session.user.id; authenticated = true;
      const [config, list] = await Promise.all([api<{ available: boolean; functionsAvailable: boolean }>('/config'), api<{ projects: Project[] }>('/projects')]);
      if (token !== generation) return;
      available = config.available; functionsAvailable = config.functionsAvailable; projects = list.projects;
      project = projects[0]; clearData();
      if (project) { try { await refresh(token); } catch (caught) { if (token === generation) showError(caught); } }
      if (token !== generation) return;
      content.hidden = false; navigate();
    } catch (caught) {
      if (token !== generation) return;
      hideWorkspace(); error.textContent = caught instanceof Error ? caught.message : 'Could not load BFF. Try again.'; error.hidden = false; retry.hidden = false;
    } finally { if (token === generation || !authenticated) { loading.hidden = true; main.setAttribute('aria-busy', 'false'); } }
  }
  retry.addEventListener('click', () => { void load(); });
  window.addEventListener('auth-change', event => {
    const user = (event as CustomEvent<{ user: { id?: string } | null }>).detail?.user;
    if (user && authenticated && user.id === userId) return;
    hideWorkspace(); if (user) void load(); else { signIn.hidden = false; loading.hidden = true; main.setAttribute('aria-busy', 'false'); }
  });
  void load();
}
