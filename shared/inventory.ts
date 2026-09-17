import { BLOCKS, ITEMS, itemDef } from './blocks';
import { itemNameToId, type Recipe } from './recipes';
import type { Inventory, Stack } from './types';

export const emptyInventory = (size = 36): Inventory => Array.from({ length: Number.isInteger(size) && size >= 0 && size <= 256 ? size : 36 }, () => null);
export const validItem = (id: number) => Number.isInteger(id) && id > 0 && (ITEMS[id] !== undefined || (id > 100 && BLOCKS[id - 100] !== undefined));
const same = (a: Stack, b: Stack) => a.id === b.id && a.durability === b.durability && a.enhancement === b.enhancement;
const clone = (inv: Inventory) => inv.map(s => s ? { ...s } : null);
const commit = (inv: Inventory, next: Inventory) => inv.splice(0, inv.length, ...next);

export function addItem(inv: Inventory, stack: Stack): number {
  if (!validItem(stack.id) || !Number.isSafeInteger(stack.count) || stack.count <= 0) return stack.count;
  const def = itemDef(stack.id), item = { ...stack };
  if (def.durability && item.durability === undefined) item.durability = def.durability;
  let left = item.count;
  for (const slot of inv) if (slot && same(slot, item)) {
    const n = Math.min(left, Math.max(0, def.stack - slot.count));
    slot.count += n; left -= n;
    if (!left) return 0;
  }
  for (let i = 0; i < inv.length && left; i++) if (!inv[i]) {
    const n = Math.min(left, def.stack);
    inv[i] = { ...item, count: n }; left -= n;
  }
  return left;
}

export function moveItem(inv: Inventory, from: number, to: number, split = false): boolean {
  if (![from, to].every(n => Number.isInteger(n) && n >= 0 && n < inv.length) || from === to) return false;
  const src = inv[from], dst = inv[to];
  if (!src) return false;
  if (dst && !same(src, dst)) {
    if (split) return false;
    inv[from] = dst; inv[to] = src; return true;
  }
  const n = Math.min(split ? Math.ceil(src.count / 2) : src.count, itemDef(src.id).stack - (dst?.count ?? 0));
  if (n <= 0) return false;
  inv[to] = { ...src, count: (dst?.count ?? 0) + n };
  src.count -= n;
  if (!src.count) inv[from] = null;
  return true;
}

export const countItem = (inv: Inventory, id: number) => inv.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);

export function consumeItems(inv: Inventory, items: Stack[] | Record<number, number>): boolean {
  const costs = new Map<number, number>();
  const list = Array.isArray(items) ? items : Object.entries(items).map(([id, count]) => ({ id: Number(id), count }));
  for (const s of list) {
    if (!validItem(s.id) || !Number.isSafeInteger(s.count) || s.count <= 0) return false;
    costs.set(s.id, (costs.get(s.id) ?? 0) + s.count);
  }
  for (const [id, n] of costs) if (!Number.isSafeInteger(n) || countItem(inv, id) < n) return false;
  for (const [id, n] of costs) {
    let left = n;
    for (let i = 0; i < inv.length && left; i++) {
      const s = inv[i];
      if (s?.id !== id) continue;
      const take = Math.min(left, s.count); s.count -= take; left -= take;
      if (!s.count) inv[i] = null;
    }
  }
  return true;
}

export function craft(inv: Inventory, recipe: Recipe, count = 1): boolean {
  if (!Number.isInteger(count) || count < 1 || count > 64 || !Number.isInteger(recipe.count) || recipe.count < 1 || recipe.count > 64) return false;
  const id = itemNameToId(recipe.out), ingredients = (recipe.grid ?? recipe.loose ?? []).filter((s): s is string => typeof s === 'string');
  if (!id || !ingredients.length) return false;
  const next = clone(inv);
  if (!consumeItems(next, ingredients.map(name => ({ id: itemNameToId(name), count })))) return false;
  if (addItem(next, { id, count: recipe.count * count })) return false;
  commit(inv, next);
  return true;
}

export function transferItem(from: Inventory, to: Inventory, slot: number): boolean {
  if (from === to || !Number.isInteger(slot) || slot < 0 || slot >= from.length || !from[slot]) return false;
  const stack = from[slot]!, next = clone(to), left = addItem(next, stack);
  if (left) return false;
  commit(to, next); from[slot] = null;
  return true;
}

export function exchangeItems(inv: Inventory, costs: Stack[], output: Stack): boolean {
  const next = clone(inv);
  if (!consumeItems(next, costs) || !validItem(output.id) || addItem(next, output)) return false;
  commit(inv, next); return true;
}
