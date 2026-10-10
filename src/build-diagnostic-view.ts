import type { BuildDiagnostics, BuildOperation } from './build-api.ts';
import { cleanDiagnosticOutput, operationExplanation, operationLabel, operationOutput, operationStatus } from './build-diagnostics.ts';

export function diagnosticTime(value: number | string | null): string {
  if (value === null) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function duration(operation: BuildOperation): string {
  if (operation.started_at === null || operation.finished_at === null) return '';
  const seconds = Math.max(0, (operation.finished_at - operation.started_at) / 1000);
  return seconds < 60 ? `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function paragraph(text: string, className = '') {
  const node = document.createElement('p'); node.textContent = text; node.className = className; return node;
}

function outputBlock(label: string, text: string) {
  const block = document.createElement('div'), heading = document.createElement('span'), output = document.createElement('pre');
  block.className = 'build-diagnostic-output'; heading.textContent = label; output.textContent = text;
  output.tabIndex = 0; output.setAttribute('aria-label', label); block.append(heading, output); return block;
}

export function renderBuildOperation(operation: BuildOperation, turnStatus: BuildDiagnostics['status'], existing?: HTMLDetailsElement, compact = false): HTMLDetailsElement {
  const details = existing ?? document.createElement('details');
  const fingerprint = JSON.stringify([operation, turnStatus, compact]);
  if (details.dataset.fingerprint === fingerprint) return details;
  const evidenceOpen = details.querySelector<HTMLDetailsElement>('.build-operation-evidence')?.open ?? false;
  const focusedSummary = document.activeElement === details.querySelector(':scope > summary');
  details.dataset.fingerprint = fingerprint;
  details.className = 'build-operation'; details.dataset.operationKey = `${operation.operation_id}:${operation.attempt_id}`;
  const status = operationStatus(operation, turnStatus);
  details.dataset.state = status === 'In progress' ? 'running' : operation.status;
  const summary = document.createElement('summary'), time = document.createElement('time'), label = document.createElement('span'), state = document.createElement('span');
  time.textContent = diagnosticTime(operation.started_at ?? operation.created_at); time.dateTime = new Date(operation.started_at ?? operation.created_at).toISOString();
  label.className = 'build-operation-label'; label.textContent = operationLabel(operation);
  state.className = 'build-operation-status'; state.textContent = `${status}${compact && operation.evidence.exitCode != null ? ` · exit ${operation.evidence.exitCode}` : ''}${duration(operation) ? ` · ${duration(operation)}` : ''}`;
  summary.append(time, label, state);
  const body = document.createElement('div'); body.className = 'build-operation-body';
  const explanation = operationExplanation(operation);
  if (explanation && !compact) body.append(paragraph(explanation));
  const failure = operation.result && typeof operation.result === 'object' && 'failure' in operation.result
    ? operation.result.failure as { code?: string; details?: string | null; providerCode?: string | null } : null;
  if (failure?.details && failure.details !== explanation) body.append(outputBlock(failure.providerCode ? `Provider response · ${failure.providerCode}` : failure.code ?? 'Failure details', cleanDiagnosticOutput(failure.details) ?? ''));
  const evidence = operation.evidence;
  const command = typeof evidence.command === 'string' ? evidence.command : null;
  if (command && !compact) body.append(outputBlock('Command', command));
  const output = operationOutput(operation);
  for (const item of output) body.append(outputBlock(item.label, item.text));
  if (operation.kind === 'command' && operation.status === 'failed' && !output.length) body.append(paragraph('No command output was retained.', 'build-diagnostic-note'));
  const metadata = document.createElement('dl'); metadata.className = 'build-diagnostic-metadata';
  const add = (name: string, value: unknown) => {
    if (value === undefined) return;
    const term = document.createElement('dt'), definition = document.createElement('dd');
    term.textContent = name; definition.textContent = value === null ? 'Unknown' : String(value); metadata.append(term, definition);
  };
  if (operation.kind === 'command' && !compact) add('Exit code', evidence.exitCode);
  add('Model', evidence.model); add('Finish reason', evidence.finishReason); add('Response limit', evidence.tokenAllowance);
  const usage = evidence.usage as { prompt_tokens?: number | null; completion_tokens?: number | null } | null | undefined;
  if (operation.kind === 'text') {
    add('Input tokens', usage?.prompt_tokens ?? null); add('Output tokens', usage?.completion_tokens ?? null);
    add('Stream ended', evidence.termination);
  }
  if (!compact) add('Attempt', operation.attempt_id);
  if (metadata.children.length) body.append(metadata);
  const raw = document.createElement('details'), rawSummary = document.createElement('summary');
  raw.className = 'build-operation-evidence'; raw.open = evidenceOpen; rawSummary.textContent = compact && command ? 'Command and evidence' : 'Recorded evidence';
  // Output is already readable above. Keep source contents in the downloadable report.
  const { stdout, stderr, output: toolOutput, ...otherEvidence } = evidence;
  raw.append(rawSummary, outputBlock('Operation record', JSON.stringify({ operationId: operation.operation_id,
    schemaVersion: operation.schema_version, deploymentVersion: operation.deployment_version,
    dispatchAttempted: operation.dispatch_attempted, createdAt: operation.created_at, startedAt: operation.started_at,
    finishedAt: operation.finished_at, evidence: otherEvidence,
    ...(operation.source ? { checkedSourceFiles: Object.keys(operation.source) } : {}) }, null, 2)));
  body.append(raw); details.replaceChildren(summary, body);
  if (focusedSummary) summary.focus({ preventScroll: true });
  return details;
}

export function renderOperationList(host: HTMLElement, operations: BuildOperation[], status: BuildDiagnostics['status'], open = false, compact = false) {
  const existing = new Map(Array.from(host.querySelectorAll<HTMLDetailsElement>(':scope > li > .build-operation'), item => [item.dataset.operationKey, item]));
  const rows = operations.map(operation => {
    const previous = existing.get(`${operation.operation_id}:${operation.attempt_id}`);
    const details = renderBuildOperation(operation, status, previous, compact);
    if (!previous) details.open = open;
    const row = previous?.parentElement ?? document.createElement('li'); row.append(details); return row;
  });
  for (const row of Array.from(host.children)) if (!rows.includes(row as HTMLElement)) row.remove();
  rows.forEach((row, index) => { if (host.children[index] !== row) host.insertBefore(row, host.children[index] ?? null); });
}
