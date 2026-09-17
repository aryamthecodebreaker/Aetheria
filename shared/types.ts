export type Realm = 'verdant' | 'cinder' | 'aether';
export type Mode = 'survival' | 'creative' | 'adventure' | 'spectator';
export type Vec3 = { x: number; y: number; z: number };
export type Stack = { id: number; count: number; durability?: number; enhancement?: number };
export type Inventory = (Stack | null)[];
export type Input = { forward: number; strafe: number; jump: boolean; sprint: boolean; crouch: boolean; yaw: number; pitch: number; seq: number };
export type Body = Vec3 & { vy: number; grounded: boolean };
export type Player = Body & { id: string; name: string; color: string; yaw: number; pitch: number; realm: Realm; mode: Mode; hp: number; hunger: number; air: number; xp: number; inventory: Inventory; selected: number; spawn: Vec3 & { realm: Realm }; achievements: string[]; deaths: number; mined: number; placed: number; seq: number };
export type Entity = Vec3 & { id: string; kind: string; realm: Realm; hp: number; maxHp: number; yaw: number; state: string; age: number; stack?: Stack; owner?: string; phase?: number; attackTimer?: number; home?: Vec3; aggro?: Vec3; aggroTime?: number };
export type Machine = { kind: string; slots: Inventory; progress: number; fuel: number; powered: boolean };
export type WorldMeta = { id: string; name: string; seed: string; mode: Mode; difficulty: number; created: number; played: number; players: number };
export type Rules = { pvp: boolean; keepInventory: boolean; daylight: boolean; mobSpawning: boolean; sleepPercent: number };
export type Action =
 | { type: 'select'; slot: number }
 | { type: 'mine' | 'place' | 'use'; x: number; y: number; z: number }
 | { type: 'attack'; id: string }
 | { type: 'craft'; recipe: string; count: number }
 | { type: 'moveItem'; from: number; to: number; split: boolean; container?: string }
 | { type: 'transfer'; slot: number; toContainer: boolean; container: string }
 | { type: 'creative'; item: number }
 | { type: 'trade'; offer: number; npc: string }
 | { type: 'enhance' | 'repair'; slot: number }
 | { type: 'eat' | 'respawn' | 'drop' | 'sleep' | 'closeContainer' }
 | { type: 'chat'; text: string };
export type ClientMessage =
 | { type: 'hello'; token: string; name: string; color: string; world: string }
 | { type: 'create'; token: string; name: string; seed: string; mode: Mode; difficulty: number }
 | { type: 'list' }
 | { type: 'input'; input: Input }
 | { type: 'chunks'; coords: [number, number][]; realm: Realm }
 | { type: 'action'; action: Action }
 | { type: 'ping'; time: number };
export type ServerMessage =
 | { type: 'worlds'; worlds: WorldMeta[] }
 | { type: 'created'; world: WorldMeta }
 | { type: 'welcome'; player: Player; world: WorldMeta; time: number; rules: Rules }
 | { type: 'snapshot'; players: Player[]; entities: Entity[]; time: number; weather: string; tick: number }
 | { type: 'chunk'; cx: number; cz: number; realm: Realm; data: number[] }
 | { type: 'block'; x: number; y: number; z: number; realm: Realm; id: number }
 | { type: 'inventory'; player: Player }
 | { type: 'container'; key: string; machine: Machine }
 | { type: 'chat'; name: string; text: string; time: number }
 | { type: 'notice' | 'error'; text: string }
 | { type: 'pong'; time: number };
