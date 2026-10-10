import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

const source = await readFile(new URL('./try.ts', import.meta.url), 'utf8');
const compiled = transpileModule(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
}).outputText;

function fixture(consent: string) {
  const handlers = new Map<string, (event?: any) => void>();
  const windowHandlers = new Map<string, (event?: any) => void>();
  const calls: unknown[][] = [];
  let resolveCapture!: () => void;
  const capturePromise = new Promise<void>(resolve => { resolveCapture = resolve; });
  const button = { disabled: false, textContent: 'Continue' };
  const input = { value: 'https://github.com/Owner/Repo.git',
    addEventListener(type: string, handler: (event?: any) => void) { handlers.set(`input:${type}`, handler); },
    setCustomValidity(_value: string) {}, removeAttribute(_name: string) {}, setAttribute(_name: string, _value: string) {}, focus() {} };
  const error = { hidden: true, textContent: '' };
  const form = { noValidate: false, submitted: 0, addEventListener(type: string, handler: (event?: any) => void) { handlers.set(type, handler); },
    querySelector() { return button; }, submit() { this.submitted++; } };
  const document = { querySelector(selector: string) { return selector === '#try-form' ? form : selector === '#try-repo' ? input : error; } };
  const context = {
    document,
    window: { addEventListener(type: string, handler: (event?: any) => void) { windowHandlers.set(type, handler); } },
    normalizeRepo: (value: string) => value.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/, ''),
    validRepo: (value: string) => /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(value),
    readConsent: () => consent,
    firstTouchAttribution: () => null,
    captureRepository: (...args: unknown[]) => { calls.push(args); return capturePromise; },
  };
  runInNewContext(compiled, context);
  return { handlers, windowHandlers, calls, button, input, form, resolveCapture,
    submit() { let prevented = false; handlers.get('submit')?.({ preventDefault() { prevented = true; } }); return prevented; } };
}

test('accepted try submit shows a short loading state, submits natively, and pageshow restores Continue', async () => {
  const f = fixture('accepted');
  assert.equal(f.submit(), true);
  assert.deepEqual(f.calls, [['Owner/Repo', 'try_v1']]);
  assert.equal(f.input.value, 'Owner/Repo');
  assert.equal(f.button.disabled, true);
  assert.equal(f.button.textContent, 'Continuing…');
  f.resolveCapture();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.form.submitted, 1);
  f.windowHandlers.get('pageshow')?.();
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.textContent, 'Continue');
});

test('rejected consent keeps native submission immediate without a loading state', () => {
  const f = fixture('rejected');
  assert.equal(f.submit(), false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.textContent, 'Continue');
});
