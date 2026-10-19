import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageLink, messageHref } from './MessageLink.tsx';
import { BoardLink } from './BoardLink.tsx';
import { renderBoardRequest } from './server.tsx';
import { liveBoardConfig, type Board, type Message } from './api.ts';

const board: Board = { id: 'board-123', slug: 'general', name: 'General', description: 'General <discussion>', created_at: '2026-10-18T12:00:00Z' };
const otherBoard: Board = { id: 'board-456', slug: 'research', name: 'Research', description: 'Notes', created_at: '2026-10-18T12:00:00Z' };
const message: Message = { id: 'post-123', board_id: board.id, title: 'Hello <script>alert(1)</script>', body: 'A message & a reply', user_id: 'alice', created_at: board.created_at };
const otherMessage: Message = { id: 'post-456', board_id: otherBoard.id, title: 'Research update', body: 'A post on another board', user_id: 'bob', created_at: '2026-10-18T13:00:00Z' };
const template = '<!doctype html><html><head><title>Message board</title><link rel="stylesheet" href="/assets/app.css"></head><body><div id="message-board-root"></div><noscript>Enable JavaScript</noscript></body></html>';
const request = (path = '/boards/general', method = 'GET') => new Request(`https://example.com${path}`, { method });

test('board labels are real root-relative links', () => {
  assert.equal(renderToStaticMarkup(<BoardLink board={board} className="message-board" />),
    '<a class="message-board" href="/boards/general">board/general</a>');
  assert.equal(renderToStaticMarkup(<BoardLink board={board} basePath="/bff/demo/" />),
    '<a href="/bff/demo/boards/general">board/general</a>');
});

test('message titles link to their encoded message URL under either mount path', () => {
  assert.equal(messageHref('general', 'post/with ?&"', '/bff/demo/'), '/bff/demo/boards/general/post%2Fwith%20%3F%26%22');
  assert.equal(renderToStaticMarkup(<MessageLink board={board} message={{ ...message, title: 'Hello' }} />),
    '<a href="/boards/general/post-123">Hello</a>');
  assert.equal(renderToStaticMarkup(<MessageLink message={message} />), 'Hello &lt;script&gt;alert(1)&lt;/script&gt;');
});

