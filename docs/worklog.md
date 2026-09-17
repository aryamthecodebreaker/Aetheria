# Aetheria worklog

## 2026-09-17 — public README and development evidence

### Scope

Owned Markdown files: `README.md`, `docs/development.md`, and `docs/worklog.md`. No application source, tests, dependencies, configuration, screenshots, or license files were edited by this pass. The build command regenerated frontend output in `dist/`. Concurrent application changes were left to their owners. No commit was created.

### Documentation completed

- Rewrote the README around **Aetheria — Explore. Build. Survive. Cross worlds.**, with a concise introduction, local quick start, controls, development scripts, configuration, contribution guidance, and an evidence-based roadmap.
- Inspected `docs/images/title.png`, `verdant.png`, and `crafting.png` with the image Read tool before embedding them. They show the actual local title screen, a snowy Verdant shoreline, and the field pack/recipe UI.
- Explicitly labeled the public deployment as a **frontend preview**, not playable online. The integration handoff reports no connected multiplayer backend and `/ws` returning 404 there; this pass did not independently probe the deployment.
- Added detailed development notes for build-time `VITE_SERVER_URL`, HTTPS/WSS, exact frontend `ALLOWED_ORIGINS`, persistent Node/disk hosting, saves/identity, browser-smoke reproduction, and remaining manual QA.
- Removed machine-specific filesystem paths from these documents. Did not invent a backend endpoint, copyright attribution, or license text.

### Source and test inspection

Read current package scripts, Vite configuration, frontend networking and input, game interactions, server lifecycle/actions/storage, machine stepping, shared world generation, mechanics and WebSocket tests, and the browser-smoke script. Revisited server origin configuration as concurrent integration work landed, and inspected `tests/origins.test.ts` after it appeared.

The former docs' claims that lint was absent and beds/circuits/bosses were unimplemented were stale. The current package has an ESLint script. Sleep, doors, circuits, hoppers, farming, workbench repair, and boss behavior have implementation paths and automated coverage; they remain experimental pending full manual gameplay QA.

### Commands actually run

All times below are local runner times on **2026-09-17**. Commands were run from the repository root; each command's output was inspected separately even when the shell continued to the next command.

| Check | Recorded outcome |
| --- | --- |
| Initial `npm run typecheck` | Passed, no diagnostics |
| Initial `npm run lint` | Failed with two unused-symbol errors in `server/main.ts`: `isOriginAllowed` and `origins`, while concurrent origin-policy edits were in progress |
| Initial `npm test`, started 15:21:59 | **177 passed across 9 files**, Vitest 3.2.7 |
| `npm run build` | Passed, Vite 7.3.6; generated frontend output |
| `npm audit` | Nonzero: **2 moderate vulnerabilities** in `vitest` / `@vitest/mocker`; no forced upgrade performed |
| Rerun `npm run lint` | Passed after the concurrent server integration progressed; this documentation pass did not change application code |
| Rerun `npm run typecheck` | Passed, no diagnostics |
| Rerun `npm test`, started 15:25:48 | **198 passed across 10 files**, including 21 newly added origin-policy/upgrade tests |
| Browser smoke | Not rerun by this pass because it overwrites screenshots outside Markdown ownership |
| Manual full playthrough / live deployment test / load benchmark | Not performed by this pass |

The latest observed lint, typecheck, and test runs pass; there is no remaining failing assertion from those runs to fix. Counts are dated observations of a changing checkout, not permanent totals or guarantees for future revisions. The build result is from the earlier run, not a claim that every later concurrent source edit was rebuilt.

The origin tests exercise isolated local WebSocket servers with the preview's Origin header, allowed/denied origins, wrong paths, capacity responses, and health metadata. They do not demonstrate a publicly reachable backend or a deployed browser session.

### Browser-smoke evidence supplied by integration

The handoff reported the following local browser observations; this pass inspected the script and images but did not claim to have executed that session:

