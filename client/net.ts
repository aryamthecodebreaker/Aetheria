import type { ClientMessage, ServerMessage } from '../shared/types';

declare global {
  interface ImportMetaEnv {
    readonly VITE_SERVER_URL?: string;
  }
}

export function defaultServerAddress(): string {
  return import.meta.env.VITE_SERVER_URL?.trim() || location.origin;
}

export function socketAddress(address = defaultServerAddress()): string {
  const value = address.trim();
  if (!value) throw new Error('Enter an HTTP or WebSocket server address.');
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !value.includes('://') && !/^[^/:]+:\d+(?:[/?#]|$)/.test(value)) throw new Error('Use an http:, https:, ws: or wss: server address.');
  let url: URL;
  try { url = new URL(value.includes('://') ? value : `${location.protocol}//${value}`); }
  catch { throw new Error('Invalid server address. Enter a hostname and optional port, or a full HTTP or WebSocket URL.'); }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) throw new Error('Use an http:, https:, ws: or wss: server address.');
  if (url.username || url.password) throw new Error('Server addresses must not contain a username or password.');
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
  if (location.protocol === 'https:' && url.protocol === 'ws:') throw new Error('This HTTPS page cannot connect to insecure ws:. Use an HTTPS or WSS server address.');
  if (url.pathname === '/') url.pathname = '/ws';
  url.hash = '';
  return url.toString();
}

export class Net {
  ping = 0;
  private socket?: WebSocket;
  private address = '';
  private heartbeat?: ReturnType<typeof setInterval>;
  private listing?: ReturnType<typeof setTimeout>;
  private received = 0;
  private state?: [boolean, string];
  private listener?: (connected: boolean, text: string) => void;

  constructor(private receive: (message: ServerMessage) => void, private status: (connected: boolean, text: string) => void) {}

  get connected() { return this.socket?.readyState === WebSocket.OPEN; }

  observeStatus(listener: (connected: boolean, text: string) => void): void {
    this.listener = listener;
    if (this.state) listener(...this.state);
  }

  private report(connected: boolean, text: string): void {
    this.state = [connected, text];
    this.status(connected, text);
    this.listener?.(connected, text);
  }

  connect(address = defaultServerAddress()): void {
    let next: string;
    try { next = socketAddress(address); }
    catch (error) {
      this.disconnect();
      this.report(false, error instanceof Error ? error.message : 'Invalid server address.');
      return;
    }
    if (next === this.address && this.connected) { this.requestWorlds(); return; }
    this.disconnect();
    this.address = next;
    this.open();
  }

  send(message: ClientMessage): boolean {
    if (!this.connected || !this.socket || this.socket.bufferedAmount > 256 * 1024) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  disconnect(): void {
    clearTimeout(this.listing);
    clearInterval(this.heartbeat);
    const socket = this.socket;
    this.socket = undefined;
    if (socket) { socket.onclose = null; socket.onmessage = null; socket.onopen = null; socket.onerror = null; socket.close(); }
  }

  private requestWorlds(): void {
    clearTimeout(this.listing);
    this.listing = setTimeout(() => this.lost('The server did not send a world list within 12 seconds.'), 12000);
    this.send({ type: 'list' });
  }

  private open(): void {
    let socket: WebSocket;
    try { socket = new WebSocket(this.address); }
    catch (error) { this.lost(error instanceof Error ? `WebSocket could not start: ${error.message}` : 'WebSocket could not start.'); return; }
    this.socket = socket;
    this.received = performance.now();
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.received = performance.now();
      this.requestWorlds();
      this.report(true, 'Connected to server. Loading worlds…');
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
        if (!message || typeof message !== 'object' || typeof message.type !== 'string' || message.type === 'worlds' && !Array.isArray(message.worlds)) throw new Error('Invalid message');
      } catch { this.lost('The server sent invalid data.'); return; }
      this.received = performance.now();
      if (message.type === 'worlds') clearTimeout(this.listing);
      if (message.type === 'pong') this.ping = Math.max(0, performance.now() - message.time);
      else this.receive(message);
    };
    socket.onerror = () => {
      if (this.socket === socket) this.lost('WebSocket connection failed. The browser does not expose the cause; check the server address, network, TLS certificate, and server origin allowlist.');
    };
    socket.onclose = event => {
      if (this.socket === socket) this.lost(`The server disconnected (code ${event.code})${event.reason ? `: ${event.reason}` : '.'}`);
    };
    this.heartbeat = setInterval(() => {
      if (this.socket !== socket) return;
      if (performance.now() - this.received >= 12000) {
        this.lost(socket.readyState === WebSocket.OPEN ? 'The server stopped responding for 12 seconds.' : 'WebSocket connection timed out after 12 seconds.');
        return;
      }
      this.send({ type: 'ping', time: performance.now() });
    }, 2000);
  }

  private lost(reason: string): void {
    this.disconnect();
    this.report(false, `${reason} Choose Connect to server to retry.`);
  }
}
