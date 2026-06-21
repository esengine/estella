# Physics Architecture — Audit & Rearchitecture

**Status (2026-06-21):** audit complete; **P1 DONE** (FixedUpdate determinism + render
interpolation); **P2 DONE** (unified reconciler — runtime collider/joint/enabled
mutability). Physics core = **Box2D 3.2.0** (the v3 rewrite) in a side wasm module
(`third_party/box2d`, C++ bindings `src/esengine/bindings/Physics*.cpp`), wrapped by the
TS SDK (`sdk/src/physics/*`).

## Verdict

**The engine choice is state-of-the-art (Box2D v3.2 = the SOTA 2D physics, a peer of
Rapier2D). The integration has modern foundations but three real gaps keep it below
top-tier (Bevy+rapier / Unity DOTS Physics).** No engine swap is warranted — the work is
in the integration layer.

### Already modern — do not churn

- v3 C-handle API (`b2WorldId`/`b2BodyId`/`b2ShapeId`/`b2JointId`); no v2 pointers.
- Buffered event model: `b2World_GetContactEvents` / `b2World_GetSensorEvents` — the v2
  `b2ContactListener` pattern is fully absent.
- Frame-based joint defs (`base.localFrameA/B`) for all five joints; v3 motion locks
  (not v2 `fixedRotation`); per-body `isBullet` continuous.
- Sub-stepping wired (`b2World_Step(dt, subStepCount)`, default 4 substeps).
- Native broadphase queries (`CastRay`/`OverlapShape`/`CastShape`/`OverlapAABB`) — no
  manual AABB walking.
- **Batched transform read-back** through a shared HEAP buffer
  `[u32 entity, f32 x, y, angle]` + a single `registry_batchSyncPhysicsTransforms`
  apply — the #1 thing wasm physics bridges get wrong, done right here.
- Data-only ECS components keyed by entity id (no wasm handles in components —
  Bevy/DOTS-correct); generation-safe handles (`b2*_IsValid`); clean lifecycle/teardown;
  `playModeOnly` gating; entity↔body via `b2Body_SetUserData`.

## The three gaps that matter (ranked)

1. **Determinism defect.** Physics steps in `Schedule.PostUpdate` on a *variable* wall-clock
   `time.delta`, not on the fixed-step schedule. There are two accumulators: a dead TS one
   (`app.ts:581-592` `FixedUpdate` — zero SDK registrations) and the live C++ one
   (`PhysicsModuleEntry.cpp:106-117`). Substep *count* per frame varies with framerate
   (144 Hz vs 60 Hz) → not frame/replay-deterministic.
2. **No render interpolation (the "looks naive" tell).** The C++ accumulator remainder is
   trapped; no prev+current pose, no lerp. Default physics 30 Hz vs a 60/144 Hz display →
   visible stutter.
3. **Colliders / joints / `RigidBody.enabled` are create-only.** Shapes are built once
   (`PhysicsSystem.ts:555`); editing a collider at runtime does nothing (no
   change-detection, no shape rebuild). Blocks the editor's live-edit story.

### Secondary gaps

- Ignores `b2World_GetBodyEvents` (moved-only read-back) — re-reads every dynamic body,
  including sleeping ones, each frame.
- No contact *hit* events (`enableHitEvents` / `hitEventThreshold` unused) — no impact speed.
- Chatty *writeback* (per-body `_physics_setBodyTransform` / `updateBodyProperties`); only
  the read-back is batched.
- Identity leaks: joints keyed by `entityB` (silent overwrite, `PhysicsJoints.cpp:35`);
  chain `b2ChainId` discarded (`PhysicsShapes.cpp:174`).
- World toggles hardcoded to `b2DefaultWorldDef()` (sleeping / continuous / restitution
  threshold / warm-starting / max linear speed not surfaced) — **overlaps the deferred
  physics project-settings work** (the settings UI needs these knobs to exist).
- Query `ppu` defaulted to 100 per-call instead of the live `Canvas.pixelsPerUnit`
  (silent wrong-scale footgun, `Physics.ts:145`).
- `enableContactEvents = true` on every shape; single-threaded (`workerCount` unused — fine
  for the wasm target today).

## Phased plan

- **P1 — FixedUpdate determinism + render interpolation (together).** Highest correctness +
  visible-quality win. SDK-only (no wasm rebuild). See below.
- **P2 — runtime collider/joint/`enabled` mutability (DONE).** A unified declarative
  reconciler replaces the ad-hoc imperative loop: Box2D is a reconciled cache of each
  entity's component structure, kept in sync with minimal *in-place* Box2D v3 ops that
  preserve simulation state — never destroy-and-rebuild the body. Two new C++ primitives:
  `physics_setBodyEnabled` (`b2Body_Enable/Disable` — toggles `RigidBody.enabled` keeping
  shapes/velocity/joints) and `physics_clearShapes` (`b2DestroyShape` over the body's
  shapes, so colliders rebuild in place with the body — and its velocity/pose/contacts —
  intact). The reconciler (`PhysicsSystem.ts`) drives them off uniform `isChangedSince`
  dirty checks across RigidBody + every collider (`colliderSignature`) + every joint
  (`jointChangedOrGone`): body create/destroy/enable-disable/props; shapes rebuilt on
  collider set/field change; joints destroyed+recreated on change/removal. **Build note:**
  the physics wasm was rebuilt with emscripten 5.0.6 — required dropping the now-removed
  `-sRELOCATABLE=1` flag (`cmake/Emscripten.cmake`; `-sSIDE_MODULE=2` already implies it).
  Chain colliders aren't runtime-rebuilt (their `b2ChainId` isn't tracked — static geometry).
- **P3 — `b2World_GetBodyEvents` + contact hit events + world-toggle config surface** (the
  config surface feeds the project-settings flow). Touches C++.
- **P4 — batched writeback + identity-leak fixes + query `ppu` from live Canvas.**

## P1 — design (SDK-only)

The engine already has a correct fixed-step accumulator (`app.ts:581-592`,
`fixedTimestep_ = 1/60`); after the fixed loop, `fixedAccumulator_` is the interpolation
remainder. P1 puts physics on that seam and interpolates the render pose — no C++ change.

1. **Expose the seam on `Time`.** Add `fixedDelta` (= `fixedTimestep_`) and `fixedAlpha`
   (= `fixedAccumulator_ / fixedTimestep_`, 0..1, set after the fixed loop) to the `Time`
   resource, plus an `app.getFixedTimestep()` getter.
2. **Align cadences.** The physics fixed timestep is set to the engine's
   (`getFixedTimestep()`) so one `FixedUpdate` tick = exactly one `b2World_Step`, and
   `fixedAlpha` is the true fraction within a single physics step.
3. **Step in `FixedUpdate`.** A step system (`Schedule.FixedUpdate`, `playModeOnly`)
   reconciles bodies, pushes pending writes, `_physics_step(fixedDelta)` (one C++ step),
   collects events, then captures pose snapshots: `prev = last cur`, `cur = read-back`.
4. **Interpolate in `PostUpdate`.** A sync system lerps `prev → cur` by `Time.fixedAlpha`
   (linear x/y, shortest-arc angle) into a buffer applied via the existing batched
   `registry_batchSyncPhysicsTransforms` (+ the parented-body path). New bodies seed
   `prev = cur` (no first-frame smear); teleports snap.

**Result:** framerate-independent substep count (deterministic) + smooth render at any
display rate. Lands the integration layer at "modern" to match the SOTA core.
