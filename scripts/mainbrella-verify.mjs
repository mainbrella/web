#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runDoctor } from './mainbrella-doctor.mjs';

const hello = 'hello from mainbrella';
const fileProbe = new Uint8Array([0, 1, 127, 128, 255, 10]);

const terminalStates = new Set(['succeeded', 'failed', 'canceled', 'timed_out', 'output_limit', 'interrupted']);

// Decode bounded SSE frames across arbitrary network chunks. Never print server data.
export async function* executionEvents(response) {
  if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) throw new Error('managed_verification_failed');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        if (boundary > 64 * 1024) throw new Error('managed_verification_failed');
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const lines = frame.split('\n');
        const type = lines.find(line => line.startsWith('event: '))?.slice(7);
        const data = lines.find(line => line.startsWith('data: '))?.slice(6);
        if (data) yield { type, data: JSON.parse(data) };
      }
      if (buffer.length > 64 * 1024 || done && buffer.trim()) throw new Error('managed_verification_failed');
      if (done) return;
    }
  } finally { await reader.cancel().catch(() => {}); }
}

export async function verifyManaged({ request, owned, wait, report }) {
  const query = new URLSearchParams(owned);
  const startPath = `/containers/executions?${query}`;
  const executionKey = randomUUID();
  report.executionKey = executionKey;
  const started = await request(startPath, 'POST', { command: 'printf mainbrella-managed', timeoutMs: 30_000 }, { 'Idempotency-Key': executionKey });
  if (!/^[a-f0-9-]{36}$/.test(started?.id ?? '')) throw new Error('managed_verification_failed');
  report.executionId = started.id;
  const path = `/containers/executions/${started.id}`;
  let cursor = 0, output = '', terminal;
  for (let attempt = 0; attempt < 4 && !terminal; attempt++) {
    const response = await request(`${path}/events?${query}&cursor=${cursor}`);
    let sawStatus = false;
    for await (const event of executionEvents(response)) {
      if (event.type === 'status') {
        sawStatus = true;
        if (terminalStates.has(event.data.status)) terminal = event.data;
      } else if (['stdout', 'stderr'].includes(event.type)) {
        if (!Number.isSafeInteger(event.data.sequence) || event.data.sequence <= 0 || typeof event.data.data !== 'string') throw new Error('managed_verification_failed');
        if (event.data.sequence > cursor) {
          cursor = event.data.sequence;
          output += event.data.data;
          if (output.length > 1024) throw new Error('managed_verification_failed');
        }
      }
    }
    if (!sawStatus) throw new Error('managed_verification_failed');
    if (!terminal) await wait();
  }
  const result = await request(`${path}?${query}`);
  if (output !== 'mainbrella-managed' || terminal?.status !== 'succeeded'
    || result.status !== 'succeeded' || result.stdout !== output || result.stderr !== ''
    || result.exitCode !== 0 || result.timedOut || result.outputTruncated) throw new Error('managed_verification_failed');
  report.managed = 'verified';

  const cancellationKey = randomUUID();
  report.cancellationKey = cancellationKey;
  const pending = await request(startPath, 'POST', { command: 'sleep 30', timeoutMs: 30_000 }, { 'Idempotency-Key': cancellationKey });
  if (!/^[a-f0-9-]{36}$/.test(pending?.id ?? '')) throw new Error('managed_verification_failed');
  report.cancellationId = pending.id;
  const cancelPath = `/containers/executions/${pending.id}?${query}`;
  await request(cancelPath, 'DELETE');
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await request(cancelPath);
    if (result.status === 'canceled') { report.cancellation = 'verified'; return; }
    if (terminalStates.has(result.status)) break;
    await wait();
  }
  throw new Error('managed_verification_failed');
}

