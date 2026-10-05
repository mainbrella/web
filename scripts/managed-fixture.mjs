export const capabilities = { apiVersion: '2026-10-05',
  execution: { foreground: true, background: true, streaming: true, reconnect: true, cancellation: true },
  files: { read: true, write: true, binary: true } };
export const managedId = '11111111-1111-4111-8111-111111111111';
export const canceledId = '22222222-2222-4222-8222-222222222222';
export const sse = frames => new Response(frames.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
export function managedResponse(path, method, body) {
  if (path.startsWith('/containers/executions?') && method === 'POST') return { id: body.command === 'sleep 30' ? canceledId : managedId };
  if (path.includes('/events?')) return sse([['stdout', { type: 'stdout', sequence: 1, data: 'mainbrella-managed' }], ['status', { status: 'succeeded' }]]);
  if (path.includes(canceledId)) return { status: method === 'DELETE' ? 'running' : 'canceled' };
  return { status: 'succeeded', stdout: 'mainbrella-managed', stderr: '', exitCode: 0, timedOut: false, outputTruncated: false };
}
