import type { RepoRunExecutionDiagnostics } from './repo-run-contract.ts';

export type RunOutputStatus = RepoRunExecutionDiagnostics & { startedAt?: string; finishedAt?: string; cursor?: number };

// Managed output connections rotate after 30 seconds. The caller retains the
// last sequence and reconnects without duplicating output or restarting a job.
export async function streamRunOutput(url: URL, signal: AbortSignal,
  onOutput: (text: string, sequence: number) => void, onStatus: (status: RunOutputStatus) => void) {
  const response = await fetch(url, { credentials: 'include', redirect: 'error', signal,
    headers: { accept: 'text/event-stream' } });
  if (response.status === 401) throw new Error('not_authenticated');
  if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('output_unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', event = '', data: string[] = [];
  function line(text: string) {
    if (!text) {
      if (data.length) {
        const value = JSON.parse(data.join('\n'));
        if ((event === 'stdout' || event === 'stderr') && typeof value.data === 'string' && Number.isSafeInteger(value.sequence) && value.sequence > 0) onOutput(value.data, value.sequence);
        else if (event === 'status' && typeof value.status === 'string') onStatus(value);
      }
      event = ''; data = [];
    } else if (text.startsWith('event:')) event = text.slice(6).trim();
    else if (text.startsWith('data:')) data.push(text.slice(5).replace(/^ /, ''));
  }
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        line(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
