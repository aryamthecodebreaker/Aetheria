import type { Action, ClientMessage, Entity, Machine, Mode, Player, Stack, WorldMeta } from '../shared/types';
import { BLOCKS, ITEMS, itemDef } from '../shared/blocks';
import { RECIPES, SMELT, itemNameToId, type Recipe } from '../shared/recipes';
import './style.css';

type Settings = { sensitivity: number; fov: number; distance: number; volume: number; bob: boolean; invertY: boolean };
type Info = { fps: number; ping: number; chunks: number; entities: number; time: number; weather: string; biome: string; players: string[]; boss?: Entity };
type Panel = '' | 'title' | 'worlds' | 'create' | 'inventory' | 'container' | 'pause' | 'guide' | 'chat' | 'death' | 'trade';
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
const label = (name: string) => name.replace(/_/g, ' ');
const readStored = (key: string): Record<string, unknown> => {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; }
};
const icon = (path: string, cls = '') => `<svg class="ae-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const marks = {
  arrow: icon('<path d="M4 12h15m-6-6 6 6-6 6"/>'),
  close: icon('<path d="m6 6 12 12M6 18 18 6"/>'),
  book: icon('<path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v14c-4-1-6 0-9 2-3-2-5-3-9-2Z"/>'),
  compass: icon('<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6Z"/>'),
  heart: icon('<path d="M12 20 4 12C-1 6 7 1 12 7c5-6 13-1 8 5Z"/>'),
  food: icon('<path d="M5 20 19 4M8 17c-7 0-5-8 0-5-2-7 5-8 5-3 0-7 8-6 6-1-1 3-5 3-5 3 5 3 2 8-3 5"/>'),
  air: icon('<path d="M12 3c-3 5-7 8-7 12a7 7 0 0 0 14 0c0-4-4-7-7-12Z"/>'),
};
const trades = [{ cost: 29, n: 8, out: 46, count: 1 }, { cost: 46, n: 1, out: 30, count: 3 }, { cost: 46, n: 3, out: 22, count: 2 }];
export const catalog = [...ITEMS.filter(i => i.id > 0).map(i => i.id), ...BLOCKS.filter(b => b.id > 0).map(b => b.id + 100)];
export function repairCost(stack: Stack) {
  const def = itemDef(stack.id);
  if (!def.durability) return;
  const material = def.tier === 5 ? 28 : def.tier === 4 || stack.id === 17 ? 27 : def.tier === 3 || def.armor ? 22 : def.tier === 2 ? 130 : stack.id === 18 ? 37 : stack.id === 43 ? 28 : 129;
  return { material, count: 2, xp: 3, restore: Math.min(def.durability - (stack.durability ?? def.durability), Math.ceil(def.durability * 0.4)) };
}

export class UI {
  token: string;
  name: string;
  color: string;
  settings: Settings;
  isOpen = true;
  private selection = 0;
  private hidden = false;
  private root: HTMLElement;
  private layer: HTMLElement;
  private hud: HTMLElement;
  private tooltip: HTMLElement;
  private panel: Panel = 'title';
  private guideBack: Panel = 'title';
  private player?: Player;
  private world?: WorldMeta;
  private worlds: WorldMeta[] = [];
  private listed = false;
  private address = location.origin;
  private machine?: { key: string; value: Machine };
  private source: { slot: number; split: boolean } | null = null;
  private query = '';
  private recipeTab: 'recipes' | 'creative' = 'recipes';
  private npc = '';
  private messages: { name: string; text: string }[] = [];
  private info?: Info;
  private lastHUD = 0;
  private rendered = new WeakMap<HTMLElement, string>();

  constructor(private send: (msg: ClientMessage) => void, private connect: (address: string) => void, private resume: () => void) {
    const profile = readStored('aetheria.profile');
    this.token = typeof profile.token === 'string' && /^[a-zA-Z0-9_-]{32,128}$/.test(profile.token) ? profile.token : crypto.randomUUID();
    this.name = typeof profile.name === 'string' ? profile.name.trim().slice(0, 24) || 'Explorer' : 'Explorer';
    this.color = typeof profile.color === 'string' && /^#[0-9a-f]{6}$/i.test(profile.color) ? profile.color : '#d79055';
    const saved = readStored('aetheria.settings');
    const number = (key: string, fallback: number, lo: number, hi: number) => typeof saved[key] === 'number' ? clamp(saved[key] as number, lo, hi) : fallback;
    this.settings = { sensitivity: number('sensitivity', 1, 0.2, 3), fov: number('fov', 75, 60, 100), distance: Math.round(number('distance', 4, 2, 6)), volume: number('volume', 0.65, 0, 1), bob: typeof saved.bob === 'boolean' ? saved.bob : true, invertY: typeof saved.invertY === 'boolean' ? saved.invertY : false };
    this.root = document.getElementById('ui') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'ui' }));
    this.root.innerHTML = `<div class="ae-hud" hidden><div class="ae-location"></div><div class="ae-crosshair" aria-hidden="true"></div><div class="ae-target" hidden><span></span><progress max="1" value="0" aria-label="Mining progress"></progress></div><div class="ae-bottom"><div class="ae-held"></div><div class="ae-vitals"></div><div class="ae-xp"></div><div class="ae-hotbar" aria-label="Hotbar"></div><div class="ae-hud-hint"><kbd>E</kbd> inventory <span>·</span> <kbd>T</kbd> chat <span>·</span> <kbd>Esc</kbd> journal</div></div><div class="ae-chat-feed" role="log" aria-label="Chat" aria-live="polite"></div></div><div class="ae-layer"></div><div class="ae-notices" role="status" aria-live="polite" aria-atomic="false"></div><div class="ae-tooltip" role="tooltip" id="ae-tooltip" hidden></div>`;
    this.layer = this.root.querySelector('.ae-layer')!;
    this.hud = this.root.querySelector('.ae-hud')!;
    this.tooltip = this.root.querySelector('.ae-tooltip')!;
    this.root.addEventListener('click', e => this.click(e));
    this.root.addEventListener('contextmenu', e => {
      const slot = (e.target as Element).closest<HTMLElement>('[data-slot]');
      if (slot && this.isOpen) { e.preventDefault(); this.pickSlot(Number(slot.dataset.slot), true); }
    });
    this.root.addEventListener('submit', e => this.submit(e));
    this.root.addEventListener('input', e => this.input(e));
    this.root.addEventListener('keydown', e => this.keydown(e));
    this.root.addEventListener('pointerover', e => this.showTooltip(e.target as Element));
    this.root.addEventListener('focusin', e => this.showTooltip(e.target as Element));
    this.root.addEventListener('pointerout', e => { if (!(e.relatedTarget instanceof Node) || !(e.target as Element).closest('[data-tip]')?.contains(e.relatedTarget)) this.hideTooltip(); });
    this.root.addEventListener('focusout', () => this.hideTooltip());
    this.persist('aetheria.profile', { token: this.token, name: this.name, color: this.color });
    this.showTitle();
  }

  get selected() { return this.selection; }
  set selected(value: number) { this.selection = Math.floor(clamp(value, 0, 8)); this.renderHotbar(); }
  get hideHUD() { return this.hidden; }
  set hideHUD(value: boolean) { this.hidden = value; this.hud.hidden = value || !this.player; }

  showTitle(): void {
    this.closeMachine();
    this.player = undefined;
    this.world = undefined;
    this.hud.hidden = true;
    this.open('title');
  }

  setWorlds(worlds: WorldMeta[]): void {
    this.worlds = worlds;
    this.listed = true;
    if (this.panel === 'worlds') this.renderWorlds();
  }

  welcome(player: Player, world: WorldMeta): void {
    this.player = player;
    this.world = world;
    this.selection = player.selected;
    this.machine = undefined;
    this.source = null;
    this.panel = '';
    this.isOpen = false;
    this.layer.innerHTML = '';
    this.root.classList.remove('ae-menu-open');
    this.hud.hidden = this.hidden;
    this.hud.inert = false;
    this.renderHotbar();
    this.renderVitals();
    this.notice(`Welcome to ${world.name}. Your field journal is under Esc.`);
    if (player.hp <= 0) this.open('death');
  }

  update(player: Player, info: Info): void {
    this.player = player.inventory.length ? player : { ...player, inventory: this.player?.inventory ?? [] };
    this.info = info;
    this.hud.hidden = this.hidden || !this.world;
    if (player.hp <= 0 && this.panel !== 'death') { this.closeMachine(); this.open('death'); }
    else if (player.hp > 0 && this.panel === 'death') { this.close(); }
    const now = performance.now();
    if (now - this.lastHUD < 100) return;
    this.lastHUD = now;
    this.renderHotbar();
    this.renderVitals();
    const hours = Math.floor(((info.time % 1 + 1) % 1) * 24);
    const minutes = Math.floor(((info.time % 1 + 1) % 1) * 1440) % 60;
    this.patch('.ae-location', `<span class="ae-location-mark">${marks.compass}</span><div><strong>${esc(info.biome || player.realm)}</strong><span>${esc(player.realm)} / ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} / ${esc(info.weather)}</span>${info.boss ? `<span>${esc(label(info.boss.kind))} · ${Math.max(0, Math.ceil(info.boss.hp))}/${info.boss.maxHp} HP · phase ${info.boss.phase ?? 1}</span><span>${info.boss.state === 'windup_radial' ? 'Radial strike: leave the 4.5-block ring' : info.boss.state === 'windup_rush' ? 'Rush charging: sidestep the marked path' : info.boss.state === 'rush' ? 'Rush: stay out of the path' : info.boss.state === 'recover' ? 'Recovering: attack now' : 'Approaching'}${info.boss.state.startsWith('windup_') ? ` · ${Math.max(0, info.boss.attackTimer ?? 0).toFixed(1)}s` : ''}</span>` : ''}</div>`);
    if (this.panel === 'inventory' || this.panel === 'container') this.renderInventory();
    if (this.panel === 'trade') this.renderTrades();
    if (this.panel === 'pause') this.renderTelemetry();
  }

  container(key: string, machine: Machine): void {
    if (this.player?.hp === 0) return;
    const same = this.machine?.key === key && this.panel === 'container';
    this.machine = { key, value: machine };
    if (!same) { this.source = null; this.query = ''; this.open('container'); }
    else this.renderInventory();
  }

  notice(text: string): void {
    const host = this.root.querySelector('.ae-notices')!;
    const note = document.createElement('div');
    note.className = 'ae-notice';
    note.textContent = text;
    host.appendChild(note);
    while (host.children.length > 4) host.firstElementChild?.remove();
    window.setTimeout(() => note.remove(), 6500);
  }

  chat(name: string, text: string): void {
    this.messages.push({ name, text });
    this.messages = this.messages.slice(-50);
    this.patch('.ae-chat-feed', this.messages.slice(-5).map(m => `<p><strong>${esc(m.name)}</strong> ${esc(m.text)}</p>`).join(''));
    if (this.panel === 'chat') this.renderChat();
  }

  toggleInventory(): void {
    if (!this.player || this.player.hp <= 0) return;
    if (this.panel === 'inventory' || this.panel === 'container') this.close();
    else { this.closeMachine(); this.source = null; this.query = ''; this.open('inventory'); }
  }

  togglePause(): void {
    if (!this.player || this.player.hp <= 0) return;
    if (this.isOpen) this.close();
    else this.open('pause');
  }

  target(name: string, progress: number): void {
    const target = this.root.querySelector<HTMLElement>('.ae-target')!;
    target.hidden = !name || this.isOpen;
    target.querySelector('span')!.textContent = name;
    const bar = target.querySelector('progress')!;
    bar.value = clamp(progress, 0, 1);
    bar.hidden = progress <= 0;
  }

  trade(npcId: string): void {
    if (!this.player || this.player.hp <= 0 || this.player.mode === 'spectator') return;
    this.closeMachine();
    this.npc = npcId;
    this.open('trade');
  }

  openChat(): void {
    if (!this.player || this.player.hp <= 0) return;
    this.closeMachine();
    this.open('chat');
  }

  showGuide(): void {
    this.guideBack = this.player ? 'pause' : 'title';
    this.closeMachine();
    this.open('guide');
  }

  close(): void {
    if (!this.player || this.player.hp <= 0) return;
    this.closeMachine();
    this.panel = '';
    this.isOpen = false;
    this.source = null;
    this.layer.innerHTML = '';
    this.root.classList.remove('ae-menu-open');
    this.hud.inert = false;
    this.hideTooltip();
    this.resume();
  }

  private action(action: Action) { this.send({ type: 'action', action }); }
  private persist(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { this.notice('Browser storage is unavailable. Your profile and settings will last only this visit.'); }
  }
  private closeMachine() {
    if (this.machine) this.action({ type: 'closeContainer' });
    this.machine = undefined;
  }
  private hideTooltip() {
    this.tooltip.hidden = true;
    this.root.querySelectorAll('[aria-describedby="ae-tooltip"]').forEach(el => el.removeAttribute('aria-describedby'));
  }
  private showTooltip(target: Element) {
    const item = target.closest<HTMLElement>('[data-tip]');
    if (!item) return;
    this.hideTooltip();
    this.tooltip.textContent = item.dataset.tip ?? '';
    this.tooltip.hidden = false;
    item.setAttribute('aria-describedby', 'ae-tooltip');
    const rect = item.getBoundingClientRect(), tip = this.tooltip.getBoundingClientRect();
    this.tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tip.width - 8, rect.left))}px`;
    this.tooltip.style.top = `${Math.max(8, rect.top > tip.height + 12 ? rect.top - tip.height - 8 : Math.min(window.innerHeight - tip.height - 8, rect.bottom + 8))}px`;
  }
  private patch(selector: string, html: string) {
    const el = this.root.querySelector<HTMLElement>(selector);
    if (!el || this.rendered.get(el) === html) return;
    this.rendered.set(el, html);
    const focused = el.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focus : undefined;
    const scroll = el.scrollTop;
    el.innerHTML = html;
    el.scrollTop = scroll;
    if (focused) Array.from(el.querySelectorAll<HTMLElement>('[data-focus]')).find(node => node.dataset.focus === focused)?.focus({ preventScroll: true });
  }
  private open(panel: Panel) {
    this.panel = panel;
    this.isOpen = true;
    this.root.classList.add('ae-menu-open');
    this.hud.inert = true;
    this.hideTooltip();
    if (document.pointerLockElement) document.exitPointerLock();
    this.renderPanel();
    const first = this.layer.querySelector<HTMLElement>('[autofocus], input:not([type="color"]), button, [tabindex="0"]');
    first?.focus({ preventScroll: true });
  }
  private frame(title: string, subtitle: string, body: string, wide = false) {
    return `<section class="ae-scrim"><div class="ae-journal ${wide ? 'ae-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="ae-panel-title"><header class="ae-panel-header"><div><h2 id="ae-panel-title">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="ae-icon-button" data-action="back" aria-label="${this.player ? 'Return to game' : 'Back to title'}">${marks.close}</button></header>${body}</div></section>`;
  }
  private renderPanel() {
    if (this.panel === 'title') {
      this.layer.innerHTML = `<section class="ae-title"><header class="ae-title-top"><span>${marks.compass} A world beyond the familiar</span><button class="ae-text-button" data-action="guide">${marks.book} Field guide</button></header><div class="ae-title-body"><h1>Aetheria<span aria-hidden="true">.</span></h1><p class="ae-title-subtitle">Leave the familiar behind.</p><p class="ae-title-copy">Find your footing in the wild. Shape a home.<br>Follow the light a little further.</p><button class="ae-primary ae-begin" data-action="worlds">Begin your journey ${marks.arrow}</button><span class="ae-title-note">A multiplayer survival sandbox</span></div><footer class="ae-title-footer"><span>Verdant lands. Cinder depths. Aether skies.</span><span>Yours to discover.</span></footer></section>`;
      return;
    }
    if (this.panel === 'worlds') {
      this.layer.innerHTML = this.frame('Your next horizon', 'Choose a world, or make a place of your own.', `<div class="ae-world-layout"><div class="ae-world-main"><div class="ae-section-heading"><h3>Worlds</h3><button class="ae-text-button" data-action="refresh">Refresh</button></div><div class="ae-world-list" aria-live="polite"></div><button class="ae-primary ae-full" data-action="create" ${this.listed ? '' : 'disabled'}>Create a new world ${marks.arrow}</button></div><aside class="ae-profile"><h3>Your explorer</h3><label>Explorer name<input id="ae-name" name="name" maxlength="24" autocomplete="nickname" value="${esc(this.name)}"></label><label class="ae-color-label">Trail color<input id="ae-color" type="color" value="${esc(this.color)}"></label><p>Your identity stays in this browser. Keep its site data to return as the same explorer.</p><label>Server address<input id="ae-address" value="${esc(this.address)}" spellcheck="false" placeholder="${esc(location.origin)}"></label><button class="ae-secondary ae-full" data-action="connect">Connect to server</button><p>Remote servers must permit this page’s origin.</p></aside></div>`, true);
      this.renderWorlds();
      return;
    }
    if (this.panel === 'create') {
      this.layer.innerHTML = this.frame('An unwritten world', 'One seed. An entirely new beginning.', `<form id="ae-create" class="ae-form"><label>World name<input name="worldName" maxlength="48" required placeholder="The quiet frontier" autofocus></label><label>World seed <span class="ae-muted">optional</span><input name="seed" maxlength="128" placeholder="Leave blank for a new seed" spellcheck="false"></label><div class="ae-form-row"><label>Mode<select name="mode"><option value="survival">Survival</option><option value="creative">Creative</option><option value="adventure">Adventure</option><option value="spectator">Spectator</option></select></label><label>Difficulty<select name="difficulty"><option value="0">Peaceful</option><option value="1">Easy</option><option value="2" selected>Normal</option><option value="3">Hard</option></select></label></div><p class="ae-help">Survival: gather and build. Creative: a free item catalog and flight. Adventure: explore without mining or placing. Spectator: observe without interacting.</p><div class="ae-form-actions"><button type="button" class="ae-secondary" data-action="world-list">Back to worlds</button><button class="ae-primary" type="submit">Create world ${marks.arrow}</button></div><p class="ae-form-status" role="status"></p></form>`);
      return;
    }
    if (this.panel === 'inventory' || this.panel === 'container') {
      const kind = this.machine?.value.kind;
      this.layer.innerHTML = this.frame(kind === 'forge' ? 'At the forge' : kind === 'chest' ? 'Stored for the journey' : kind === 'hopper' ? 'At the hopper' : kind === 'craft3' ? 'At the workbench' : 'Your field pack', kind === 'craft3' ? 'Workbench recipes consume ingredients directly from your pack.' : 'Travel light. Make something useful.', `<div class="ae-inventory-layout"><section class="ae-pack"><div class="ae-container-content"></div><div class="ae-section-heading"><h3>Inventory <span class="ae-muted">36 slots</span></h3><button class="ae-text-button" data-action="cancel-move">Clear selection</button></div><div class="ae-pack-grid" aria-label="Inventory"></div><p class="ae-help ae-move-hint" aria-live="polite"></p><div class="ae-equipment"></div><div class="ae-pack-actions"></div></section><section class="ae-crafting"><div class="ae-tabs"><button data-action="recipes" class="ae-tab ${this.recipeTab === 'recipes' ? 'is-active' : ''}" aria-pressed="${this.recipeTab === 'recipes'}">Recipes</button>${this.player?.mode === 'creative' ? `<button data-action="catalog" class="ae-tab ${this.recipeTab === 'creative' ? 'is-active' : ''}" aria-pressed="${this.recipeTab === 'creative'}">Creative catalog</button>` : ''}</div><label class="ae-search"><span class="ae-sr-only">Search items or ingredients</span><input id="ae-search" type="search" placeholder="Find an item or ingredient…" value="${esc(this.query)}"></label><div class="ae-recipe-list"></div></section></div>`, true);
      this.renderInventory();
      return;
    }
    if (this.panel === 'pause') {
      this.layer.innerHTML = this.frame('A moment on the trail', this.world?.name ?? 'Field journal', `<div class="ae-pause-layout"><nav class="ae-pause-nav" aria-label="Pause menu"><button class="ae-primary" data-action="resume">Return to the wild ${marks.arrow}</button><button class="ae-secondary" data-action="guide">${marks.book} Field guide</button><button class="ae-secondary" data-action="fullscreen">Toggle fullscreen</button><button class="ae-secondary" data-action="save">Save world</button><button class="ae-text-button" data-action="quit">Leave world</button><p class="ae-help">The world keeps moving while your journal is open. Manual saves require the world creator.</p></nav><section class="ae-settings"><h3>Make yourself comfortable</h3>${this.range('sensitivity', 'Look sensitivity', 0.2, 3, 0.1)}${this.range('fov', 'Field of view', 60, 100, 1)}${this.range('distance', 'View distance', 2, 6, 1)}${this.range('volume', 'Volume', 0, 1, 0.05)}<label class="ae-toggle"><span>Walking bob</span><input data-setting="bob" type="checkbox" ${this.settings.bob ? 'checked' : ''}></label><label class="ae-toggle"><span>Invert vertical look</span><input data-setting="invertY" type="checkbox" ${this.settings.invertY ? 'checked' : ''}></label><p class="ae-help">Settings are saved on this browser.</p></section></div><div class="ae-telemetry"></div>`, true);
      this.renderTelemetry();
      return;
    }
    if (this.panel === 'guide') {
      this.layer.innerHTML = this.frame('Notes from the field', 'A small companion for a very large world.', `<div class="ae-guide"><section><h3>Find your footing</h3><dl class="ae-controls"><div><dt><kbd>W A S D</kbd></dt><dd>Move</dd></div><div><dt><kbd>Mouse</kbd></dt><dd>Look around</dd></div><div><dt><kbd>Space</kbd></dt><dd>Jump / rise in flight</dd></div><div><dt><kbd>Shift</kbd></dt><dd>Crouch / descend in flight</dd></div><div><dt><kbd>Ctrl</kbd></dt><dd>Sprint</dd></div><div><dt><kbd>Left click</kbd></dt><dd>Hold to mine; attack a creature</dd></div><div><dt><kbd>Right click</kbd></dt><dd>Use a block or place the held block</dd></div><div><dt><kbd>1–9</kbd> / <kbd>Wheel</kbd></dt><dd>Select a hotbar slot</dd></div><div><dt><kbd>E</kbd> / <kbd>T</kbd> / <kbd>Esc</kbd></dt><dd>Inventory / chat / journal</dd></div></dl><p class="ae-help">Inside your pack, click a source then a destination. Right-click either slot to move half. Shift-click a pack slot to transfer it into an open container.</p></section><section class="ae-guide-notes"><h3>Your first shelter</h3><p>Gather logs and turn them into planks. Four planks make a workbench; place it nearby for larger recipes. Craft sticks and a wooden pick, then mine stone for cobble.</p><h3>Fire, metal, light</h3><p>Eight cobble make a forge. A wooden pick mines copper ore; smelt raw copper into ingots. A stone pick mines iron and gold; a copper pick mines sapphire. A sapphire pick mines radiant in Cinder. Shift-click raw ore into the forge, then coal or planks for fuel. Logs go to the input to make coal, not the fuel slot. Smelt cobble into stone for solar cores. Right-click with held food to eat when not using a block.</p><h3>Further than the treeline</h3><p>Craft a Cinder portal at a workbench from 4 cobble, 2 coal, 2 copper ingots and 1 gold ingot, all reachable in Verdant. Take a sapphire pick to mine radiant in Cinder, or defeat the Cinder Guardian near arrival for radiant. An Aether portal needs 4 cobble, 4 sapphire and 1 radiant. Right-click a placed portal, or stand inside it for a second, to travel. Use a portal in either other realm to return to Verdant.</p><h3>Seeds, shelter and sleep</h3><p>Break tallgrass for seeds. Right-click dirt or grass with a hoe, then right-click the farmland with seeds (wheat also works). Crops need water within 4 blocks at farmland height and daylight with open sky, or a nearby bright light. Young and middle crops grow into golden wheat; right-click mature wheat for 3 wheat and 1 seed, leaving a young crop planted. Use a bone on an immature crop to add 45 seconds of growth only when water and light requirements are met.</p><p>Craft a bed from 3 hide and 3 planks at a workbench. Right-click it in Verdant with safe space beside it to set spawn. At night, stay still with no hostile creature within 16 blocks; dawn arrives when the required share of living survival/adventure players sleeps. Right-click a door to toggle it. Doors occupy one block and use a fixed orientation.</p><h3>Circuits that do work</h3><p>Place a lever, connect face-adjacent wire blocks, then attach a lamp, door or hopper. Right-click the lever to toggle power. Only wire relays power; lamps, doors and hoppers are endpoints. Powered lamps emit light; power changes open or close doors. Solar cores are sources while time is before 0.55, the sky above is clear of opaque blocks, and weather is not stormy. They need no fuel. Traversal is limited to 512 source/wire nodes.</p><p>A powered hopper has 5 slots: it pushes one item to the container below, pulls one from above, and harvests one face-adjacent mature crop per circuit step if the harvest fits. A forge supplies only its output; incoming ore and fuel are routed automatically. Shift-click to deposit, click a container stack to withdraw. Unpowered hoppers remain manual storage.</p><h3>Guardians beyond Verdant</h3><p>The Cinder Guardian and Aether Crown wait near their realms’ arrival grounds. Both charge a radial strike for 1.2 seconds: leave the 4.5-block ring. At half health they switch to a 1-second rush windup: sidestep the marked direction before the 0.7-second rush. Terrain can stop a rush; markings show its maximum clear-ground path, not guaranteed hits. Use recovery windows for close-range attacks. Bows and radiant wands have no ranged firing mechanic.</p><h3>A few things worth knowing</h3><p>The forge routes fuel automatically. Trading requires a nearby trader. Enhancing a durable item needs a visible nearby workbench, one radiant, and 10 XP. Recipes show exact ingredient counts; the server checks reach and workbench access.</p><p>Armor stays in the normal inventory; there are no separate equipment slots. Death may drop your belongings, depending on the world’s keep-inventory rule. Beds are not available.</p><p>Type <kbd>/help</kbd> in chat for server commands. World-creator commands include <kbd>/save</kbd>, <kbd>/time day</kbd>, and <kbd>/mode creative</kbd>.</p></section></div><footer class="ae-guide-footer"><button class="ae-primary" data-action="guide-back">${this.player ? 'Back to journal' : 'Back to title'} ${marks.arrow}</button></footer>`, true);
      return;
    }
    if (this.panel === 'chat') {
      this.layer.innerHTML = this.frame('Voices on the trail', 'Say hello. Share a discovery.', `<div class="ae-chat-history" role="log" aria-live="polite" aria-label="Chat history"></div><form id="ae-chat" class="ae-chat-form"><label class="ae-sr-only" for="ae-chat-text">Message or command</label><input id="ae-chat-text" name="text" maxlength="256" autocomplete="off" placeholder="Message, or /help for commands" autofocus required><button class="ae-primary" type="submit">Send</button></form>`);
      this.renderChat();
      return;
    }
    if (this.panel === 'death') {
      this.layer.innerHTML = `<section class="ae-death ae-scrim"><div role="dialog" aria-modal="true" aria-labelledby="ae-death-title" class="ae-death-content"><span class="ae-death-mark">${marks.compass}</span><h2 id="ae-death-title">The trail goes quiet.</h2><p>Every journey has its stumbles.<br>A new beginning is waiting at your spawn.</p><button class="ae-primary" data-action="respawn" autofocus>Find your way back ${marks.arrow}</button><button class="ae-text-button" data-action="quit">Leave world</button></div></section>`;
      return;
    }
    if (this.panel === 'trade') {
      this.layer.innerHTML = this.frame('A fair exchange', 'Stay close to the trader to exchange supplies.', '<div class="ae-trades"></div>');
      this.renderTrades();
    }
  }

  private renderWorlds() {
    const create = this.root.querySelector<HTMLButtonElement>('[data-action="create"]');
    if (create) create.disabled = !this.listed;
    this.patch('.ae-world-list', !this.listed ? '<div class="ae-empty"><span class="ae-loading" aria-hidden="true"></span><h3>Looking for horizons…</h3><p>Connecting to the server. Use Connect to server to retry.</p></div>' : !this.worlds.length ? '<div class="ae-empty"><span class="ae-empty-mark">' + marks.compass + '</span><h3>No footprints yet.</h3><p>Create the first world on this server.</p></div>' : this.worlds.map((w, i) => `<button class="ae-world" data-world="${i}" data-focus="world-${i}"><span class="ae-world-symbol">${marks.compass}</span><span class="ae-world-description"><strong>${esc(w.name)}</strong><span>${esc(w.mode)} · ${['Peaceful', 'Easy', 'Normal', 'Hard'][w.difficulty] ?? 'Unknown'} · ${Math.floor(w.played / 60)} min explored</span><small>Seed ${esc(w.seed)}</small></span><span class="ae-world-join"><span>${w.players} online</span>${marks.arrow}</span></button>`).join(''));
  }
  private itemIcon(id: number) {
    const def = itemDef(id);
    if (def.block !== undefined) {
      const color = (BLOCKS[def.block]?.color ?? 0x8f8f96).toString(16).padStart(6, '0');
      return `<svg class="ae-item-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="m16 3 12 7v13l-12 7-12-7V10Z" fill="#${color}"/><path d="m4 10 12 7 12-7-12-7Z" fill="#fff" fill-opacity=".2"/><path d="M16 17v13l12-7V10Z" fill="#000" fill-opacity=".24"/><path d="m4 10 12 7 12-7M16 17v13" fill="none" stroke="#000" stroke-opacity=".15"/></svg>`;
    }
    const paths: Record<string, string> = {
      pick: '<path d="m9 27 12-21"/><path d="M9 10c8-8 15-5 18 2L17 8Z"/>',
      axe: '<path d="m8 27 13-22"/><path d="m15 8 8-3 5 8-8 4Z"/>',
      shovel: '<path d="m8 27 10-17"/><path d="m17 12 5-7 6 4-4 8-5 1Z"/>',
      sword: '<path d="m5 27 6-6m-3-3 6 6m-3-5L23 4l5-1-1 6-14 13"/>',
      hoe: '<path d="m8 27 11-21m-8 3 10-3 5 6"/>',
      bow: '<path d="M6 5c25-1 24 20 0 22L18 16Z"/><path d="M10 16h18m-3-3 3 3-3 3"/>',
    };
    const path = def.tool ? paths[def.tool] : def.armor ? '<path d="m10 5 6 3 6-3 7 7-5 5-3-3v14H11V14l-3 3-5-5Z"/>' : def.food ? '<path d="M16 9c-14-8-14 20 0 18 14 2 14-26 0-18Zm0 0c0-5 3-7 7-6"/>' : def.name.includes('ingot') ? '<path d="m4 20 5-11 16-3 4 12-7 7Z"/><path d="m4 20 17-4 8 2m-8-2 4-10"/>' : def.name === 'stick' ? '<path d="m7 27 18-22-3-2L4 24Z"/>' : '<path d="m16 3 10 8-3 14-7 5-9-8-2-12Z"/><path d="m16 3 1 13 9-5M5 10l12 6 6 9m-6-9-1 14"/>';
    const tone = def.name.includes('sapphire') ? '#84b8df' : def.name.includes('copper') ? '#d29a70' : def.name.includes('radiant') || def.rarity ? '#d4bce8' : def.food ? '#c8b16c' : '#c9c4b2';
    return `<svg class="ae-item-icon" viewBox="0 0 32 32" fill="none" stroke="${tone}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path ?? paths.pick}</svg>`;
  }
  private stackTip(stack: Stack) {
    const def = itemDef(stack.id);
    return `${label(def.name)} × ${stack.count}${def.durability ? `\nDurability ${stack.durability ?? def.durability} / ${def.durability}` : ''}${stack.enhancement ? `\nEnhancement +${stack.enhancement}` : ''}${def.food ? `\nRestores ${def.food} hunger` : ''}${def.armor ? `\nArmor rating ${def.armor} · carried in inventory` : ''}`;
  }
  private slot(stack: Stack | null, i: number, kind: 'pack' | 'hotbar' | 'container') {
    const def = stack ? itemDef(stack.id) : undefined;
    const tip = stack ? this.stackTip(stack) : `Empty slot ${i + 1}`;
    const active = kind === 'pack' ? this.source?.slot === i : kind === 'hotbar' && this.selection === i;
    return `<button class="ae-slot ${active ? 'is-selected' : ''}" ${kind === 'pack' ? `data-slot="${i}"` : kind === 'hotbar' ? `data-hotbar="${i}"` : `data-container-slot="${i}"`} data-focus="${kind}-${i}" aria-label="${esc(`${kind === 'hotbar' ? `Hotbar ${i + 1}: ` : ''}${tip}`)}" aria-pressed="${!!active}" data-tip="${esc(tip)}">${kind === 'hotbar' || kind === 'pack' && i < 9 ? `<small class="ae-slot-key">${i + 1}</small>` : ''}${stack ? this.itemIcon(stack.id) : ''}${stack && stack.count > 1 ? `<span class="ae-count">${stack.count}</span>` : ''}${stack && def?.durability ? `<progress class="ae-durability" max="${def.durability}" value="${stack.durability ?? def.durability}" aria-label="Durability"></progress>` : ''}${stack?.enhancement ? '<span class="ae-enhanced" aria-hidden="true"></span>' : ''}</button>`;
  }
  private renderHotbar() {
    if (!this.player) return;
    this.patch('.ae-hotbar', Array.from({ length: 9 }, (_, i) => this.slot(this.player!.inventory[i] ?? null, i, 'hotbar')).join(''));
    const held = this.player.inventory[this.selection];
    this.patch('.ae-held', held ? esc(label(itemDef(held.id).name)) : 'Empty hand');
  }
  private renderVitals() {
    if (!this.player) return;
    const p = this.player;
    const meter = (name: string, value: number, mark: string, cls: string) => `<div class="ae-vital ${cls}" title="${name}: ${Math.ceil(value)} / 20">${mark}<progress value="${clamp(value, 0, 20)}" max="20" aria-label="${name}"></progress><span>${Math.ceil(value)}</span></div>`;
    this.patch('.ae-vitals', p.mode === 'creative' || p.mode === 'spectator' ? `<span class="ae-mode">${esc(p.mode)} mode</span>` : meter('Health', p.hp, marks.heart, 'ae-health') + meter('Hunger', p.hunger, marks.food, 'ae-hunger') + meter('Air', p.air, marks.air, 'ae-air'));
    this.patch('.ae-xp', `<span>${Math.floor(p.xp)} XP</span><progress max="10" value="${clamp(p.xp, 0, 10)}" aria-label="Experience toward 10 XP enhancement cost"></progress>`);
  }
  private count(id: number) { return this.player?.inventory.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0) ?? 0; }
  private ingredients(recipe: Recipe) {
    const counts = new Map<number, number>();
    for (const entry of recipe.grid ?? recipe.loose ?? []) if (entry) { const id = itemNameToId(entry); counts.set(id, (counts.get(id) ?? 0) + 1); }
    return [...counts];
  }
  private renderInventory() {
    if (!this.player) return;
    if (this.player.mode !== 'creative') this.recipeTab = 'recipes';
    this.patch('.ae-pack-grid', Array.from({ length: 36 }, (_, i) => this.slot(this.player!.inventory[i] ?? null, i, 'pack')).join(''));
    const hint = this.source ? `Selected slot ${this.source.slot + 1}${this.source.split ? ' · half stack' : ''}. Choose a destination; right-click to split.` : 'Click source, then destination. Right-click to move half. Shift-click to transfer to an open container.';
    this.patch('.ae-move-hint', esc(hint));
    const armor = this.player.inventory.filter((s): s is Stack => !!s && !!itemDef(s.id).armor);
    this.patch('.ae-equipment', `<h3>Equipment <span class="ae-muted">carried automatically</span></h3><p>${armor.length ? armor.map(s => esc(itemDef(s.id).name)).join(' · ') : 'No armor carried.'}</p><small>No separate armor slots; keep equipment in your pack.</small>`);
    const held = this.player.inventory[this.source?.slot ?? this.selection];
    const enhance = held && itemDef(held.id).durability && (held.enhancement ?? 0) < 3 && this.player.xp >= 10 && this.count(28) >= 1;
    const repair = held ? repairCost(held) : undefined;
    const canRepair = repair && repair.restore > 0 && this.player.xp >= repair.xp && this.count(repair.material) >= repair.count && this.player.mode !== 'spectator';
    this.patch('.ae-pack-actions', `${repair ? `<button class="ae-secondary" data-action="repair" ${canRepair ? '' : 'disabled'}>Repair ${this.source ? 'selected' : 'held'} item</button><p class="ae-help">${repair.count} ${esc(itemDef(repair.material).name)} + ${repair.xp} XP · restores ${repair.restore} durability (up to 40% of maximum) · visible nearby workbench required, server checked</p>` : ''}<button class="ae-secondary" data-action="enhance" ${enhance ? '' : 'disabled'}>Enhance ${this.source ? 'selected' : 'held'} item</button><p class="ae-help">1 radiant + 10 XP · nearby workbench required · up to +3</p>${this.player.inventory[this.selection] && itemDef(this.player.inventory[this.selection]!.id).food ? '<button class="ae-text-button" data-action="eat">Eat held food</button>' : ''}`);
    const m = this.machine?.value;
    if (m?.kind === 'forge') {
      const recipe = m.slots[0] ? SMELT[itemDef(m.slots[0].id).name.replace(/ /g, '_')] : undefined;
      this.patch('.ae-container-content', `<h3>Forge <span class="ae-muted">${m.powered ? 'burning' : 'idle'}</span></h3><div class="ae-forge-slots">${['Input', 'Fuel', 'Output'].map((name, i) => `<div><span>${name}</span>${this.slot(m.slots[i] ?? null, i, 'container')}</div>`).join('')}</div><div class="ae-forge-progress"><progress max="${recipe?.time ?? 1}" value="${m.progress}" aria-label="Smelting progress"></progress><span>${Math.round(clamp(m.progress / (recipe?.time ?? 1), 0, 1) * 100)}% · ${Math.ceil(m.fuel)}s fuel</span></div><p class="ae-help">Shift-click a pack slot to deposit. Fuel is routed automatically; click a forge slot to take its contents.</p>`);
    } else if (m?.kind === 'chest' || m?.kind === 'hopper') {
      this.patch('.ae-container-content', `<h3>${m.kind === 'hopper' ? `Hopper · ${m.slots.length} slots · ${m.powered ? 'powered' : 'unpowered'}` : 'Chest'} <span class="ae-muted">click a stack to take it</span></h3><div class="ae-chest-grid">${m.slots.map((s, i) => this.slot(s, i, 'container')).join('')}</div>${m.kind === 'hopper' ? '<p class="ae-help">Shift-click a pack stack to deposit. When powered by a lever or solar core, pulls from above, pushes below, and harvests one face-adjacent mature crop per circuit step. Only forge output can be pulled.</p>' : ''}`);
    } else if (m?.kind === 'craft3') this.patch('.ae-container-content', '<p class="ae-workbench-note">Workbench open · choose a recipe. Ingredients stay in your pack.</p>');
    this.renderRecipes();
  }
  private renderRecipes() {
    const query = this.query.trim().toLowerCase();
    if (this.recipeTab === 'creative' && this.player?.mode === 'creative') {
      const items = catalog.filter(id => itemDef(id).name.includes(query));
      this.patch('.ae-recipe-list', `<p class="ae-help">Gives a full stack. Replaces your selected hotbar stack before adding the item to your pack.</p><div class="ae-catalog">${items.map(id => `<button data-creative="${id}" data-focus="creative-${id}" data-tip="${esc(itemDef(id).name)}" aria-label="Get ${esc(itemDef(id).name)}">${this.itemIcon(id)}<span>${esc(itemDef(id).name)}</span></button>`).join('')}</div>${items.length ? '' : '<p class="ae-empty">No matching items.</p>'}`);
      return;
    }
    const matches = RECIPES.map((recipe, index) => ({ recipe, index, ingredients: this.ingredients(recipe) })).filter(({ recipe, ingredients }) => [label(recipe.out), ...ingredients.map(([id]) => itemDef(id).name)].some(name => name.includes(query)));
    this.patch('.ae-recipe-list', matches.map(({ recipe, index, ingredients }) => {
      const can = ingredients.every(([id, n]) => this.count(id) >= n) && this.player?.mode !== 'spectator';
      return `<article class="ae-recipe"><div class="ae-recipe-top">${this.itemIcon(itemNameToId(recipe.out))}<div><h4>${esc(label(recipe.out))} <span>×${recipe.count}</span></h4><small>${recipe.needs3 ? 'Nearby workbench required · server checked' : 'Hand crafting'}</small></div><button class="ae-craft-button" data-recipe="${index}" data-focus="recipe-${index}" ${can ? '' : 'disabled'} aria-label="Craft ${esc(label(recipe.out))}">Craft</button></div><ul class="ae-ingredients">${ingredients.map(([id, n]) => `<li class="${this.count(id) >= n ? 'is-enough' : 'is-missing'}">${esc(itemDef(id).name)} <span>${this.count(id)}/${n}</span></li>`).join('')}</ul></article>`;
    }).join('') || '<div class="ae-empty"><h3>Nothing in these notes.</h3><p>Try an item name or an ingredient.</p></div>');
  }
  private renderTrades() {
    this.patch('.ae-trades', trades.map((offer, i) => `<article class="ae-trade"><div>${this.itemIcon(offer.out)}<h3>${offer.count} ${esc(itemDef(offer.out).name)}</h3></div><p>${offer.n} ${esc(itemDef(offer.cost).name)} <span class="ae-muted">· you have ${this.count(offer.cost)}</span></p><button class="ae-secondary" data-offer="${i}" data-focus="offer-${i}" ${this.count(offer.cost) < offer.n ? 'disabled' : ''}>Exchange</button></article>`).join(''));
  }
  private renderChat() {
    this.patch('.ae-chat-history', this.messages.map(m => `<p><strong>${esc(m.name)}</strong><span>${esc(m.text)}</span></p>`).join('') || '<p class="ae-muted">No voices yet. Start the conversation.</p>');
    const history = this.root.querySelector('.ae-chat-history');
    if (history) history.scrollTop = history.scrollHeight;
  }
  private range(key: keyof Settings, name: string, min: number, max: number, step: number) {
    return `<label class="ae-range"><span>${name}<output id="ae-value-${key}">${this.settingText(key)}</output></span><input data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${this.settings[key]}"></label>`;
  }
  private settingText(key: keyof Settings) {
    const value = this.settings[key];
    return key === 'volume' ? `${Math.round(Number(value) * 100)}%` : key === 'fov' ? `${value}°` : key === 'distance' ? `${value} chunks` : `${Number(value).toFixed(1)}×`;
  }
  private renderTelemetry() {
    if (!this.info || !this.player) return;
    const i = this.info, p = this.player;
    this.patch('.ae-telemetry', `<div><span>${Math.round(i.fps)} FPS</span><span>${Math.round(i.ping)} ms</span><span>${i.chunks} chunks</span><span>${i.entities} entities</span><span>${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}</span></div><p>On the trail: ${esc(i.players.join(', ') || this.name)}</p>`);
  }
  private profile() {
    const input = this.root.querySelector<HTMLInputElement>('#ae-name');
    const color = this.root.querySelector<HTMLInputElement>('#ae-color');
    this.name = input?.value.trim().slice(0, 24) || this.name;
    if (color && /^#[0-9a-f]{6}$/i.test(color.value)) this.color = color.value;
    this.persist('aetheria.profile', { token: this.token, name: this.name, color: this.color });
  }
  private connectServer() {
    this.profile();
    const input = this.root.querySelector<HTMLInputElement>('#ae-address');
    this.address = input?.value.trim() || this.address || location.origin;
    try {
      const url = new URL(this.address.includes('://') ? this.address : `${location.protocol}//${this.address}`);
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid address');
      url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
      if (url.pathname === '/') url.pathname = '/ws';
      url.hash = '';
      this.listed = false;
      this.renderWorlds();
      this.connect(url.toString());
    } catch { this.notice('Enter a valid HTTP or WebSocket server address, then connect again.'); }
  }
  private pickSlot(slot: number, split: boolean) {
    if (!this.player || this.player.mode === 'spectator') return;
    if (!this.source) {
      if (!this.player.inventory[slot]) return;
      this.source = { slot, split };
    } else if (this.source.slot === slot) this.source = null;
    else {
      this.action({ type: 'moveItem', from: this.source.slot, to: slot, split: split || this.source.split });
      this.source = null;
    }
    this.renderInventory();
  }
  private click(event: MouseEvent) {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    const d = button.dataset;
    if (d.hotbar !== undefined) { this.selected = Number(d.hotbar); this.action({ type: 'select', slot: this.selected }); return; }
    if (d.slot !== undefined) {
      if (event.shiftKey && this.machine && this.machine.value.kind !== 'craft3') { this.action({ type: 'transfer', slot: Number(d.slot), toContainer: true, container: this.machine.key }); this.source = null; }
      else this.pickSlot(Number(d.slot), false);
      return;
    }
    if (d.containerSlot !== undefined && this.machine) { this.action({ type: 'transfer', slot: Number(d.containerSlot), toContainer: false, container: this.machine.key }); return; }
    if (d.world !== undefined) { const world = this.worlds[Number(d.world)]; if (world) { this.profile(); this.send({ type: 'hello', token: this.token, name: this.name, color: this.color, world: world.id }); this.notice(`Entering ${world.name}…`); } return; }
    if (d.recipe !== undefined) { const recipe = RECIPES[Number(d.recipe)]; if (recipe) { this.action({ type: 'craft', recipe: recipe.out, count: 1 }); if (recipe.needs3) this.notice('Craft requested. Stay within reach of a visible workbench.'); } return; }
    if (d.creative !== undefined) { if (this.player?.mode === 'creative') this.action({ type: 'creative', item: Number(d.creative) }); return; }
    if (d.offer !== undefined) { this.action({ type: 'trade', offer: Number(d.offer), npc: this.npc }); return; }
    switch (d.action) {
      case 'worlds': this.open('worlds'); this.connectServer(); break;
      case 'world-list': this.open('worlds'); break;
      case 'refresh': this.connectServer(); break;
      case 'connect': this.connectServer(); break;
      case 'create': this.profile(); this.open('create'); break;
      case 'back': this.player ? this.close() : this.open('title'); break;
      case 'resume': this.close(); break;
      case 'guide': this.showGuide(); break;
      case 'guide-back': this.open(this.guideBack); break;
      case 'cancel-move': this.source = null; this.renderInventory(); break;
      case 'recipes': this.recipeTab = 'recipes'; this.renderPanel(); break;
      case 'catalog': this.recipeTab = 'creative'; this.renderPanel(); break;
      case 'enhance': this.action({ type: 'enhance', slot: this.source?.slot ?? this.selection }); break;
      case 'repair': this.action({ type: 'repair', slot: this.source?.slot ?? this.selection }); this.notice('Repair requested. Stay within reach of a visible workbench.'); break;
      case 'eat': this.action({ type: 'eat' }); break;
      case 'save': this.action({ type: 'chat', text: '/save' }); break;
      case 'fullscreen': {
        const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
        if (request) void request.catch(() => this.notice('Fullscreen is unavailable in this browser.'));
        else this.notice('Fullscreen is unavailable in this browser.');
        break;
      }
      case 'quit': location.reload(); break;
      case 'respawn': this.action({ type: 'respawn' }); break;
    }
  }
  private submit(event: SubmitEvent) {
    const form = event.target as HTMLFormElement;
    event.preventDefault();
    if (form.id === 'ae-create') {
      const data = new FormData(form);
      const name = String(data.get('worldName') ?? '').trim();
      if (!name) return;
      this.send({ type: 'create', token: this.token, name: name.slice(0, 48), seed: String(data.get('seed') ?? '').slice(0, 128), mode: String(data.get('mode')) as Mode, difficulty: Number(data.get('difficulty')) });
      this.patch('.ae-form-status', 'Creating your world… If the server reports an error, adjust the details and try again.');
    } else if (form.id === 'ae-chat') {
      const input = form.querySelector<HTMLInputElement>('input')!;
      const text = input.value.replace(/[\x00-\x1f]/g, '').trim();
      if (!text) return;
      this.action({ type: 'chat', text: text.slice(0, 256) });
      input.value = '';
      input.focus();
    }
  }
  private input(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.id === 'ae-search') { this.query = input.value; this.renderRecipes(); return; }
    if (input.id === 'ae-name' || input.id === 'ae-color') { this.profile(); return; }
    const key = input.dataset.setting as keyof Settings | undefined;
    if (!key) return;
    if (key === 'bob' || key === 'invertY') this.settings[key] = input.checked;
    else { this.settings[key] = clamp(Number(input.value), Number(input.min), Number(input.max)); const output = this.root.querySelector(`#ae-value-${key}`); if (output) output.textContent = this.settingText(key); }
    this.persist('aetheria.settings', this.settings);
  }
  private keydown(event: KeyboardEvent) {
    if (!this.isOpen) return;
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); if (this.panel === 'guide') this.open(this.guideBack); else if (this.player) this.close(); else if (this.panel !== 'title') this.open('title'); return; }
    if (event.key === 'Tab') {
      const elements = Array.from(this.layer.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, [tabindex="0"]')).filter(el => el.getClientRects().length > 0);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    const target = event.target as HTMLElement;
    if (event.key.toLowerCase() === 'e' && !target.matches('input, select, textarea') && (this.panel === 'inventory' || this.panel === 'container')) { event.preventDefault(); this.close(); return; }
    if (event.key === 'Enter' && event.altKey && target.dataset.slot !== undefined) { event.preventDefault(); this.pickSlot(Number(target.dataset.slot), true); }
    else if (event.key === 'Enter' && event.shiftKey && target.dataset.slot !== undefined && this.machine && this.machine.value.kind !== 'craft3') { event.preventDefault(); this.action({ type: 'transfer', slot: Number(target.dataset.slot), toContainer: true, container: this.machine.key }); this.source = null; }
    if (event.key.startsWith('Arrow') && target.classList.contains('ae-slot')) {
      const siblings = Array.from(target.parentElement!.querySelectorAll<HTMLButtonElement>('.ae-slot'));
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? 9 : -9;
      event.preventDefault();
      siblings[(siblings.indexOf(target as HTMLButtonElement) + delta + siblings.length) % siblings.length]?.focus();
    }
  }
}
