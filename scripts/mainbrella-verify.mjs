#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runDoctor } from './mainbrella-doctor.mjs';

const hello = 'hello from mainbrella';

// Requests are injectable to verify ownership and cleanup without paid starts.
export async function verify({ request, catalogId = 'node' }) {
  let owned;
  const report = { ok: false, stdout: null, exitCode: null, cleanup: 'not_needed' };
  try {
    const before = await request('/containers');
    if (!before.active || !Array.isArray(before.containers) || !Array.isArray(before.imageCatalog)
      || !before.imageCatalog.some(image => image.id === catalogId)
      || before.containers.length >= before.limits.maxContainers
      || before.usage.starts >= before.limits.maxStartsPerMonth) throw new Error('preflight_failed');
    let started;
    try { started = await request('/containers', 'POST', { catalogId }); }
    catch {
      // Creation is not idempotent; observe once but never retry or guess ownership.
      try { await request('/containers'); } catch {}
      report.cleanup = 'reconcile_manually';
      throw new Error('creation_ambiguous');
    }
    const candidates = started.containers?.filter(container =>
      !before.containers.some(old => old.id === container.id && old.createdAt === container.createdAt));
    if (candidates?.length !== 1 || candidates[0].status !== 'running'
      || typeof candidates[0].id !== 'string' || !Number.isFinite(Date.parse(candidates[0].createdAt))) {
      report.cleanup = 'reconcile_manually';
      throw new Error('creation_ambiguous');
    }
    owned = { id: candidates[0].id, createdAt: candidates[0].createdAt };
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
    async request(path, method = 'GET', body) {
      const response = await fetch(new URL(path, base), {
        method, headers: { Authorization: `Bearer ${process.env.MAINBRELLA_API_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
