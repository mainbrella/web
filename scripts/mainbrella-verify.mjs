#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runDoctor } from './mainbrella-doctor.mjs';

const exec = promisify(execFile);
const hello = 'hello from mainbrella';

// request and execute are injectable so the ownership and cleanup contract can
// be verified without consuming starts or issuing real SSH credentials.
export async function verify({ request, execute, catalogId = 'node' }) {
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
    const access = await request('/containers/ssh', 'POST', owned);
    const result = await execute(access);
    report.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : null;
    // Never echo unexpected output or SSH diagnostics that might contain credentials.
    if (result.stdout?.trim() !== hello || result.exitCode !== 0) throw new Error('execution_failed');
    report.stdout = hello;
  } catch (error) {
    report.error = ['preflight_failed', 'creation_ambiguous', 'execution_failed', 'ssh_response_invalid'].includes(error.message)
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
    async execute(access) {
      const match = typeof access.command === 'string' && access.command.match(
        /^ssh -o ProxyCommand='cloudflared access ssh --hostname %h' ([a-f0-9]{64})@([a-z0-9]+(?:[.-][a-z0-9]+)*)$/);
      if (!match || match[2] !== access.hostname) throw new Error('ssh_response_invalid');
      const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15',
        '-o', 'ProxyCommand=cloudflared access ssh --hostname %h', `${match[1]}@${match[2]}`, `echo "${hello}"`];
      try {
        const result = await exec('ssh', args, { timeout: 30_000, maxBuffer: 64 * 1024 });
        return { stdout: result.stdout, exitCode: 0 };
      } catch (error) { return { stdout: '', exitCode: Number.isInteger(error.code) ? error.code : null }; }
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
