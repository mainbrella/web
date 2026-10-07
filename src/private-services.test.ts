import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = { hostname: 'localhost' } as Location;
const { privateNetworks, privateMember, createPrivateServicesClient, validPrivateName, validPrivatePort } = await import('./private-services.ts');
const member = { id: 'c1', createdAt: '2026-10-07T12:00:00.000Z', name: 'api', port: 8080 };

test('private service metadata validates names, ports, generation identities, and unique memberships', () => {
  assert.deepEqual(privateMember({ ...member, apiKey: 'secret' }), member);
  assert.deepEqual(privateNetworks({ networks: [{ name: 'demo', members: [member] }] }), [{ name: 'demo', members: [member] }]);
  for (const name of ['', 'UPPER', '1api', 'api.internal', 'a'.repeat(64)]) assert.equal(validPrivateName(name), false);
  for (const port of [0, 80, 1023, 65536, 8080.5, '8080']) assert.equal(validPrivatePort(port), false);
  for (const createdAt of ['yesterday', '2026-10-07', '2026-10-07T12:00:00Z']) assert.throws(() => privateMember({ ...member, createdAt }));
  for (const networks of [
    [{ name: 'demo', members: [member, { ...member, id: 'c2' }] }],
    [{ name: 'demo', members: [member] }, { name: 'other', members: [member] }],
    [{ name: 'demo', members: [] }, { name: 'demo', members: [] }],
  ]) assert.throws(() => privateNetworks({ networks }));
  // A replaced generation is separate; the old attachment must never migrate automatically.
  const replacement = { ...member, createdAt: '2026-10-07T12:01:00.000Z' };
  assert.equal(privateNetworks({ networks: [{ name: 'old', members: [member] }, { name: 'new', members: [replacement] }] }).length, 2);
});

test('all Private Services endpoints use session authentication and the exact generation, without previews', async () => {
  const calls: { url: URL; options: RequestInit }[] = [];
  const client = createPrivateServicesClient({ fetcher: async (input, options = {}) => {
    const url = new URL(String(input)); calls.push({ url, options });
    assert.equal(options.credentials, 'include'); assert.equal(options.redirect, 'error');
    if (url.pathname.endsWith('/networks')) {
      if (options.method === 'GET') return Response.json({ networks: [{ name: 'demo', members: [member] }] });
      if (options.method === 'POST') { assert.deepEqual(JSON.parse(options.body as string), { name: 'demo' }); return Response.json({ name: 'demo', members: [] }, { status: 201 }); }
      assert.equal(url.searchParams.get('network'), 'demo'); assert.equal(options.body, undefined);
      return Response.json({ deleted: true });
    }
    assert.equal(url.pathname, '/private-services/members'); assert.equal(url.searchParams.get('network'), 'demo');
    if (options.method === 'PUT') { assert.deepEqual(JSON.parse(options.body as string), member); return Response.json({ network: 'demo', ...member }); }
    assert.deepEqual(JSON.parse(options.body as string), { id: member.id, createdAt: member.createdAt, name: member.name });
    return Response.json({ detached: true });
  } });
  await client.list(); await client.create('demo'); await client.attach('demo', member); await client.detach('demo', member); await client.delete('demo');
  assert.equal(calls.length, 5);
  assert.ok(calls.every(({ url }) => url.pathname.startsWith('/private-services/')));
});

test('caller-only attachment omits port and refuses mismatched server acknowledgements', async () => {
  const { port, ...caller } = member;
  const client = createPrivateServicesClient({ fetcher: async (_url, options) => {
    assert.deepEqual(JSON.parse(options!.body as string), caller);
    return Response.json({ network: 'demo', ...caller, createdAt: '2026-10-07T12:01:00.000Z' });
  } });
  await assert.rejects(client.attach('demo', caller), /invalid_response/);
});

test('expected conflicts remain identifiable; untrusted errors are hidden and writes are never retried', async () => {
  for (const error of ['network_name_conflict', 'service_name_conflict', 'machine_already_attached', 'network_not_empty', 'container_not_running']) {
    const client = createPrivateServicesClient({ fetcher: async () => Response.json({ error }, { status: 409 }) });
    await assert.rejects(client.attach('demo', member), { message: error });
  }
  let calls = 0, notified = false;
  const client = createPrivateServicesClient({ onUnauthenticated: () => { notified = true; }, fetcher: async () => {
    calls++; return Response.json({ error: '<script>private error</script>' }, { status: 401 });
  } });
  await assert.rejects(client.create('demo'), { message: 'private_services_unavailable' });
  assert.equal(calls, 1); assert.equal(notified, true);
});
