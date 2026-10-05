import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { API_ORIGIN } from './auth.js';

export function openContainerTerminal(host, { onClose }) {
  const terminal = new Terminal({
    cursorBlink: true, fontSize: 14, scrollback: 2000,
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
  const url = new URL('/containers/terminal', API_ORIGIN);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  let disposed = false;
  let connected = false;
  let receivedExit = false;
  const send = frame => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame)); };
  const size = () => { if (!disposed && output.clientWidth) { fit.fit(); send({ type: 'resize', cols: terminal.cols, rows: terminal.rows }); } };
  const observer = new ResizeObserver(size);
  observer.observe(output);
  const input = terminal.onData(data => send({ type: 'input', data }));
  const timeout = setTimeout(() => {
    if (!connected && !disposed) { status.textContent = 'Terminal connection timed out. Close and try again.'; socket.close(); }
  }, 20000);
  socket.addEventListener('open', () => {
    clearTimeout(timeout);
    if (disposed) { socket.close(); return; }
    connected = true;
    status.textContent = 'Connected';
    size();
    terminal.focus();
  });
  socket.addEventListener('message', ({ data }) => {
    if (disposed) return;
    if (data instanceof ArrayBuffer) terminal.write(new Uint8Array(data));
    else {
      try {
        const frame = JSON.parse(data);
        if (frame.type === 'exit') { receivedExit = true; status.textContent = `Shell exited (${frame.code}).`; }
      } catch { status.textContent = 'Terminal received an invalid response.'; socket.close(); }
    }
  });
  socket.addEventListener('close', () => {
    clearTimeout(timeout);
    if (!disposed && !receivedExit) status.textContent = connected
      ? 'Terminal disconnected. Close and reopen to start another shell.'
      : 'Could not connect. Check your sign-in and container, then close and try again.';
  });
  socket.addEventListener('error', () => {
    if (!disposed) status.textContent = 'Could not connect to the terminal. Close and try again.';
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(timeout);
    observer.disconnect();
    input.dispose();
    socket.close();
    terminal.dispose();
    host.hidden = true;
    close.removeEventListener('click', closeTerminal);
  }
  function closeTerminal() { dispose(); onClose(); }
  close.addEventListener('click', closeTerminal);
  return { dispose };
}
