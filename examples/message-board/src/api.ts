import { demoConfig, demoUsers, type DemoUser } from './config.ts';

export type Message = {
  id: string;
  board_id?: string;
  user_id: string;
  title: string;
  body: string;
  created_at: string;
};

export type Board = {
  id: string;
  user_id?: string | null;
  slug: string;
  name: string;
  description: string;
  created_at: string;
};

export type PublicBoardConfig = {
  apiOrigin: string;
  projectId: string;
  publicKey: string;
  table: string;
};

export type DemoSession = {
  session: { id: string; user_id: DemoUser; expires_at: string; created_at: string };
  token: string;
};

export const liveBoardConfig: PublicBoardConfig = demoConfig;

export class DemoApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'DemoApiError';
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function requestJson(url: string, init: RequestInit, fetcher: FetchLike, timeoutMs = 10_000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        credentials: 'omit',
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw new DemoApiError('The request took too long. Check your connection and try again.');
      throw new DemoApiError('Could not reach the message board. Check your connection and try again.');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (controller.signal.aborted) throw new DemoApiError('The request took too long. Check your connection and try again.');
      throw new DemoApiError('The message board returned an unreadable response. Try again.', response.status);
    }
    if (!response.ok) {
      const error = isRecord(payload) && typeof payload.error === 'string' && payload.error
        ? payload.error : `The request failed (HTTP ${response.status}).`;
      throw new DemoApiError(error, response.status);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function messagesFrom(payload: unknown): Message[] {
  if (!isRecord(payload) || !Array.isArray(payload.data) || !payload.data.every(isMessage)) {
    throw new DemoApiError('The message board returned data in an unexpected format. Try again later.');
  }
  return payload.data;
}

function tableUrl(config: PublicBoardConfig, table = config.table): string {
  return `${config.apiOrigin.replace(/\/$/, '')}/bff/data/${encodeURIComponent(config.projectId)}/tables/${encodeURIComponent(table)}`;
}

export async function fetchPublicMessages(
  config: PublicBoardConfig = liveBoardConfig,
  fetcher: FetchLike = fetch,
  timeoutMs = 10_000,
): Promise<Message[]> {
  try {
    return messagesFrom(await requestJson(`${tableUrl(config)}?select=*`, { headers: { apikey: config.publicKey } }, fetcher, timeoutMs));
  } catch (error) {
    if (error instanceof DemoApiError && error.status === 403) throw new DemoApiError('This public demo is unavailable right now. Try again later.', 403);
    throw error;
  }
}

export async function fetchPublicBoards(config: PublicBoardConfig = liveBoardConfig, fetcher: FetchLike = fetch): Promise<Board[]> {
  const boards: Board[] = [];
  for (let offset = 0; ; offset += 100) {
    const payload = await requestJson(`${tableUrl(config, 'boards')}?select=*&order=slug.asc&limit=100&offset=${offset}`,
      { headers: { apikey: config.publicKey } }, fetcher);
    if (!isRecord(payload) || !Array.isArray(payload.data) || !payload.data.every(isBoard)) {
      throw new DemoApiError('The message board returned boards in an unexpected format. Try again later.');
    }
    boards.push(...payload.data);
    if (payload.data.length < 100) return boards;
  }
}

export async function fetchPublicBoard(slug: string, config: PublicBoardConfig = liveBoardConfig, fetcher: FetchLike = fetch, messageId?: string): Promise<{ board: Board; messages: Message[] } | null> {
  const payload = await requestJson(`${tableUrl(config, 'boards')}?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`,
    { headers: { apikey: config.publicKey } }, fetcher);
  if (!isRecord(payload) || !Array.isArray(payload.data) || !payload.data.every(isBoard)) {
    throw new DemoApiError('The message board returned boards in an unexpected format.');
  }
  const board = payload.data[0];
  if (!board) return null;
  if (board.slug !== slug) throw new DemoApiError('The message board returned an unexpected board.');
  const filter = messageId === undefined ? '&order=created_at.desc&limit=20' : `&id=eq.${encodeURIComponent(messageId)}&limit=1`;
  const messages = messagesFrom(await requestJson(`${tableUrl(config)}?select=*&board_id=eq.${encodeURIComponent(board.id)}${filter}`,
    { headers: { apikey: config.publicKey } }, fetcher));
  if (messages.some(message => message.board_id !== board.id)) throw new DemoApiError('The message board returned messages from another board.');
  if (messageId !== undefined) {
    if (messages.some(message => message.id !== messageId) || messages.length > 1) throw new DemoApiError('The message board returned an unexpected message.');
    if (!messages.length) return null;
  }
  return { board, messages };
}

export function createDemoApi(config: PublicBoardConfig = liveBoardConfig, fetcher: FetchLike = fetch) {
  const sessionUrl = `${config.apiOrigin.replace(/\/$/, '')}/bff/demo/session`;
  const headers = (session?: DemoSession | null) => ({ apikey: config.publicKey,
    ...(session ? { authorization: `Bearer ${session.token}` } : {}) });

  return {
    async login(userId: DemoUser): Promise<DemoSession> {
      const payload = await requestJson(sessionUrl, { method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify({ userId }) }, fetcher);
      if (!isDemoSession(payload) || payload.session.user_id !== userId || Date.parse(payload.session.expires_at) <= Date.now()) {
        throw new DemoApiError('The demo returned an invalid session. Try logging in again.');
      }
      return payload;
    },
    async logout(session: DemoSession): Promise<void> {
      const payload = await requestJson(sessionUrl, { method: 'DELETE', headers: headers(session) }, fetcher);
      if (!isRecord(payload) || payload.revoked !== true) throw new DemoApiError('The demo did not confirm session revocation.');
    },
    async list(session: DemoSession | null, messageId?: string): Promise<Message[]> {
      const filter = messageId === undefined ? '' : `&id=eq.${encodeURIComponent(messageId)}&limit=1`;
      const messages = messagesFrom(await requestJson(`${tableUrl(config)}?select=*${filter}`, { headers: headers(session) }, fetcher));
      if (messageId !== undefined && (messages.length > 1 || messages.some(message => message.id !== messageId))) throw new DemoApiError('The message board returned an unexpected message.');
      return messages;
    },
    async listBoards(session: DemoSession | null): Promise<Board[]> {
      const boards: Board[] = [];
      // Table reads are capped at 100 rows. Keep fetching so every board is selectable.
      for (let offset = 0; ; offset += 100) {
        const payload = await requestJson(`${tableUrl(config, 'boards')}?select=*&order=slug.asc&limit=100&offset=${offset}`,
          { headers: headers(session) }, fetcher);
        if (!isRecord(payload) || !Array.isArray(payload.data) || !payload.data.every(isBoard)) {
          throw new DemoApiError('The message board returned boards in an unexpected format. Try again later.');
        }
        boards.push(...payload.data);
        if (payload.data.length < 100) return boards;
      }
    },
    async createBoard(session: DemoSession, name: string, description: string): Promise<Board> {
      const cleanName = name.trim();
      const cleanDescription = description.trim();
      if (!cleanName || cleanName.length > 80) throw new DemoApiError('Enter a board name of 1–80 characters.');
      if (cleanDescription.length > 2000) throw new DemoApiError('Enter a description of at most 2000 characters.');
      const slug = cleanName.toLowerCase().replace(/\s+/g, '-');
      if (!/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
        throw new DemoApiError('Use letters (a–z), numbers, spaces, or hyphens in the board name, starting and ending with a letter or number.');
      }
      // The boards table's UNIQUE constraint rejects existing slugs. Do not
      // change the slug or retry the insert when the database returns an error.
      const payload = await requestJson(tableUrl(config, 'boards'), {
        method: 'POST', headers: { ...headers(session), 'content-type': 'application/json' },
        body: JSON.stringify({ slug, name: cleanName, description: cleanDescription, user_id: session.session.user_id }),
      }, fetcher);
      if (!isRecord(payload) || !Array.isArray(payload.data) || payload.data.length !== 1
        || !isBoard(payload.data[0]) || payload.data[0].user_id !== session.session.user_id
        || payload.data[0].slug !== slug || payload.data[0].name !== cleanName || payload.data[0].description !== cleanDescription) {
        throw new DemoApiError('The demo did not confirm the new board. Refresh boards before trying again.');
      }
      return payload.data[0];
    },
    async create(session: DemoSession, boardId: string, title: string, body: string): Promise<Message> {
      const cleanTitle = title.trim();
      const text = body.trim();
      if (!boardId.trim()) throw new DemoApiError('Choose a board for your message.');
      if (!cleanTitle || cleanTitle.length > 200) throw new DemoApiError('Enter a title of 1–200 characters.');
      if (!text || text.length > 2000) throw new DemoApiError('Enter a message of 1–2000 characters.');
      const payload = await requestJson(tableUrl(config), {
        method: 'POST', headers: { ...headers(session), 'content-type': 'application/json' },
        body: JSON.stringify({ board_id: boardId, user_id: session.session.user_id, title: cleanTitle, body: text }),
      }, fetcher);
      const rows = messagesFrom(payload);
      if (rows.length !== 1 || rows[0].board_id !== boardId || rows[0].user_id !== session.session.user_id
        || rows[0].title !== cleanTitle) {
        throw new DemoApiError('The demo did not confirm the posted message. Refresh messages before trying again.');
      }
      return rows[0];
    },
    async update(session: DemoSession, message: Message, body: string): Promise<Message | null> {
      const text = body.trim();
      if (!text || text.length > 2000) throw new DemoApiError('Enter a message of 1–2000 characters.');
      if (!message.id) throw new DemoApiError('Choose a message to edit.');
      const payload = await requestJson(`${tableUrl(config)}?id=eq.${encodeURIComponent(message.id)}`, {
        method: 'PATCH', headers: { ...headers(session), 'content-type': 'application/json' },
        // Preserve the original author; an authenticated non-owner receives the
        // backend's ownership-policy error rather than a client-side rejection.
        body: JSON.stringify({ body: text, user_id: message.user_id }),
      }, fetcher);
      const rows = messagesFrom(payload);
      if (rows.length > 1 || rows.some(row => row.id !== message.id)) throw new DemoApiError('The demo returned an unexpected message after saving.');
      return rows[0] ?? null;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isDemoSession(value: unknown): value is DemoSession {
  return isRecord(value) && isRecord(value.session)
    && typeof value.token === 'string' && /^bff_us_[a-f0-9]{64}$/.test(value.token)
    && typeof value.session.id === 'string' && !!value.session.id
    && demoUsers.includes(value.session.user_id as DemoUser)
    && typeof value.session.expires_at === 'string' && Number.isFinite(Date.parse(value.session.expires_at))
    && typeof value.session.created_at === 'string' && Number.isFinite(Date.parse(value.session.created_at));
}

function isMessage(value: unknown): value is Message {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.user_id === 'string'
    && typeof value.title === 'string'
    && typeof value.body === 'string'
    && typeof value.created_at === 'string'
    && Number.isFinite(Date.parse(value.created_at));
}

function isBoard(value: unknown): value is Board {
  return isRecord(value)
    && typeof value.id === 'string' && !!value.id
    && typeof value.slug === 'string' && /^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(value.slug)
    && typeof value.name === 'string' && !!value.name.trim()
    && typeof value.description === 'string'
    && typeof value.created_at === 'string' && Number.isFinite(Date.parse(value.created_at));
}

export type { DemoUser } from './config.ts';
