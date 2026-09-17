import { itemDef } from '../shared/blocks';
import { addItem } from '../shared/inventory';
import { SMELT, itemNameToId } from '../shared/recipes';
import type { Inventory, Machine } from '../shared/types';

export const fuelValue = (id: number) => itemDef(id).fuel ?? ([106,129].includes(id) ? 8 : 0);
export function smeltRecipe(id: number) {
  const name = itemDef(id).name.replace(/ /g,'_');
  return Object.hasOwn(SMELT,name) ? SMELT[name] : undefined;
}
export function inputSlot(m: Machine, id: number): number | undefined {
  if (m.kind !== 'forge') return;
  return smeltRecipe(id) ? 0 : fuelValue(id) ? 1 : undefined;
}
export function insertStack(m: Machine, stack: NonNullable<Inventory[number]>) {
  if (m.kind === 'forge') {
    const slot = inputSlot(m,stack.id);
    if (slot === undefined) return false;
    const target = [m.slots[slot] ? { ...m.slots[slot]! } : null];
    if (addItem(target,stack)) return false;
    if (slot === 0 && m.slots[0]?.id !== stack.id) m.progress = 0;
    m.slots[slot] = target[0];
    return true;
  }
  if (!['chest','hopper'].includes(m.kind)) return false;
  const next = m.slots.map(s => s ? { ...s } : null);
  if (addItem(next,stack)) return false;
  m.slots.splice(0,m.slots.length,...next);
  return true;
}
export function transferOne(from: Machine, to: Machine) {
  if (from === to) return false;
  const indices = from.kind === 'forge' ? [2] : from.slots.map((_,i) => i);
  for (const i of indices) {
    const stack = from.slots[i];
    if (!stack || !insertStack(to,{ ...stack,count:1 })) continue;
    if (--stack.count === 0) from.slots[i] = null;
    return true;
  }
  return false;
}
export function stepForge(m: Machine, dt: number) {
  const input = m.slots[0], fuel = m.slots[1], output = m.slots[2];
  const recipe = input ? smeltRecipe(input.id) : undefined, out = recipe ? itemNameToId(recipe.out) : 0;
  const can = !!recipe && (!output || output.id === out && output.count < itemDef(out).stack);
  if (can && m.fuel <= 0 && fuel) {
    const burn = fuelValue(fuel.id);
    if (burn) { m.fuel += burn; if (--fuel.count === 0) m.slots[1] = null; }
  }
  m.powered = can && m.fuel > 0;
  const elapsed = Math.min(dt,m.fuel);
  m.fuel = Math.max(0,m.fuel-dt);
  if (m.powered && recipe && input) {
    m.progress += elapsed;
    if (m.progress >= recipe.time) {
      m.progress = 0;
      if (--input.count === 0) m.slots[0] = null;
      m.slots[2] = { id:out,count:(output?.count ?? 0)+1 };
    }
  } else if (!can) m.progress = 0;
}
