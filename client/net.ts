import type { ClientMessage, ServerMessage } from '../shared/types';

export function socketAddress(address = location.origin): string {
  const url = new URL(address.includes('://') ? address : `${location.protocol}//${address}`);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid server address');
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  if (url.pathname === '/') url.pathname = '/ws';
  url.hash = '';
  return url.toString();
}

export class Net {
  ping = 0;
  private socket?: WebSocket;
  private address = '';
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private attempts = 0;
  private received = 0;
  private stopped = false;

  constructor(private receive: (message: ServerMessage) => void, private status: (connected: boolean, text: string) => void) {}

  get connected() { return this.socket?.readyState === WebSocket.OPEN; }

  connect(address = location.origin): void {
    const next = socketAddress(address);
    if (next === this.address && this.connected) { this.send({ type: 'list' }); return; }
    this.disconnect();
    this.stopped = false;
    this.address = next;
    this.attempts = 0;
    this.open();
  }

  send(message: ClientMessage): boolean {
    if (!this.connected || !this.socket || this.socket.bufferedAmount > 256 * 1024) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  disconnect(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    const socket = this.socket;
    this.socket = undefined;
    if (socket) { socket.onclose = null; socket.onmessage = null; socket.onopen = null; socket.close(); }
  }

  private open(): void {
    if (this.stopped) return;
    let socket: WebSocket;
    try { socket = new WebSocket(this.address); }
    catch { this.lost(); return; }
    this.socket = socket;
    this.received = performance.now();
    socket.onopen = () => {
      if (this.socket !== socket) return;
      const reconnected = this.attempts > 0;
      this.attempts = 0;
      this.received = performance.now();
      this.send({ type: 'list' });
      this.status(true, reconnected ? 'Connection restored. Choose a world to continue.' : 'Connected to server.');
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (!message || typeof message !== 'object' || typeof message.type !== 'string') throw new Error('Invalid message');
        this.received = performance.now();
        if (message.type === 'pong') this.ping = Math.max(0, performance.now() - message.time);
        else this.receive(message);
      } catch {
        this.status(false, 'Invalid server data. Reconnecting…');
        socket.close(1002, 'Invalid server data');
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => { if (this.socket === socket) this.lost(); };
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (performance.now() - this.received > 12000) {
        socket.onclose = null;
        socket.close();
        this.lost();
        return;
      }
      this.send({ type: 'ping', time: performance.now() });
    }, 2000);
  }

  private lost(): void {
    this.socket = undefined;
    clearInterval(this.heartbeat);
    if (this.stopped) return;
    const delay = Math.min(15000, 1000 * 2 ** Math.min(this.attempts++, 4));
    this.status(false, `Connection lost. Retrying in ${delay / 1000}s…`);
    this.retry = setTimeout(() => this.open(), delay);
  }
}
