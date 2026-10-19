import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoApi, DemoApiError, fetchPublicMessages, liveBoardConfig, type Board, type DemoSession, type Message } from './api.ts';

const rows: Message[] = [
  { id: 'welcome', user_id: 'alice', title: 'Welcome', body: 'Welcome to the BFF message board.', created_at: '2026-10-15T18:30:00.000Z' },
  { id: 'hello', user_id: 'bob', title: 'Hello', body: 'Glad to be here.', created_at: '2026-10-15T19:00:00.000Z' },
];

const alice: DemoSession = { token: `bff_us_${'a'.repeat(64)}`, session: {
  id: 'alice-session', user_id: 'alice', created_at: '2026-10-17T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z',
} };
const bob: DemoSession = { token: `bff_us_${'b'.repeat(64)}`, session: { ...alice.session, id: 'bob-session', user_id: 'bob' } };
const general: Board = { id: 'general', slug: 'general', name: 'General', description: 'General discussion.', created_at: rows[0].created_at };

test('signed-out browsing reads messages and boards with only the public key', async () => {
  const calls: URL[] = [];
  const api = createDemoApi(liveBoardConfig, async (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(new Headers(init?.headers).get('apikey'), liveBoardConfig.publicKey);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    assert.equal(init?.credentials, 'omit');
    return Response.json({ data: url.pathname.endsWith('/boards') ? [general] : [rows[0]] });
  });
  assert.deepEqual(await api.list(null), [rows[0]]);
  assert.deepEqual(await api.listBoards(null), [general]);
  assert.deepEqual(await api.list(null, rows[0].id), [rows[0]]);
  assert.equal(calls[2].searchParams.get('id'), `eq.${rows[0].id}`);
  assert.equal(calls[2].searchParams.get('limit'), '1');
  assert.equal(calls.length, 3);
});

test('authenticated message pages fetch their selected ID even outside the latest feed', async () => {
  const selected = { ...rows[0], id: 'old/post?&' };
  const api = createDemoApi(liveBoardConfig, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('id'), `eq.${selected.id}`);
    assert.equal(url.searchParams.get('limit'), '1');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${alice.token}`);
    return Response.json({ data: [selected] });
  });
  assert.deepEqual(await api.list(alice, selected.id), [selected]);
  const unexpected = createDemoApi(liveBoardConfig, async () => Response.json({ data: rows }));
  await assert.rejects(unexpected.list(alice, selected.id), /unexpected message/);
});

test('board creation inserts trimmed fields and the logged-in owner, with slugs derived only from the name', async () => {
  for (const session of [alice, bob]) {
    for (const [name, slug] of [['  Product Plans  ', 'product-plans'], ['Release   Notes', 'release-notes'],
      ['Web-Dev 2026', 'web-dev-2026'], ['a'.repeat(80), 'a'.repeat(80)]]) {
      const api = createDemoApi(liveBoardConfig, async (input, init) => {
        assert.ok(String(input).endsWith('/tables/boards'));
        assert.equal(init?.method, 'POST');
        assert.equal(init?.credentials, 'omit');
        assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${session.token}`);
        assert.equal(new Headers(init?.headers).get('apikey'), liveBoardConfig.publicKey);
        assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
        const data = JSON.parse(String(init?.body));
        assert.deepEqual(Object.keys(data).sort(), ['description', 'name', 'slug', 'user_id']);
        assert.equal(data.name, name.trim());
        assert.equal(data.description, 'Discuss plans.');
        assert.equal(data.user_id, session.session.user_id);
        assert.equal(data.slug, slug);
        return Response.json({ data: [{ ...general, ...data, id: 'new-board' }] }, { status: 201 });
      });
      const created = await api.createBoard(session, name, '  Discuss plans.  ');
      assert.equal(created.id, 'new-board');
      assert.equal(created.user_id, session.session.user_id);
    }
  }
});

test('duplicate board slugs return the database error without appending a suffix or retrying', async () => {
  let inserts = 0;
  const api = createDemoApi(liveBoardConfig, async (_input, init) => {
    inserts++;
    assert.equal(JSON.parse(String(init?.body)).slug, 'general');
    return Response.json({ error: 'database_query_failed' }, { status: 502 });
  });
  await assert.rejects(api.createBoard(alice, 'General', ''), error =>
    error instanceof DemoApiError && error.message === 'database_query_failed' && error.status === 502);
  assert.equal(inserts, 1);
});

