import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { API_ORIGIN } from './auth.js';

const MAX_RECONNECTS = 5;
const encoder = new TextEncoder();

export function openContainerTerminal(host, { createdAt, onClose }) {
  const terminal = new Terminal({
    cursorBlink: !matchMedia('(prefers-reduced-motion: reduce)').matches,
    fontSize: 14, scrollback: 2000, screenReaderMode: true,
    theme: { background: '#0d1014', foreground: '#e6e8ec' },
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  const output = host.querySelector('.terminal-output');
  const status = host.querySelector('[role="status"]');
  const close = host.querySelector('button');
  terminal.open(output);
  fit.fit();
  terminal.focus();
  let socket;
  let disposed = false;
  let ready = false;
  let ended = false;
  let attempts = 0;
  let reconnectTimer;
  let connectionTimer;
  const send = data => { if (ready && socket?.readyState === WebSocket.OPEN) socket.send(data); };
  const resize = () => {
    if (disposed || !output.clientWidth) return;
    fit.fit();
    send(JSON.stringify({ cols: Math.min(500, terminal.cols), rows: Math.min(200, terminal.rows) }));
  };
  const observer = new ResizeObserver(resize);
  observer.observe(output);
  const input = terminal.onData(data => {
    const bytes = encoder.encode(data);
    for (let offset = 0; offset < bytes.length; offset += 65536) send(bytes.subarray(offset, offset + 65536));
  });

  function connect() {
    if (disposed || ended) return;
    const url = new URL('/containers/terminal', API_ORIGIN);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('createdAt', createdAt);
    url.searchParams.set('cols', String(Math.min(500, terminal.cols)));
    url.searchParams.set('rows', String(Math.min(200, terminal.rows)));
    const current = new WebSocket(url);
    socket = current;
    current.binaryType = 'arraybuffer';
    ready = false;
    status.textContent = attempts ? 'Reconnecting…' : 'Connecting…';
    connectionTimer = setTimeout(() => {
      if (!disposed && socket === current && !ready) current.close();
    }, 20000);
    current.addEventListener('message', ({ data }) => {
      if (disposed || current !== socket) return;
      if (data instanceof ArrayBuffer) {
        // Acknowledge after xterm renders to bound server-side output buffering.
        terminal.write(new Uint8Array(data), () => {
          if (!disposed && current === socket && current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'ack' }));
        });
      } else {
        try {
          const frame = JSON.parse(data);
          if (frame.type === 'ready') {
            clearTimeout(connectionTimer);
            ready = true;
            terminal.reset(); // tmux redraws the persistent session on attach.
            status.textContent = 'Connected';
            resize();
            terminal.focus();
          } else if (frame.type === 'exit') {
            ended = true;
            status.textContent = `Shell exited (${frame.code}).`;
          } else if (frame.type === 'error') {
            ended = true;
            status.textContent = 'Terminal unavailable. Close and try again.';
          }
        } catch {
          ended = true;
          status.textContent = 'Terminal received an invalid response. Close and try again.';
          current.close();
        }
      }
    });
    current.addEventListener('close', (event) => {
      clearTimeout(connectionTimer);
      ready = false;
      if (disposed || current !== socket || ended) return;
      if (event.code === 1000 || event.code === 1008 || event.code === 1002) {
        ended = true;
        status.textContent = event.reason === 'Container stopped' || event.reason === 'Session expired'
          ? 'Container stopped.' : 'Terminal closed. Open another terminal to reconnect.';
        return;
      }
      if (attempts >= MAX_RECONNECTS) {
        ended = true;
        status.textContent = 'Could not reconnect. Check your sign-in and container, then close and try again.';
        return;
      }
      const delay = Math.min(1000 * 2 ** attempts++, 16000);
      status.textContent = `Connection lost. Reconnecting in ${delay / 1000}s…`;
      reconnectTimer = setTimeout(connect, delay);
    });
    // Browsers hide HTTP upgrade errors; the close event handles bounded retries.
    current.addEventListener('error', () => {});
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(connectionTimer);
    clearTimeout(reconnectTimer);
    observer.disconnect();
    input.dispose();
    socket?.close();
    terminal.dispose();
    close.removeEventListener('click', closeTerminal);
  }
  function closeTerminal() { dispose(); host.hidden = true; onClose(); }
  close.addEventListener('click', closeTerminal);
  connect();
  return { dispose };
}
