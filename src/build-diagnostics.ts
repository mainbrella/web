import type { BuildDiagnostics, BuildOperation } from './build-api.ts';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const failureOf = (op: BuildOperation) => record(record(op.result).failure);
const evidenceOf = (op: BuildOperation) => record(op.evidence);
const labelText = (op: BuildOperation) => `${op.operation_id} ${op.label} ${text(evidenceOf(op).command) ?? ''}`.toLowerCase();

export function operationLabel(op: BuildOperation): string {
  if (op.operation_id.startsWith('limit-')) {
    const name = op.operation_id.slice(6);
    const labels: Record<string, string> = { 'output-tokens': 'Output token limit', 'input-tokens': 'Input token limit',
      'context-size': 'Conversation size limit', 'elapsed-time': 'Build time limit', 'round-limit': 'Repair round limit' };
    return labels[name] ?? 'Build limit';
  }
  const raw = text(op.label) ?? op.operation_id;
  const normalized = raw.toLowerCase().trim();
  const commandAction = op.kind === 'command' || evidenceOf(op).toolName === 'run_command'
    || ['check the build', 'install dependencies', 'type-check and compile', 'start preview', 'prepare project files'].includes(normalized);
  if (op.kind === 'text' || /^text(?:-|$)/i.test(op.operation_id)) return 'Model response';
  if (!commandAction) return raw;
  if (normalized === 'check the build' || normalized === 'type-check and compile') return 'Type-check and compile';
  const haystack = labelText(op);
  if (haystack.includes('npm install') || haystack.includes('install dependencies') || /^install(?:-|$)/i.test(op.operation_id)) return 'Install dependencies';
  if (haystack.includes('tsc') || haystack.includes('vite build') || haystack.includes('compile') || /^compile(?:-|$)/i.test(op.operation_id)) return 'Type-check and compile';
  if (haystack.includes('mkdir') || haystack.includes('directories') || haystack.includes('prepare project')) return 'Prepare project files';
  if (haystack.includes('start-preview') || haystack.includes('start preview')) return 'Start preview';
  return raw;
}

export function operationStatus(op: BuildOperation, turnStatus: BuildDiagnostics['status']): string {
  if (op.status === 'unknown') return op.finished_at != null || (turnStatus !== 'queued' && turnStatus !== 'running') ? 'Outcome unknown' : 'In progress';
  return ({ proposed: 'Proposed', skipped: 'Not run', blocked: 'Blocked', succeeded: 'Completed', failed: 'Failed' } as const)[op.status];
}

export function operationExplanation(op: BuildOperation): string | null {
  const explicit = text(op.explanation);
  if (explicit) return explicit;
  const evidence = evidenceOf(op), failure = failureOf(op);
  if (op.kind === 'text' && evidence.finishReason === 'length') {
    const allowance = typeof evidence.tokenAllowance === 'number' ? evidence.tokenAllowance.toLocaleString() : null;
    return `The model reached${allowance ? ` its ${allowance} token` : ' the'} response limit before finishing. Incomplete tool requests were not run.`;
  }
  if (failure.code === 'build_inference_timeout') return 'The model did not respond before the inference timeout. Incomplete tool requests were not run.';
  if (failure.code === 'build_inference_disconnected') return 'The inference service disconnected before finishing. Incomplete tool requests were not run.';
  if (op.kind === 'text' && (evidence.termination === 'read_exception' || evidence.termination === 'stream_error'))
    return 'The model stream ended unexpectedly before a complete response was retained. Its execution outcome is unknown.';
  if (op.kind === 'text' && (evidence.doneSeen === true && !text(evidence.finishReason) || failure.code === 'model_response_incomplete'))
    return `The model stream ended without a complete finish marker${evidence.doneSeen === true ? ' (the end marker arrived without a finish reason)' : ''}. Incomplete tool requests were not run.`;
  if (text(failure.providerCode)) return `The provider rejected the request (${text(failure.providerCode)}).`;
  const details = text(failure.details);
  if (details) return details;
  const code = text(failure.code);
  if (code === 'spend_limit_exceeded') return "Your Mainbrella account's monthly spending limit could not cover this request and existing reservations. No request was sent to Cloudflare.";
  if (code === 'build_budget_exceeded') return 'The build stopped before verification finished. See the operation journal for the limit and the last check.';
  if (code) return `The operation failed (${code.replaceAll('_', ' ')}).`;
  if (op.status === 'unknown') return 'Execution may have started, but no definitive result was retained.';
  if (op.status === 'blocked') return 'Local validation prevented this operation from running.';
  if (op.status === 'skipped') return 'Not run. The build stopped before this operation started.';
  if (op.status === 'proposed') return 'Proposed. Waiting for the model to finish its request.';
  if (op.kind === 'command' && op.status === 'failed')
    return `${operationLabel(op)} exited with code ${evidence.exitCode ?? 'unknown'}. Command output and the checked source are retained in diagnostics.`;
  return null;
}

export function cleanDiagnosticOutput(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const clean = value
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .trim();
  return clean || null;
}