test('message pages query a specific post within its board and render it without JavaScript', async () => {
  const selected = { ...message, id: 'old post/&', title: '</title><script>alert(1)</script> $&' };
  for (const basePath of ['/', '/bff/demo/']) {
    const calls: URL[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push(url);
      assert.equal(new Headers(init?.headers).get('authorization'), null);
      if (url.pathname.endsWith('/boards')) return Response.json({ data: [board] });
      // The selected message is older than the global recent feed.
      return Response.json({ data: url.searchParams.has('id') ? [selected] : [otherMessage] });
    };
    const response = await renderBoardRequest(request(`${messageHref(board.slug, selected.id, basePath)}/`), { template, fetcher, homeHref: basePath });
    assert.equal(response?.status, 200);
    const html = await response!.text();
    assert.equal(calls[1].searchParams.get('board_id'), `eq.${board.id}`);
    assert.equal(calls[1].searchParams.get('id'), `eq.${selected.id}`);
    assert.equal(calls[1].searchParams.get('limit'), '1');
    assert.match(html, /<title>&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; \$&amp; · BFF<\/title>/);
    assert.match(html, /data-message-id="old%20post%2F%26"/);
    assert.match(html, /A message &amp; a reply/);
    assert.equal((html.match(/class="message-row"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /Enable JavaScript|<script>alert|Latest 1 post/);
  }
});

test('missing messages and messages belonging to another board return 404', async () => {
  for (const boards of [[board], []]) {
    const response = await renderBoardRequest(request('/boards/general/missing'), { template, fetcher: async input =>
      Response.json({ data: String(input).includes('/tables/boards?') ? boards : [] }) });
    assert.equal(response?.status, 404);
    assert.match(await response!.text(), /Message not found\./);
  }
});

test('message pages reject unexpected rows, API failures, and malformed IDs', async () => {
  for (const row of [{ ...message, board_id: otherBoard.id }, { ...message, id: 'wrong-id' }]) {
    const response = await renderBoardRequest(request('/boards/general/post-123'), { template, fetcher: async input =>
      Response.json({ data: String(input).includes('/tables/boards?') ? [board] : [row] }) });
    assert.equal(response?.status, 502);
    assert.doesNotMatch(await response!.text(), /A message &amp; a reply/);
  }
  const failure = await renderBoardRequest(request('/boards/general/post-123'), { template, fetcher: async () => { throw new Error('private'); } });
  assert.equal(failure?.status, 502);
  assert.match(await failure!.text(), /Could not load this message/);
  for (const path of ['/boards/general/%ZZ', '/boards/general/post-123/extra']) {
    const invalid = await renderBoardRequest(request(path), { template, fetcher: async () => { assert.fail('Invalid routes must not query the API'); } });
    assert.equal(invalid?.status, 404);
  }
  const head = await renderBoardRequest(request('/boards/general/post-123', 'HEAD'), { template, fetcher: async input =>
    Response.json({ data: String(input).includes('/tables/boards?') ? [board] : [message] }) });
  assert.equal(head?.status, 200);
  assert.equal(await head!.text(), '');
  const post = await renderBoardRequest(request('/boards/general/post-123', 'POST'), { template });
  assert.equal(post?.status, 405);
});

test('mounted board pages match and link within the demo path', async () => {
  const options = { template, homeHref: '/bff/demo/', fetcher: (async (input: RequestInfo | URL) =>
    Response.json({ data: String(input).includes('/tables/boards?') ? [board] : [message] })) as typeof fetch };
  assert.equal(await renderBoardRequest(request('/boards/general'), options), null);
  const response = await renderBoardRequest(request('/bff/demo/boards/general'), options);
  assert.equal(response?.status, 200);
  const html = await response!.text();
  assert.match(html, /href="\/bff\/demo\/boards\/general"/);
  assert.doesNotMatch(html, /href="\/boards\//);
});

test('direct board requests render three columns, the selected feed, other boards and global recent posts', async () => {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(new Headers(init?.headers).get('apikey'), liveBoardConfig.publicKey);
    assert.equal(new Headers(init?.headers).get('authorization'), null);
    assert.equal(init?.credentials, 'omit');
    if (url.pathname.endsWith('/boards')) return Response.json({ data: url.searchParams.has('slug') ? [board] : [board, otherBoard] });
    return Response.json({ data: url.searchParams.has('board_id') ? [message] : [message, otherMessage] });
  };
  const response = await renderBoardRequest(request(), { template, fetcher });
  assert.equal(response?.status, 200);
  assert.match(response!.headers.get('content-type')!, /text\/html/);
  const html = await response!.text();
  assert.equal(calls.length, 4);
  assert.equal(calls[0].searchParams.get('slug'), 'eq.general');
  assert.equal(calls[1].searchParams.get('board_id'), 'eq.board-123');
  assert.equal(calls[1].searchParams.get('order'), 'created_at.desc');
  assert.equal(calls[1].searchParams.get('limit'), '20');
  assert.equal(calls[2].searchParams.get('order'), 'slug.asc');
  assert.equal(calls[3].searchParams.has('board_id'), false);
  assert.match(html, /class="board-layout"/);
  assert.match(html, /class="board-navigation"/);
  assert.match(html, /class="recent-messages"/);
  assert.match(html, /href="\/boards\/general"[^>]*aria-current="page"/);
  assert.match(html, /href="\/boards\/general\/post-123"/);
  assert.match(html, /href="\/boards\/research\/post-456"/);
  assert.match(html, /<h1 id="board-title">board\/general<\/h1>/);
  assert.match(html, /data-server-rendered="true"/);
  assert.match(html, /Hello &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /A message &amp; a reply/);
  assert.equal((html.match(/class="message-row"/g) ?? []).length, 1);
  assert.match(html, /href="\/assets\/app.css"/);
  assert.doesNotMatch(html, /Enable JavaScript|<script>alert/);
});

test('supplementary sidebar failures do not take down the selected board feed', async () => {
  const response = await renderBoardRequest(request(), { template, fetcher: async input => {
    const url = new URL(String(input));
    if (url.searchParams.has('slug')) return Response.json({ data: [board] });
    if (url.searchParams.has('board_id')) return Response.json({ data: [message] });
    throw new Error('supplementary request unavailable');
  } });
  assert.equal(response?.status, 200);
  const html = await response!.text();
  assert.match(html, /A message &amp; a reply/);
  assert.match(html, /href="\/boards\/general"[^>]*aria-current="page"/);
  assert.match(html, /Messages are unavailable\./);
});

test('empty boards, missing boards, invalid paths and API failures have distinct server responses', async () => {
  const empty: typeof fetch = async input => Response.json({ data: String(input).includes('/tables/boards?') ? [board] : [] });
  const response = await renderBoardRequest(request('/boards/general/'), { template, fetcher: empty });
  assert.equal(response?.status, 200);
  assert.match(await response!.text(), /No messages yet\./);
  let calls = 0;
  const missing: typeof fetch = async () => { calls++; return Response.json({ data: [] }); };
  const notFound = await renderBoardRequest(request(), { template, fetcher: missing });
  assert.equal(notFound?.status, 404);
  assert.equal(calls, 1);
  assert.match(await notFound!.text(), /Board not found/);
  const invalid = await renderBoardRequest(request('/boards/invalid/nested/extra'), { template, fetcher: missing });
  assert.equal(invalid?.status, 404);
  assert.equal(calls, 1);
  const unavailable = await renderBoardRequest(request(), { template, fetcher: async () => { throw new Error('private backend details'); } });
  assert.equal(unavailable?.status, 502);
  assert.doesNotMatch(await unavailable!.text(), /private backend details/);
});

test('server refuses unrelated board rows and keeps other routes and HTTP methods separate', async () => {
  const mismatch = await renderBoardRequest(request(), { template, fetcher: async input => Response.json({
    data: String(input).includes('/tables/boards?') ? [board] : [{ ...message, board_id: 'another-board' }],
  }) });
  assert.equal(mismatch?.status, 502);
  assert.doesNotMatch(await mismatch!.text(), /A message/);
  assert.equal(await renderBoardRequest(request('/'), { template }), null);
  assert.equal((await renderBoardRequest(request('/boards/general', 'POST'), { template }))?.status, 405);
  const head = await renderBoardRequest(request('/boards/general', 'HEAD'), { template, fetcher: async () => Response.json({ data: [] }) });
  assert.equal(head?.status, 404);
  assert.equal(await head!.text(), '');
});
