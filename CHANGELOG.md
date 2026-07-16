# Changelog

All notable changes to Estella are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [VERSIONING.md](VERSIONING.md) for what "the public API" means for an engine
like Estella (the SDK API, the editor project/asset formats, and the WASM ABI) and
what we treat as a breaking change.

Version numbers here track the **Estella release** — the engine + editor + SDK
shipped together, matching the Git tags and GitHub Releases. The SDK is not
published separately; it ships inside the editor.

## [Unreleased]

## [0.24.0] - 2026-07-15

Video comes to Estella. A declarative Video component plays a stream on any
renderable — a sprite, a UI element, or a 2D mesh — uploaded straight to the
GPU with no CPU copy on WebGL2; and on WeChat, where the platform's own decoder
is absent on PC and unreliable on phones, the engine ships its own wasm MPEG-1
decoder so every device plays the same frames. The design resolution graduates
from a UI-Canvas detail to a project-level truth: gameplay can letterbox to a
reference resolution with no dummy Canvas, the device preview works on any
scene, and screen orientation is one project-wide setting that ships correctly
to web, desktop, playable, and WeChat alike. Under the hood, WeChat becomes the
first member of a mini-game platform family described as data, and the editor
opens and re-Plays noticeably faster.

### Added

- **Video playback.** A declarative `Video` component streams onto whichever
  renderable an entity has — `Sprite`, `UIVisual` (video in menus and loading
  screens), or `Mesh2D` — driving a live texture that updates every frame. On
  the web/desktop backend it plays through an `HTMLVideoElement` (any format the
  runtime decodes) and, on WebGL2, uploads each frame GPU→GPU with
  `texImage2D(video)` — no CPU readback; WebGPU keeps a correct readback
  fallback behind the same pump. The subsystem mirrors the audio architecture
  end to end — a `PlatformVideoBackend` chosen by the platform adapter, a
  `VideoPlayer` resource, a `VideoPlugin` — and both backends are pixel-verified
  headless on WebGL2 and WebGPU.
