# Aetheria worklog

## 2026-09-17 — documentation and research pass

### Scope

Owned files only: `README.md`, `docs/research.md`, `docs/worklog.md`, `.env.example`, `.gitignore`. No application code, package configuration or saves were intentionally changed by this pass. No commit was requested or created.

### Completed documentation work

- Inspected package scripts, Vite configuration, shared registries/types/physics/world generation, client controls/UI/networking/worker renderer, and server lifecycle/actions/machines/entities/storage.
- Successfully fetched Three.js BufferGeometry, MDN Web Workers, the `ws` maintainer README and Node filesystem documentation. Recorded citations and short architectural tradeoffs in `research.md`; no Minecraft source material was used.
- Documented actual startup/build/development commands, `/ws` proxy, `PORT`/`SAVE_DIR`, controls, creator commands, bearer-token limitations and temporary-file/rename/backup persistence.
- Added only the two currently consumed application settings to `.env.example`. Documented that `npm run server` does not automatically read `.env`.
- Added ignore rules for dependencies, built output, local saves, logs, environment files and generated caches while preserving `.env.example`.

### Checks and evidence

| Check | Status for this pass |
| --- | --- |
| Primary-source fetches | Successful; URLs and scope recorded in `research.md` |
| Code-to-document comparison | Performed on the source snapshot read during this pass |
| `npm run typecheck` | Passed in this pass: `tsc --noEmit` exited successfully with no diagnostics; rerun after parallel changes settle |
| Lint | No lint script or configured lint command found in `package.json`; not run |
| `npm test` | Not run in this documentation pass; final integration owner must record its result |
| `npm run build` | Not run in this documentation pass; final integration owner must record its result |
| Browser/manual gameplay QA | Not performed by this pass |
| Performance/load testing | Not performed; no FPS, capacity or timing claims |

Existing tests were inspected for coverage intent, not assumed to pass. Pre-existing `dist/`, logs and saves are not evidence of a successful current build or playtest.

### Parallel implementation handoff

The gameplay agent is adding functional beds, door states, crop stages, hoppers, circuits and bosses. At the snapshot read for these docs, `server/actions.ts` still rejected sleep as unavailable, `server/machines.ts` stepped crops/forges, and `server/entities.ts` had basic mobs but no bosses. Those features are **pending integration and QA**, not certified complete by this documentation pass. After that agent returns, reread the changed server/shared/client paths and update the README's scope and controls to match actual behavior.

### Pending final QA — checklist, not results

- [ ] Run `npm run typecheck`, `npm test` and `npm run build` after parallel changes settle; record failures as well as successes. Confirm the lint command with the integration owner if one is introduced.
- [ ] Follow the documented production and two-terminal development flows; verify `/ws` through Vite rather than assuming a loaded title screen proves connectivity.
- [ ] Create/join/rejoin a world with separate browser profiles; verify visible movement and block edits between clients, creator privileges and reconnect behavior.
- [ ] Check mouse capture/release, keyboard controls, death/respawn, inventory split/transfer, crafting, smelting, food and realm transitions.
- [ ] Exercise every newly integrated bed/door/crop/hopper/circuit/boss interaction, including save/reload and multiplayer synchronization, before marking it working.
- [ ] Use a disposable save directory for restart and backup-recovery tests; do not damage user worlds to test recovery.
- [ ] Check chunk edges, negative coordinates, mesh updates/eviction, transparent surfaces and renderer behavior under extended travel.
- [ ] Test trusted LAN startup, firewall restrictions and browser secure-context behavior; do not treat plain HTTP LAN access as authenticated or Internet-ready hosting.
- [ ] Record any measured performance with hardware, browser, Node version, seed and settings. Do not turn configured limits into benchmark claims.

### Known scope gaps

This remains a prototype, not the complete ultimate-game request. Vehicles/rail, villager professions/schedules, raids, alchemy, dynamic fluid simulation, propagated voxel lighting and shaped crafting remain unbuilt as complete systems. Other registry entries or UI labels may precede functional mechanics. Public-server authentication, TLS termination, token lifecycle, stronger save/schema guarantees and deployment hardening also remain outside the current implementation.

### Final integration results

Pending the integration owner's final checks. Append actual commands, observed results and unresolved issues here; do not infer completion from this checklist.
