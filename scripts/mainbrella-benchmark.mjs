#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runDoctor } from './mainbrella-doctor.mjs';
import { verify, createRequester } from './mainbrella-verify.mjs';

function percentiles(values) {
  if (!values.length) return { count: 0, p50Ms: null, p95Ms: null };
  const sorted = [...values].sort((a, b) => a - b);
  const rank = p => sorted[Math.ceil(p * sorted.length) - 1];
  return { count: sorted.length, p50Ms: rank(.5), p95Ms: rank(.95) };
}

// Reuse verification's operation ownership and cleanup instead of guessing IDs.
export async function runBenchmark({ request, samples, concurrency, catalogId = 'node',
  now = () => performance.now(), wait, metadata = {},
}) {
  if (!Number.isInteger(samples) || samples < 1 || samples > 1000
    || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > samples) {
    return { ok: false, error: 'invalid_run_size' };
  }
  const before = await request('/containers');
  if (!before?.active || !Array.isArray(before.containers)
    || !Array.isArray(before.imageCatalog) || !before.imageCatalog.some(image => image.id === catalogId)
    || !Number.isInteger(before.limits?.maxContainers)
    || !Number.isInteger(before.limits?.maxStartsPerMonth)
    || !Number.isInteger(before.usage?.starts)
    || before.limits.maxContainers - before.containers.length < concurrency
    || before.limits.maxStartsPerMonth - before.usage.starts < samples) {
    return { ok: false, error: 'insufficient_access_or_allowance' };
  }
  const report = {
    protocol: 'mainbrella-http-v1', startedAt: new Date().toISOString(),
    environment: { ...metadata, catalogId, plan: before.plan ?? null, limits: before.limits,
      computeRegion: 'not reported by API', cacheState: 'uncontrolled' },
    requested: samples, concurrency, samples: [],
  };
  for (let offset = 0; offset < samples; offset += concurrency) {
    const batch = await Promise.all(Array.from({ length: Math.min(concurrency, samples - offset) }, async (_, i) => {
      let start, running, executed, instance;
      let createRequests = 0;
      const result = await verify({ catalogId, wait, async request(path, method = 'GET', body, headers) {
        if (path === '/containers' && method === 'POST') {
          start ??= now();
          createRequests++;
        }
        const data = await request(path, method, body, headers);
        if (path === '/containers' && method === 'POST' && data.creation?.status === 'running') {
          running = now();
          instance = data.containers?.find(container => container.id === data.creation.containerId
            && container.createdAt === data.creation.createdAt)?.instance ?? null;
        }
        if (path.startsWith('/containers/exec?') && method === 'POST') executed = now();
        return data;
      } });
      return { sample: offset + i + 1, ...result, createRequests, instance: instance ?? null,
        createMs: start !== undefined && running !== undefined ? running - start : null,
        firstCommandMs: start !== undefined && executed !== undefined && result.stdout
          ? executed - start : null };
    }));
    report.samples.push(...batch);
    // Wait for the whole batch's cleanup, then halt on any failure. Never retry
    // a new reservation to compensate for a missing or failed measurement.
    if (batch.some(sample => !sample.ok)) break;
  }
  const successful = report.samples.filter(sample => sample.ok);
  report.finishedAt = new Date().toISOString();
  report.attempted = report.samples.length;
  report.successful = successful.length;
  report.ok = report.attempted === samples && report.successful === samples;
  report.summary = {
    create: percentiles(successful.map(sample => sample.createMs)),
    firstCommand: percentiles(successful.map(sample => sample.firstCommandMs)),
  };
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--samples' || args[2] !== '--concurrency'
    || !/^\d+$/.test(args[1]) || !/^\d+$/.test(args[3])) {
    return { ok: false, error: 'usage', message: 'node mainbrella-benchmark.mjs --samples N --concurrency N' };
  }
  const samples = Number(args[1]), concurrency = Number(args[3]);
  if (samples < 1 || samples > 1000 || concurrency < 1 || concurrency > samples) {
    return { ok: false, error: 'invalid_run_size' };
  }
  const doctor = await runDoctor();
  if (!doctor.ok) return { ok: false, error: 'preflight_failed', doctor };
  const base = process.env.MAINBRELLA_API_URL || 'https://api.mainbrella.com';
  return runBenchmark({ samples, concurrency,
    catalogId: process.env.MAINBRELLA_CATALOG_ID || 'node',
    metadata: { apiOrigin: new URL(base).origin, nodeVersion: process.versions.node,
      clientLocation: process.env.MAINBRELLA_CLIENT_LOCATION || 'not supplied' },
    request: createRequester({ base, key: process.env.MAINBRELLA_API_KEY }),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await main();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch { console.error('Benchmark could not run. Check connectivity and the read-only doctor.'); process.exitCode = 1; }
}
