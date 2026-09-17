import type { Input } from '../shared/types';
import type { UI } from './ui';

export class Controls {
  yaw = 0;
  pitch = 0;
  seq = 0;
  left = false;
  private keys = new Set<string>();
  private events = new AbortController();

  constructor(private canvas: HTMLCanvasElement, private ui: UI, private active: () => boolean, private command: (code: string) => void, private changed: () => void, private interact: (button: number) => void, private unlockAudio: () => void) {
    const options = { signal: this.events.signal };
    window.addEventListener('keydown', event => {
      if (event.defaultPrevented || this.typing(event.target)) return;
      if (!this.active()) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        if (this.locked) document.exitPointerLock();
        else this.ui.togglePause();
        this.clear();
        return;
      }
      if (this.ui.isOpen) return;
      if (['KeyE', 'KeyT', 'Enter', 'KeyQ', 'KeyF', 'F3'].includes(event.code) || /^Digit[1-9]$/.test(event.code)) {
        event.preventDefault();
        if (!event.repeat) this.command(event.code);
        return;
      }
      if (!this.locked || !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'].includes(event.code)) return;
      event.preventDefault();
      if (!this.keys.has(event.code)) { this.keys.add(event.code); this.changed(); }
    }, options);
    window.addEventListener('keyup', event => { if (this.keys.delete(event.code)) this.changed(); }, options);
    document.addEventListener('mousemove', event => {
      if (!this.locked || this.ui.isOpen) return;
      const scale = 0.002 * this.ui.settings.sensitivity;
      this.yaw = ((this.yaw - event.movementX * scale + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch - event.movementY * scale * (this.ui.settings.invertY ? -1 : 1)));
    }, options);
    canvas.addEventListener('mousedown', event => {
      if (!this.active() || this.ui.isOpen) return;
      event.preventDefault();
      this.unlockAudio();
      if (!this.locked) { this.lock(); return; }
      if (event.button === 0) this.left = true;
      this.interact(event.button);
    }, options);
    window.addEventListener('mouseup', event => { if (event.button === 0) this.left = false; }, options);
    canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
    canvas.addEventListener('wheel', event => {
      if (!this.active() || this.ui.isOpen || !this.locked) return;
      event.preventDefault();
      this.command(event.deltaY > 0 ? 'NextSlot' : 'PreviousSlot');
    }, { ...options, passive: false });
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) { this.clear(); if (this.active() && !this.ui.isOpen) this.ui.togglePause(); }
    }, options);
    document.addEventListener('pointerlockerror', () => this.ui.notice('Mouse capture unavailable. Click the game to retry.'), options);
    window.addEventListener('blur', () => { this.clear(); if (this.active() && !this.ui.isOpen) this.ui.togglePause(); }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); }, options);
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  lock(): void {
    if (!this.active() || this.ui.isOpen || this.locked) return;
    this.unlockAudio();
    this.canvas.focus();
    try {
      const request = this.canvas.requestPointerLock();
      if (request) void request.catch(() => this.ui.notice('Click the game to capture the mouse.'));
    } catch { this.ui.notice('Mouse capture is unavailable in this browser.'); }
  }

  sample(): Input {
    const enabled = this.active() && !this.ui.isOpen && this.locked && !document.hidden;
    const held = (...codes: string[]) => enabled && codes.some(code => this.keys.has(code));
    return { forward: Number(held('KeyW')) - Number(held('KeyS')), strafe: Number(held('KeyD')) - Number(held('KeyA')), jump: held('Space'), sprint: held('ControlLeft', 'ControlRight'), crouch: held('ShiftLeft', 'ShiftRight'), yaw: this.yaw, pitch: this.pitch, seq: this.seq };
  }

  clear(): void { this.keys.clear(); this.left = false; this.changed(); }
  dispose(): void { this.events.abort(); this.clear(); }
  private typing(target: EventTarget | null) { return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select')); }
}
