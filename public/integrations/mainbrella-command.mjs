// Run this tool in your application, outside the remote container.
// Bind the exact generation returned by your creation operation.
export function mainbrellaCommand({ id, createdAt }, {
  key = process.env.MAINBRELLA_API_KEY, fetcher = fetch,
} = {}) {
  if (typeof id !== 'string' || !id || !Number.isFinite(Date.parse(createdAt))
    || typeof key !== 'string' || !/^mb_[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error('A container generation and Mainbrella API key are required.');
  }
  const url = `https://api.mainbrella.com/containers/exec?${new URLSearchParams({ id, createdAt })}`;
  return async function execute(command) {
    if (typeof command !== 'string' || !command.trim()
      || new TextEncoder().encode(command).byteLength > 16 * 1024) {
      throw new Error('Provide a nonempty command of at most 16 KiB.');
    }
    const response = await fetcher(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(40_000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, timeoutMs: 30_000 }),
    });
    if (!response.ok) throw new Error(`Mainbrella command failed (HTTP ${response.status}).`);
    const result = await response.json();
    if (typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
      || !(Number.isInteger(result.exitCode) || result.exitCode === null)
      || typeof result.timedOut !== 'boolean' || typeof result.outputTruncated !== 'boolean') {
      throw new Error('Unexpected Mainbrella command response.');
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode,
      timedOut: result.timedOut, outputTruncated: result.outputTruncated };
  };
}
