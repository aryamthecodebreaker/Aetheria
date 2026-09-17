import { BLOCK, ITEMS } from './blocks';

export type Recipe = { id?: string; out: string; count: number; grid?: (string | 0)[]; loose?: string[]; needs3?: boolean };
const R = (out: string, count: number, grid: (string | 0)[] | null, loose?: string[]): Recipe =>
  ({ out, count, ...(grid ? { grid, needs3: grid.length > 4 } : { loose: loose! }) });

export const RECIPES: Recipe[] = [
  R('planks', 4, ['log']),
  { out: 'stick', count: 4, loose: ['planks'] },
  R('workbench', 1, ['planks', 'planks', 'planks', 'planks']),
  R('wood_pick', 1, ['planks', 'planks', 'planks', 0, 'stick', 0, 0, 'stick', 0]),
  R('stone_pick', 1, ['cobble', 'cobble', 'cobble', 0, 'stick', 0, 0, 'stick', 0]),
  R('copper_pick', 1, ['copper_ingot', 'copper_ingot', 'copper_ingot', 0, 'stick', 0, 0, 'stick', 0]),
  R('sapphire_pick', 1, ['sapphire', 'sapphire', 'sapphire', 0, 'stick', 0, 0, 'stick', 0]),
  R('wood_axe', 1, ['planks', 'planks', 0, 'planks', 'stick', 0, 0, 'stick', 0]),
  R('stone_axe', 1, ['cobble', 'cobble', 0, 'cobble', 'stick', 0, 0, 'stick', 0]),
  R('wood_shovel', 1, ['planks', 0, 0, 'stick', 0, 0, 'stick', 0, 0]),
  R('stone_shovel', 1, ['cobble', 0, 0, 'stick', 0, 0, 'stick', 0, 0]),
  R('hoe', 1, ['planks', 'planks', 0, 0, 'stick', 0, 0, 'stick', 0]),
  R('copper_sword', 1, ['copper_ingot', 0, 0, 'copper_ingot', 0, 0, 'stick', 0, 0]),
  R('sapphire_sword', 1, ['sapphire', 0, 0, 'sapphire', 0, 0, 'stick', 0, 0]),
  R('copper_helmet', 1, ['copper_ingot', 'copper_ingot', 'copper_ingot', 'copper_ingot', 0, 'copper_ingot']),
  R('copper_chestplate', 1, ['copper_ingot', 0, 'copper_ingot', 'copper_ingot', 'copper_ingot', 'copper_ingot', 'copper_ingot', 'copper_ingot', 'copper_ingot']),
  R('copper_boots', 1, ['copper_ingot', 0, 0, 'copper_ingot', 0, 'copper_ingot']),
  R('sapphire_chestplate', 1, ['sapphire', 0, 'sapphire', 'sapphire', 'sapphire', 'sapphire', 'sapphire', 0, 'sapphire']),
  R('forge', 1, ['cobble', 'cobble', 'cobble', 'cobble', 0, 'cobble', 'cobble', 'cobble', 'cobble']),
  R('chest', 1, ['planks', 'planks', 'planks', 'planks', 0, 'planks', 'planks', 'planks', 'planks']),
  R('torch', 4, ['coal', 0, 0, 'stick', 0, 0]),
  R('lamp', 1, ['glass', 'glass', 'glass', 'glass', 'torch', 'glass', 'glass', 'glass', 'glass']),
  R('glass', 1, null, ['sand']),
  R('bread', 1, null, ['wheat', 'wheat', 'wheat']),
  R('door', 3, ['planks', 'planks', 0, 'planks', 'planks', 0, 'planks', 'planks', 0]),
  R('slab', 6, ['cobble', 'cobble', 'cobble']),
  R('fence', 4, [0, 0, 0, 'planks', 'planks', 'planks', 'planks', 'planks', 'planks']),
  R('bricks', 4, null, ['dirt', 'dirt', 'dirt', 'dirt']),
  R('stone_bricks', 4, ['cobble', 'cobble', 'cobble', 'cobble', 'cobble', 'cobble', 'cobble', 'cobble', 'cobble']),
  R('wire', 8, null, ['copper_ingot', 'copper_ingot']),
  R('lever', 1, ['cobble', 0, 0, 'stick', 0, 0]),
  R('bed', 1, ['hide', 'hide', 'hide', 'planks', 'planks', 'planks']),
  R('hopper', 1, ['iron_ingot', 0, 'iron_ingot', 'iron_ingot', 'chest', 'iron_ingot', 0, 'iron_ingot', 0]),
  R('solar_core', 1, ['glass', 'glass', 'glass', 'copper_ingot', 'sapphire', 'copper_ingot', 'stone', 'stone', 'stone']),
  R('copper_axe', 1, ['copper_ingot', 'copper_ingot', 0, 'copper_ingot', 'stick', 0, 0, 'stick', 0]),
  R('copper_shovel', 1, ['copper_ingot', 0, 0, 'stick', 0, 0, 'stick', 0, 0]),
  R('bow', 1, ['stick', 'silk', 0, 'stick', 'silk', 0, 'stick', 'silk', 0]),
  { out: 'arrow', count: 4, loose: ['bone', 'stick', 'silk'] },
  R('compass', 1, [0, 'copper_ingot', 0, 'copper_ingot', 'sapphire', 'copper_ingot', 0, 'copper_ingot', 0]),
  R('aether_portal', 1, ['cobble', 'sapphire', 'cobble', 'sapphire', 'radiant', 'sapphire', 'cobble', 'sapphire', 'cobble']),
  R('cinder_portal', 1, ['cobble', 'coal', 'cobble', 'copper_ingot', 'gold_ingot', 'copper_ingot', 'cobble', 'coal', 'cobble']),
  R('gem_blade', 1, ['sapphire', 0, 0, 'sapphire', 0, 0, 'radiant', 0, 0]),
  R('radiant_wand', 1, ['radiant', 0, 0, 'stick', 0, 0, 'gold_ingot', 0, 0]),
];

export const SMELT: Record<string, { out: string; time: number }> = {
  raw_copper: { out: 'copper_ingot', time: 8 },
  raw_iron: { out: 'iron_ingot', time: 10 },
  raw_gold: { out: 'gold_ingot', time: 10 },
  sand: { out: 'glass', time: 6 },
  raw_meat: { out: 'cooked_meat', time: 8 },
  fish: { out: 'cooked_fish', time: 6 },
  cobble: { out: 'stone', time: 6 },
  log: { out: 'coal', time: 10 },
};

export function itemNameToId(name: string): number {
  name = name.trim().toLowerCase().replace(/ /g, '_');
  const bi = Object.hasOwn(BLOCK, name.toUpperCase()) ? BLOCK[name.toUpperCase()] : undefined;
  if (bi !== undefined) return bi ? 100 + bi : 0;
  return Object.hasOwn(ITEM_INDEX, name) ? ITEM_INDEX[name] : 0;
}
const ITEM_INDEX = Object.fromEntries(ITEMS.map(i => [i.name.replace(/ /g, '_'), i.id]));
