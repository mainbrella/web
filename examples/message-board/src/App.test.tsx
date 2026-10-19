import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from './App.tsx';

test('the example starts with the public message list and write actions without logging in', () => {
  const unexpected = async () => { throw new Error('Rendering must not call the API'); };
  const html = renderToStaticMarkup(<App api={{ login: unexpected, logout: unexpected, list: unexpected,
    listBoards: unexpected, createBoard: unexpected, create: unexpected, update: unexpected }} />);
  assert.match(html, /<h1 id="board-title">All posts<\/h1>/);
  assert.match(html, /id="board-panel"/);
  assert.match(html, /id="global-message-search"/);
  assert.match(html, /id="create-message"/);
  assert.match(html, /id="create-board-button"/);
  assert.match(html, /Loading messages…/);
  assert.doesNotMatch(html, /id="login-panel"|id="current-user"|id="logout"|My messages|<dialog/);
});
