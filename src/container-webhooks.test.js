import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { hostname: 'localhost' };
const { webhookConfig, webhookDeliveries, createWebhookClient } = await import('./container-webhooks.js');
const container = { id: 'small', createdAt: '2026-10-05T12:00:00.000Z' };
const config = { id: 'd688d42a-25ef-4c13-9b28-21a0fde6e163', createdAt: container.createdAt, configuredAt: container.createdAt, retainUntil: Date.parse(container.createdAt) + 7 * 86400_000, url: 'https://relay.example.com/events' };
test('webhook configuration keeps generation identity and excludes persisted secrets', () => {
  assert.deepEqual(webhookConfig({ webhook: { ...config, secret: 'private', iv: 'private' } }, container), config);
  assert.equal(webhookConfig({ webhook: null }, container), null);
  for (const webhook of [{ ...config, createdAt: 'foreign' }, { ...config, url: 'http://relay.example.com/' }, { ...config, url: 'https://user:pass@relay.example.com/' }, { ...config, id: 'bad' }]) assert.throws(() => webhookConfig({ webhook }, container));
});
test('delivery states are bounded, deduplicated and stripped of private payloads', () => {
  const item = { id: config.id, status: 'exhausted', attempts: 8, manualRetries: 3 };
  assert.deepEqual(webhookDeliveries({ deliveries: [{ ...item, event: { private: true } }] }), [item]);
  for (const deliveries of [[item, item], [{ ...item, status: 'unknown' }], [{ ...item, attempts: 9 }], [{ ...item, manualRetries: -1 }]]) assert.throws(() => webhookDeliveries({ deliveries }));
});
test('webhook mutations bind ownership, never replay ambiguous saves and sanitize receiver failures', async () => {
  let calls = 0;
  const client = createWebhookClient({ fetcher: async (url, options) => {
    calls++; assert.equal(url.searchParams.get('id'), container.id); assert.equal(url.searchParams.get('createdAt'), container.createdAt);
    assert.equal(options.credentials, 'include'); assert.equal(options.redirect, 'error'); assert.equal(options.method, 'PUT');
    assert.deepEqual(JSON.parse(options.body), { url: config.url }); return Response.json({ webhook: config, signingSecret: 'mbwh_' + 'a'.repeat(64) }, { status: 201 });
  } });
  const result = await client(container, 'PUT', { url: config.url }); assert.equal(result.signingSecret.length, 69); assert.equal(calls, 1);
  const failed = createWebhookClient({ fetcher: async () => { calls++; return Response.json({ error: 'private token' }, { status: 503 }); } });
  await assert.rejects(failed(container, 'PUT', { url: config.url }), { message: 'webhook_unavailable' }); assert.equal(calls, 2);
  const lost = createWebhookClient({ fetcher: async () => Response.json({ webhook: config }) });
  await assert.rejects(lost(container, 'PUT', { url: config.url }), { message: 'invalid_response' });
});
