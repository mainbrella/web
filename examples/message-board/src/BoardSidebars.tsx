import type { Board, Message } from './api.ts';
import type { ReactNode } from 'react';
import { boardHref, BoardLink } from './BoardLink.tsx';
import { messageHref } from './MessageLink.tsx';

export function boardTone(slug: string): 'orange' | 'violet' | 'teal' | 'blue' {
  const tones = ['orange', 'violet', 'teal', 'blue'] as const;
  let hash = 0;
  for (const character of slug) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return tones[Math.abs(hash) % tones.length];
}

export function BoardNavigation({ boards, boardCounts, basePath, activeSlug, view, onViewChange, showMyMessages = true, boardLookup = 'available', actions, footerHref }: {
  boards: Board[];
  boardCounts: Map<string, number>;
  basePath: string;
  activeSlug?: string;
  view?: 'all' | 'mine';
  onViewChange?: (view: 'all' | 'mine') => void;
  showMyMessages?: boolean;
  boardLookup?: 'loading' | 'available' | 'unavailable';
  actions?: ReactNode;
  footerHref?: string;
}) {
  const viewLink = (name: 'all' | 'mine') => {
    const icon = name === 'all'
      ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></svg>
      : <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg>;
    const label = name === 'all' ? 'All messages' : 'My messages';
    return onViewChange
      ? <button className="board-nav-item" type="button" aria-pressed={view === name} onClick={() => onViewChange(name)}>{icon}{label}</button>
      : <a className="board-nav-item" href={name === 'all' ? basePath : `${basePath}?view=mine`} aria-current={!activeSlug && view === name ? 'page' : undefined}>{icon}{label}</a>;
  };

  return <aside className="board-navigation">
    <nav className="board-nav" aria-label="Message views">
      {viewLink('all')}{showMyMessages && viewLink('mine')}
    </nav>
    {actions}
    <details className="board-list" open>
      <summary>Boards</summary>
      {boardLookup === 'loading' && boards.length === 0 ? <p className="board-list-state">Loading boards…</p>
        : boardLookup === 'unavailable' && boards.length === 0 ? <p className="board-list-state">Boards unavailable.</p>
          : boards.length === 0 ? <p className="board-list-state">No boards yet.</p>
            : <ul>{boards.map(board => <li key={board.id}>
              <a className="board-nav-item board-filter" href={boardHref(board.slug, basePath)} title={`board/${board.slug}`}
                aria-current={board.slug === activeSlug ? 'page' : undefined}>
                <span className={`board-icon board-icon--${boardTone(board.slug)}`} aria-hidden="true">{board.slug.charAt(0).toUpperCase()}</span>
                <span className="board-slug">board/{board.slug}</span>
                <span className="board-count">{boardCounts.get(board.id) ?? 0}</span>
              </a>
            </li>)}</ul>}
    </details>
    {footerHref && <a className="back-link board-back-link" href={footerHref}>Back to BFF <span aria-hidden="true">↗</span></a>}
  </aside>;
}

export function RecentMessages({ messages, boards, basePath, loaded = true, loading = false, emptyText = 'No messages yet.' }: {
  messages: Message[];
  boards: Board[];
  basePath: string;
  loaded?: boolean;
  loading?: boolean;
  emptyText?: string;
}) {
  const boardById = new Map(boards.map(board => [board.id, board]));
  const recent = [...messages].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 5);
  return <aside className="recent-messages" aria-labelledby="recent-title">
    <h2 id="recent-title">Recent posts</h2>
    {loading ? <div className="recent-loading" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => <div key={index}><span className="skeleton-line short" /><span className="skeleton-line long" /></div>)}
    </div> : recent.length ? <ul className="recent-list">
      {recent.map(message => {
        const board = boardById.get(message.board_id ?? '');
        const href = board ? messageHref(board.slug, message.id, basePath) : `#message-${encodeURIComponent(message.id)}`;
        return <li key={message.id}>
          <div className="recent-message">
            <div className="recent-board"><span className={`board-icon board-icon--${boardTone(board?.slug ?? '')}`} aria-hidden="true">{board?.slug.charAt(0).toUpperCase() ?? '?'}</span>
              {board ? <BoardLink basePath={basePath} board={board} /> : 'Board unavailable'}<time dateTime={message.created_at}>{formatRelative(message.created_at)}</time></div>
            <a className="recent-post-link" href={href}>
              <p>{message.title}</p>
              <span className="recent-preview">{message.body}</span>
            </a>
          </div>
        </li>;
      })}
    </ul> : <p className="recent-empty">{loaded ? emptyText : 'Messages are unavailable.'}</p>}
  </aside>;
}

function formatRelative(value: string): string {
  const difference = (Date.parse(value) - Date.now()) / 1000;
  if (!Number.isFinite(difference)) return 'Date unavailable';
  const absolute = Math.abs(difference);
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] = absolute < 60 ? [Math.round(difference), 'second']
    : absolute < 3600 ? [Math.round(difference / 60), 'minute']
      : absolute < 86400 ? [Math.round(difference / 3600), 'hour']
        : absolute < 604800 ? [Math.round(difference / 86400), 'day']
          : absolute < 2629800 ? [Math.round(difference / 604800), 'week']
            : absolute < 31557600 ? [Math.round(difference / 2629800), 'month'] : [Math.round(difference / 31557600), 'year'];
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit);
}