test('board creation validates limits and confirms the inserted row and its owner', async () => {
  const noRequest = createDemoApi(liveBoardConfig, async () => { throw new Error('Invalid input must not make a request'); });
  for (const name of [' \n ', 'x'.repeat(81)]) {
    await assert.rejects(noRequest.createBoard(alice, name, ''), /board name of 1–80/);
  }
  for (const name of ['Café & plans', '会議', '-leading', 'trailing-', 'has/slash']) {
    await assert.rejects(noRequest.createBoard(alice, name, ''), /Use letters/);
  }
  await assert.rejects(noRequest.createBoard(alice, 'Valid', 'x'.repeat(2001)), /at most 2000/);
  for (const description of ['', 'x'.repeat(2000)]) {
    const api = createDemoApi(liveBoardConfig, async (_input, init) =>
      Response.json({ data: [{ ...general, ...JSON.parse(String(init?.body)) }] }));
    assert.equal((await api.createBoard(alice, 'Valid', description)).description, description);
  }
  for (const invalid of ['empty', 'multiple', 'owner', 'name', 'description', 'slug', 'malformed']) {
    const api = createDemoApi(liveBoardConfig, async (_input, init) => {
      const board = { ...general, ...JSON.parse(String(init?.body)) };
      const data = invalid === 'empty' ? [] : invalid === 'multiple' ? [board, board]
        : invalid === 'owner' ? [{ ...board, user_id: 'bob' }]
          : invalid === 'name' ? [{ ...board, name: 'Wrong name' }]
            : invalid === 'description' ? [{ ...board, description: 'Wrong description' }]
              : invalid === 'slug' ? [{ ...board, slug: 'wrong-slug' }]
                : [{ ...board, created_at: 'invalid' }];
      return Response.json({ data }, { status: 201 });
    });
    await assert.rejects(api.createBoard(alice, 'My board', 'Description'), /did not confirm/);
  }
  for (const status of [401, 403]) {
    const api = createDemoApi(liveBoardConfig, async () => Response.json({ error: 'permission_denied' }, { status }));
    await assert.rejects(api.createBoard(alice, 'My board', ''), error => error instanceof DemoApiError && error.status === status);
  }
});

test('board selection loads every page with the session and validates board data', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ ...general, id: `board-${index}`, slug: `board-${index}` }));
  const calls: string[] = [];
  const api = createDemoApi(liveBoardConfig, async (input, init) => {
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${alice.token}`);
    assert.equal(new Headers(init?.headers).get('apikey'), liveBoardConfig.publicKey);
    assert.equal(init?.credentials, 'omit');
    return Response.json({ data: calls.length === 1 ? firstPage : [general] });
  });
  assert.deepEqual(await api.listBoards(alice), [...firstPage, general]);
  assert.deepEqual(calls.map(url => new URL(url).search), [
    '?select=*&order=slug.asc&limit=100&offset=0', '?select=*&order=slug.asc&limit=100&offset=100',
  ]);
  assert.ok(calls.every(url => new URL(url).pathname.endsWith('/tables/boards')));
  const empty = createDemoApi(liveBoardConfig, async () => Response.json({ data: [] }));
  assert.deepEqual(await empty.listBoards(alice), []);
  for (const data of [null, [{ ...general, slug: 'bad/slug' }], [{ ...general, id: '' }], [{ ...general, description: null }]]) {
    const malformed = createDemoApi(liveBoardConfig, async () => Response.json({ data }));
    await assert.rejects(malformed.listBoards(alice), /unexpected format/);
  }
});

test('posting inserts the selected board, authenticated author, title, and plain body, and uses the returned row', async () => {
  const posted = { ...rows[0], id: 'new-message', board_id: general.id, title: 'A title', body: 'Saved by the backend' };
  const api = createDemoApi(liveBoardConfig, async (input, init) => {
    assert.equal(String(input), 'https://api.mainbrella.com/bff/data/90da3093-84b6-4cd7-a39a-a8afc39403b8/tables/messages');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${alice.token}`);
    assert.equal(new Headers(init?.headers).get('apikey'), liveBoardConfig.publicKey);
    assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), { board_id: general.id, user_id: 'alice', title: 'A title', body: 'Plain text\nwith a second line' });
    return Response.json({ data: [posted] }, { status: 201 });
  });
  assert.deepEqual(await api.create(alice, general.id, '  A title  ', '  Plain text\nwith a second line  '), posted);
  const longTitle = 't'.repeat(200);
  const acceptsMaximum = createDemoApi(liveBoardConfig, async (_input, init) => {
    assert.equal(JSON.parse(String(init?.body)).title, longTitle);
    return Response.json({ data: [{ ...posted, title: longTitle }] }, { status: 201 });
  });
  assert.equal((await acceptsMaximum.create(alice, general.id, longTitle, 'Body')).title, longTitle);
});

