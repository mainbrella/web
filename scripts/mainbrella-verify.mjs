#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runDoctor } from './mainbrella-doctor.mjs';

const hello = 'hello from mainbrella';

// Requests are injectable to verify ownership and cleanup without paid starts.
export async function verify({ request, catalogId = 'node', wait = () => new Promise(resolve => setTimeout(resolve, 1000)) }) {
  let owned;
  const report = { ok: false, stdout: null, exitCode: null, cleanup: 'not_needed' };
  try {
    const before = await request('/containers');
    if (!before.active || !Array.isArray(before.containers) || !Array.isArray(before.imageCatalog)
      || !before.imageCatalog.some(image => image.id === catalogId)
      || before.containers.length >= before.limits.maxContainers
      || before.usage.starts >= before.limits.maxStartsPerMonth) throw new Error('preflight_failed');
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
  } catch (error) {
    report.error = ['preflight_failed', 'creation_ambiguous', 'execution_failed'].includes(error.message)
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
    async request(path, method = 'GET', body, headers = {}) {
      const response = await fetch(new URL(path, base), {
        method, headers: { Authorization: `Bearer ${process.env.MAINBRELLA_API_KEY}`, ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new Error('request_failed');
      return response.json();
    },

  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await main();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch { console.error('Verification could not run. Use Node 22+ with no command-line arguments.'); process.exitCode = 1; }
}
