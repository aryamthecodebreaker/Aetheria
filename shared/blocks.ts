import type { Realm } from './types';

export type BlockDef = {
  id: number; name: string;
  solid: boolean; opaque: boolean;
  hardness: number; tool?: string; tier?: number;
  light?: number; drop?: string; dropCount?: number;
  gravity?: boolean; liquid?: boolean; flammable?: boolean;
  cross?: boolean; // rendered as X-shape plant
  slab?: boolean; stairs?: boolean;
  sound?: string; realm?: Realm; crop?: boolean;
  container?: string; machine?: string;
  color: number; // base texture color, client generates texture from this
  accent?: number;
};

// id 0 = air. Keep compact: Uint16 world storage.
const B = (d: Partial<BlockDef> & { id: number; name: string; color: number }) => ({
  solid: true, opaque: true, hardness: 1, sound: 'stone', ...d
} as BlockDef);

export const BLOCKS: BlockDef[] = [
  B({ id: 0, name: 'air', color: 0, solid: false, opaque: false, hardness: 0 }),
  // terrain
  B({ id: 1, name: 'grass', color: 0x5ea54a, hardness: 0.6, tool: 'shovel', drop: 'dirt', sound: 'grass' }),
  B({ id: 2, name: 'dirt', color: 0x8a6a43, hardness: 0.5, tool: 'shovel', sound: 'grass' }),
  B({ id: 3, name: 'stone', color: 0x8f8f96, hardness: 1.5, tool: 'pick', tier: 1 }),
  B({ id: 4, name: 'sand', color: 0xd9c98d, hardness: 0.5, tool: 'shovel', sound: 'sand' }),
  B({ id: 5, name: 'water', color: 0x3f76c9, solid: false, opaque: false, liquid: true, hardness: 0 }),
  B({ id: 6, name: 'log', color: 0x6b4d2e, hardness: 1.2, tool: 'axe', flammable: true, sound: 'wood' }),
  B({ id: 7, name: 'leaves', color: 0x4a8a3a, hardness: 0.3, opaque: false, flammable: true, sound: 'grass' }),
  B({ id: 8, name: 'coal ore', color: 0x4c4c52, hardness: 2.5, tool: 'pick', tier: 1, drop: 'coal' }),
  B({ id: 9, name: 'copper ore', color: 0x9a6b4f, hardness: 3, tool: 'pick', tier: 1, drop: 'raw_copper' }),
  B({ id: 10, name: 'iron ore', color: 0xb9a08a, hardness: 3.5, tool: 'pick', tier: 2, drop: 'raw_iron' }),
  B({ id: 11, name: 'gold ore', color: 0xc9a94f, hardness: 3.5, tool: 'pick', tier: 2, drop: 'raw_gold' }),
  B({ id: 12, name: 'sapphire ore', color: 0x3a6bd8, hardness: 4, tool: 'pick', tier: 3, drop: 'sapphire', light: 6 }),
  B({ id: 13, name: 'radiant ore', color: 0xe8c8ff, hardness: 5, tool: 'pick', tier: 4, drop: 'radiant', light: 9, realm: 'cinder' }),
  B({ id: 14, name: 'aetherstone', color: 0x9fe8e0, hardness: 6, tool: 'pick', tier: 4, realm: 'aether', light: 4 }),
  B({ id: 15, name: 'cinderstone', color: 0x6e4444, hardness: 2, tool: 'pick', tier: 2, realm: 'cinder' }),
  B({ id: 16, name: 'cinder ash', color: 0x3a2a2a, hardness: 0.5, tool: 'shovel', realm: 'cinder' }),
  B({ id: 17, name: 'magma', color: 0xd8542a, hardness: 2, tool: 'pick', tier: 2, light: 12, realm: 'cinder' }),
  B({ id: 18, name: 'verdant crystal', color: 0x6fe8a8, hardness: 5, tool: 'pick', tier: 4, light: 10, realm: 'aether' }),
  B({ id: 19, name: 'snow', color: 0xf2f6fa, hardness: 0.4, tool: 'shovel', sound: 'snow' }),
  B({ id: 20, name: 'ice', color: 0x9ecff2, hardness: 0.8, tool: 'pick', sound: 'stone' }),
  B({ id: 21, name: 'bedrock', color: 0x2a2a2e, hardness: 999 }),
  B({ id: 22, name: 'gravel', color: 0x8a8580, hardness: 0.7, tool: 'shovel', gravity: true }),
  // crafting / functional
  B({ id: 23, name: 'workbench', color: 0xa8794a, hardness: 1.5, tool: 'axe', container: 'craft3', sound: 'wood' }),
  B({ id: 24, name: 'forge', color: 0x707078, hardness: 3, tool: 'pick', tier: 1, machine: 'forge', light: 8 }),
  B({ id: 25, name: 'chest', color: 0x9a7640, hardness: 1.5, tool: 'axe', container: 'chest', sound: 'wood' }),
  B({ id: 26, name: 'torch', color: 0xffc060, solid: false, opaque: false, hardness: 0.1, light: 14, cross: true, sound: 'wood' }),
  B({ id: 27, name: 'lamp', color: 0xffe9a0, hardness: 0.5, light: 0, sound: 'stone' }),
  B({ id: 28, name: 'glass', color: 0xcfe8ef, hardness: 0.4, opaque: false, drop: '' }),
  B({ id: 29, name: 'planks', color: 0xb08a56, hardness: 1, tool: 'axe', flammable: true, sound: 'wood' }),
  B({ id: 30, name: 'cobble', color: 0x7a7a80, hardness: 2, tool: 'pick', tier: 1 }),
  B({ id: 31, name: 'farmland', color: 0x6a4a2a, hardness: 0.5, tool: 'shovel', drop: 'dirt', sound: 'grass' }),
  B({ id: 32, name: 'wheat crop', color: 0xc8b860, solid: false, opaque: false, hardness: 0.1, cross: true, crop: true, drop: 'wheat', sound: 'grass' }),
  B({ id: 33, name: 'door', color: 0x9a6a3a, hardness: 1.2, tool: 'axe', opaque: false, sound: 'wood' }),
  B({ id: 34, name: 'slab', color: 0x9a9aa0, hardness: 2, tool: 'pick', tier: 1, slab: true }),
  B({ id: 35, name: 'fence', color: 0x8a6a3a, hardness: 1, tool: 'axe', opaque: false, sound: 'wood' }),
  B({ id: 36, name: 'flower', color: 0xe86a8a, solid: false, opaque: false, hardness: 0.1, cross: true, drop: 'flower', sound: 'grass' }),
  B({ id: 37, name: 'tallgrass', color: 0x5aa04a, solid: false, opaque: false, hardness: 0.05, cross: true, drop: '', sound: 'grass' }),
  B({ id: 38, name: 'cactus', color: 0x5a9a4a, hardness: 0.6, opaque: false, sound: 'grass' }),
  B({ id: 39, name: 'wire', color: 0xd8a030, solid: false, opaque: false, hardness: 0.1, drop: 'wire', sound: 'stone' }),
  B({ id: 40, name: 'lever', color: 0x8a6a4a, solid: false, opaque: false, hardness: 0.3, sound: 'stone' }),
  B({ id: 41, name: 'lamp powered', color: 0xffd870, hardness: 0.5, light: 15, drop: 'lamp', sound: 'stone' }),
  B({ id: 42, name: 'aether portal', color: 0xb090ff, solid: false, opaque: false, hardness: 5, light: 11 }),
  B({ id: 43, name: 'cinder portal', color: 0xff9050, solid: false, opaque: false, hardness: 5, light: 11 }),
  B({ id: 44, name: 'bricks', color: 0xb06048, hardness: 2, tool: 'pick', tier: 1 }),
  B({ id: 45, name: 'stone bricks', color: 0x8a8a92, hardness: 2, tool: 'pick', tier: 1 }),
  B({ id: 46, name: 'glow lily', color: 0xa0ffb0, solid: false, opaque: false, hardness: 0.1, light: 8, cross: true, realm: 'aether' }),
  B({ id: 47, name: 'ember bloom', color: 0xffb060, solid: false, opaque: false, hardness: 0.1, light: 7, cross: true, realm: 'cinder' }),
  B({ id: 48, name: 'dragon egg', color: 0x302040, hardness: 8, light: 6 }),
  B({ id: 49, name: 'bed', color: 0x9266b5, hardness: 1, tool: 'axe', slab: true, opaque: false, sound: 'wood' }),
  B({ id: 50, name: 'door open', color: 0x9a6a3a, hardness: 1.2, tool: 'axe', solid: false, opaque: false, cross: true, drop: 'door', sound: 'wood' }),
  B({ id: 51, name: 'crop young', color: 0x62983e, solid: false, opaque: false, hardness: 0.1, cross: true, crop: true, drop: 'seeds', sound: 'grass' }),
  B({ id: 52, name: 'crop middle', color: 0x97b94d, solid: false, opaque: false, hardness: 0.1, cross: true, crop: true, drop: 'seeds', sound: 'grass' }),
  B({ id: 53, name: 'hopper', color: 0x576777, hardness: 2, tool: 'pick', tier: 1, container: 'hopper', machine: 'hopper' }),
  B({ id: 54, name: 'solar core', color: 0x487dbc, hardness: 2, tool: 'pick', tier: 1, machine: 'solar' }),
];
export const BLOCK = Object.fromEntries(BLOCKS.map(b => [b.name.replace(/ /g, '_').toUpperCase(), b.id]));
export const BLOCK_NAME = Object.fromEntries(BLOCKS.map(b => [b.id, b.name]));
export const blockDef = (id: number) => BLOCKS[id] ?? BLOCKS[0];

