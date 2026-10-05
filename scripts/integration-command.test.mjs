import test from 'node:test';
import assert from 'node:assert/strict';
import { mainbrellaCommand } from '../public/integrations/mainbrella-command.mjs';

const generation = { id: 'c /one', createdAt: '2026-10-05T12:00:00.000Z' };
const result = { stdout: 'hello', stderr: '', exitCode: 0, timedOut: false, outputTruncated: false };
const key = 'mb_test_secret';

test('command adapter binds identity and credentials outside model arguments and returns execution flags', async () => {
  const execute = mainbrellaCommand(generation, { key, fetcher: async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.mainbrella.com');
    assert.equal(parsed.searchParams.get('id'), generation.id);
    assert.equal(parsed.searchParams.get('createdAt'), generation.createdAt);
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { command: 'echo hello', timeoutMs: 30_000 });
    return Response.json({ ...result, outputTruncated: true });
  } });
  assert.deepEqual(await execute('echo hello'), { ...result, outputTruncated: true });
});

test('command adapter rejects missing identity, credentials, empty and oversized UTF-8 commands', async () => {
  for (const identity of [{}, { ...generation, createdAt: 'invalid' }, { ...generation, id: '' }]) {
    assert.throws(() => mainbrellaCommand(identity, { key }));
  }
  assert.throws(() => mainbrellaCommand(generation, { key: '' }));
  const execute = mainbrellaCommand(generation, { key, fetcher: () => assert.fail('must not send a request') });
  for (const command of ['', ' ', '🙂'.repeat(4097), null]) await assert.rejects(execute(command));
});

test('command adapter hides server errors and rejects malformed execution responses', async () => {
  for (const response of [Response.json({ secret: key }, { status: 401 }),
    Response.json({ stdout: key }), Response.json({ ...result, timedOut: 'false' })]) {
    const execute = mainbrellaCommand(generation, { key, fetcher: async () => response });
    await assert.rejects(execute('pwd'), error => !error.message.includes(key));
  }
});
