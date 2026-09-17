# Development and QA

## Local setup

Use Node.js 24, npm, and a desktop WebGL2 browser. From the repository root:

```sh
npm install
npm run build
npm run server
```

Open http://localhost:7777. The server serves `dist/`, accepts WebSocket upgrades at `/ws`, and exposes `/health` for basic liveness. A successful health response alone does not establish a working game connection. `npm run build` builds the frontend, not a standalone server binary; `npm run server` uses `tsx`, which is a development dependency.

For development, run `npm run server:watch` and `npm run dev` in separate terminals, then visit http://localhost:5173. Vite proxies `/ws` to `ws://localhost:7777`. Use the default frontend server address to exercise the proxy. If changing backend `PORT`, update the proxy target too. Server restarts require reconnecting and rejoining.

## Available scripts

These are the scripts in `package.json` at this inspection:

| Command | Implementation |
| --- | --- |
| `npm run dev` | `vite` |
| `npm run server` | `tsx server/main.ts` |
| `npm run server:watch` | `tsx watch server/main.ts` |
| `npm run build` | `vite build` |
| `npm test` | `vitest run` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `eslint . --max-warnings=0` |

## Configuration

### Frontend

`VITE_SERVER_URL` is a **build-time, public frontend setting**, not a secret or server runtime setting. Set it in Vite's environment or the frontend host's build configuration before running `npm run build`. Changing it requires rebuilding and redeploying the frontend.

Use the actual backend's HTTPS base address or WSS endpoint. With a root URL, the client chooses `/ws`; an explicit non-root path is preserved. HTTP/HTTPS addresses are converted to WS/WSS. Without a configured value, the client uses the page origin. The UI's server-address field can override the default for an explicit connection.

An HTTPS frontend cannot connect to insecure `ws:`. The client rejects mixed-content addresses, unsupported protocols, and embedded credentials. Connection errors and missing-world-list timeouts are surfaced in the UI; **Connect to server** explicitly retries. A loaded title screen is not proof that multiplayer is connected.

Source: `client/net.ts:9` (default address), `client/net.ts:13` (normalization and mixed-content checks), `client/net.ts:82` (world-list timeout).

### Backend

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `7777` | HTTP/WebSocket listening port |
| `SAVE_DIR` | `./saves` | World persistence directory, relative to process working directory |
| `ALLOWED_ORIGINS` | Empty | Additional comma-separated browser frontend origins |

The server launch script does not automatically load `.env`. Configure variables in the shell or hosting platform. For example, in PowerShell:

```powershell
$env:PORT = "7777"
$env:SAVE_DIR = "./saves"
$env:ALLOWED_ORIGINS = "https://aetheria-aryam.vercel.app"
npm run server
```

For persistent hosting, point `SAVE_DIR` at the host's persistent disk mount, not an ephemeral checkout. Run one server process per save directory.

The allowlist contains the **frontend origin**, not the backend URL or its `/ws` path. Use exactly `https://aetheria-aryam.vercel.app` for the current preview. Entries must be HTTP(S) origins without paths, trailing slashes, credentials, or wildcards; add other frontend origins explicitly, separated by commas. The implementation also allows browser requests whose origin host matches the request host and clients without an Origin header. This is an origin policy, **not authentication**.

Source: `server/origins.ts:9` (validation), `server/origins.ts:17` (policy). The server's upgrade handler applies the policy before accepting a socket.

## Hosting and the public preview

