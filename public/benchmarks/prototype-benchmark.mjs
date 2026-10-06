import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { estimateCost } from './cost.mjs';

const base = process.env.TEST_BASE_URL || 'https://mainbrella-machine-test.crimson-dust-553b.workers.dev';
const token = process.env.TEST_API_TOKEN || (await readFile('.test-token', 'utf8')).trim();
const instance = 'standard-2', count = 30, width = 100;
const prefix = `bench-${Date.now()}`, machines = new Set();
const report = { startedAt: new Date().toISOString(), instance, count, width, raw: {}, cleanup: [], success: false };
const output = `results/${prefix}.json`;
const check = (ok, message) => { if (!ok) throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quantile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] ?? null;
const id = (kind, n) => `${prefix}-${kind}-${n}`;

async function persist() {
  await mkdir('results', { recursive: true });
  const json = JSON.stringify(report, null, 2) + '\n';
  await writeFile(output, json);
  await writeFile('results/benchmark-latest.json', json);
}
async function api(machine, suffix = '', method = 'POST', body = {}) {
  const started = performance.now();
  const response = await fetch(`${base}/machines/${machine}${suffix}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: ['GET', 'DELETE'].includes(method) ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await response.json();
  check(response.ok, `HTTP ${response.status}: ${JSON.stringify(data)}`);
  return { ...data, wallMs: performance.now() - started };
}
async function exec(machine, argv) {
  const result = await api(machine, '/exec', 'POST', { argv });
  check(result.exitCode === 0, `${machine}: exit ${result.exitCode}: ${result.stderr}`);
  return result;
}
async function stop(machine) {
  const status = await api(machine, '', 'DELETE');
  check(status.running === false && status.info === null, `${machine} did not stop`);
}
async function start(machine, options = {}) {
  machines.add(machine);
  const result = await api(machine, '/start', 'POST', { instance, ...options });
  check(result.coldStart === true && result.exitCode === 0 && result.stdout.includes('Linux'), `${machine} was not a fresh usable shell`);
  return result;
}
async function sample(machine, options = {}) {
  try { return { machine, ok: true, ...(await start(machine, options)) }; }
  catch (error) { return { machine, ok: false, error: String(error) }; }
}
function summary(samples) {
  const successful = samples.filter((s) => s.ok);
  return { attempted: samples.length, succeeded: successful.length, successRate: successful.length / samples.length,
    p50Ms: quantile(successful.map((s) => s.wallMs), .5), p95Ms: quantile(successful.map((s) => s.wallMs), .95),
    serverP50Ms: quantile(successful.map((s) => s.durationMs), .5), serverP95Ms: quantile(successful.map((s) => s.durationMs), .95) };
}

const workloadSource = await readFile('workload.cjs', 'utf8');
const launchCode = `const fs=require('node:fs'),cp=require('node:child_process');
fs.writeFileSync('/tmp/agent-workload.cjs',${JSON.stringify(workloadSource)});
const log=fs.openSync('/tmp/agent-workload.log','w');
const child=cp.spawn(process.execPath,['/tmp/agent-workload.cjs'],{detached:true,stdio:['ignore',log,log]});
child.unref();console.log(JSON.stringify({pid:child.pid}));`;
const pollCode = `const fs=require('node:fs');let result=null,progress=null;
for(const [key,file] of [['result','/tmp/agent-result.json'],['progress','/tmp/agent-progress.json']]){
if(fs.existsSync(file)){const value=JSON.parse(fs.readFileSync(file,'utf8'));if(key==='result')result=value;else progress=value;}}
console.log(JSON.stringify({result,progress}));`;
const costMachines = Array.from({ length: 3 }, (_, n) => id('cost', n));
let failure;
try {
  // Start bounded 10-minute samples first; latency and scale tests run during their model waits.
  await Promise.all(costMachines.map(async (machine) => {
    await start(machine, { keepAliveMs: 720_000 });
    await exec(machine, ['node', '-e', launchCode]);
  }));
  report.raw.costMachines = costMachines;
  console.log('COST: three actual 10-minute sessions started.');
  await persist();

  report.raw.create = [];
  for (let n = 0; n < count; n++) {
    const machine = id('create', n), result = await sample(machine);
    report.raw.create.push(result);
    await stop(machine);
    if ((n + 1) % 10 === 0) console.log(`CREATE: ${n + 1}/${count} sampled.`);
  }
  report.create = summary(report.raw.create);
  await persist();

  const seed = id('seed', 0), marker = randomUUID();
  await start(seed);
  const seedCode = String.raw`const fs=require('node:fs'),crypto=require('node:crypto');fs.mkdirSync('/workspace',{recursive:true});
fs.writeFileSync('/workspace/assets.bin',crypto.randomBytes(30*1024*1024));
for(let i=0;i<300;i++)fs.writeFileSync('/workspace/module-'+i+'.js','module.exports='+i+';\n'+'//'.padEnd(1024,'x'));
const sha=crypto.createHash('sha256').update(fs.readFileSync('/workspace/assets.bin')).digest('hex');
fs.writeFileSync('/workspace/marker.json',JSON.stringify({marker:${JSON.stringify(marker)},sha}));console.log(sha);`;
  const seeded = await exec(seed, ['node', '-e', seedCode]);
  const snapshot = await api(seed, '/snapshot');
  report.snapshot = { ...snapshot, marker, assetSha256: seeded.stdout.trim(), populatedBytes: 30 * 1024 * 1024 + 300 * 1024 };
  await stop(seed);
  report.raw.resume = [];
  const verifyCode = `const fs=require('node:fs'),crypto=require('node:crypto');const m=JSON.parse(fs.readFileSync('/workspace/marker.json','utf8'));
const sha=crypto.createHash('sha256').update(fs.readFileSync('/workspace/assets.bin')).digest('hex');
if(m.marker!==${JSON.stringify(marker)}||m.sha!==sha)process.exit(1);console.log(sha);`;
  for (let n = 0; n < count; n++) {
    const machine = id('resume', n), result = await sample(machine, { snapshot: snapshot.snapshot });
    if (result.ok) {
      try { await exec(machine, ['node', '-e', verifyCode]); result.filesVerified = true; }
      catch (error) { result.ok = false; result.error = String(error); }
    }
    report.raw.resume.push(result);
    await stop(machine);
    if ((n + 1) % 10 === 0) console.log(`RESUME: ${n + 1}/${count} sampled and content checked.`);
  }
  report.resume = summary(report.raw.resume);
  await persist();

  const burstStart = performance.now();
  report.raw.scale = await Promise.all(Array.from({ length: width }, async (_, n) => {
    const dispatchedAfterMs = performance.now() - burstStart;
    return { ...(await sample(id('scale', n))), dispatchedAfterMs };
  }));
  report.scale = { ...summary(report.raw.scale), uniqueHostnames: new Set(report.raw.scale.filter((s) => s.ok).map((s) => s.stdout.split(/\s+/)[1])).size,
    dispatchSpreadMs: Math.max(...report.raw.scale.map((s) => s.dispatchedAfterMs)) };
  const running = await Promise.all(report.raw.scale.map(async (s) => {
    try { return (await api(s.machine, '', 'GET')).running; } catch { return false; }
  }));
  report.scale.observedRunning = running.filter(Boolean).length;
  await Promise.all(report.raw.scale.map((s) => stop(s.machine)));
  console.log(`SCALE: ${report.scale.succeeded}/${width} usable starts; ${report.scale.observedRunning} simultaneously running.`);
  await persist();

  report.raw.cost = [];
  const completed = new Set(), costDeadline = Date.now() + 700_000;
  let lastProgress = 0;
  while (completed.size < costMachines.length && Date.now() < costDeadline) {
    for (const machine of costMachines.filter((name) => !completed.has(name))) {
      const state = JSON.parse((await exec(machine, ['node', '-e', pollCode])).stdout);
      if (state.result) {
        check(!state.result.error, `Workload failed: ${state.result.error}`);
        check(state.result.cycles === 10 && state.result.testsPassed >= 10 && state.result.wallSeconds >= 599, 'Incomplete 10-minute workload');
        report.raw.cost.push({ machine, ...state.result });
        completed.add(machine);
        await stop(machine);
        await persist();
      } else if (Date.now() - lastProgress >= 30_000) {
        console.log(`COST: waiting; ${state.progress?.completedCycles ?? 0}/10 edit/build/test cycles completed.`);
        lastProgress = Date.now();
      }
    }
    if (completed.size < costMachines.length) await sleep(15_000);
  }
  check(completed.size === costMachines.length, '10-minute workload deadline exceeded');
  report.cost = estimateCost(report.raw.cost);
  report.success = report.create.succeeded === count && report.resume.succeeded === count && report.scale.succeeded === width && report.scale.uniqueHostnames === width && report.scale.observedRunning === width;
} catch (error) {
  failure = error;
  report.failure = String(error.stack ?? error);
  console.error(report.failure);
} finally {
  // Retry cleanup only; benchmark measurements are never retried or silently replaced.
  const pending = [...machines];
  for (let offset = 0; offset < pending.length; offset += 20) {
    await Promise.all(pending.slice(offset, offset + 20).map(async (machine) => {
      let error;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await stop(machine); report.cleanup.push({ machine, stopped: true }); return; }
        catch (caught) { error = String(caught); }
      }
      report.cleanup.push({ machine, stopped: false, error });
    }));
  }
  report.cleanupVerified = report.cleanup.every((s) => s.stopped);
  report.success &&= report.cleanupVerified;
  report.finishedAt = new Date().toISOString();
  await persist();
}
console.log(JSON.stringify({ CREATE: report.create, RESUME: report.resume, SCALE: report.scale, COST: report.cost }, null, 2));
console.log(`Raw results: ${output}; all machines stopped: ${report.cleanupVerified}`);
if (failure || !report.success) process.exitCode = 1;
