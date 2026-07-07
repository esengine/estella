# Changelog

All notable changes to Estella are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [VERSIONING.md](VERSIONING.md) for what "the public API" means for an engine
like Estella (the SDK API, the editor project/asset formats, and the WASM ABI) and
what we treat as a breaking change.

Version numbers here track the **Estella release** — the engine + editor + SDK
shipped together, matching the Git tags and GitHub Releases. The `esengine` SDK npm
package carries its own version line; npm consumers should read the **SDK** notes in
each entry.

## [Unreleased]

## [0.16.0] - 2026-07-06

A renderer and UI release building on 0.15.0. It lands a modern typed-handle RHI
beneath the renderer, built-in 2D lit rendering with a shader effect library, and a
sharper, more tactile UI runtime (kinetic scrolling, scale-perfect text, virtualized
lists), alongside broad editor performance and workflow polish.

### Added

- **Built-in 2D lit rendering.** A `Sprite.lit` toggle lights any sprite through the
  Lit-2D channel using fragment-only shaders and ready-made material templates — no
  hand-authored lit material required.
- **Shader effect shelf.** A browsable library of effect templates, material-graph
  nodes, and an in-editor shader manual, with engine `time` and `screenUV` exposed to
  shaders (the `es` builtin prefix dropped) and a runnable effects gallery.
- **`createListView`.** An ergonomic virtualized list/grid widget with a UIMask-clipped
  viewport and an editor prefab; new **ui-list** example.
- **Kinetic UI scrolling.** Drag and touch scrolling with momentum and fling for scroll
  containers.
- **`Text.renderMode`.** Glyphs auto-route between a hinted bitmap path at their final
  pixel size and 4×-supersampled SDF when magnified, staying crisp at every scale.
- **Radial & unified fills.** Progress bars and sliders now share one `UIVisual.Filled`
  primitive, with radial gauges (360° / 180° / 90°) for cooldown rings and arc meters.
- **Editor quality-of-life.** Asset-reference fields locate their target in the Content
  Browser; a project paints its own thumbnail from the viewport on save; light gizmos
  show on/off state and are click-to-select; and a "Use less CPU in background" frame
  cap throttles the engine when the window is unfocused.

### Changed

- **Renderer RHI modernized.** The renderer moves to typed GPU resource handles with
  descriptor-based creation, a vertex layout folded into the pipeline object (VAOs
  become a GL-backend detail), render passes expressed as a single target+clear
  begin/end boundary, and the removal of loose render-state setters from the device
  interface. A pure internal refactor — no change to the documented SDK surface.

### Fixed

- **Lighting** — occluders no longer shadow their own interior (a caster can be lit),
  and Light2D collection is type-aware.
- **Editor** — submenu flyouts measure and clamp to the viewport, gizmos anchor at the
  entity's world position, text and panels are click-selectable with correct
  click-through cycling, and plain-path asset references resolve on incremental
  re-projection. Faster Play (stamped host build, idle prewarm, V8 code cache) and
  lighter idle CPU.
- **Assets** — sprite-animation clips play outside the editor by resolving on reference
  identity rather than a fetch URL.

### SDK

- `esengine` SDK **0.5.0**.

## [0.15.0] - 2026-07-05

The first feature release since the 0.14.0 licensing change — a large one. It adds a
full gameplay AI layer, a rebuilt World Outliner, a complete tilemap painter, a
first-class material system, a Sequencer, and much more, alongside deep internal
re-architecture of the editor, renderer, and asset pipelines.

### Added

- **Gameplay AI layer.** Grid navigation with A\* pathfinding (`NavGrid`, `NavAgent`,
  the `Nav` resource), a perception system (`Perceiver` / `PerceptionTarget` /
  `Perception`), and two decision paradigms over one shared action/condition
  registry — **state machines** (`.esfsm`) and **behavior trees** (`.esbt`) — each
  with a visual node-graph editor. New guide: **Gameplay AI**.
- **World Outliner** rebuilt to a UE-style `SSceneOutliner`: virtualized tree,
  path-based first-class folders, real hidden/locked state (decoupled from component
  enabled), reveal-on-select, keyboard navigation, token search, drag-to-reorder,
  and a pluggable column registry.
- **Tilemap painter** — stamp brush with flip/rotate and footprint preview, bucket &
  line tools on a unified stroke driver, terrain/autotile, per-tile polygon collision
  end-to-end, and a marquee select with copy / cut / paste / delete.
