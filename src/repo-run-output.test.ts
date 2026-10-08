import test from 'node:test';
import assert from 'node:assert/strict';
import { streamRunOutput, type RunOutputStatus } from './repo-run-output.ts';

test('SSE handles split UTF-8, CRLF, heartbeats and mixed output before final status', async t => {
  const status: RunOutputStatus = { status: 'timed_out', exitCode: null, timedOut: true, outputTruncated: false, cursor: 2 };
  const encoded = new TextEncoder().encode(': heartbeat\r\n\r\nevent: stdout\r\ndata: {"sequence":1,"data":"héllo ☂\\n"}\r\n\r\n'
    + 'event: stderr\ndata: {"sequence":2,"data":"warning\\n"}\n\n' + `event: status\ndata: ${JSON.stringify(status)}\n\n`);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset < encoded.length) controller.enqueue(encoded.subarray(offset, ++offset));
    else controller.close();
  } });
  t.mock.method(globalThis, 'fetch', async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
  const output: [string, number][] = [], results: RunOutputStatus[] = [];
  await streamRunOutput(new URL('https://api.test/events?cursor=0'), new AbortController().signal,
    (text, sequence) => output.push([text, sequence]), result => results.push(result));
  assert.deepEqual(output, [['héllo ☂\n', 1], ['warning\n', 2]]);
  assert.deepEqual(results, [status]);
});

test('invalid output and authentication failures do not leak response text into logs', async t => {
  const url = new URL('https://api.test/events');
  const output: string[] = [];
  t.mock.method(globalThis, 'fetch', async () => new Response('private error page', { status: 401 }));
  await assert.rejects(streamRunOutput(url, new AbortController().signal, text => output.push(text), () => {}), /not_authenticated/);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ internal: 'private details' }));
  await assert.rejects(streamRunOutput(url, new AbortController().signal, text => output.push(text), () => {}), /output_unavailable/);
  assert.deepEqual(output, []);
});
