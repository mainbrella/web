import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFileEntries } from './build-files.ts';

test('repository roots group nested paths into folders before ordinary and hidden files', () => {
  assert.deepEqual(buildFileEntries(['src/deep/utils.ts', 'package.json', '.gitignore', 'src/App.tsx', 'public/generated/image.jpg']), [
    { name: 'public', path: 'public', directory: true },
    { name: 'src', path: 'src', directory: true },
    { name: '.gitignore', path: '.gitignore', directory: false },
    { name: 'package.json', path: 'package.json', directory: false },
  ]);
});

test('folder navigation uses exact path boundaries and retains full paths for opening files', () => {
  assert.deepEqual(buildFileEntries(['src/App.tsx', 'src/deep/utils.ts', 'src-old/other.ts', 'src10.ts'], 'src'), [
    { name: 'deep', path: 'src/deep', directory: true },
    { name: 'App.tsx', path: 'src/App.tsx', directory: false },
  ]);
  assert.deepEqual(buildFileEntries(['public/generated/image.jpg'], 'public/generated'), [
    { name: 'image.jpg', path: 'public/generated/image.jpg', directory: false },
  ]);
  assert.deepEqual(buildFileEntries(['src/App.tsx'], 'deleted-folder'), []);
  assert.deepEqual(buildFileEntries([]), []);
});

test('file names sort naturally and folder names appear once across many descendants', () => {
  assert.deepEqual(buildFileEntries(['file10.ts', 'src/one.ts', 'file2.ts', 'src/two.ts', 'src/deep/three.ts']).map(entry => entry.name),
    ['src', 'file2.ts', 'file10.ts']);
});
