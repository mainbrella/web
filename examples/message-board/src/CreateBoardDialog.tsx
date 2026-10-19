import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DemoApiError, type Board, type DemoSession } from './api.ts';

type Props = {
  api: { createBoard(session: DemoSession, name: string, description: string): Promise<Board> };
  session: DemoSession;
  onClose: () => void;
  onCreated: (board: Board) => void;
};

export function CreateBoardDialog({ api, session, onClose, onCreated }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const busy = useRef(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    active.current = true;
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    element.showModal();
    nameInput.current?.focus();
    return () => {
      active.current = false;
      element.close();
      document.documentElement.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 80) {
      setError('Enter a board name of 1–80 characters.');
      nameInput.current?.focus();
      return;
    }
    if (description.trim().length > 2000) {
      setError('Enter a description of at most 2000 characters.');
      return;
    }
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      const board = await api.createBoard(session, cleanName, description.trim());
      if (active.current) onCreated(board);
    } catch (cause) {
      if (active.current) setError(cause instanceof DemoApiError && cause.status === 401
        ? 'Your demo session has expired. Log out and log in again to continue.'
        : cause instanceof DemoApiError && cause.status === 403
          ? 'You don’t have permission to create boards.'
          : cause instanceof Error ? cause.message : 'Could not create the board. Try again.');
    } finally {
      busy.current = false;
      if (active.current) setSaving(false);
    }
  }

  return <dialog ref={dialog} className="create-board-dialog" aria-labelledby="create-board-dialog-title"
    onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }}>
    <header className="create-board-dialog-header">
      <h2 id="create-board-dialog-title">Create new board</h2>
      <button className="dialog-close" type="button" aria-label="Close create board" disabled={saving} onClick={onClose}>×</button>
    </header>
    <form className="create-form" onSubmit={event => void submit(event)} aria-busy={saving}>
      <label className="create-field" htmlFor="new-board-name">
        <span>Name <span className="required-mark">(required)</span></span>
        <input ref={nameInput} id="new-board-name" name="name" type="text" required maxLength={80}
          value={name} disabled={saving} onChange={event => setName(event.target.value)} />
      </label>
      <label className="create-field" htmlFor="new-board-description">
        <span>Description</span>
        <textarea id="new-board-description" name="description" rows={4} maxLength={2000}
          value={description} disabled={saving} onChange={event => setDescription(event.target.value)} />
      </label>
      {error && <p className="create-error" role="alert">{error}</p>}
      <div className="create-actions">
        <button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button className="primary-button" type="submit" disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create board'}</button>
      </div>
    </form>
  </dialog>;
}