export function createRequester({ base, key, fetcher = fetch }) {
  return async (path, method = 'GET', body, headers = {}) => {
    const binary = body instanceof Uint8Array;
    const response = await fetcher(new URL(path, base), {
      method, headers: { ...(path === '/capabilities' ? {} : { Authorization: `Bearer ${key}` }),
        ...(body !== undefined ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' } : {}), ...headers },
      body: binary ? body : body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error('request_failed');
    if (method === 'GET' && path.includes('/events?')) return response;
    if (method === 'GET' && path.startsWith('/containers/files?')) return new Uint8Array(await response.arrayBuffer());
    return response.json();
  };
}

// Requests are injectable to verify ownership and cleanup without paid starts.
export async function verify({ request, catalogId = 'node', wait = () => new Promise(resolve => setTimeout(resolve, 1000)) }) {
  let owned;
  const report = { ok: false, stdout: null, exitCode: null, cleanup: 'not_needed' };
  try {
    const capabilities = await request('/capabilities');
    if (!['foreground', 'background', 'streaming', 'reconnect', 'cancellation'].every(feature => capabilities?.execution?.[feature] === true)
      || !['read', 'write', 'binary'].every(feature => capabilities?.files?.[feature] === true)) throw new Error('preflight_failed');
    const before = await request('/containers');
    if (!before.active || !Array.isArray(before.containers) || !Array.isArray(before.imageCatalog)
      || !before.imageCatalog.some(image => image.id === catalogId)
      || before.containers.length >= before.limits.maxContainers
      || before.usage.starts >= before.limits.maxStartsPerMonth
      || before.usage.availableComputeUnitHours !== undefined && before.usage.availableComputeUnitHours <= 0
      || before.limits.maxConcurrentComputeUnits !== undefined && (before.usage.concurrentComputeUnits ?? 0) + 1 > before.limits.maxConcurrentComputeUnits) throw new Error('preflight_failed');
    const creationKey = randomUUID();
    let started;
    // Retry the same operation, including polling when the reservation is still starting.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await wait();
      try {
        started = await request('/containers', 'POST', { catalogId }, { 'Idempotency-Key': creationKey });
        if (started.creation?.status === 'running') break;
      } catch {}
    }
    const creation = started?.creation;
    const candidate = started?.containers?.find(container => container.id === creation?.containerId
      && container.createdAt === creation?.createdAt && container.status === 'running');
    if (!creation?.id || creation.status !== 'running' || !candidate
      || typeof candidate.id !== 'string' || !Number.isFinite(Date.parse(candidate.createdAt))) {
      report.cleanup = 'reconcile_manually';
      report.creationKey = creationKey;
      throw new Error('creation_ambiguous');
    }
    owned = { id: candidate.id, createdAt: candidate.createdAt };
    report.container = owned;
    const result = await request(`/containers/exec?${new URLSearchParams(owned)}`, 'POST',
      { command: `echo "${hello}"`, timeoutMs: 30_000 });
    report.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : null;
    // Never echo unexpected output or execution diagnostics that might contain credentials.
    if (result.stdout?.trim() !== hello || result.exitCode !== 0
      || result.timedOut !== false || result.outputTruncated !== false) throw new Error('execution_failed');
    report.stdout = hello;
    const filePath = `/containers/files?${new URLSearchParams({ ...owned, path: `/tmp/mainbrella-verify-${creationKey}.bin` })}`;
    try {
      const written = await request(filePath, 'PUT', fileProbe, { 'Content-Type': 'application/octet-stream' });
      const read = await request(filePath);
      if (written.size !== fileProbe.byteLength || !(read instanceof Uint8Array)
        || read.byteLength !== fileProbe.byteLength || read.some((byte, i) => byte !== fileProbe[i])) throw new Error();
      report.files = 'verified';
    } catch { throw new Error('file_verification_failed'); }
    try { await verifyManaged({ request, owned, wait, report }); } catch { throw new Error('managed_verification_failed'); }
  } catch (error) {
    report.error = ['preflight_failed', 'creation_ambiguous', 'execution_failed', 'file_verification_failed', 'managed_verification_failed'].includes(error.message)
      ? error.message : 'verification_failed';
  } finally {
    if (owned) {
      try {
        const after = await request(`/containers?${new URLSearchParams(owned)}`, 'DELETE');
        if (!Array.isArray(after.containers) || after.containers.some(container =>
          container.id === owned.id && container.createdAt === owned.createdAt)) throw new Error();
        report.cleanup = 'completed';
      } catch { report.cleanup = 'failed'; }
    }
  }
  report.ok = !report.error && report.cleanup === 'completed';
  return report;
}

async function main() {
  if (process.argv.length > 2) throw new Error('Usage: node mainbrella-verify.mjs');
  const doctor = await runDoctor();
  if (!doctor.ok) return { ok: false, error: 'preflight_failed', doctor };
  const base = process.env.MAINBRELLA_API_URL || 'https://api.mainbrella.com';
  return verify({
    catalogId: process.env.MAINBRELLA_CATALOG_ID || 'node',
    request: createRequester({ base, key: process.env.MAINBRELLA_API_KEY }),

  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await main();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch { console.error('Verification could not run. Use Node 22+ with no command-line arguments.'); process.exitCode = 1; }
}
