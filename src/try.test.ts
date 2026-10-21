import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

const source = await readFile(new URL('./try.ts', import.meta.url), 'utf8');
const compiled = transpileModule(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
}).outputText;

function fixture() {
  const handlers = new Map<string, (event?: any) => void>();
  const windowHandlers = new Map<string, (event?: any) => void>();
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
  };
  runInNewContext(compiled, context);
  return { handlers, windowHandlers, button, input, error, form,
    submit() { let prevented = false; handlers.get('submit')?.({ preventDefault() { prevented = true; } }); return prevented; } };
}

test('valid repository submits immediately through the native form without tracking requests', () => {
  const f = fixture();
  assert.equal(f.submit(), false);
  assert.equal(f.input.value, 'Owner/Repo');
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.textContent, 'Continue');
  assert.equal(f.form.submitted, 0, 'the browser handles the native submit');
  assert.equal(f.windowHandlers.size, 0);
});

test('invalid repository still blocks submission and displays an inline error', () => {
  const f = fixture();
  f.input.value = 'invalid repository';
  assert.equal(f.submit(), true);
  assert.equal(f.error.hidden, false);
  assert.equal(f.error.textContent, 'Enter a GitHub URL or owner/repository.');
});
