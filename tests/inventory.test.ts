import { describe, expect, it } from 'vitest';
import { addItem, consumeItems, countItem, craft, emptyInventory, exchangeItems, moveItem, transferItem, validItem } from '../shared/inventory';
import { RECIPES, SMELT, itemNameToId } from '../shared/recipes';
import { blockDef, itemDef } from '../shared/blocks';

describe('inventory transactions', () => {
  it('allocates independent inventories and splits stacks without mutating the input', () => {
    const inv = emptyInventory(2), stack = { id: 29, count: 150 };
    expect(addItem(inv, stack)).toBe(22);
    expect(inv).toEqual([{ id:29,count:64 },{ id:29,count:64 }]);
    expect(stack.count).toBe(150);
    expect(emptyInventory(2)).toEqual([null,null]);
  });
  it('initializes tools and preserves enhancement and durability when moving', () => {
    const inv = emptyInventory(3);
    expect(addItem(inv,{ id:1,count:1 })).toBe(0);
    expect(inv[0]?.durability).toBe(60);
    expect(moveItem(inv,0,1)).toBe(true);
    inv[1]!.enhancement = 2;
    expect(moveItem(inv,1,2,true)).toBe(true);
    expect(inv[2]).toEqual({ id:1,count:1,durability:60,enhancement:2 });
  });
  it('merges, splits, swaps and rejects invalid slots without duplication', () => {
    const inv = emptyInventory(3);
    addItem(inv,{ id:29,count:63 }); addItem(inv,{ id:30,count:4 });
    expect(moveItem(inv,0,2,true)).toBe(true);
    expect(inv.map(s => s?.count)).toEqual([31,4,32]);
    expect(moveItem(inv,2,0)).toBe(true);
    expect(countItem(inv,29)).toBe(63);
    expect(moveItem(inv,0,1,true)).toBe(false);
    expect(moveItem(inv,0,1)).toBe(true);
    const before = structuredClone(inv);
    for (const n of [-1,3,NaN,0.5,Infinity]) expect(moveItem(inv,n,0)).toBe(false);
    expect(moveItem(inv,0,0)).toBe(false);
    expect(inv).toEqual(before);
  });
  it('aggregates repeated ingredient costs before consumption', () => {
    const inv = emptyInventory(); addItem(inv,{ id:29,count:2 });
    const before = structuredClone(inv);
    expect(consumeItems(inv,[{ id:29,count:2 },{ id:29,count:1 }])).toBe(false);
    expect(inv).toEqual(before);
    expect(consumeItems(inv,{ 29:2 })).toBe(true);
    expect(countItem(inv,29)).toBe(0);
  });
  it('crafts atomically and rejects full output and invalid batch counts', () => {
    const recipe = RECIPES.find(r => r.out === 'planks')!;
    const inv = emptyInventory(1); addItem(inv,{ id:106,count:2 });
    const before = structuredClone(inv);
    expect(craft(inv,recipe)).toBe(false); expect(inv).toEqual(before);
    expect(craft(inv,recipe,2)).toBe(true); expect(inv[0]).toEqual({ id:129,count:8 });
    for (const n of [-1,0,0.5,65,NaN,Infinity]) expect(craft(inv,recipe,n)).toBe(false);
  });
  it('does not transfer or trade partially when output cannot fit', () => {
    const from = emptyInventory(1), to = emptyInventory(1);
    addItem(from,{ id:29,count:2 }); addItem(to,{ id:29,count:63 });
    expect(transferItem(from,to,0)).toBe(false);
    expect(countItem(from,29)).toBe(2); expect(countItem(to,29)).toBe(63);
    expect(transferItem(from,from,0)).toBe(false);
    const inv = emptyInventory(1); addItem(inv,{ id:29,count:9 });
    expect(exchangeItems(inv,[{ id:29,count:8 }],{ id:46,count:1 })).toBe(false);
    expect(countItem(inv,29)).toBe(9);
  });
  it('crafts both portals without ingredients from their inaccessible destination', () => {
    const inv = emptyInventory();
    const make = (out: string) => expect(craft(inv,RECIPES.find(r => r.out === out)!)).toBe(true);
    addItem(inv,{id:itemNameToId('log'),count:32});
    for (let i = 0; i < 16; i++) make('planks');
    make('stick'); make('stick'); make('workbench'); make('wood_pick');
    expect(itemDef(itemNameToId('wood_pick')).tier).toBeGreaterThanOrEqual(blockDef(3).tier!);
    addItem(inv,{id:itemNameToId('cobble'),count:32});
    make('stone_pick'); make('forge');
    expect(itemDef(itemNameToId('stone_pick')).tier).toBeGreaterThanOrEqual(blockDef(11).tier!);
    addItem(inv,{id:itemNameToId('coal'),count:8});
    addItem(inv,{id:itemNameToId('copper_ingot'),count:8});
    addItem(inv,{id:itemNameToId('gold_ingot'),count:1});
    make('copper_pick'); make('cinder_portal');
    expect(itemDef(itemNameToId('copper_pick')).tier).toBeGreaterThanOrEqual(blockDef(12).tier!);
    addItem(inv,{id:itemNameToId('sapphire'),count:8});
    make('sapphire_pick');
    expect(itemDef(itemNameToId('sapphire_pick')).tier).toBeGreaterThanOrEqual(blockDef(13).tier!);
    addItem(inv,{id:itemNameToId('radiant'),count:1});
    make('aether_portal');
    expect(countItem(inv,itemNameToId('aetherstone'))).toBe(0);
    expect(countItem(inv,itemNameToId('cinderstone'))).toBe(0);
  });
  it('resolves every recipe and smelting item, without prototype lookups', () => {
    expect(new Set(RECIPES.map(r => r.out)).size).toBe(RECIPES.length);
    for (const [name,r] of Object.entries(SMELT)) { expect(validItem(itemNameToId(name)),name).toBe(true); expect(validItem(itemNameToId(r.out))).toBe(true); }
    for (const r of RECIPES) for (const name of [r.out,...(r.grid ?? r.loose ?? []).filter((x): x is string => !!x)]) expect(validItem(itemNameToId(name)),name).toBe(true);
    expect(itemNameToId('__proto__')).toBe(0); expect(itemNameToId('constructor')).toBe(0);
    expect(validItem(65535)).toBe(false);
    expect(RECIPES.find(r => r.out === 'workbench')?.needs3).toBe(false);
    expect(RECIPES.find(r => r.out === 'wood_pick')?.needs3).toBe(true);
  });
});
