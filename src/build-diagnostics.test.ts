import test from 'node:test';
import assert from 'node:assert/strict';
import type { BuildDiagnostics, BuildOperation } from './build-api.ts';
import { failureOperations, formatBuildDiagnostics, operationExplanation, operationLabel, operationOutput, operationStatus } from './build-diagnostics.ts';

const op = (id: string, patch: Partial<BuildOperation> = {}): BuildOperation => ({
  turn_id: 'turn-1', operation_id: id, attempt_id: '1', schema_version: 1, deployment_version: null,
  kind: 'tool', label: id, status: 'succeeded', explanation: null, dispatch_attempted: 1,
  created_at: 100, started_at: 110, updated_at: 120, finished_at: 120, evidence: {}, result: null, source: null, ...patch,
});
const report = (patch: Partial<BuildDiagnostics> = {}): BuildDiagnostics => ({
  schemaVersion: 1, turnId: 'turn-1', status: 'failed', error: null, errorExplanation: null, log: '',
  failureOperationId: null, operations: [], billing: [], ...patch,
});

test('failure selection uses the latest attempt for the reported operation and keeps prior command checks supporting', () => {
  const old = op('text-0', { kind: 'text', status: 'failed', created_at: 100 });
  const oldAttempt = op('tool-0-0', { status: 'failed', created_at: 110, attempt_id: '1' });
  const latestAttempt = op('tool-0-0', { status: 'unknown', finished_at: 140, created_at: 120, updated_at: 140, attempt_id: '2' });
  const check = op('compile-0', { kind: 'command', label: 'tsc --noEmit', status: 'failed', created_at: 130 });
  const selected = failureOperations(report({ error: 'build_budget_exceeded', failureOperationId: 'tool-0-0', operations: [old, oldAttempt, check, latestAttempt] }));
  assert.deepEqual(selected, [latestAttempt, check]);
  assert.equal(operationLabel(check), 'Type-check and compile');
});

test('successful later command attempt supersedes a failed attempt for supporting checks', () => {
  const prior = op('compile-0', { kind: 'command', status: 'failed', created_at: 100, attempt_id: '1' });
  const retry = op('compile-0', { kind: 'command', status: 'succeeded', created_at: 200, updated_at: 220, attempt_id: '2' });
  const cause = op('limit-output', { kind: 'limit', status: 'failed', created_at: 230 });
  assert.deepEqual(failureOperations(report({ error: 'build_budget_exceeded', failureOperationId: 'limit-output', operations: [prior, retry, cause] })), [cause]);
});

test('reported stop cause stays separate from earlier command and billing failures', () => {
  const command = op('compile-0', { kind: 'command', status: 'failed', created_at: 100 });
  const billingOp = op('settle-0', { kind: 'billing', status: 'failed', created_at: 110 });
  const stop = op('text-2', { kind: 'text', status: 'failed', label: 'Model response', created_at: 120, explanation: 'The provider stopped the request.' });
  const value = formatBuildDiagnostics(report({ error: 'build_inference_disconnected', failureOperationId: 'text-2', operations: [command, billingOp, stop], billing: [
    { id: 'usage-1', user_id: 'u', app_id: 'a', turn_id: 'turn-1', model: 'model-a', reserved_micro_usd: 10, cost_micro_usd: null, usage_json: null, status: 'reserved', created_at: 110, reported_at: null },
  ] }));
  assert.match(value, /Reported stop cause:[\s\S]*Model response/);
  assert.match(value, /Billing:/);
  assert.match(value, /Operations:[\s\S]*compile-0/);
  assert.ok(value.indexOf('Operations:') < value.indexOf('Reported stop cause:'));
  assert.ok(value.indexOf('Reported stop cause:') < value.indexOf('Billing:'));
});

test('billing formatting preserves the distinction between unknown usage and zero usage', () => {
  const value = formatBuildDiagnostics(report({ billing: [
    { id: 'unknown', user_id: 'u', app_id: 'a', turn_id: 't', model: 'model-a', reserved_micro_usd: 10, cost_micro_usd: null, usage_json: null, status: 'reserved', created_at: 100, reported_at: null },
    { id: 'zero', user_id: 'u', app_id: 'a', turn_id: 't', model: 'model-b', reserved_micro_usd: 10, cost_micro_usd: 0, usage_json: '{"inputTokens":0}', status: 'settled', created_at: 110, reported_at: 120 },
  ] }));
  assert.match(value, /model-a: reserved, usage unknown/);
  assert.match(value, /model-b: settled, 0 micro-USD, usage/);
});

test('operation outputs strip ANSI and unsafe controls and restrict tool output to failed outcomes', () => {
  const evidence = { stdout: '\u001b[31mred\u001b[0m\u0001\nline\tend', output: 'private success text' };
  assert.deepEqual(operationOutput(op('tool-ok', { evidence })), [{ label: 'stdout', text: 'red\nline\tend' }]);
  const failed = op('tool-failed', { status: 'failed', evidence });
  assert.deepEqual(operationOutput(failed), [
    { label: 'stdout', text: 'red\nline\tend' }, { label: 'output', text: 'private success text' },
  ]);
  assert.deepEqual(operationOutput(op('command', { kind: 'command', evidence: { output: 'command output' } })), [{ label: 'output', text: 'command output' }]);
});

test('unknown attempts are in progress only while their turn remains live', () => {
  const unfinished = op('text-0', { kind: 'text', status: 'unknown', finished_at: null });
  const finished = op('text-0', { kind: 'text', status: 'unknown', finished_at: 150 });
  assert.equal(operationStatus(unfinished, 'running'), 'In progress');
  assert.equal(operationStatus(unfinished, 'failed'), 'Outcome unknown');
  assert.equal(operationStatus(finished, 'running'), 'Outcome unknown');
});

test('old diagnostics explain incomplete streams from evidence when no server explanation exists', () => {
  assert.match(operationExplanation(op('text-0', { kind: 'text', status: 'failed', evidence: { doneSeen: true } }))!, /without a complete finish marker/);
  assert.match(operationExplanation(op('text-0', { kind: 'text', status: 'failed', evidence: { finishReason: 'length', tokenAllowance: 4096 } }))!, /4,096 token response limit/);
  assert.match(operationExplanation(op('text-0', { kind: 'text', status: 'failed', evidence: { termination: 'read_exception' } }))!, /stream ended unexpectedly/);
  assert.equal(operationExplanation(op('other', { explanation: '  server reason  ' })), 'server reason');
});