test('posting rejects blank and oversized input without requests and requires a confirmed row for the chosen board and author', async () => {
  const noRequest = createDemoApi(liveBoardConfig, async () => { throw new Error('Invalid input must not make a request'); });
  await assert.rejects(noRequest.create(alice, ' ', 'A title', 'A body'), /Choose a board/);
  await assert.rejects(noRequest.create(alice, general.id, ' \n ', 'A body'), /title of 1–200/);
  await assert.rejects(noRequest.create(alice, general.id, 'x'.repeat(201), 'A body'), /title of 1–200/);
  await assert.rejects(noRequest.create(alice, general.id, 'A title', ' \n '), /1–2000/);
  await assert.rejects(noRequest.create(alice, general.id, 'A title', 'x'.repeat(2001)), /1–2000/);
  const posted = { ...rows[0], board_id: general.id, title: 'A title' };
  for (const data of [[], [posted, posted], [{ ...posted, board_id: 'other' }], [{ ...posted, user_id: 'bob' }]]) {
    const unconfirmed = createDemoApi(liveBoardConfig, async () => Response.json({ data }, { status: 201 }));
    await assert.rejects(unconfirmed.create(alice, general.id, 'A title', 'My body'), /did not confirm/);
  }
  const wrongTitle = createDemoApi(liveBoardConfig, async () => Response.json({ data: [{ ...posted, title: 'Different title' }] }, { status: 201 }));
  await assert.rejects(wrongTitle.create(alice, general.id, 'A title', 'My body'), /did not confirm/);
  for (const status of [401, 403]) {
    const rejected = createDemoApi(liveBoardConfig, async () => Response.json({ error: status === 401 ? 'unauthorized' : 'permission_denied' }, { status }));
    await assert.rejects(rejected.create(alice, general.id, 'A title', 'My body'), error => error instanceof DemoApiError && error.status === status);
    await assert.rejects(rejected.listBoards(alice), error => error instanceof DemoApiError && error.status === status);
  }
});

test('public board reads the configured messages table with only its browser key', async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const result = await fetchPublicMessages(liveBoardConfig, async (input, init) => {
    request = { input, init };
    return Response.json({ data: rows, meta: { count: 2 } });
  });

  assert.deepEqual(result, rows);
  assert.equal(request?.input, 'https://api.mainbrella.com/bff/data/90da3093-84b6-4cd7-a39a-a8afc39403b8/tables/messages?select=*');
  assert.deepEqual(request?.init?.headers, { apikey: 'bff_pk_1f9bb9fd543d6a5476ad7ce210577c2479d290a5cdc06282de9eb884d57005c4' });
  assert.equal(request?.init?.credentials, 'omit');
  assert.ok(request?.init?.signal instanceof AbortSignal);
  assert.equal(request?.init?.method, undefined);
});

test('public board rejects unavailable and malformed responses with useful errors', async () => {
  await assert.rejects(
    fetchPublicMessages(liveBoardConfig, async () => Response.json({ error: 'permission_denied' }, { status: 403 })),
    /public demo is unavailable/,
  );
  await assert.rejects(
    fetchPublicMessages(liveBoardConfig, async () => Response.json({ data: [{ ...rows[0], created_at: 'not-a-date' }] })),
    /unexpected format/,
  );
  await assert.rejects(
    fetchPublicMessages(liveBoardConfig, async () => Response.json({ data: null })),
    /unexpected format/,
  );
});

