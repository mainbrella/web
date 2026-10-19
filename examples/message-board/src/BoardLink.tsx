import * as React from 'react';
import type { Board } from './api.ts';

export function boardHref(slug: string, basePath = '/') {
  return `${basePath}boards/${encodeURIComponent(slug)}`;
}

export function BoardLink({ board, className, basePath = '/' }: { board: Board; className?: string; basePath?: string }) {
  return <a className={className} href={boardHref(board.slug, basePath)}>board/{board.slug}</a>;
}
