# Renderer 2D — boundaries and optional GPU backend

The Kingdom renderer is intentionally separate from the authoritative Worker simulation. It receives actor/world snapshots and advances only camera, interpolation, sprites, particles and presentation caches.

## Responsibilities

- `src/ui/game.js` is currently the **composition root** for the browser scene. It still contains too much code and must be reduced incrementally, preserving the current game and browser tests.
- `src/ui/render/water-layer.js` owns the water backdrop and foam/rock cache lifecycle. It takes its image and decoration painter as dependencies; it never reads the simulation directly.
- `src/ui/terrain-chunks.js` owns the chunk raster cache and its memory cap.
- `src/ui/actor-viewport-index.js` answers which moving actors may appear in the camera. It is scoped to a snapshot, not an authority on collisions or gameplay.
- `src/ui/kingdom-list.js` and `src/ui/inspectors/tactical-inspector.js` only format read-only information and have no direct DOM or command submission authority.

## Design constraints

1. The renderer may **read** snapshots but must never grant resources, move troops, approve plans, change morale or resolve warfare. It is an observer.
2. Keep the browser HUD in DOM for accessibility and readable text, and avoid calling DOM layout measurement for every actor.
3. A frame rate request changes only drawing cadence; it must not change the simulated day or AI order.
4. Cache invalidation should be explicit by seed/revision/camera/visual asset, and tests should verify when a redraw is necessary.
5. A faster-looking map does not prove a faster simulation; instrument RAF/frame CPU, draw p95, GPU work, Worker day phases, transport overhead and memory independently.
6. Any PixiJS/Phaser/WebGL migration requires a **parallel benchmark of equivalent scenes**, not an all-at-once rewrite. Reuse existing assets and event/snapshot formats.

## Visual acceptance

For water: compare static viewpoint, pan/zoom, texture load, different seasons and animation ticks, and render-reference mode in Chromium with image snapshots. For combat: verify projectile depth, soldier selection/hover, tactical formation/sprite overlay and controller input at 60/144 Hz.

Current automated tests cover cache invalidation and output contracts. Pixel-perfect visual parity on representative scenes remains a separate browser QA gate.