test('demo login obtains a server session and uses it for data requests and revocation without cookies', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createDemoApi(liveBoardConfig, async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (init.method === 'POST') {
      assert.equal(init.body, JSON.stringify({ userId: 'alice' }));
      assert.equal(new Headers(init.headers).has('authorization'), false);
      return Response.json(alice, { status: 201 });
    }
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${alice.token}`);
    return Response.json(init.method === 'DELETE' ? { revoked: true } : { data: rows });
  });

  const session = await api.login('alice');
  assert.deepEqual(session, alice);
  assert.deepEqual(await api.list(session), rows);
  await api.logout(session);
  assert.deepEqual(calls.map(call => [call.url, call.init.method ?? 'GET']), [
    ['https://api.mainbrella.com/bff/demo/session', 'POST'],
    ['https://api.mainbrella.com/bff/data/90da3093-84b6-4cd7-a39a-a8afc39403b8/tables/messages?select=*', 'GET'],
    ['https://api.mainbrella.com/bff/demo/session', 'DELETE'],
  ]);
  for (const { init } of calls) {
    assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).get('apikey'), liveBoardConfig.publicKey);
  }
});

test('edits reach the backend for every author and preserve its exact denial without pretending the save succeeded', async () => {
  const forbidden = createDemoApi(liveBoardConfig, async (input, init) => {
    assert.equal(String(input), 'https://api.mainbrella.com/bff/data/90da3093-84b6-4cd7-a39a-a8afc39403b8/tables/messages?id=eq.welcome');
    assert.equal(init?.method, 'PATCH');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${bob.token}`);
    assert.deepEqual(JSON.parse(String(init?.body)), { body: 'Trying to edit Alice’s post', user_id: 'alice' });
    return Response.json({ error: 'permission_denied' }, { status: 403 });
  });
  await assert.rejects(forbidden.update(bob, rows[0], ' Trying to edit Alice’s post '), error => {
    assert.ok(error instanceof DemoApiError);
    assert.equal(error.message, 'permission_denied');
    assert.equal(error.status, 403);
    return true;
  });
  const noChanges = createDemoApi(liveBoardConfig, async () => Response.json({ data: [], meta: { changes: 0 } }));
  assert.equal(await noChanges.update(alice, rows[0], 'Still here'), null);
});

test('successful edits use the returned row, escape the row filter, and reject unrelated response rows', async () => {
  const message = { ...rows[0], id: 'id&user_id=eq.bob' };
  const updated = { ...message, body: 'Saved by the backend' };
  const api = createDemoApi(liveBoardConfig, async (input, init) => {
    assert.ok(String(input).endsWith('?id=eq.id%26user_id%3Deq.bob'));
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${alice.token}`);
    return Response.json({ data: [updated] });
  });
  assert.deepEqual(await api.update(alice, message, 'My draft'), updated);
  const wrongRow = createDemoApi(liveBoardConfig, async () => Response.json({ data: [rows[1]] }));
  await assert.rejects(wrongRow.update(alice, rows[0], 'My draft'), /unexpected message/);
});

test('invalid or mismatched login sessions cannot enter the board, and expired credentials retain the server status', async () => {
  for (const payload of [{}, { ...alice, token: 'not-a-session-token' }, bob,
    { ...alice, session: { ...alice.session, expires_at: '2000-01-01T00:00:00.000Z' } }]) {
    const api = createDemoApi(liveBoardConfig, async () => Response.json(payload));
    await assert.rejects(api.login('alice'), /invalid session/);
  }
  const expired = createDemoApi(liveBoardConfig, async () => Response.json({ error: 'unauthorized' }, { status: 401 }));
  await assert.rejects(expired.list(alice), error => error instanceof DemoApiError && error.message === 'unauthorized' && error.status === 401);
});

test('an interrupted network request times out and does not leave the form waiting indefinitely', async () => {
  await assert.rejects(fetchPublicMessages(liveBoardConfig, (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }), 5), /request took too long/);
});
