import type { Input, Player, ServerMessage } from '../shared/types';
import { queueInput } from '../shared/physics';
import type { WebSocket } from 'ws';
import type { GameWorld, Profile } from './storage';

export type Session = {
  socket: WebSocket; hash?: string; game?: GameWorld; profile?: Profile; player?: Player;
  input: Input; inputAt: number; inputQueue?: Input[]; activeInput?: Input; inputTicks?: number; subscriptions: Set<string>; container?: string;
  mine?: { key: string; id: number; slot: number; start: number; last: number };
  sleeping?: { key: string; point: { x:number; y:number; z:number } };
  lastAction: number; lastAttack: number; lastChat: number; lastPortal: number; survival: number;
  budget: number; chunks: number; refill: number;
};
export const idleInput = (): Input => ({ forward: 0, strafe: 0, jump: false, sprint: false, crouch: false, yaw: 0, pitch: 0, seq: 0 });
export function receiveInput(s: Session, input: Input, now: number): boolean {
  if (!s.player || input.seq <= s.player.seq || input.seq <= s.input.seq) return true;
  const next = { forward: input.forward, strafe: input.strafe, jump: input.jump, sprint: input.sprint, crouch: input.crouch, yaw: input.yaw, pitch: input.pitch, seq: input.seq };
  if (!queueInput(s.inputQueue ??= [], next)) return false;
  s.input = next;
  s.inputAt = now;
  return true;
}
export function tickInput(s: Session, now: number): Input {
  let input: Input;
  if (now - s.inputAt >= 1000) {
    s.inputQueue = [];
    input = { ...idleInput(), yaw: s.player!.yaw, pitch: s.player!.pitch, seq: s.input.seq };
  } else input = s.inputQueue?.shift() ?? s.activeInput ?? s.input;
  s.inputTicks = s.activeInput?.seq === input.seq ? (s.inputTicks ?? 0) + 1 : 1;
  s.activeInput = input;
  return input;
}
export function send(s: Session, message: ServerMessage) {
  if (s.socket.readyState !== 1) return;
  if (s.socket.bufferedAmount > 2 * 1024 * 1024) { s.socket.close(1008, 'Slow connection'); return; }
  s.socket.send(JSON.stringify(message));
}
export function resetMotion(s: Session) {
  if (!s.player) return;
  s.player = { ...s.player, vy: 0, grounded: false };
  if (s.profile) s.profile.player = s.player;
  s.input = { ...idleInput(), yaw:s.player.yaw, pitch:s.player.pitch, seq:s.player.seq };
  s.inputAt = 0;
  s.inputQueue = [];
  s.activeInput = undefined;
  s.inputTicks = 0;
  s.mine = undefined;
  s.container = undefined;
  s.sleeping = undefined;
}
export const inventory = (s: Session) => { if (s.player) send(s, { type: 'inventory', player: s.player }); };
export const notice = (s: Session, text: string) => send(s, { type: 'notice', text });
