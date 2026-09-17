export type Profile = { token: string; name: string; color: string };

export function createToken(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== 'function') throw new Error('Secure random generation is unavailable. Use a browser with Web Crypto to create an explorer profile.');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function loadProfile(): { profile: Profile; notice?: string } {
  let raw: string | null;
  let saved: Record<string, unknown> = {};
  let notice: string | undefined;
  try { raw = localStorage.getItem('aetheria.profile'); }
  catch (error) {
    if (!(error instanceof ReferenceError)) throw new Error('Browser profile storage cannot be read. Allow site storage and reload to avoid replacing your existing explorer.', { cause: error });
    raw = null;
  }
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) saved = value as Record<string, unknown>;
  } catch { saved = {}; }
  const valid = typeof saved.token === 'string' && saved.token.length >= 32 && saved.token.length <= 128 && !/[^a-zA-Z0-9_-]/.test(saved.token);
  const profile = {
    token: valid ? saved.token as string : createToken(),
    name: typeof saved.name === 'string' ? saved.name.trim().slice(0, 24) || 'Explorer' : 'Explorer',
    color: typeof saved.color === 'string' && /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color : '#d79055',
  };
  if (raw !== null && !valid) notice = 'The saved explorer identity was invalid and has been replaced. Previous progress needs a backup of the original valid profile; worlds have not been deleted.';
  try { localStorage.setItem('aetheria.profile', JSON.stringify(profile)); }
  catch { notice = [notice, 'Browser storage could not save your profile. This explorer identity will last only this visit; allow site storage before playing.'].filter(Boolean).join(' '); }
  return { profile, notice };
}