export type ItemDef = {
  id: number; name: string; stack: number;
  block?: number; tool?: string; tier?: number; speed?: number;
  damage?: number; armor?: number; slot?: 'head' | 'chest' | 'legs' | 'feet';
  food?: number; fuel?: number; durability?: number; rarity?: number;
};
const I = (d: Partial<ItemDef> & { id: number; name: string }) => ({ stack: 64, ...d } as ItemDef);
export const ITEMS: ItemDef[] = [
  I({ id: 0, name: 'air', stack: 0 }),
  I({ id: 1, name: 'wood pick', stack: 1, tool: 'pick', tier: 1, speed: 3, durability: 60, damage: 2 }),
  I({ id: 2, name: 'stone pick', stack: 1, tool: 'pick', tier: 2, speed: 5, durability: 130, damage: 3 }),
  I({ id: 3, name: 'copper pick', stack: 1, tool: 'pick', tier: 3, speed: 7, durability: 260, damage: 4 }),
  I({ id: 4, name: 'sapphire pick', stack: 1, tool: 'pick', tier: 4, speed: 10, durability: 700, damage: 5 }),
  I({ id: 5, name: 'wood axe', stack: 1, tool: 'axe', tier: 1, speed: 3, durability: 60, damage: 3 }),
  I({ id: 6, name: 'stone axe', stack: 1, tool: 'axe', tier: 2, speed: 5, durability: 130, damage: 4 }),
  I({ id: 7, name: 'copper axe', stack: 1, tool: 'axe', tier: 3, speed: 7, durability: 260, damage: 5 }),
  I({ id: 8, name: 'wood shovel', stack: 1, tool: 'shovel', tier: 1, speed: 3, durability: 60, damage: 2 }),
  I({ id: 9, name: 'stone shovel', stack: 1, tool: 'shovel', tier: 2, speed: 5, durability: 130, damage: 2 }),
  I({ id: 10, name: 'copper shovel', stack: 1, tool: 'shovel', tier: 3, speed: 7, durability: 260, damage: 3 }),
  I({ id: 11, name: 'copper sword', stack: 1, tool: 'sword', tier: 3, speed: 1.5, durability: 260, damage: 7 }),
  I({ id: 12, name: 'sapphire sword', stack: 1, tool: 'sword', tier: 4, speed: 1.5, durability: 700, damage: 10 }),
  I({ id: 13, name: 'hoe', stack: 1, tool: 'hoe', tier: 1, speed: 2, durability: 60 }),
  I({ id: 14, name: 'copper helmet', stack: 1, armor: 2, slot: 'head', durability: 180 }),
  I({ id: 15, name: 'copper chestplate', stack: 1, armor: 4, slot: 'chest', durability: 220 }),
  I({ id: 16, name: 'copper boots', stack: 1, armor: 2, slot: 'feet', durability: 160 }),
  I({ id: 17, name: 'sapphire chestplate', stack: 1, armor: 6, slot: 'chest', durability: 500 }),
  I({ id: 18, name: 'bow', stack: 1, tool: 'bow', durability: 300, damage: 5 }),
  I({ id: 19, name: 'arrow', stack: 64 }),
  I({ id: 20, name: 'coal', fuel: 40 }),
  I({ id: 21, name: 'raw copper' }),
  I({ id: 22, name: 'copper ingot' }),
  I({ id: 23, name: 'raw iron' }),
  I({ id: 24, name: 'iron ingot' }),
  I({ id: 25, name: 'raw gold' }),
  I({ id: 26, name: 'gold ingot' }),
  I({ id: 27, name: 'sapphire' }),
  I({ id: 28, name: 'radiant' }),
  I({ id: 29, name: 'wheat' }),
  I({ id: 30, name: 'bread', food: 5 }),
  I({ id: 31, name: 'raw meat', food: 2 }),
  I({ id: 32, name: 'cooked meat', food: 8 }),
  I({ id: 33, name: 'apple', food: 4 }),
  I({ id: 34, name: 'stick' }),
  I({ id: 35, name: 'bone' }),
  I({ id: 36, name: 'hide' }),
  I({ id: 37, name: 'silk' }),
  I({ id: 38, name: 'essence' }),
  I({ id: 39, name: 'compass' }),
  I({ id: 40, name: 'grapnel' }),
  I({ id: 41, name: 'map' }),
  I({ id: 42, name: 'gem blade', stack: 1, tool: 'sword', tier: 5, speed: 2, durability: 1200, damage: 12, rarity: 1 }),
  I({ id: 43, name: 'radiant wand', stack: 1, durability: 300, damage: 8, rarity: 1 }),
  I({ id: 44, name: 'fish' }),
  I({ id: 45, name: 'cooked fish', food: 6 }),
  I({ id: 46, name: 'trade note' }),
  I({ id: 47, name: 'ember fruit', food: 3, rarity: 1 }),
  I({ id: 48, name: 'seeds' }),
];
// Block items (id >= 100 maps to block-100) are implicit: item id 100+n places block n
export const itemDef = (id: number) => ITEMS[id] ?? (id >= 100 ? { id, name: BLOCK_NAME[id - 100] ?? '?', stack: 64, block: id - 100 } : ITEMS[0]);
export const itemIdForBlock = (blockId: number) => {
  const idx = ITEMS.findIndex(i => i.block === blockId);
  return idx > 0 ? idx : 100 + blockId;
};
