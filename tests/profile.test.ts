import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToken, loadProfile } from '../client/profile';
import { parseMessage } from '../server/protocol';

const uuid = '12345678-1234-4234-8234-123456789abc';
let stored: string | null;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };

beforeEach(() => {
  stored = null;
  storage = {
    getItem: vi.fn(() => stored),
    setItem: vi.fn((_key: string, value: string) => { stored = value; }),
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => uuid) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('explorer profile', () => {
  it('creates and persists a fresh profile with the secure UUID API', () => {
    const result = loadProfile();
    expect(result).toEqual({ profile: { token: uuid, name: 'Explorer', color: '#d79055' }, notice: undefined });
    expect(JSON.parse(stored!)).toEqual(result.profile);
  });

  it('uses cryptographic bytes on insecure LAN pages without randomUUID', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => { bytes.fill(255); return bytes; });
    vi.stubGlobal('crypto', { getRandomValues });
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Insecure randomness'); });
    const { profile } = loadProfile();
    expect(profile.token).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
    expect(random).not.toHaveBeenCalled();
    expect(parseMessage(JSON.stringify({ type: 'hello', ...profile, world: 'test' }))).not.toBeNull();
    expect(parseMessage(JSON.stringify({ type: 'create', token: profile.token, name: 'Test', seed: '', mode: 'survival', difficulty: 2 }))).not.toBeNull();
  });

  it.each([0, 127, 128, 255])('sets RFC UUID version and variant bits for random byte %i', byte => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(byte) });
    expect(createToken()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it.each([uuid, 'a'.repeat(32), 'Z_-'.repeat(42) + 'AB'])('preserves a valid existing token without any crypto API', token => {
    stored = JSON.stringify({ token, name: '  Trail  ', color: '#AbCdEf' });
    vi.stubGlobal('crypto', undefined);
    const { profile, notice } = loadProfile();
    expect(profile).toEqual({ token, name: 'Trail', color: '#AbCdEf' });
    expect(notice).toBeUndefined();
  });

  it.each(['short', 'a'.repeat(31), 'a'.repeat(129), 'a'.repeat(32) + '.', 'a'.repeat(32) + '\n', 42, null])('replaces invalid token %s with a useful notice', token => {
    stored = JSON.stringify({ token, name: 'Old explorer', color: '#abcdef' });
    const { profile, notice } = loadProfile();
    expect(profile).toEqual({ token: uuid, name: 'Old explorer', color: '#abcdef' });
    expect(notice).toContain('invalid and has been replaced');
    expect(notice).toContain('backup');
    expect(JSON.parse(stored!).token).toBe(uuid);
  });

  it.each(['{', 'null', '[]', '42', '{}', ''])('recovers malformed stored profile %s', raw => {
    stored = raw;
    expect(loadProfile().notice).toContain('invalid');
    expect(JSON.parse(stored!).token).toBe(uuid);
  });

  it.each([undefined, {}])('fails precisely rather than generating a weak bearer without crypto', crypto => {
    vi.stubGlobal('crypto', crypto);
    expect(() => loadProfile()).toThrow('Secure random generation is unavailable');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('does not overwrite old data if secure generation fails', () => {
    stored = '{';
    vi.stubGlobal('crypto', undefined);
    expect(() => loadProfile()).toThrow('Web Crypto');
    expect(stored).toBe('{');
  });

  it('does not replace an unreadable existing identity', () => {
    storage.getItem.mockImplementation(() => { throw new Error('Denied'); });
    expect(() => loadProfile()).toThrow('avoid replacing your existing explorer');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps a valid identity in memory and warns when persistence fails', () => {
    stored = JSON.stringify({ token: uuid });
    storage.setItem.mockImplementation(() => { throw new Error('Quota'); });
    const result = loadProfile();
    expect(result.profile.token).toBe(uuid);
    expect(result.notice).toContain('could not save');
  });
});
