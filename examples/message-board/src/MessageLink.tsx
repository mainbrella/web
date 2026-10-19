import * as React from 'react';
import type { Board, Message } from './api.ts';
import { boardHref } from './BoardLink.tsx';

export function messageHref(slug: string, id: string, basePath = '/') {
  return `${boardHref(slug, basePath)}/${encodeURIComponent(id)}`;
}

export function MessageLink({ message, board, basePath = '/' }: { message: Message; board?: Board; basePath?: string }) {
  return board ? <a href={messageHref(board.slug, message.id, basePath)}>{message.title}</a> : <>{message.title}</>;
}