[Public frontend preview](https://aetheria-aryam.vercel.app)

As reported for **2026-09-17**, the deployment serves the frontend but has no connected multiplayer backend; `/ws` returns 404 there. It is not advertised as playable online. The preview status is supplied by the integration handoff, not a fresh deployment probe in this documentation pass.

To connect a separately hosted frontend:

1. Provision a persistent Node host with persistent disk and WebSocket upgrade support. Keep the dependencies needed by the `tsx` server launcher installed.
2. Set `SAVE_DIR`, `PORT`, and the exact frontend `ALLOWED_ORIGINS` on the backend.
3. Provide trusted HTTPS/WSS through the host or reverse proxy. The application has no built-in HTTPS listener. Route `/ws` upgrades to the Node process and preserve the intended request host.
4. Set frontend `VITE_SERVER_URL` to that **real** backend address and rebuild/redeploy. No public backend endpoint is supplied by this repository's current deployment status.
5. Check `/health`, then actually create/list/join a world from the deployed frontend and confirm `/ws` upgrades successfully. Verify two-player synchronization and persistence through a backend restart.

Static hosting and serverless functions do not replace the continuous simulation process or durable save disk. There has been no production load/capacity certification. Configured player/session limits are limits, not measured hosting capacity.

For trusted LAN use, serve the built frontend from the same Node host and port. Other devices must use that host's LAN address, not their own `localhost`. The server does not specify a loopback-only bind host. Restrict firewall access to the intended private network. Profile creation has a cryptographic-byte fallback when `randomUUID` is unavailable, covered by tests; real multi-device LAN/browser QA remains pending. Use TLS and suitable access control before public exposure.

## Identity and persistence

The browser stores a random bearer token under `aetheria.profile` in `localStorage`. The server hashes tokens with SHA-256 for profile lookup and creator privileges. Display names are not credentials. This is persistent local identity, not an account system with recovery or revocation. Clearing site data loses the browser's identity; changing origin or port uses different storage. Use separate browser profiles/contexts for separate players; duplicate connected profiles are rejected.

Source: `client/profile.ts:1`, `server/storage.ts:17`.

Each world is saved as `<world-id>.json`, with `.json.bak` retaining the previous rolling copy. Saved data includes seed, block-edit overlays, profiles, machines, entities, time, weather, rules, and boss-defeat state. Generated chunks are reconstructed from the seed.

Autosave runs every 30 seconds; the creator's `/save` command and graceful shutdown also save. Writes are serialized: write a temporary file, sync/close it, copy the old primary to the backup, then rename the temporary file into place. Startup tries the primary and then the backup; unrecoverable worlds fail to load rather than silently reset. This is not a transactional database or a guarantee against power loss.

Source: `server/storage.ts:25` (load/recovery), `server/storage.ts:56` (save queue).

Stop the process cleanly before taking an independent backup of the entire save directory. Keep backups outside the checkout. Never publish saves or storage exports, and add custom in-project save directories to local ignore rules. Test recovery only with disposable worlds.

## Automated verification

Run from the repository root:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm audit
```

Do not use a build alone as evidence for server behavior. Inspect each exit status; in shells that continue after failure, a later successful command does not make an earlier failure pass.

The **2026-09-17 15:25:48** documentation-pass rerun recorded **198 passing tests in 10 files**, after an earlier run passed 177 tests in 9 files. Lint and typecheck passed on the rerun. These are results for the source being exercised at those times, not permanent test counts. Concurrent integration work may add tests or change results. See [worklog](worklog.md) for check history and the initial lint failure.

### Coverage and its limits

| Area | Inspected evidence | Still not established |
| --- | --- | --- |
| Terrain and chunks | `tests/world.test.ts`; seeded realm generation, safe spawn, codec validation, bounded caching, edits surviving eviction | Extended travel across many seeds and real hardware performance |
| Inventory/crafting | `tests/inventory.test.ts`; splitting, merging, atomic costs/output, transfers/trades, portal recipe progression | Full gather-to-endgame progression in the browser |
| Physics | `tests/physics.test.ts`; collisions, slabs, crouch, jump edges, flight, swimming, ray/visibility logic | Complete device/input/latency matrix |
| Server authority and saves | `tests/server.test.ts`; reach/timing checks, armor, creator commands, ordered input, backup recovery, real WebSocket movement and restart/rejoin | Public-server authentication, long-running resilience, capacity |
| Networking/profile/origins | `tests/net.test.ts`, `tests/profile.test.ts`, `tests/origins.test.ts`; address validation, real local socket connection, timeouts, explicit retry, cryptographic identity/storage failures, exact origin policy and local upgrade responses | Successful separately deployed frontend/backend session; a local test using the preview's Origin header is not a live deployment test |
| Client/rendering | `client/game.test.ts`, `client/rendering/rendering.test.ts`; interaction/prediction and mesh/atlas/actor logic | Visual correctness on every GPU/browser, accessible mobile gameplay |
| Experimental mechanics | `tests/mechanics.test.ts`; circuit bounds, door occupancy, hopper conservation, crop stages, repair, safe beds, sleep threshold, boss telegraphs/rewards/save state | Full manual mechanics playthrough and multiplayer synchronization under realistic conditions |

Bosses, sleep, circuits, farming, doors, hoppers, and repair are now implemented paths with automated tests, not merely planned registry entries. They remain **experimental** until full gameplay QA covers them. Tests that directly prepare state are not evidence of a natural progression playthrough.

`npm audit` reported **2 moderate vulnerabilities** in the test dependency chain (`vitest` / `@vitest/mocker`). The suggested forced fix changes the Vitest major version. No dependency upgrade or forced audit fix was performed in this documentation-only pass.

## Browser smoke: reproduction and evidence

The existing `tools/browser-smoke.mjs` launches a real game server, a Vite WebSocket proxy, and headless Playwright Chromium using a temporary save directory. It drives the actual UI and observes protocol frames. It uses software WebGL rendering, so its render statistics are not hardware benchmarks.

```sh
npx playwright install chromium
node --import tsx tools/browser-smoke.mjs
```

The first command installs the browser if needed. Run the script from the repository root. It creates temporary state, overwrites `docs/images/title.png`, `docs/images/verdant.png`, and `docs/images/crafting.png`, and attempts to remove its temporary files on exit. On Windows, the script expects an `opencode` subdirectory under the OS temporary directory to exist. Inspect that prerequisite before running outside the development environment.

Because this documentation pass owns only Markdown files, it **did not rerun this screenshot-writing script**. The following observations were supplied by the integration handoff; the script and all three images were read directly to check what they demonstrate:

- UI world creation in survival mode using seed `aetheria` and rendered Verdant terrain.
- A second independent browser context joined the same world with a different player identity.
- Bidirectional chat reached both clients through real WebSocket messages.
- A fixture added two logs through the server API; clicking **Craft planks** sent the real action and produced four planks, leaving one log. This is not a mining check.
- Reload/rejoin retained explorer identity and the crafted inventory. The Node process remained running; this is not a browser proof of disk persistence through server restart.
- `ECONNRESET` errors were observed during teardown. These are not proven to be gameplay runtime faults, but the smoke may exit nonzero and must not be recorded as an unqualified clean pass.

The script records `steps`, `failingStep`, page/socket errors, `serverErrors`, and `cleanup` in its JSON output. Diagnose the stage that failed rather than treating a screenshot, completed gameplay steps, or `ok` before teardown as sufficient. Conversely, do not infer an in-session disconnect from cleanup errors alone. Source/health-response changes can also invalidate startup assertions: compare failures with the script revision actually run.

### Screenshot review

- `title.png`: the real title screen, including a local connection/loading notice; not proof the public frontend is connected.
- `verdant.png`: a snowy Tundra coast, ocean, crosshair, and hotbar in Verdant.
- `crafting.png`: the field pack, recipe requirements, and fixture-backed crafting output.

The README embeds these existing captures without fabricating assets or presenting them as production multiplayer evidence.

## Manual QA still needed

- [ ] Repeat both built-client and Vite-proxy startup flows; inspect the `/ws` handshake and world list.
- [ ] Run separate clients and verify visible movement, mining, placement, container changes, creator permissions, and explicit reconnect.
- [ ] Test mouse capture/release, focus/blur, keyboard controls, inventory splitting, smelting, eating, armor wear, death, and respawn.
- [ ] Complete progression from gathering materials through both portals, realm return positions, and boss encounters without injected inventory.
- [ ] Exercise beds, group sleep thresholds, occupied door closing, circuit breaks, solar conditions, hopper/forge transfers, crop light/water/fertilizer behavior, harvesters, and repair in two-player sessions.
- [ ] Repeat mechanics checks after graceful restart and backup recovery in a disposable save directory.
- [ ] Investigate smoke teardown `ECONNRESET` separately from gameplay errors; record command exit status and failure stage.
- [ ] Validate a real HTTPS frontend/WSS backend deployment with the exact origin allowlist and persistent disk.
- [ ] Check multiple browsers/devices, negative chunk coordinates, chunk boundaries, prolonged travel, mesh eviction, transparent surfaces, and measured performance.

## Known scope gaps

There is no complete player-fired projectile system, rail/vehicle simulation, dynamic fluid simulation, propagated voxel lighting, touch/mobile control scheme, shaped crafting grid, villager profession/schedule simulation, raids, or alchemy. Wisp telegraphed attacks and boss windups do not constitute a general projectile simulation. Approximate vertex shading and emissive block states do not constitute propagated lighting.

The simulation has fixed vertical bounds and basic creature AI. No infinite-height, production-scale, high-capacity, or full manual playthrough claim is made. Public authentication, token lifecycle, access control, stronger save/schema guarantees, and deployment hardening remain follow-up work.

## Contributing and reporting

Keep changes focused and add regression coverage for behavior changes. Record the commands actually run, their results, and manual reproduction separately. Issue reports should include seed, realm, mode, versions, and expected/actual behavior, with no tokens, private saves, or browser-storage exports.

`package.json` declares MIT; a standalone license text was absent at the documentation snapshot and is a maintainer follow-up. This pass does not invent copyright attribution or alter licensing files.
