import type { Action, ClientMessage } from '../shared/types';
import { validItem } from '../shared/inventory';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number) => num(v, lo, hi) && Number.isInteger(v);
const str = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.length >= min && v.length <= max;
export const modes = ['survival', 'creative', 'adventure', 'spectator'];
export const realms = ['verdant', 'cinder', 'aether'];
const token = (v: unknown) => str(v, 32, 128) && /^[a-zA-Z0-9_-]+$/.test(v);
const position = (v: Record<string, unknown>) => int(v.x, -100000, 100000) && int(v.y, 0, 79) && int(v.z, -100000, 100000);

function action(v: unknown): v is Action {
  if (!object(v)) return false;
  switch (v.type) {
    case 'select': return int(v.slot, 0, 8);
    case 'mine': case 'place': case 'use': return position(v);
    case 'attack': return str(v.id, 1, 80);
    case 'craft': return str(v.recipe, 1, 64) && int(v.count, 1, 64);
    case 'moveItem': return int(v.from, 0, 35) && int(v.to, 0, 35) && typeof v.split === 'boolean' && (v.container === undefined || str(v.container, 1, 80));
    case 'transfer': return int(v.slot, 0, 35) && typeof v.toContainer === 'boolean' && str(v.container, 1, 80);
    case 'creative': return typeof v.item === 'number' && validItem(v.item);
    case 'trade': return int(v.offer, 0, 20) && str(v.npc, 1, 80);
    case 'enhance': case 'repair': return int(v.slot, 0, 35);
    case 'eat': case 'respawn': case 'drop': case 'sleep': case 'closeContainer': return true;
    case 'chat': return str(v.text, 1, 256) && [...v.text].every(c => c.charCodeAt(0) >= 32 || c === '\t' || c === '\n');
    default: return false;
  }
}

export function parseMessage(raw: string): ClientMessage | null {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!object(v)) return null;
  let ok = false;
  switch (v.type) {
    case 'list': ok = true; break;
    case 'hello': ok = token(v.token) && str(v.name, 1, 24) && str(v.color, 7, 7) && /^#[0-9a-f]{6}$/i.test(v.color) && str(v.world, 1, 80); break;
    case 'create': ok = token(v.token) && str(v.name, 1, 48) && str(v.seed, 0, 128) && modes.includes(v.mode as string) && int(v.difficulty, 0, 3); break;
    case 'ping': ok = num(v.time, 0, Number.MAX_SAFE_INTEGER); break;
    case 'input': {
      const i = v.input;
      ok = object(i) && num(i.forward, -1, 1) && num(i.strafe, -1, 1) && num(i.yaw, -1000000, 1000000) && num(i.pitch, -Math.PI / 2, Math.PI / 2) && int(i.seq, 0, Number.MAX_SAFE_INTEGER) && ['jump', 'sprint', 'crouch'].every(k => typeof i[k] === 'boolean');
      break;
    }
    case 'chunks': ok = realms.includes(v.realm as string) && Array.isArray(v.coords) && v.coords.length <= 16 && v.coords.every(c => Array.isArray(c) && c.length === 2 && c.every(n => int(n, -6250, 6250))); break;
    case 'action': ok = action(v.action); break;
  }
  return ok ? v as ClientMessage : null;
}
