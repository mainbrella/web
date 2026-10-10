import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBuildBriefPrompt,
  readBuildBriefPrompt,
} from './build-brief.ts';

test('skipping both questions returns the trimmed original prompt', () => {
  assert.equal(formatBuildBriefPrompt('  Make a reading list.\n', ['', '  ']), 'Make a reading list.');
});

test('preferences round trip with multiline prompts, quotes, unicode and custom choices', () => {
  const prompt = 'Build a café planner.\nIt should support “quiet” hours and 🍵.';
  const answers = ['  An unusual “community” app  ', 'Noir / 夜の喫茶店'];
  const formatted = formatBuildBriefPrompt(prompt, answers);
  assert.match(formatted, /Build preferences:\n\{"appType":"An unusual “community” app","visualStyle":"Noir \/ 夜の喫茶店"\}$/);
  assert.deepEqual(readBuildBriefPrompt(formatted), {
    prompt,
    answers: ['An unusual “community” app', 'Noir / 夜の喫茶店'],
  });
});

test('one answer can be blank and unknown custom values remain readable', () => {
  const formatted = formatBuildBriefPrompt('A small archive', ['', 'Warm editorial colors']);
  assert.deepEqual(readBuildBriefPrompt(formatted), {
    prompt: 'A small archive', answers: ['', 'Warm editorial colors'],
  });
});

test('malformed and unrelated preference JSON stay part of the original prompt', () => {
  for (const text of [
    'Idea\n\nBuild preferences:\n{broken',
    'Idea\n\nBuild preferences:\n{"appType":"Website"}',
    'Idea\n\nBuild preferences:\n{"appType":"Website","visualStyle":"Clean","extra":true}',
    'Idea\n\nBuild preferences:\n{"appType":" ","visualStyle":""}',
    'Idea\n\nBuild preferences:\n{"appType":"Website","visualStyle":"Clean"}\nextra',
    'Idea\n{"appType":"Website","visualStyle":"Clean"}',
  ]) {
    assert.deepEqual(readBuildBriefPrompt(text), { prompt: text, answers: ['', ''] });
  }
});

test('formatter rejects blank prompts and preferences over 180 characters', () => {
  assert.throws(() => formatBuildBriefPrompt(' \n ', ['', '']), /Describe what you want to build/);
  assert.equal(formatBuildBriefPrompt('Idea', ['a'.repeat(180), '']).includes('a'.repeat(180)), true);
  assert.throws(() => formatBuildBriefPrompt('Idea', ['a'.repeat(181), '']), /180 characters or fewer/);
});

test('formatter enforces the 6,000 character limit without truncating', () => {
  const exact = formatBuildBriefPrompt('x'.repeat(6000 - '\n\nBuild preferences:\n{"appType":"Website","visualStyle":""}'.length), ['Website', '']);
  assert.equal(exact.length, 6000);
  assert.throws(
    () => formatBuildBriefPrompt('x'.repeat(6000 - '\n\nBuild preferences:\n{"appType":"Website","visualStyle":""}'.length + 1), ['Website', '']),
    /longer than 6,000 characters/,
  );
  assert.throws(() => formatBuildBriefPrompt('x'.repeat(6001), ['', '']), /longer than 6,000 characters/);
});

test('reader requires the exact shape and rejects answers over 180 characters', () => {
  const tooLong = `Idea\n\nBuild preferences:\n${JSON.stringify({ appType: 'a'.repeat(181), visualStyle: '' })}`;
  assert.deepEqual(readBuildBriefPrompt(tooLong), { prompt: tooLong, answers: ['', ''] });
  const wrongType = 'Idea\n\nBuild preferences:\n{"appType":"Website","visualStyle":null}';
  assert.deepEqual(readBuildBriefPrompt(wrongType), { prompt: wrongType, answers: ['', ''] });
});
