# Aetheria

An original multiplayer voxel survival sandbox prototype built with Node.js 24, TypeScript, Vite, Three.js and `ws`. This is a playable foundation under active development, **not a complete “ultimate” game**. Implementation status below is based on source inspection; it is not a manual playtest certification.

## Run locally

Use Node.js 24 and npm. From `C:\Users\aryam\Downloads\minecraft`:

```powershell
npm install
npm run build
npm run server
```

Open http://localhost:7777. Keep the server terminal running. The server serves `dist/` and handles WebSockets at `/ws`; `/health` returns a basic liveness response. Rebuild after client changes. `npm run build` bundles the client, not a standalone server executable; the server runs TypeScript through `tsx`, so its development dependency must remain installed.

### Development

Start `npm run server` in one terminal and `npm run dev` in another. Open http://localhost:5173. Vite proxies `/ws` to `ws://localhost:7777` (`vite.config.ts:5`). Use the page's default server address so the connection goes through the proxy. `npm run server:watch` is available for server development; restarts disconnect players.

### Configuration

Only these application environment variables are currently read (`server/main.ts:163`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `7777` | HTTP and WebSocket listening port |
| `SAVE_DIR` | `saves` under the process working directory | World save directory; an absolute path avoids working-directory ambiguity |

`.env.example` is a reference, **not an automatically loaded configuration file**. The current server script does not load `.env`. Set variables in the launching shell, for example:

```powershell
$env:PORT = "7777"
$env:SAVE_DIR = "C:\Users\aryam\Downloads\minecraft\saves"
npm run server
```

If you change `PORT`, the Vite proxy target must also be changed to match. There is no application `HOST`, auth-secret or external API-key setting.

### Trusted LAN only

Run the built client and server on your own host, then open `http://<host-LAN-IP>:7777` on another device. Substitute that host's actual local address; `localhost` on a second device refers to the second device. The server does not specify a bind host, so do not assume it is loopback-only. If necessary, allow inbound TCP 7777 only on the trusted/private network in Windows Firewall; do not disable the firewall or forward the router port.

Load the client from the same host and port as the server. A server-address field is not a guarantee that arbitrary cross-origin connections are accepted. Browser secure-context requirements can also prevent profile creation with `crypto.randomUUID()` over plain HTTP at a LAN IP; use trusted HTTPS when needed rather than disabling browser security. LAN/browser behavior remains pending QA.

**Do not expose this server publicly without TLS, real authentication/access control and further hardening.** There is no built-in HTTPS listener, account recovery, token revocation or private-world authorization.

## Start playing

Choose a display name/color, connect to the server, and create or select a world. World creation offers a seed, survival/creative/adventure/spectator mode, and difficulty. A blank seed is replaced by a generated value. After joining, click the world to capture the mouse.

| Control | Action |
| --- | --- |
| Mouse | Look around while captured |
| W/A/S/D | Move |
| Space | Jump / swim up; double-press toggles creative flight |
| Ctrl | Sprint |
| Shift | Crouch; descend while flying |
| Hold left mouse | Mine; left-click an entity to attack |
| Right mouse | Contextual use/trade, eat held food, or place a held block |
| 1–9 / mouse wheel | Select hotbar slot |
| E | Inventory and recipe browser |
| T / Enter | Chat and commands |
| Q | Drop the entire held stack |
| F | Toggle HUD |
| F3 | Debug statistics |
| Esc | Release mouse / open or close the journal menu |

Controls: `client/input.ts:12`, `client/game.ts:444`, `shared/physics.ts:119`. Menus stop local input, not the multiplayer world simulation.

In the pack, click a source then a destination; right-click to split a stack. Shift-click a pack slot to deposit into an open chest/forge; click a container slot to withdraw. Crafting selects a recipe and consumes ingredients from the pack, with a nearby visible workbench required for designated recipes. It is not a shaped crafting-grid interface. Use the in-game recipe list for current ingredients and progression, including portal recipes. Enhancement requires a nearby workbench, radiant and XP. Contextual right-click takes precedence over eating; the pack also has an “Eat held food” action (`client/ui.ts:363`).

### Commands

Enter `/help` in chat. Other commands require the profile that created the world (`server/actions.ts:190`):

```text
/time day|night
/weather clear|rain|storm
/mode survival|creative|adventure|spectator
/give item count
/save
/tp x y z
/locate
/rules key value
```

`/mode` changes the caller's mode. `/give` resolves registry item names, with underscores for spaces; count must be 1–2304. `/tp` is limited to x/z within ±100000 and y from 1 up to, but not including, 80. `/locate` reports a nearby Verdant structure. Boolean rules are `pvp`, `keepInventory`, `daylight` and `mobSpawning`; `sleepPercent` accepts 0–100, but the existence of that setting alone does not establish a working bed system. PvP and keep-inventory default to false.

## Current scope

### Implemented source paths

- Seeded Verdant terrain with biomes, caves, ores, trees, settlements and ruins; Cinder caverns and Aether floating islands. Portal actions switch realms and retain return positions (`shared/worldgen.ts:11`, `server/actions.ts:119`).
- Streamed chunks, exposed-face worker meshing, procedural texture atlas, separate solid/liquid geometry, approximate vertex shading, day/night sky, weather visuals, particles and synthesized audio (`client/rendering/world.ts:118`, `client/rendering/mesher.ts:14`, `client/game.ts:20`).
- Server-owned movement/collision and action validation, local movement prediction/correction, multiplayer snapshots, chat and reconnect-to-world-selection behavior (`server/main.ts:85`, `client/net.ts:58`).
- Mining/placement, inventory transactions, recipe-based crafting, forge smelting, crop timers, chests, food/hunger/air/health, death/respawn, basic mobs, fixed trader offers and tool enhancement (`server/actions.ts:70`, `server/machines.ts:7`, `server/entities.ts:27`).
- Local world/profile persistence and a rolling backup (`server/storage.ts:25`).

These are implementation observations, not a claim that all interactions have passed end-to-end QA. Configured limits such as eight players per world are not measured capacity guarantees.

### In progress or not implemented

Beds, functional door states, visible crop stages, hopper transfer, circuits and bosses are being developed in parallel. At this documentation inspection, the server still returned an unavailable notice for sleep; machine stepping handled crops and forges, and the mob definitions did not include bosses. Treat these additions as **pending integration and QA**, not completed features. Recheck the source and worklog after the gameplay agent returns.

The larger requested scope remains incomplete: vehicles, rail systems, villager professions and schedules, raids, alchemy, dynamic fluid simulation, true propagated voxel lighting, and shaped crafting are not implemented as complete systems. A registry item, a generated settlement, an equipment label or a rule setting does not imply its full gameplay system exists. AI is basic, not a general navigation/simulation system; this is not an infinite-height or production-scale world.

## Identity and saves

The browser keeps a random bearer token in `localStorage` under `aetheria.profile`; the server stores SHA-256 token hashes for profile lookup and creator privileges (`client/ui.ts:58`, `server/storage.ts:17`). This is local persistent identity, **not full authentication**. Possession of a token grants that profile's access; names are not credentials. Do not share tokens or browser-storage exports. Clearing site data loses the browser's profile identity; changing origin/port uses different local storage. Separate browser profiles can be used for separate players; a duplicate connected profile is rejected.

Each world is saved as `<world-id>.json`, with `.json.bak` as the previous rolling copy. Saves include the seed, block-edit overlays, profiles, machines, entities, time, weather and rules. Generated chunks are rebuilt from the seed. Autosave runs every 30 seconds; `/save` and graceful server shutdown also save (`shared/constants.ts:5`, `server/main.ts:151`).

Writes are serialized: write `.json.tmp`, sync and close it, copy the previous primary to `.bak`, then rename the temporary file over the primary. Startup tries the primary, then the backup; an unrecoverable world stops loading rather than silently generating a replacement. This is not a transactional database or a guarantee against power loss. Run only one server process per save directory. Stop it cleanly before taking an independent directory backup; keep backups outside this checkout. Custom save directories inside the project must be added to your local ignore rules. Never publish saves as assets.

## Development checks

```powershell
npm run typecheck
npm test
npm run build
```

`npm test` runs Vitest. Existing suites cover world generation/RLE, physics, inventory, server/storage and WebSocket integration, plus client/rendering logic. Test existence is not evidence of a passing run. No lint script is configured in `package.json`; do not substitute a made-up command. See [worklog](docs/worklog.md) for checks actually performed and pending manual QA.

## Layout and research

- `shared/`: registries, recipes, types, seeded generation, physics and chunk codec.
- `server/`: HTTP/WebSocket lifecycle, authoritative actions, entities, machines and file persistence.
- `client/`: input, UI, networking, game presentation and worker renderer.
- `tests/`: automated core and integration tests.
- [Research and architectural tradeoffs](docs/research.md): successful primary documentation fetches, not Minecraft source material.