- **Material system** — reflection-driven std140 UBO materials, Material Instances, a
  Material Editor, static shader switches compiled to variants, 2D lighting (`Light2D`
  directional/point/spot with normal maps), and a visual **Material Graph**.
- **2D lighting & shadows** — `Light2D` on a dedicated Lit-2D channel plus
  `ShadowCaster2D` for soft, directional 2D shadows; per-sprite parallax scrolling.
- **Sequencer** — a UE-style timeline panel with a curve editor and auto-key
  recording, backed by a pure-TypeScript timeline runtime.
- **Animator** upgrades — nested (sub-)state machines, 1D blend states, exit-time
  transitions, and Spine-driven animation (not just sprites).
- **Input** — `defineInputMap` with named actions, gamepad support, data-driven
  `.inputmap` assets, a visual input-map editor, and interactive rebinding.
- **Physics** — a kinematic move-and-slide `CharacterController`, a Unity/UE-style
  collision-layer matrix in Project Settings, full world/solver config threaded from
  Project Settings, and contact/hit events.
- **Editor viewport** — UE-style gizmo handles, any-entity picking, multi-select,
  marquee, group transforms, nudge/snap, collider-shape overlays, and click-to-select
  UI elements via the engine hit-test.
- **Export targets** — playable-ad (single-file HTML), WeChat MiniGame
  (`exportWeChat`), and a desktop (Electron) target.
- **Subsystem observability** — a live **Engine Modules** panel reporting which
  subsystems are loaded and stepping across both the edit and play realms.

### Changed

- Large internal re-architecture across the **editor** (model-as-truth state, a
  versioned editor↔runtime protocol), the **renderer** (unified submission path,
  device-owned pipeline state, single-source `.esshader` shaders), **serialization**,
  and the **asset pipeline**. These touch engine internals, not the documented SDK
  surface.
- **UI runtime** modernized to fully SDF text (fill / outline / shadow), flex layout,
  and theme tokens; the legacy Canvas2D text renderer was removed.
- The **Apache-2.0 relicense** from 0.14.0 is carried into this release.

### Fixed

- Editor stability: a per-panel render error boundary, state-preserving hot reload,
  and more robust asset-reference resolution — plus numerous tilemap, outliner,
  physics, and export fixes.

### SDK

- `esengine` SDK **0.4.0** on npm.

## [0.14.0] - 2026-06-26

### Changed
- **License: relicensed to the Apache License, Version 2.0.** Estella is now free
  for any use, including commercial use. This reverts the noncommercial restriction
  introduced in v0.13.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), and
  [BUSINESS_MODEL.md](BUSINESS_MODEL.md).
- Every first-party source file now carries `SPDX-License-Identifier: Apache-2.0`.
- Contributing terms simplified to the standard Apache-2.0 **inbound = outbound**
  model; the previous Contributor License Agreement and commercial-relicensing grant
  are removed (see [CONTRIBUTING.md](CONTRIBUTING.md)).

### Added
- This `CHANGELOG.md` and a published versioning policy ([VERSIONING.md](VERSIONING.md))
  with an explicit Semantic Versioning commitment.
- A public business-model statement ([BUSINESS_MODEL.md](BUSINESS_MODEL.md)).

### Notes
- No code behavior changed in this release — it is a licensing/governance release.
- The bundled Spine Runtimes remain proprietary and are unaffected by this
  relicense; shipping a game that uses Estella's Spine integration still requires a
  Spine license from Esoteric Software (see [NOTICE](NOTICE)).

## [0.13.0] - 2026-06-22

### Changed
- Relicensed to the PolyForm Noncommercial License 1.0.0 (noncommercial use only,
  with a paid commercial license). **Superseded by 0.14.0** — this window is closed
  and Estella is permissively licensed again.

## Earlier history

Releases up to and including **v0.12.3** were published under the **MIT License**;
that grant remains valid for those snapshots. A detailed per-version changelog was
not kept before this file was introduced — see the Git history at
`github.com/esengine/estella` for the full commit-level record since the first
commit on 2026-01-25.

[Unreleased]: https://github.com/esengine/estella/compare/v0.16.0...HEAD
[0.16.0]: https://github.com/esengine/estella/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/esengine/estella/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/esengine/estella/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/esengine/estella/compare/v0.12.3...v0.13.0
