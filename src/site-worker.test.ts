import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './site-worker.ts';

test('the site Worker passes unrelated requests through to static assets', async () => {
  const request = new Request('https://mainbrella.com/docs/');
  const response = new Response('Static docs');
  assert.equal(await worker.fetch(request, { ASSETS: { async fetch(input) {
    assert.equal(input, request);
    return response;
  } } }), response);
});

test('board URLs render the built demo template on the server', async t => {
  const created = '2026-10-18T12:00:00Z';
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => Response.json({
    data: String(input).includes('/tables/boards?')
      ? [{ id: 'general', slug: 'general', name: 'General', description: '', created_at: created }]
      : [{ id: 'hello', board_id: 'general', user_id: 'alice', title: 'Server rendered title', body: 'Server rendered body', created_at: created }],
  }));
  const response = await worker.fetch(new Request('https://mainbrella.com/bff/demo/boards/general'), { ASSETS: { async fetch(input) {
    assert.equal(input.url, 'https://mainbrella.com/bff/demo/');
    return new Response('<html><head><title>Demo</title></head><body><div id="message-board-root"></div></body></html>');
  } } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Server rendered title/);
  assert.match(html, /Server rendered body/);
  assert.match(html, /href="\/bff\/demo\/">All messages/);
  assert.match(html, /href="\/bff\/demo\/boards\/general"/);
  assert.match(html, /data-server-rendered="true"/);
});
