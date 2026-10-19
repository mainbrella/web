import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createDemoApi, liveBoardConfig } from './api.ts';
import { localDemoConfig } from './config.ts';

const root = document.getElementById('message-board-root');
if (!root) throw new Error('Message board root is missing');

// The default development server proxies to the public demo; local-api mode
// uses a local backend and its separate project/key.
const config = import.meta.env.MODE === 'local-api'
  ? { ...localDemoConfig, apiOrigin: import.meta.env.DEV ? '/message-board-api' : localDemoConfig.apiOrigin }
  : { ...liveBoardConfig, apiOrigin: import.meta.env.DEV ? '/message-board-api' : liveBoardConfig.apiOrigin };
const api = createDemoApi(config);
const sessionKey = `message-board:session:${config.projectId}`;
const basePath = root.dataset.basePath ?? new URL('.', window.location.href).pathname;
const route = window.location.pathname.startsWith(basePath) ? window.location.pathname.slice(basePath.length) : '';
const boardRoute = /^boards\/([a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)(?:\/([^/]+))?\/?$/.exec(route);
const initialBoardSlug = root.dataset.boardSlug ?? boardRoute?.[1];
const encodedMessageId = root.dataset.messageId ?? boardRoute?.[2];
let initialMessageId: string | undefined;
try { if (encodedMessageId !== undefined) initialMessageId = decodeURIComponent(encodedMessageId); } catch { /* Keep malformed routes on the server-rendered 404 page. */ }
if (!root.dataset.serverRendered || root.dataset.boardSlug) {
  createRoot(root).render(<App api={api} basePath={basePath} sessionKey={sessionKey} initialBoardSlug={initialBoardSlug} initialMessageId={initialMessageId} />);
}