export function operationOutput(op: BuildOperation): { label: string; text: string }[] {
  const evidence = evidenceOf(op), outputs: { label: string; text: string }[] = [];
  for (const key of ['stdout', 'stderr'] as const) {
    const value = cleanDiagnosticOutput(evidence[key]);
    if (value) outputs.push({ label: key, text: value });
  }
  if (op.kind === 'command' || op.kind === 'tool' && ['failed', 'blocked', 'unknown'].includes(op.status)) {
    const value = cleanDiagnosticOutput(evidence.output);
    if (value) outputs.push({ label: 'output', text: value });
  }
  return outputs;
}

const chronological = (ops: BuildOperation[]) => [...ops].sort((a, b) => a.created_at - b.created_at || a.updated_at - b.updated_at);
const latestAttempt = (ops: BuildOperation[]) => chronological(ops).at(-1);
const isTerminalFailure = (op: BuildOperation) => op.status === 'failed' || op.status === 'blocked' || op.status === 'unknown' && op.finished_at != null;

export function failureOperations(report: BuildDiagnostics): BuildOperation[] {
  const ops = chronological(report.operations);
  let primary: BuildOperation | undefined;
  if (report.failureOperationId) primary = latestAttempt(ops.filter(op => op.operation_id === report.failureOperationId));
  if (!primary) primary = [...ops].reverse().find(op => op.kind !== 'billing' && op.kind !== 'cleanup' && isTerminalFailure(op));
  if (!primary) return [];
  const result = [primary];
  if ((report.error === 'build_budget_exceeded' || report.error === 'build_check_failed') && primary.kind !== 'command') {
    const latestByCommand = new Map<string, BuildOperation>();
    for (const op of ops) if (op.kind === 'command') {
      const command = text(evidenceOf(op).command);
      latestByCommand.set(command ? `command:${command}` : `operation:${op.operation_id}`, op);
    }
    const lastFailedCommand = [...latestByCommand.values()].filter(op => op.status === 'failed')
      .sort((a, b) => a.created_at - b.created_at || a.updated_at - b.updated_at).at(-1);
    if (lastFailedCommand) result.push(lastFailedCommand);
  }
  return result;
}

function timestamp(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function operationLines(op: BuildOperation, turnStatus: BuildDiagnostics['status']): string[] {
  const when = timestamp(op.finished_at ?? op.updated_at);
  const lines = [`${when ? `${when} ` : ''}${operationLabel(op)} — ${operationStatus(op, turnStatus)} (${op.operation_id}, attempt ${op.attempt_id})`];
  const explanation = operationExplanation(op);
  const cleanExplanation = cleanDiagnosticOutput(explanation);
  if (cleanExplanation) lines.push(`  ${cleanExplanation}`);
  const details = cleanDiagnosticOutput(failureOf(op).details);
  if (details && details !== cleanExplanation) lines.push(`  Failure details:\n${details}`);
  const command = text(evidenceOf(op).command);
  if (command) lines.push(`  Command: ${command}`);
  for (const output of operationOutput(op)) lines.push(`  ${output.label}:\n${output.text}`);
  return lines;
}

export function formatBuildDiagnostics(report: BuildDiagnostics): string {
  const lines = [`Build turn ${report.turnId} — ${report.status}${report.error ? ` (${report.error})` : ''}`];
  const explanation = text(report.errorExplanation);
  if (explanation) lines.push(explanation);
  const cause = failureOperations(report);
  const normal = chronological(report.operations.filter(op => op.kind !== 'billing' && op.kind !== 'cleanup'));
  lines.push('', 'Operations:');
  if (!normal.length) lines.push('  No recorded operations.');
  for (const op of normal) lines.push(...operationLines(op, report.status));
  if (cause.length) lines.push('', 'Reported stop cause:', ...operationLines(cause[0], report.status));
  if (cause.length > 1) lines.push('', 'Last failed check (supporting):', ...operationLines(cause[1], report.status));
  const cleanup = chronological(report.operations.filter(op => op.kind === 'cleanup'));
  if (cleanup.length) lines.push('', 'Cleanup:', ...cleanup.flatMap(op => operationLines(op, report.status)));
  const billingOperations = chronological(report.operations.filter(op => op.kind === 'billing'));
  if (report.billing.length || billingOperations.length) {
    lines.push('', 'Billing:');
    for (const op of billingOperations) lines.push(...operationLines(op, report.status));
    for (const item of report.billing) {
      const amount = item.cost_micro_usd == null ? 'usage unknown' : `${item.cost_micro_usd} micro-USD`;
      const usage = text(item.usage_json);
      lines.push(`  ${timestamp(item.reported_at ?? item.created_at) ?? ''} ${item.model}: ${item.status}, ${amount}${usage ? `, usage ${usage}` : ''}`.trim());
    }
  }
  const log = cleanDiagnosticOutput(report.log);
  if (log) lines.push('', 'Turn log:', log);
  return lines.join('\n');
}