1. Created a survival world through the UI using seed `aetheria`; received real chunks/snapshots and rendered terrain.
2. Joined with a second independent browser context and distinct player identity.
3. Exchanged chat in both directions through the UI and actual WebSocket messages.
4. Added two logs through a server-side fixture, then crafted four planks through the real recipe UI, retaining one log. This is crafting evidence, not a mining/gathering check.
5. Reloaded and rejoined with the same identity and crafted inventory. The server remained running; disk persistence across server restart is separately covered by integration tests.
6. Observed `ECONNRESET` during teardown. A nonzero smoke exit must be recorded, but this does not establish a gameplay runtime fault. (Superseded: the rerun below exits 0 and classifies this as an expected teardown artifact.)

Reproduce with:

```sh
npx playwright install chromium
node --import tsx tools/browser-smoke.mjs
```

The script writes screenshots and temporary state. See [development](development.md#browser-smoke-reproduction-and-evidence) for prerequisites, cleanup behavior, fixture limits, and failure-stage interpretation. The script's startup health assertion and server health metadata were also changing during integration; compare the actual revisions before diagnosing a new run.

### Browser smoke rerun against the settled source

Executed on **2026-09-17** (18:38–18:39 local runner time) from the repository root with `node --import tsx tools/browser-smoke.mjs`, after lint, typecheck, the 198-test suite, and a fresh `vite build` all passed in the same session. All nine stages passed and the script exited **0**:

1. Started the real game server behind the Vite proxy; health and world-list stages passed.
2. Created a survival world via the UI with seed `aetheria`; a second independent browser context joined.
3. Bidirectional chat flowed through the UI over the actual WebSocket (2 chat messages each direction).
4. Real movement: holding `W` for 1.2 s displaced the player server-side from z −0.50 to z −5.60.
5. Fixture-backed crafting: two logs added via server API, real `craft planks` action through the UI yielded 4 planks + 1 log, retained across a page reload and rejoin with the same player ID.
6. Error audit clean: zero page errors, protocol errors, websocket errors, console errors, or HTTP errors on both clients; zero server errors. The only noise was 2 Vite ws-proxy `ECONNRESET` messages during forced teardown, which the script itself classifies as expected (`teardownProxyNote`).
7. Screenshots regenerated: `docs/images/title.png`, `verdant.png`, `crafting.png` (1280×720, no context loss). These overwrote the previous screenshots, consistent with the script's documented behavior.

This closes the first "Remaining work" item below; the remaining items stand.

### Remaining work

- ~~Repeat browser smoke against the settled source~~ Done: rerun on 2026-09-17 passed all stages with exit 0; see "Browser smoke rerun" above.
- Manually verify two-client movement and block/container synchronization, full inventory/smelting/survival flow, and progression through both portals without injected materials.
- Playtest bosses, group sleep, door occupancy, circuits, hoppers, farming/harvesters, and repair through save/restart and multiplayer sessions.
- Provision and validate a persistent HTTPS/WSS backend before describing the public preview as playable. Configure the exact frontend origin and persistent save disk.
- Investigate and update the moderate test-dependency advisories without assuming a forced major upgrade is safe.
- Add the standalone MIT license text through the repository maintainer. `package.json` declares MIT, but no `LICENSE` file was present at this inspection; no attribution was invented here.
- Continue work on missing complete systems: player-fired projectiles, vehicles/rail, dynamic fluids, propagated voxel light, mobile/touch gameplay, shaped crafting, villager professions/schedules, raids, and alchemy.

## Earlier 2026-09-17 — research/documentation pass

The previous worklog recorded a research pass covering Three.js BufferGeometry, MDN Web Workers, the `ws` maintainer README, and Node filesystem documentation, with references in [research](research.md). It recorded a passing typecheck but no test/build/browser run. Its source snapshot preceded the current mechanics and origin-policy integration.

That earlier pass also reported work on `.env.example` and `.gitignore`; those files were not edited by this pass. Historical statements about absent lint or unimplemented sleep/circuits/bosses are superseded by the current inspection and results above, rather than treated as current project status.