- **Video on WeChat, engine-owned.** `wx.createVideoDecoder` is absent on the PC
  client and unreliable on phones, so the WeChat video path is deterministic
  instead: a ~61 KB `videodec` wasm side module (pl_mpeg, MIT) decodes MPEG-1
  behind the same texture pump on every device class — phone, PC, devtools,
  headless. The cook transcodes each authored video into an MPEG-1 `.esv` plus
  an AAC `.esv.m4a` audio track that becomes the playback **clock** (the video
  decodes toward the track's playhead; loop-wraps and seeks exact-seek), shelling
  out to a bundled ffmpeg at cook time. Cook quality and audio bitrate are
  per-asset Import Settings.
- **Opt-in project camera fit.** A gameplay scene can now letterbox to a
  reference resolution without a dummy UI `Canvas`: a `ScreenScaling` resource
  (design width/height, scale mode, match axis) fits the main camera whenever a
  scale mode is set, while UI layout keeps scaling independently off its own
  Canvas. Off by default — an unconfigured game renders unchanged — and honored
  by every runtime: the editor Play realm, web, desktop, playable, and WeChat.
- **Device preview on any scene.** The design frame, letterbox, and safe-area
  overlay were a UI-layer feature that needed a `Canvas`; they now read the
  project design resolution and show in any editor mode once a device is picked,
  so a pure gameplay scene gets the same framing preview and quick device menu.
- **Faster editor open, with a loading screen.** Opening a project shows a
  loading screen while the Play-realm engine prewarms in the background, so the
  first click-to-Play is quick; re-Play keeps that realm engine alive across Stop
  for a warm restart; and the asset registry is now cache-first with a
  parallelized disk scan (~3.5× on a large project), so scanning no longer gates
  boot.

### Changed

- **One screen orientation, project-wide.** Orientation was a per-platform
  packaging field that only WeChat consumed (web/desktop had none; the playable's
  was an orphaned no-op). It collapses to a single `packaging.orientation`,
  defaulted from the design resolution's aspect so a landscape design ships
  landscape everywhere with zero config, and consumed by every target — WeChat
  `deviceOrientation`, a rotate-to-fit overlay on web and playable, and the
  Electron window size on desktop. Legacy per-platform fields migrate forward
  automatically on open, and Project Settings replaces the two old controls with
  one.
- **WeChat is now a mini-game platform family.** The WeChat integration is
  refactored into a normalized mini-game platform — a host-global surface, a data
  `MiniGameProfile`, and one adapter — with the shared filesystem/fetch/image/
  input/storage/canvas logic written once; WeChat becomes a profile that binds
  `wx`. The export pipeline likewise splits into a vendor-neutral `exportMiniGame`
  plus a WeChat profile. WeChat output is byte-identical and the public `wx*`
  helpers stay as thin back-compat wrappers — groundwork for additional mini-game
  vendors, with no behavior change today.

### Fixed

- **One bad value no longer bricks a scene.** Scene load now salvages invalid
  fields — an out-of-range or wrong-typed value is coerced or dropped with a
  diagnostic instead of failing the whole scene — and the MCP `set_field` door
  coerces and validates on the way in, so automation can't write a value that a
  later open chokes on.
- **A failed New Project says so.** Project creation that errors now surfaces a
  toast instead of leaving the dialog stuck on "Creating…".
- **WeChat real-device hardening.** The export bundle and emscripten glue
  down-level to ES2017 for the on-device JS engine, the replication codec creates
  its `TextEncoder`/`TextDecoder` lazily, and the `performance` polyfill is
  stabilized — the fixes that carried the video path from black frames to first
  live playback on a physical device.
- **Packaged editors ship the SDK types.** The desktop build now bundles the SDK
  `.d.ts`, so a packaged editor can stage a project's `esengine` types for the
  IDE even when the unpacked SDK copy isn't present.

## [0.23.0] - 2026-07-14

The editor opens its doors to AI agents, and the asset registry comes alive.
This release ships a built-in MCP server — any MCP-capable AI tool can connect
to the running editor and build a game through the same doors the UI uses:
create projects, edit scenes and components, import assets, read validation,
drive Play, and export. And the asset pipeline stops being a snapshot: files
dropped into a project register on sight, a texture assigned anywhere lights
up without reopening the project, and every failure that used to be a silent
white box is now a hard error or a queryable diagnostic.

### Added

- **MCP server, built in.** The editor ships an MCP (Model Context Protocol)
  server: launch with `--mcp` (or spawn the bundled `editor-mcp` entry from an
  installed app) and any MCP-capable AI tool gets 47 tools that operate the
  live editor — project create/open, scene and entity editing, component
  add/remove and field writes (undoable, through the same command path as the
  UI), asset import/create, viewport capture and window screenshots, Play
  control, log reading, and game export. The Windows quirk is solved for
  good: the protocol lives in a plain-node front (Electron main never
  receives piped stdin on Windows), talking to the editor over an
  authenticated loopback channel.
- **Eyes and hands inside the running game.** `play_probe` evaluates code in
  the isolated Play realm — read gameplay state via `window.__estellaPlay`,
  or inject input events to drive the game — so automation can verify actual
  gameplay, not just the edit-mode scene.
- **Queryable scene validation.** `getDiagnostics()` on the editor surface
  (and the `get_diagnostics` MCP tool) returns exactly what the Details panel
  flags — required fields left empty, inert-component notices, and now
  **unresolvable asset references** (a ref that names no registered asset, or
  whose load failed). An empty list is a machine-checkable "scene is clean".
- **Public FSM/BT loaders.** `Assets.loadStateMachine` / `loadBehaviorTree`
  load `.esfsm` / `.esbt` definitions into the AI store on demand, and
  `Assets.pathForHandle` resolves a live handle back to the asset it came
  from (the reverse of ref resolution).

### Changed

- **Assets register on sight.** The project scan now adopts orphans: any
  known-type content file without a `.meta` sidecar gets one minted and
  enters the registry — "drop an asset folder into the project and open it"
  just works, at open and on every filesystem refresh while the project is
  open. Importing a file that already lives inside the project registers it
  in place instead of spawning a renamed copy. The write doors (import and
  create, UI and MCP alike) guarantee the registry sees their output before
  they return.
- **Windows installer is a real wizard.** The one-click installer (which put
  the app under a package-derived folder name) is replaced by an assisted
  installer: pick the install directory, default `Programs\Estella Editor`.
- **SDK types staging is stamped and loud.** The `.esengine/sdk` types mirror
  (what makes `import from 'esengine'` resolve in your IDE) re-stages only
  when the editor or SDK actually changed, falls back to the in-archive SDK
  dist when the unpacked copy is missing, and reports failure in the Output
  Log and a toast instead of silently skipping.

### Fixed

- **The white-box family: cold asset references now converge.** Assigning a
  texture (or any handle-valued asset) that the scene-open preload never saw
  — via the Details picker popover, an MCP `set_field`, or a hot-created
  asset — left a dead handle rendering a white box until the project was
  reopened, with zero logs. The editor now loads cold references through the
  engine's own loaders and re-projects exactly the referencing components
  when the load lands; failures log loudly and surface in diagnostics.
- **Tilemaps follow their source, live.** Editing `Tilemap.source` re-derives
  the map immediately (no more reopen); a `.tmj` rewritten on disk
  invalidates stale caches and re-renders; and the "renders as fragments of
  the wrong texture after import" failure — along with the constant
  ~1s/frame grind that came with it — is gone with the registry staleness
  that caused it.
- **Invisible-but-solid maps fail loud.** A tilemap whose tileset textures
  all failed to load says so once, as an error naming the failing paths —
  collision-only ghost levels no longer cost a debugging session.
- **The Game inspector names live assets.** During Play, asset slots showed a
  red "required but empty" flag for perfectly loaded assets — the running
  world stores realm-local handles, which the inspector coerced to empty.
  Live handles now translate back to the assets they came from (name +
  thumbnail), and asset slots are read-only while playing.
- **sRGB uploads cover every texture path** under linear color — the last
  paths that uploaded color textures without the sRGB flag are aligned, so
  linear-light projects decode consistently no matter how a texture arrives.
- **`.esengine/sdk` missing in v0.22.0 installs** (#49). The packaged app
  shipped its SDK dist archive-only; the types mirror silently skipped and
  projects opened with no `esengine` types for the IDE. Now staged with a
  fallback source and loud failure (see *Changed*); reopening a project in
  the editor regenerates the folder.

## [0.22.0] - 2026-07-13

Light gets physical: an opt-in linear-light pipeline decodes sRGB in hardware,
runs the post-process chain on HDR float targets, and makes bright lights
actually bloom. Sprite animation becomes first-class authoring — slice a sheet
into a flipbook in the new Flipbook editor, drop it into the scene as a posed
animated sprite, and drive it from the FSM without a line of code. Audio grows
a real mixer (per-bus effect chains, sidechain ducking, a Mixer panel, MP3
cooks), and the physics editor catches up with its runtime: every joint draws
in the viewport, and anchors and slide axes edit by direct drag.

### Added

- **Linear-light rendering.** Set **Project Settings → Rendering → Color Space**
  to *Linear* and the whole frame computes in linear light: color textures
  upload as sRGB and decode in hardware (KTX2 compressed textures transcode to
  sRGB variants), tints and light colors linearize, post-process intermediates
  blend without shadow banding, and the final blit performs the one
  linear-to-sRGB encode. The setting persists in the project and boots every
  runtime the same way — the editor viewport, Play, web/desktop exports,
  playables, and WeChat. The default stays *Gamma*: existing projects render
  byte-identical until they opt in.
- **HDR post-processing.** Under linear color, the post-process chain upgrades
  its intermediate targets to 16-bit float wherever the device supports it
  (always on WebGPU; via `EXT_color_buffer_float` on WebGL2, with a graceful
  LDR fallback). Light accumulation past 1.0 survives into the effect chain:
  bloom's bright-pass sees real over-range energy, tonemap receives true HDR,
  and the bloom threshold now reaches 2 — set it above 1 and only over-range
  light blooms, the classic emissive-glow setup.
- **Flipbook editor.** Sprite-sheet animation gets its own asset type and a
  dedicated panel: a sheet canvas with a slicing grid (click or drag cells to
  append frames), a frame strip with per-frame durations and drag reordering,
  fps/loop controls, and a live looping preview. **Create Sprite Animation** on
  any texture guesses the grid from the image and produces a ready `.esanim`
  clip; sheet-cell frames re-slice consistently when the grid changes, and
  legacy per-texture clips stay valid.
- **Animated sprites in one step.** **Create Animated Sprite** on a `.esanim`
  (or dropping one into the viewport) spawns a complete entity — Transform,
  Sprite, SpriteAnimator — posed at frame 0, in one undoable step. Selected
  flipbooks loop live in the viewport without entering Play, and when the same
  clip is open in the Flipbook editor the preview follows your edits as you
  make them.
- **Code-free animation states.** FSM and behavior-tree actions now take an
  optional argument, and four `spriteAnim.*` built-ins mirror the `timeline.*`
  family: `spriteAnim.play` (the argument picks the clip), `.restart`, `.stop`,
  and a `spriteAnim.finished` condition with a formal replay contract.
  Idle/run/attack switching is now pure `.esfsm` data on the FSM canvas.
- **An audio mixer, end to end.** Buses gain a real DSP topology — declarative
  per-bus effect inserts (biquad filters, convolution reverb, compressor) and
  sidechain ducking (`duck music by voice`) that never fights the user's volume
  setting. The project mix persists in the manifest and boots identically in
  the editor, Play, and every export; the new **Audio Mixer** bottom-dock panel
  edits it live — one strip per bus with fader, mute, insert chain, duck rule,
  and custom bus management.
- **Audio import pipeline.** Selecting an audio asset shows a decoded waveform
  with play/pause and click-to-seek plus format details. A **Compress Audio**
  package option re-encodes `.wav` sources to MP3 at cook time (per-asset
  Import Settings override the global switch — seamless-loop clips can opt out
  of MP3's encoder-delay seam); already-compressed formats pass through.
- **Physics editing in the viewport.** The physics gizmo family fills out:
  one-way platforms draw their solid-side arrow, all six joint components draw
  anchor-to-anchor links with draggable anchor dots, motor joints show their
  target-velocity arrow, prismatic/wheel joints show the slide axis with a
  re-aim handle, and particle emitters preview their `angleSpread` aim wedge.
  Anchors and axes edit by direct drag in the owning body's frame; collider
  handles now measure from the offset shape center. The show flag is labeled
  **Physics**, and the physics showcase gains a spring piston (prismatic joint
  in action).
- **Smarter FSM/BT pickers.** Action and condition fields upgrade from bare
  text inputs to grouped suggestions: project names lead, built-ins group under
  their namespace with localized descriptions, and the keyboard drives the
  whole popover. Action nodes no longer suggest conditions (and vice versa).
- **Tilemap ellipse tool + saved stamps.** Ellipse (**O**) fills the inscribed
  ellipse of a dragged box in one undo step, with the classic pixel-circle
  shape correction. A saved-stamp strip bookmarks the current brush per
  project — auto-named chips with pattern previews, click to recall, identical
  patterns dedupe.

### Changed

- **`.esanim` and `.estimeline` part ways.** `.esanim` is now exclusively the
  flipbook format with its own editor; the Sequencer keeps `.estimeline`, and
  **New Animation** creates a `.estimeline` instead of disguising a multi-track
  timeline as a flipbook. Existing files of both types stay valid.
- The three audio extension lists (SDK registry, runtime loader, editor tiles)
  unify on one set: `mp3 / wav / ogg / aac / flac / m4a / webm`.

### Fixed

- **WebGPU bind groups could go stale.** The bind-group cache keyed entries by
  resource handles that emscripten reuses immediately after release, so
  create/destroy churn could make a draw read a *deleted* resource's bindings —
  post-process passes read other passes' parameters, which silently blanked the
  whole WGSL bloom chain. Deleting a buffer or texture now evicts every cached
  group that references it, and the four bloom scenes joined CI on both
  backends to keep it that way.
- **Editing a joint no longer corrupts its connected body.** The editor's
  reconciler copied entity-reference fields verbatim across two id domains, so
  the first edit of any joint silently re-pointed `connectedEntity` at an
  arbitrary entity. References now remap on both edit and respawn (undo of a
  delete restores joint wiring correctly).
- **Kawase blur is backend-identical.** Post-process chain targets switch to
  bilinear sampling: the blur's half-texel taps landed exactly on texel
  boundaries under nearest filtering, whose rounding is backend-dependent — GL
  and WebGPU visibly diverged. Bloom falloff now measures byte-identical across
  backends in both color spaces.
- **`.esanim` texture dependencies now enter the cook.** Clips' sheet textures
  were invisible to the build's dependency scan, and anim-clip/timeline
  component slots matched no editor asset type so their pickers offered
  nothing. Both fixed by the flipbook split.
- **Audio preview is audible again.** The editor's CSP never allowed
  `estella://` media, so every `<audio>` element — including the double-click
  preview — was silently blocked.

## [0.21.0] - 2026-07-13

Estella speaks your language: the editor UI ships in English and 简体中文, and game
text localizes itself through `.eslocale` string tables bound straight to Text
components — no code. Networking graduates from beta with client prediction,
reconciliation, and interest management; physics gains one-way platforms and new
joints; cutscenes run code-free off the FSM; and a broad performance pass trims
per-frame work across the SDK, renderer, and editor.

### Added

- **The editor speaks 简体中文.** Every panel, dialog, menu, and toast ships in
  English and Simplified Chinese — over a thousand strings across the whole editor.
  Pick the language in **Settings → Appearance → Language** (it follows your system
  language by default); the editor reloads to apply it everywhere at once.
- **Localized game text as data.** New `.eslocale` string tables (one locale per
  file, with CLDR plural forms) and a `Text.i18nKey` binding that resolves keys to
  words every frame — switching locale or late-loading a table re-flows every bound
  label with zero bookkeeping. Scenes that bind keys **localize themselves in every
  runtime**: the loader auto-installs localization, discovers the shipped tables,
  and follows the player's system language, so even pure scene-driven projects get
  working localization with zero game code. Builds always include locale tables.
- **A translator-shaped locale editor.** `.eslocale` is a first-class asset:
  create tables from the Content Browser, edit them in a Details-panel editor with
  a reference translation per key, a one-click missing-keys backfill, and plural
  sub-editing — and bind keys from a `Text.i18nKey` dropdown that previews each
  key's translation. The `ui-controls` example ships English + 中文.
- **Networking graduates from beta.** The replication layer's `@beta` tags are
  gone, closed out by three capstones:
  - **Client prediction + reconciliation.** `prediction.apply` is the same
    input-to-state function the server runs — inputs apply locally with zero
    perceived latency, the server acknowledges consumed inputs, and every fixed
    tick rebuilds owned state as authority ⊕ unacknowledged replay, so
    mispredictions structurally cannot accumulate.
  - **Correction smoothing.** `prediction.smoothing { halfLife, maxError }` eases
    corrections out instead of snapping — purely presentational, so simulation
    state cannot drift; oversized errors still teleport.
  - **Interest management.** An `InterestPolicy` (built-in `radiusInterest`)
    scopes each connection to the entities it can see — entering entities spawn
    with current state, leaving ones despawn, and each client's delta carries only
    its own view. Connections always see the entities they own.
  - The `multiplayer-arena` example now runs on prediction end to end.
- **One-way platforms and new joints.** `OneWayPlatform` lets bodies jump up
  through a platform and land on it; `MotorJoint` drives a body toward a target
  velocity or spring-held offset (conveyors, moving platforms); and a mouse-drag
  API grabs dynamic bodies with an auto-sized grip. Showcased in the rebuilt
  `physics-playground` example.
- **Code-free cutscenes.** The FSM and behavior trees pre-register
  `timeline.play` / `timeline.pause` actions and a `timeline.finished` condition,
  and `TimelinePlayer` gains a formal replay contract (a latched `finished` flag;
  raising `playing` on a finished clip replays from the top). The new `cutscene`
  example plays an intro timeline, hands over to gameplay on finish, and replays
  on demand — without registering a single action in code.
- **Preview FX in edit mode.** A viewport toggle (on by default) runs particles
  and trails live while you edit — no Play required. Toggling off clears the
  residue, and editing an emitter's timing fields (duration, looping, bursts)
  restarts it so the change is visible immediately.
- **Outline post-process.** Full-screen Sobel edge detection inks scene edges
  toward black — the classic 2D ink look, tunable via threshold, thickness, and
  intensity.
- **Tiled image-collection tilesets.** "Collection of images" tilesets (one loose
  image per tile) now load everywhere: the loose images fold into a single grid
  atlas at load time, so the renderer sees an ordinary tileset. Previously every
  collection tile rendered as a white block.

### Changed

- **A performance pass across the frame loop.** The SDK query cache no longer
  pays for unrelated structural changes; text tessellation is cached per entity;
  state-visual writes stop at rest; transform iteration and world-matrix composes
  skip work for static and childless entities; the GL backend caches texture and
  scissor state to cut per-draw FFI; and the editor reads engine telemetry only
  while the Profiler panel is open.

### Fixed

- **KTX2 textures on WeChat.** The WebGL2 capability check relied on a DOM global
  that WeChat MiniGames don't have, so real devices refused every compressed
  texture despite running WebGL2. The check is now capability-based and
  environment-independent.
- **`.tmx` maps fail loud.** The tilemap loader advertised `.tmx` but only parses
  JSON, so XML maps died with an inscrutable syntax error. XML content is now
  rejected with the fix: export as **JSON map files (`.tmj`)** from Tiled.

## [0.20.0] - 2026-07-12

A real UI editor: anchor-based layout with an on-canvas resize gizmo, a widget palette
you drag onto the Canvas, and a design-resolution viewport that frames your target
screen and previews how the UI adapts on any device — backed by a modernized UI runtime
(theme tokens, live theming, data binding) and new tilemap layer tooling.

### Added

- **Design-resolution viewport.** Author your UI against a fixed design resolution —
  landscape `1920 × 1080` or a portrait `750 × 1334`, your call. UI mode frames the
  design screen on entry and dims around it, and the editor is **WYSIWYG**: what you lay
  out inside the frame is exactly what ships at that resolution. Pick the resolution from
  the viewport's **Design** dropdown, and simulate a target screen (iPhone / iPad /
  1080p …) from the **Device** dropdown — the UI **relayouts to that device's aspect**
  (per the Canvas scale mode) with letterbox bars and safe-area insets.
- **UI authoring on the canvas.** A nine-slice **anchor grid**, a **Widget palette** you
  drag onto the Canvas, and an eight-handle, unit- and anchor-aware **resize gizmo** that
  edits UINodes directly in the viewport. The UINode inspector is rebuilt around
  dimension fields, box-model cards, and anchor pickers, with In-Layout vs Absolute
  positioning modes.
- **Editing modes.** The Activity Bar switches between **Scene**, **UI**, and **Tilemap**
  modes (and follows your selection), each revealing its companion panels and viewport
  aids.
- **Modern UI runtime.** Anchor presets, a theme-token system with live theme swapping
  across every built-in widget, and a push-model data-binding API (signals / derived /
  bind) that cleans up automatically on despawn.
- **Tilemap layer panel.** Add layers and set per-layer opacity, with collision /
  terrain / animation badges surfaced in the palette.

### Changed

- Editor UI consolidated onto shared primitives (Button / IconButton), with inline
  editable dimension fields and deduplicated tilemap controls.

### Fixed

- UINodes lay out and are positionable: the reconciler keeps parent `Children` in sync so
  newly created UI children get laid out, absolute nodes bake correctly, and dragging a
  centered node works.
- Editor UI now matches the design frame at the correct scale — the design frame and
  layout share the UI world scale (1 unit = 1 design px) instead of mixing in the physics
  `pixelsPerUnit`, which had made UI vanish when the design resolution changed.
- Edit-mode gizmos are hidden in Play.
- `.estileset` tilemaps render on scene load and keep their tile size in sync.
- Engine-computed transform fields are preserved, so moving an entity no longer snaps the
  gizmo to the origin; text alignment is unified across framed and unframed text.
- Asset-ref fields validate leniently (string ref vs numeric handle), loader-based asset
  slots resolve to project paths, and `ThemeStyle` fields validate so themed widgets pass.

## [0.19.0] - 2026-07-10

A create-anything entity workflow, an inspector that guards your data, a fully
keyboard-driven editor, and multi-scene builds — plus a broad theme and Spine polish
pass.

### Added

- **Create any entity from one place.** The **Create…** popover now spawns every
  component-anchored entity — Sprite, Camera, Particles, Light, Tilemap, Spine, Audio,
  Text, BitmapText, Shape, Mesh, Trail, and the UI widgets — alongside **your own
  project components** and any **project prefab** (`.esprefab`). A single create pipeline
  backs the menu, drag-and-drop, and the automation surface, so every path spawns the
  same way and as one undo step.
- **Inspector field constraints.** A field declared **required** is flagged when left
  empty, a numeric field is clamped to its declared range on write (out-of-range values
  can no longer slip in through play-mode or material edits), and dropping an asset onto
  a slot is rejected unless its type matches.
- **Multi-scene builds.** Every scene in the project ships as a switchable
  `SceneManager` target. Pick the **startup scene** from the Content Browser, review the
  **Scenes in build** list in the Package dialog, and **exclude** scenes you don't want
  to ship.
- **Spine skeleton & atlas as first-class asset slots.** Assign the skeleton and atlas
  from asset-picker slots in Details — portable UUID references that survive moves and
  renames — with a live skeleton preview and animation/skin dropdowns.
- **Tilemap painting upgrades.** A **random-scatter brush** for stamp variation,
  **animated tiles** in the tileset editor (frame sequences with per-frame durations and
  a live preview), diagonal-flip support for GID tile objects, and a keyboard-navigable
  tile palette.
- **A keyboard-driven editor.** Menus and context menus navigate with the arrow keys
  (type-ahead, Home/End, submenus), the Outliner jumps to entities as you type, the
  Content Browser folder tree and the tile palette walk with arrows, file operations
  post a **toast with Undo**, transient surfaces restore focus on close, **Esc** backs
  out everywhere, and a visible focus ring always shows where you are.
- **Preview exports locally.** Serve web and playable-ad exports over a loopback HTTP
  server straight from the editor.
- **Query filter DSL.** The SDK exports `With`, `Without`, `And`, `Or`, and `Not` for
  composing query filters.

### Changed

- **The editor UI is unified in English** and migrated onto a single design-token
  system, so accent color, spacing, and surfaces stay consistent across every panel,
  menu, and graph editor. The material graph joins the shared node canvas (pan/zoom,
  shared context menu).
- **Closing a dirty document guards asynchronously** instead of blocking on a native
  confirm dialog.

### Fixed

- **Spine properties apply live from the inspector.** Editing the tint color, time
  scale, or the playing toggle now takes effect immediately; `setSkeletonColor` degrades
  gracefully on an older WASM that lacks it.
- **Spine atlases are single-sourced.** Atlas pages resolve through the manifest, the
  cook embeds them, KTX2 pages transcode via Basis, and the exporter detects the runtime
  version again.
- **WeChat export hardening.** One SDK core per bundle (no `Res` identity split-brain),
  KTX2 ships as `.ktx2.bin` to satisfy the suffix whitelist with the Basis module, the
  runtime instantiates the staged WASM twins, and export fails fast without the
  `-t wechat` runtime.
- **The packaged editor is self-contained.** It ships the new-project templates and can
  play and export without bundling editor sources at runtime.
- **Tilemap creation is a single undo step** again — the reconciler projects the
  tilemap's tileset assets out-of-band, so undo/redo and reload restore them.
- Platform-specific shortcut mismatches, duplicate entries in Recents, and a TypeDoc
  build break (a duplicated Basis transcoder import) are fixed.

## [0.18.0] - 2026-07-09

Tilemap authoring, on-canvas gizmos, and a selectable WebGPU backend — plus a round
of export fixes that make single-file playables self-contained again.

### Added

- **Tilemap authoring in the editor.** Paint maps directly in the viewport: a
  first-class New Tilemap command with a tileset chooser, multi-tileset layers (a
  single layer paints from several tilesets), add/remove tilesets on a layer live,
  a live rect/line paint preview, a block eraser, and stroke rollback. Tiled tile
  (GID) objects render as positioned sprites and honour their Tiled object rotation.
- **On-canvas gizmos.** Particle emitters show and aim on the canvas with a
  draggable spawn radius; lights and colliders adopt that same radius drag handle;
  gizmo handles now cover size (vec2) and cone angle — shape edited on the canvas,
  not just in the inspector.
- **Selectable WebGPU backend.** Switch the viewport between WebGL2 and WebGPU in
  Settings → Renderer (with a prompt to apply), the status bar shows the active
  backend, and the profiler reads real GPU time via timestamp queries — parity with
  the GL path.
- **Motion trails.** A `TrailRenderer` draws a ribbon through the unified batch face.
- **Y-sort.** Check a layer under Project Settings → Rendering → "Y-sorted layers"
  and its sprites/shapes/text draw in world-Y order (lower on screen on top) —
  top-down occlusion with no manual layer/z juggling, across the edit viewport, play
  mode, and every export target; pixel-verified on both backends.
- **Editor resilience.** The editor survives its own crashes — local crash capture,
  main-process failsafes, and a startup update notification.
- **Packaging & launcher.** The Package dialog exposes texture compression and
  auto-atlas; the launcher can remove a project from recents.
- **API surface governance.** Every public SDK export is snapshotted with its
  signature and stability tag in `sdk/etc/*.api.md`, enforced by CI. Networking, the
  material graph, and the headless/node entry are tagged `@beta` (no compatibility
  promise yet); everything untagged is stable.

### Fixed

- **Single-file playables are self-contained again.** Typed text/binary assets
  (tilemaps, materials, tilesets) no longer 404 in a playable: the embedded asset
  backend accepts an already-resolved `data:` URL instead of re-looking it up as a
  key. A tilemap's tileset images are now discovered as dependencies and rewritten
  to logical refs at cook time, so the single-file build actually ships and resolves
  them.
- **API-surface guard is machine-independent.** The snapshot excludes ambient
  built-in members (which float with the installed `@types/node`) and pins its line
  endings, so the CI guard no longer drifts between machines.

### Changed

- WebGPU caches bind groups instead of rebuilding one per draw.

### Removed

- The `esengine` SDK is no longer published to npm (the editor is the single
  distribution channel). The npm publish workflow and the broken `./factory`
  package entry are gone.

## [0.17.0] - 2026-07-08

The multiplayer and WebGPU release. Estella gains a complete server-authoritative
networking stack — declare which fields replicate and entities sync across machines
with interpolation, input routing, and an in-editor multiplayer preview — and the
renderer boots on WebGPU with pixel parity against WebGL2, shaders emitted in both
languages from one source.

### Added

- **Server-authoritative multiplayer.** Mark an entity `Replicated` and it spawns on
  every client; fields declared `replicated` (C++ annotation or `defineComponent`
  metadata) stream as binary deltas with per-field dirty masks and snapshot
  interpolation on the remote side. A `Net` session resource gates roles
  (server/client/offline), `Replicated.owner` routes each connection's per-tick input
  commands to its entities, and the handshake refuses protocol/ABI/schema drift
  fail-loud. **SDK:** `Net`, `Replicated`, `NetGhost`, `MemoryTransport`,
  `MessagePortTransport`, binary frames on `NetChannel`, sockets behind
  `PlatformAdapter.createSocket`.
- **Editor multiplayer preview.** The Play-mode dropdown gains a player count (1–4):
  the primary realm boots as the listen server and each extra player gets its own
  `Game P#` tab — the exact shipping netcode running across editor realms with zero
  network setup.
- **Dedicated servers on Node.** The new `esengine/node` entry runs the same engine
  wasm + gameplay code headless: `loadEsengineModule`, `createHeadlessApp`,
  `runHeadless`, a Node platform adapter, and a silent audio backend. New
  **multiplayer-arena** example; the networking guide covers the whole stack.
- **WebGPU render backend.** The engine boots on WebGPU (`backend: 'webgpu'`) with
  full-scene pixel parity against WebGL2. Every built-in shader, filter, post-process
  effect and material-graph output emits in both GLSL and WGSL from one source, and
  user `.esshader` files get auto-generated WGSL twins through a vendored
  glslang + naga pipeline (no external toolchain). Dual-backend pixel verification
  runs on every push via SwiftShader.
- **Mesh2D.** A scene-level custom-mesh renderer on the unified batch face — sorting,
  culling, clipping, multi-texture merging and 2D lighting for free.
- **Tiled parity.** Object layers spawn real colliders and queryable object data,
  hexagonal maps, multi-tileset rendering, chunked/infinite maps and external
  tilesets — one `.tmj` parser for all of it.
- **Asset pipeline.** Texture and audio residency with unified refcounts and
  memory-pressure trim, `Assets.preload` for streaming, cook-time auto-atlas packing
  (`<name>.atlas` folders), and content-addressed cooked builds that resolve path
  references end-to-end across web, WeChat and playable exports.
- **Post-processing.** True-LUT color grading and per-pass texture parameters.

### Changed

- **One draw-command producer.** All renderers assemble commands through
  `BatchBuilder` (CI-guarded); clears became render-pass load-ops; loose uniforms ride
  a std140 `DrawParams` UBO; every raw pointer+length WASM entry validates through
  `boundarySpan`. Sync `readPixels` left the RHI for an async readback seam.
- **Push-gated CI.** Every push to master now runs the C++ harnesses, both test
  suites, example checks, boundary guards and headless pixel verification — on both
  render backends.
- **SDK 0.6.0** (from 0.5.0): the networking/replication surface above, plus
  `Time.fixedTick` and the `esengine/node` entry.

### Fixed

- **Prefabs in shipped builds** — `PrefabServer` captured a stale `Assets` instance at
  plugin build, breaking uuid-referenced prefab instantiation in play/cooked runtimes.
- **Legacy tilemap scenes rendered nothing** — `TilemapLayer` asset discovery listed
  only one of its two refs.
- **Client authority window** — a connecting client committed its role only after the
  handshake, letting authority-gated gameplay run locally for the first ticks and
  leave orphan state beside the replicated ghosts.
- **Editor** — moving a UINode edits its layout inputs instead of stomping Yoga;
  actionable hint when a side module 404s.

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

[Unreleased]: https://github.com/esengine/estella/compare/v0.23.0...HEAD
[0.23.0]: https://github.com/esengine/estella/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/esengine/estella/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/esengine/estella/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/esengine/estella/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/esengine/estella/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/esengine/estella/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/esengine/estella/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/esengine/estella/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/esengine/estella/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/esengine/estella/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/esengine/estella/compare/v0.12.3...v0.13.0
