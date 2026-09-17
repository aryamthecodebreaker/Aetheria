import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, open, rename, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { World } from './world';
import type { Entity, Machine, Player, Realm, Rules, Vec3, WorldMeta } from '../shared/types';

export type Profile = { player: Player; returns: Partial<Record<Realm, Vec3>> };
export type GameWorld = {
  meta: WorldMeta; world: World; admin: string; profiles: Map<string, Profile>;
  machines: Map<string, Machine>; entities: Entity[]; time: number; weather: string; rules: Rules; bossDefeated: Realm[];
};
type Saved = {
  version: number; meta: WorldMeta; admin: string; profiles: [string, Profile][];
  edits: [string, [number, number][]][]; machines: [string, Machine][];
  entities: Entity[]; time: number; weather: string; rules: Rules; bossDefeated?: Realm[];
};
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const defaultRules = (): Rules => ({ pvp: false, keepInventory: false, daylight: true, mobSpawning: true, sleepPercent: 50 });

export class Storage {
  worlds = new Map<string, GameWorld>();
  private queue: Promise<void> = Promise.resolve();
  constructor(readonly dir: string) {}

  async load() {
    await mkdir(this.dir, { recursive: true });
    const files = await readdir(this.dir);
    const ids = new Set(files.filter(f => /^[a-f0-9-]{36}\.json(?:\.bak)?$/.test(f)).map(f => f.slice(0, 36)));
    for (const id of ids) {
      let loaded = false;
      for (const suffix of ['.json', '.json.bak']) {
        try {
          const d = JSON.parse(await readFile(join(this.dir, id + suffix), 'utf8')) as Saved;
          if (d.version !== 1 || d.meta.id !== id || !Array.isArray(d.profiles) || !Array.isArray(d.edits) || !/^[a-f0-9]{64}$/.test(d.admin)) throw new Error('Invalid save');
          const world = new World(d.meta.seed);
          world.edits = new Map(d.edits.map(([key, edits]) => [key, new Map(edits)]));
          this.worlds.set(id, { meta: d.meta, world, admin: d.admin, profiles: new Map(d.profiles), machines: new Map(d.machines), entities: d.entities, time: d.time, weather: d.weather, rules: d.rules, bossDefeated: d.bossDefeated ?? [] });
          if (suffix === '.json.bak') await copyFile(join(this.dir, id + suffix), join(this.dir, id + '.json'));
          loaded = true;
          break;
        } catch (e) {
          if (suffix === '.json.bak') throw new Error(`Cannot recover world ${id}`, { cause: e });
        }
      }
      if (!loaded) throw new Error(`Cannot load world ${id}`);
    }
  }

  create(name: string, seed: string, mode: WorldMeta['mode'], difficulty: number, token: string): GameWorld {
    const meta: WorldMeta = { id: randomUUID(), name: name.trim() || 'New world', seed: seed || randomUUID(), mode, difficulty, created: Date.now(), played: 0, players: 0 };
    const game: GameWorld = { meta, world: new World(meta.seed), admin: hashToken(token), profiles: new Map(), machines: new Map(), entities: [], time: 0.25, weather: 'clear', rules: defaultRules(), bossDefeated: [] };
    this.worlds.set(meta.id, game);
    return game;
  }

  save(): Promise<void> {
    const snapshots = [...this.worlds.values()].map(g => {
      const d: Saved = { version: 1, meta: g.meta, admin: g.admin, profiles: [...g.profiles], edits: [...g.world.edits].map(([key, edits]) => [key, [...edits]]), machines: [...g.machines], entities: g.entities, time: g.time, weather: g.weather, rules: g.rules, bossDefeated: g.bossDefeated };
      return { id: g.meta.id, text: JSON.stringify(d) };
    });
    const operation = this.queue.catch(() => {}).then(async () => {
      for (const { id, text } of snapshots) {
        const path = join(this.dir, id + '.json'), tmp = path + '.tmp';
        const file = await open(tmp, 'w', 0o600);
        try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
        try { await copyFile(path, path + '.bak'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        await rename(tmp, path);
      }
    });
    this.queue = operation;
    return operation;
  }
}
