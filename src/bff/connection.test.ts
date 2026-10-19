import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createAppConnection } from './connection.ts';
import type { TablePolicy } from './app-data.ts';

type OwnerApi = Parameters<typeof createAppConnection>[1];
const key = { id: 'browser-key', name: 'Frontend app', prefix: 'bff_pk_1234', origins: ['https://app.example'], tables: { notes: ['select'] }, functions: {} };
const issued = { key, token: `bff_pk_${'a'.repeat(64)}` };
function clipboard(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let copied = '';
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async writeText(value: string) { copied = value; } } } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'navigator', original); else Reflect.deleteProperty(globalThis, 'navigator'); });
  return () => copied;
}

test('frontend config and executable example use the actual scoped key without owner cookies', async t => {
  const copied = clipboard(t);
  const requests: unknown[][] = [];
  const connection = createAppConnection('https://api-stg.mainbrella.com/', (async (...args: unknown[]) => { requests.push(args); return issued; }) as OwnerApi);
  connection.setName(' My frontend ');
  connection.setOrigins('https://app.example\nhttp://localhost:5173\nhttps://app.example\n');
  await connection.create('project-id', 'notes');
  assert.deepEqual(requests, [['/projects/project-id/api-keys', 'POST', {
    name: 'My frontend', origins: ['https://app.example', 'http://localhost:5173'], tables: { notes: ['select'] },
  }]], 'creating a key never changes table permissions');
  await connection.copy('project-id', 'notes', 'config');
  assert.deepEqual(JSON.parse(copied()), { apiOrigin: 'https://api-stg.mainbrella.com', projectId: 'project-id', publicKey: issued.token, table: 'notes' });
  await connection.copy('project-id', 'notes', 'javascript');
  const run = new Function('fetch', `return (async () => { ${copied()}\nreturn data; })()`);
  const rows = [{ id: 'one', body: 'Hello' }];
  const result = await run(async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://api-stg.mainbrella.com/bff/data/project-id/tables/notes?select=*');
    assert.deepEqual(options, { headers: { apikey: issued.token }, credentials: 'omit' });
    return Response.json({ data: rows, meta: {} });
  });
  assert.deepEqual(result, rows);
  await assert.rejects(run(async () => Response.json({ error: 'permission_denied' }, { status: 403 })), /permission_denied/);
  await assert.rejects(connection.copy('project-id', 'private_table', 'config'), /Create a browser key/);
});

test('invalid origins are rejected before creating any key and form input survives failures', async t => {
  clipboard(t);
  let requests = 0;
  const connection = createAppConnection('https://api.example', (async () => { requests++; throw new Error('Request failed'); }) as OwnerApi);
  for (const invalid of ['', '*', 'https://app.example/path', 'https://app.example/', 'https://user:password@app.example', 'ftp://app.example', Array.from({ length: 11 }, (_, i) => `https://app${i}.example`).join('\n')]) {
    connection.setOrigins(invalid);
    await assert.rejects(connection.create('project', 'notes'), /exact http/);
  }
  assert.equal(requests, 0);
  connection.setOrigins('http://localhost:3000');
  await assert.rejects(connection.create('project', 'notes'), /Request failed/);
  await assert.rejects(connection.create('project', 'notes'), /Request failed/);
  assert.equal(requests, 2);
  await assert.rejects(connection.copy('project', 'notes', 'config'), /Create a browser key/);
});

test('enabling public reads preserves the latest own-row write rules', async () => {
  const current: TablePolicy = { table: 'notes', select: 'none', insert: 'own', update: 'own', delete: 'own', ownerColumn: 'author_id' };
  const requests: unknown[][] = [];
  const connection = createAppConnection('https://api.example', (async (...args: unknown[]) => {
    requests.push(args); return args[1] === 'PUT' ? {} : { policies: [current] };
  }) as OwnerApi);
  await connection.enablePublicReads('project', 'notes');
  assert.deepEqual(requests, [['/projects/project/policies'], ['/projects/project/policies/notes', 'PUT', {
    select: 'public', insert: 'own', update: 'own', delete: 'own', ownerColumn: 'author_id',
  }]]);
  requests.length = 0;
  await connection.enablePublicReads('project', 'products');
  assert.deepEqual(requests[1], ['/projects/project/policies/products', 'PUT', {
    select: 'public', insert: 'none', update: 'none', delete: 'none', ownerColumn: null,
  }]);
});

test('refresh retains the one-time key, while revocation and workspace reset discard it', async t => {
  clipboard(t);
  let listed = [key];
  const connection = createAppConnection('https://api.example', (async (_path: string, method?: string) => method === 'POST' ? issued : method === 'DELETE' ? {} : { keys: listed }) as OwnerApi);
  await connection.create('project', 'notes');
  await connection.load('project');
  await connection.copy('project', 'notes', 'config');
  await connection.revoke('project', key.id);
  await assert.rejects(connection.copy('project', 'notes', 'config'), /Create a browser key/);
  await connection.create('project', 'notes');
  listed = [];
  await connection.load('project');
  await assert.rejects(connection.copy('project', 'notes', 'config'), /Create a browser key/);
  await connection.create('project', 'notes');
  connection.reset();
  await assert.rejects(connection.copy('project', 'notes', 'config'), /Create a browser key/);
});

test('an in-flight key response cannot restore credentials after a project or session change', async t => {
  clipboard(t);
  let complete!: (value: typeof issued) => void;
  const connection = createAppConnection('https://api.example', (() => new Promise<typeof issued>(resolve => { complete = resolve; })) as OwnerApi);
  const pending = connection.create('project', 'notes');
  connection.reset();
  complete(issued);
  await pending;
  await assert.rejects(connection.copy('project', 'notes', 'javascript'), /Create a browser key/);
});
