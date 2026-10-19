import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { DemoApiError, type Board, type DemoSession, type Message } from './api.ts';

type CreateApi = {
  listBoards(session: DemoSession): Promise<Board[]>;
  create(session: DemoSession, boardId: string, title: string, body: string): Promise<Message>;
};

type Props = {
  api: CreateApi;
  session: DemoSession;
  open: boolean;
  onClose: () => void;
  onCreated: (message: Message, board?: Board) => void;
};

const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Try again.';
const sessionExpired = 'Your demo session has expired. Log out and log in again to continue.';

export function CreateMessageDialog({ api, session, open, onClose, onCreated }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const boardRequest = useRef(0);
  const savingRef = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const previousOverflow = useRef('');
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoard, setSelectedBoard] = useState('');
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [boardsError, setBoardsError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadBoards = useCallback(async () => {
    const request = ++boardRequest.current;
    setBoardsLoading(true);
    setBoardsError('');
    try {
      const result = await api.listBoards(session);
      if (request !== boardRequest.current) return;
      setBoards(result);
      setSelectedBoard(current => result.some(board => board.id === current) ? current : result[0]?.id ?? '');
    } catch (cause) {
      if (request === boardRequest.current) setBoardsError(cause instanceof DemoApiError && cause.status === 401
        ? sessionExpired
        : cause instanceof DemoApiError && cause.status === 403
          ? 'You don’t have permission to view boards.'
          : errorText(cause));
    } finally {
      if (request === boardRequest.current) setBoardsLoading(false);
    }
  }, [api, session]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      previousOverflow.current = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      if (!element.open) element.showModal();
      void loadBoards();
    } else {
      boardRequest.current++;
      if (element.open) element.close();
      document.documentElement.style.overflow = previousOverflow.current;
      opener.current?.focus();
    }
    return () => {
      boardRequest.current++;
      if (element.open) element.close();
      document.documentElement.style.overflow = previousOverflow.current;
    };
  }, [open, loadBoards]);

  function handleClose() {
    if (savingRef.current) return;
    onClose();
    opener.current?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    if (boardsLoading || boardsError || !boards.some(board => board.id === selectedBoard)) return;
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle || cleanTitle.length > 200) { setError('Enter a title of 1–200 characters.'); return; }
    if (!selectedBoard) { setError('Choose a board.'); return; }
    if (!cleanBody || cleanBody.length > 2000) { setError('Enter a message of 1–2000 characters.'); return; }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const message = await api.create(session, selectedBoard, cleanTitle, cleanBody);
      setTitle('');
      setBody('');
      onCreated(message, boards.find(board => board.id === message.board_id));
      dialog.current?.close();
    } catch (cause) {
      setError(cause instanceof DemoApiError && cause.status === 401
        ? sessionExpired
        : cause instanceof DemoApiError && cause.status === 403
          ? 'You don’t have permission to post to this board.'
          : errorText(cause));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const selected = boards.find(board => board.id === selectedBoard);
  const canPost = !boardsLoading && !boardsError && boards.some(board => board.id === selectedBoard)
    && title.trim().length > 0 && title.trim().length <= 200 && Boolean(body.trim());

  return <dialog ref={dialog} className="create-dialog" aria-labelledby="create-dialog-title"
    onCancel={event => { if (savingRef.current) event.preventDefault(); }}
    onClose={() => { document.documentElement.style.overflow = previousOverflow.current; handleClose(); }}>
    <header className="create-dialog-header">
      <span className="create-dialog-brand">bff<span aria-hidden="true">.</span></span>
      <h1 id="create-dialog-title">Create a message</h1>
      <button className="dialog-close" type="button" aria-label="Close create message" disabled={saving} onClick={() => dialog.current?.close()}>×</button>
    </header>
    <div className="create-dialog-layout">
      <div className="create-form-panel">
        <form className="create-form" onSubmit={event => void submit(event)}>
          <label className="create-field" htmlFor="create-board">
            <span>Post to</span>
            <select id="create-board" value={selectedBoard} disabled={boardsLoading || boardsError !== '' || boards.length === 0 || saving}
              onChange={event => setSelectedBoard(event.target.value)}>
              {boards.length === 0 && <option value="">{boardsLoading ? 'Loading boards…' : boardsError ? 'Boards unavailable' : 'No boards available'}</option>}
              {boards.map(board => <option key={board.id} value={board.id}>board/{board.slug}</option>)}
            </select>
          </label>
          {boardsLoading && <p className="create-state" role="status">Loading boards…</p>}
          {boardsError && <div className="create-state create-state--error" role="alert">
            <span>{boardsError}</span><button className="state-action" type="button" disabled={boardsLoading} onClick={() => void loadBoards()}>Retry</button>
          </div>}
          {!boardsLoading && !boardsError && boards.length === 0 && <p className="create-state" role="status">There are no boards to post to yet.</p>}
          <label className="create-field" htmlFor="create-title">
            <span>Title <span className="required-mark">(required)</span></span>
            <input id="create-title" name="title" type="text" required maxLength={200} value={title} disabled={saving}
              onChange={event => setTitle(event.target.value)} placeholder="Give your message a title" />
          </label>
          <label className="create-field" htmlFor="create-body">
            <span>Message <span className="required-mark">(required)</span></span>
            <textarea id="create-body" name="body" rows={8} required maxLength={2000} value={body} disabled={saving}
              aria-describedby="create-body-count" onChange={event => setBody(event.target.value)} placeholder="Write your message" />
          </label>
          <div className="create-field-meta"><span id="create-body-count">{body.length}/2000</span></div>
          {error && <p className="create-error" role="alert">{error}</p>}
          <div className="create-actions">
            <button className="primary-button" type="submit" disabled={!canPost || saving}>{saving ? 'Posting…' : 'Post'}</button>
          </div>
        </form>
      </div>
      {selected && <aside className="create-board-aside" aria-label="Selected board">
        <h2>{selected.name}</h2>
        {selected.description && <p>{selected.description}</p>}
      </aside>}
    </div>
  </dialog>;
}
