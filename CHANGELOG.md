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

### Fixed

- **The Dawn dependency cache is written from the default branch.** It had been written
  from the release pipeline, which runs on a tag — and a GitHub cache is readable only
  from the ref that created it, its descendants, and the default branch. No tag is any of
  those for the next tag, so every release paid for a cold Dawn build and then wrote the
  result where nothing could read it. Whether a tag run can read the default branch's
  cache is not yet proven; the next release is what settles it.

## [0.38.0] - 2026-07-30

Games built with v0.33.0 through v0.37.0 install on Android 10 and 11 and then fail to
start: the dynamic linker cannot resolve `APerformanceHint_getManager`, so it refuses
`libestella_js_host.so` and the process dies before any engine code runs. Six releases
shipped with it because CI booted one emulator, API 34, and the fault only exists below
API 31.

### Fixed

- **Android 10 and 11 can run a packaged game.** The manifest declared minSdk 26 while
  the NDK was told to build against 33. The NDK decides how to reference an API by
  comparing it with the build target, so a target above the declared floor compiles every
  `__builtin_available` in the host to dead code and turns each guarded symbol into a
  load-time requirement. ADPF is one of those. It is now resolved through `dlsym`, so a
  device that exports it gets a hint session and a device that does not gets none.
### Added

- **Every supported Android version is tested on pull requests that touch the host.** One
  game is built once and installed on one emulator per release, 10 through 16, so a
  difference between two versions cannot be a difference between two builds. Each reports
  launch time, PSS, CPU and frame intervals. The version list comes from the runner's own
  system images rather than a written-down list. There is no pixel judgement in it — a
  legitimately dark scene and a dead renderer produce the same screenshot — so frames are
  published for a person to look at and the gate is limited to install, reaching `ready`,
  and recording no error.

### Changed

- **Android's declared minimum is API 29 (Android 10), raised from 26.** The font path
  calls `AFontMatcher_create`, which is API 29, so 26 was a claim rather than a capability.
  Nothing that ran before stops running.

## [0.37.0] - 2026-07-29

Two things this release is mostly about: what a game does on hardware you do not own,
and text.

v0.36.0's Android template shipped without its precompiled bytecode, so every game
packaged from it opened on a black screen for about fourteen seconds while QuickJS
compiled the SDK bundle on the phone — a first launch a player reports as a crash.
That had two separate causes, a compiler asked for by a name Windows does not have and
an unlinked libm on Linux, and it reached players because the publish gate checked that
an archive was in the release rather than what was inside it. A packaged game now also
keeps a boot-and-crash record in a place its player can find and send, which is the
only way to learn anything about a failure that happens on their device and not yours.
Windows auto-update had been failing for the whole of 0.36.0 as well, on a certificate
the installer should never have been signed with.

And text draws what it has been claiming to. An outline moves the glyph's edge through
the distance field instead of stamping the glyph eight times around itself; `shadowBlur`
softens the shadow instead of being documented as reserved; a line's extra leading is
split above and below the text the way a line box always has, which moves every centred
label in every project down by the tenth of an em it had been floating; and glyphs are
rasterized for the pixels they land on rather than for the design box, which is why
editor text was soft at every zoom except "fit".

### Added

- **A scene can say that a node scrolls.** Scrolling was reachable only by *building* the
  ScrollView widget in code, so a scene could describe every part of a scroll area — the
  clipped box, the oversized child — without the one fact that made it a scroll area. Drop
  a ScrollView from the Create menu and it sat there: clipped, hittable, motionless.
  `UIScroll` is that fact. The behaviour plugin attaches a ScrollContainer to any entity
  carrying one, sized from the box the layout pass resolved rather than the authored
  fields, and moves the content by its insets — the same container and the same input path
  the widget has always used, so the two ways of building a scroll area now differ only in
  who writes the components.
- **An outline moves the glyph's edge instead of stamping the glyph.** Outlined text was
  eight offset copies of itself, which reads as an outline while it is a hairline and
  merges into a blob past a few pixels. The glyphs are already a distance field, so the
  outline is a threshold — the same quads draw the same shape, grown. Carrying the width
  needed a per-draw value the batch path has no seam for, so it rides per *vertex*:
  `BatchVertex` gains one float, which keeps every label in one batch regardless of its
  style. The value is in the atlas's own distance units, so it means the same thing at
  every font size and every zoom, and asking for more than the atlas spread degrades to
  the widest real outline rather than flooding the glyph's cell. Bitmap atlases have no
  distance to move and keep the stamp fan. WebGL2 and WebGPU agree to within a pixel.
- **`Text.shadowBlur` softens the shadow.** The field was in the component, the inspector,
  the scene file and the guide — as "reserved", because the renderer read the colour and
  the offset and nothing else, so a shadow was a second stamp of the text sitting slightly
  below the first. It is now nine taps spread around a ring, with each tap's alpha inverted
  out of the compositing equation rather than divided, so the layers land at the alpha that
  was asked for.
- **A packaged game leaves a record its player can send.** Everything the native host
  reported went to the platform log, which means logcat, which means a cable and a
  developer — so a failure on someone else's phone left its evidence on their phone. The
  host now writes the same lines to a file: the device, the GPU and its driver, which boot
  phase each line belongs to, where the SDK bundle came from, and how long the launch took,
  with the previous run kept alongside so a crash-and-retry does not overwrite the record
  of the crash. SIGSEGV / SIGABRT / SIGBUS / SIGFPE / SIGILL are caught, the signal and its
  phase and the return addresses go in, and then the default handler is restored and the
  signal re-raised so the OS still produces its tombstone. On the launch after a crash the
  record is copied somewhere a file manager will list it — since Android 11 an app's
  `Android/data` is closed to the Files app, so the thing built to make a failure
  reportable was reachable by everyone except the person reporting it.
- **New Script writes the module and the line that makes it run.** A project has exactly
  two script entries, and a module neither of them reaches is dead — never bundled, schema
  never extracted, component never in Add Component. Nobody can be expected to know that
  before they have seen a project laid out, so the editor writes both halves: a component
  is re-exported from the declaration entry, a system is imported by the startup entry, and
  the entries come from the manifest rather than a conventional pair. The dialog shows what
  will be written and which line the entry gains, and refreshes the schemas rather than
  waiting on the watcher, so a component is in Add Component the moment it closes.
- **MCP: name a scene, address one member, hand over a program too big to say.** A scene
  file could only be called `scene.esscene`, which is fine for the first one and collides
  on the second. A field path naming one member of a structural field was rejected —
  `"Transform.position.x"` appeared in the tool's own description while the surface threw
  on it — and now resolves to the field plus an index, reads the rest and writes it back.
  And an op program had to arrive inline: a panel of a few hundred entities is a few
  hundred KB of JSON, which does not belong in a message, so `apply_scene_ops` takes an
  `opsPath` to a project file instead.

### Fixed

- **A published template is checked for what is inside it.** The publish gate listed the
  release's asset *names*, and a zip missing half its contents passes that. v0.36.0's
  Android template shipped without its precompiled bytecode and nothing between the build
  and the store looked inside the archive. The reason it could go unnoticed is that one
  `optional` flag answered two different questions: a contributor's local build without the
  bytecode is fine, because the host compiles and caches instead, but a *published*
  template without it ships that first launch to every game made from it. Those audiences
  are now separate, and the check reads the archive's central directory against the drafted
  release before it is made public.
- **The Android template carries its bytecode.** Two causes, and the first hid the second.
  The precompile step shells out to a C compiler and asked for `gcc` on Windows — the one
  name a machine set up for this build is least likely to have — so it built through CMake
  instead, which the native build already requires and which finds whatever is installed.
  Then the step linked no libraries at all, and QuickJS needs libm: macOS carries the math
  functions in libSystem so a bare `cc` links there, Linux does not, and the Ubuntu runner
  is the one that builds the Android template each release publishes. Clean install to
  first frame on a Xiaomi 15 is now under four seconds.
- **A packaged game starts in the orientation it was authored in.** The headless export read
  orientation from a top-level key the project format does not have, so the fallback always
  won and a 600x1080 shmup shipped as a letterboxed landscape app. It calls the same
  `resolveOrientation` the editor's own export does; reading the manifest by hand is how the
  two drifted apart.
- **The Windows installer is no longer signed with the macOS certificate.** `CSC_LINK` is
  electron-builder's platform-*neutral* variable and the release workflow exported it to
  both legs of the matrix, so the NSIS installer was signed with the project's Apple
  Developer ID and that identity was stamped into `app-update.yml`. Windows cannot build a
  chain to a trusted root for an Apple-issued certificate, so every Windows auto-update
  failed — after downloading the whole installer. The secrets are scoped to the macOS leg
  now, and a guard after packaging fails the release on anything other than NotSigned or
  Valid. Installs already carrying that pin refuse every update they can never verify, so
  the editor settles it up front instead of at the end of a download.
- **A Spine sequence stops sampling empty atlas space.** A sequence swaps which atlas region
  an attachment points at, and with the region goes the page — spine-c does that swap inside
  `computeWorldVertices`, and this draw loop read the texture *before* that call and the uvs
  after. A sequence whose frames sit on one page was fine by luck; effect flipbooks are
  exactly the ones that span pages, so every glow, energy trail and ground pool drew the new
  frame's uvs against the previous frame's texture and simply was not there. The same file
  also gated the premultiplied *tint* on whether the blend code got a premultiplied twin, so
  a Multiply or Screen slot on a premultiplied page stopped fading correctly; both backends
  now key both decisions off the one fact.
- **A Spine skeleton exported as JSON is an asset.** Spine 2.1 has no binary export, so a
  project on that runtime ships a plain `.json` — and the `.meta` mint door typed files by
  extension and name suffix only, so the skeleton never entered the registry and the
  Skeleton Path picker was empty. Everything downstream already handled it. The file→type
  table gained a third criterion beside extension and suffix, a marker in the content: a
  JSON skeleton is claimed by the same `"skeleton":{..."spine":"<ver>"...}` header the
  runtime's version detection reads, so the editor and the runtime cannot disagree. Only the
  head is read, and only for extensions a name cannot type. The same table could not type a
  DragonBones pair either; added alongside.
- **The Create popover offers the project's components.** It read the engine's user-component
  registry, but the editor deliberately never executes project code, so that registry only
  ever held what the *editor* realm defined — empty for every project that has ever opened.
  It reads `schemas.json` now, the same source Add Component has always read. The Create
  catalog was also assembled inline in the popover, so `listEntityTemplates` had only the
  static half and `create_entity` could not spawn a project component or a prefab the
  popover was happy to show; one source now backs all three.
- **A lineHeight's extra space belongs half above the text, not all below.** The baseline was
  placed a flat 0.8em under the line's top, so everything a lineHeight adds beyond the em box
  landed below it and a centred block sat `(lineHeight - 1em)/2` too high — 0.1em at the 1.2
  default, which a real UI pack showed as a visible 6px on a 60px number. Every centred label
  in every project moves down by that half-leading, which is where they should have been.
- **Glyphs are rasterized for the pixels they land on, not the design box.** Bitmap text
  rasterizes per display size, but the size it asked for came from the box UI lays out in,
  and that box is deliberately pinned to the design size in the editor so UI does not reflow
  while the view zooms. The two agree in a shipped game and nowhere else, so editor text was
  rasterized for the design scale and then scaled by the camera. It also explains why SDF
  looked so much better in the editor: it was the only pipeline not being asked for the wrong
  size.
- **A scene batch that fails leaves the scene alone.** `apply_scene_ops` promises that a throw
  anywhere rolls the whole batch back, and it rolled back field writes — all a gesture knows
  how to undo. Every structural edit stayed: a program that spawned sixteen entities and then
  hit a bad field path left sixteen entities behind, under an error saying the batch had
  failed. The suite already claimed to cover this while faking the transaction with a rethrow,
  so the assertion could only ever pass.
- **Opening a scene stops throwing away the scene you just built.** A person who opens a scene
  over unsaved work gets asked about it; a driver got nothing, and the panel it had just
  authored was gone while the call returned ok. It refuses now, and names the two ways out —
  `discardChanges` is one of them, because throwing edits away is a legitimate thing to want
  and should be said out loud.

### Documentation

- **Where a device failure leaves its evidence, and who can actually fetch it.** What the boot
  record holds, what the phase lines mean, how a crash reads, and how to symbolize the
  addresses — plus the sentence to give a player who has no cable: open it once more, then
  send the newest `estella-crash-*.log`. The first-launch section also described a build
  machine with no compiler as producing "a working app that compiles on first run", which is
  true and reads as harmless; it costs that launch ten seconds on a screen a player reads as
  a hang, and v0.36.0 shipped exactly that way.

## [0.36.0] - 2026-07-29

A game is run at the screen it was authored for. The target device shaped the edit
overlay and nothing else, so a project made for a phone was only ever *played* at
whatever shape its panel happened to be dragged to. One selection now drives editing
and both play hosts, the device list is the project's own to extend, and each screen
carries the safe area it should be tested against.

The UI toolkit also gained the pieces a real UI package turns out to need — subtree
opacity, a pointer gate, masks that clip to what they draw, `object-fit`, and a font a
game ships itself — while 9-slice borders, which had been dropped everywhere outside
the edit viewport, now survive Play and a packaged build. Underneath, the source tree
was reorganised: the renderer separates the device from the frame that drives it, the
SDK's modules found shelves, eleven build trees became one, and the guards that police
those boundaries fail when the layout drifts instead of going quiet.

### Added

- **The target screen now governs the running game, not just the canvas you author
  against.** The device selection shaped the edit overlay and nothing else: a game played
  in the viewport or the Game panel filled whatever space the dock happened to have, so a
  project authored for a phone was only ever *run* at whatever aspect its panel was
  dragged to. One selection now drives all three views — editing previews it, and both
  play hosts letterbox to it. The Game panel gained an overlay bar carrying that control
  plus a readout of the simulated size. `Design` stays the "no simulation" choice, so a
  desktop project is unchanged. The letterbox is applied to the element hosting the realm
  rather than inside the engine, so the realm sees a canvas of the device's shape and its
  own `ScreenScaling` adapts exactly as it would on the hardware.
- **A project declares the screens it tests on.** The built-in device list is a guess, and
  a guess nobody can correct means everyone tests on approximately the wrong screen.
  `screenPresets` in `project.esproject` adds rows to the dropdown, editable in Project
  Settings → Display (id, name, portrait size, and safe-area insets behind a per-row
  expander). An entry reusing a built-in id **replaces** that built-in, so a studio can
  make "iPhone" mean the exact handset it ships to and every saved selection still
  resolves. Presets ride version control with the project.
- **UI: subtree opacity, a pointer gate, mask shapes, and `object-fit`.** `UINode.opacity`
  multiplies down the tree like CSS `opacity` (fading a panel no longer means touching
  every visual's alpha) and `UINode.pointerEvents = None` makes a node and its subtree
  transparent to the pointer, so a decorative overlay stops eating clicks. Both resolve in
  the same hierarchical pass that already resolves `display`. `UIMask.alphaCutoff` above 0
  clips to the shape the mask *draws* instead of its box, so a circular avatar frame stops
  cutting a square. `UIVisual.fit` is CSS `object-fit`: `Contain` letterboxes the image
  inside its box, `Cover` crops it — neither distorts art whose ratio differs from its slot.
- **A game can ship its own font.** `Text.font` is a real asset reference to an imported
  `.ttf`/`.otf`, so it rides the same machinery as every other asset slot (dependency
  tracking, cook inclusion, `@uuid:` refs, hot update, ref counting). Previously `Text`
  could only name a family the *host* already had, which on native meant there was no
  answer at all. Shipped fonts are not a second text path — the loader mints a family name
  and the pipeline still speaks one language for "which typeface".
- **Drag a 9-slice border on the texture instead of typing four numbers.** The asset
  inspector draws the four guides on the preview and they are draggable; the numeric
  fields stay in sync for exact nudges.
- **Ordering a group of systems, written once.** `defineSystemSet` puts systems under one
  name, so a run condition and the ordering edges are stated for the group instead of
  repeated per member — and anything ordered against that name waits for all of them.
  `App.addSystemSet` had been there for a while with no exported way to build its
  argument; `defineSystemSet` and its types are public now. Ordering also travels on the
  system definition itself, which is what finally gives the top-level `addSystem` — the
  path examples and game code actually use, and the one that takes no options — a way to
  say "after that one".
- **An agent can build a scene through MCP, not just poke at one.** The editor's MCP
  surface could observe anything and change one field at a time — fine for a tweak,
  hopeless for authoring. `apply_scene_ops` runs a program of create/parent/component/field
  ops as one undoable, atomic batch: if any op fails, the error names it and the whole
  batch rolls back rather than leaving a half-built subtree.

### Fixed

- **9-slice borders were dropped everywhere except the edit viewport.** A frame that
  sliced correctly while authoring stretched the moment you pressed Play, and would have
  stretched in every shipped build. Three separate breaks stacked: scene preloading asked
  the import-settings resolver with the *resolved* path while suppliers key by the
  authored ref; the editor keyed its Play payload by `@uuid:` alone, so a ported or
  hand-authored scene holding paths got nothing; and assembling the addressable manifest
  dropped the importer block entirely, so a packaged build had no channel for the `.meta`
  at all. Import settings now travel with the asset through one description that Play, a
  playable and a cooked build all read.
- **Orientation was a clickable no-op for the default screen.** Landscape/Portrait took
  clicks and changed nothing while `Design` was selected — there is no screen being held
  one way when none is simulated. The rows are disabled with a note saying what enables them.
- **Concurrent writes could corrupt `project.esproject`.** Every project-settings writer
  did an unserialized read-modify-write of the manifest, so two edits in flight both read
  the pre-edit file and the second landed on top of the first — losing it, or interleaving
  into JSON that no longer parses. Typing across the fields of one settings row produced
  exactly that. All manifest patches now queue on one chain.
- **A DragonBones armature ignored its Color.** The field was in the inspector and
  did nothing — the runtime's ABI had no tint entry point, so the value was
  authored, saved, and dropped. It tints now, and **multiplies** each slot's own
  colour rather than replacing it, so what an artist set in DragonBones Pro
  survives being tinted. Opaque white is the tint that changes nothing, which is
  what makes clearing the field restore the original instead of leaving the last
  colour stuck. Per entity, so one of two figures sharing a skeleton can be tinted
  alone.
- **Three engine systems declared an execution order that never reached the scheduler.**
  `defineSystem` accepted `runBefore` / `runAfter` and then discarded them, so the
  character controller was not in fact running before the physics step, and neither drag
  system was running after UI interaction — each landed wherever registration order
  happened to leave it. Edges now travel with the definition and combine with whatever the
  registration site or the enclosing set adds, rather than one silently replacing the
  other.

## [0.35.0] - 2026-07-28

A second skeletal runtime. Estella has animated Spine skeletons since 0.19.0;
DragonBones is the one most Chinese studios author in, and until now the only way
to use it was to export something else. It runs everywhere the engine does — the
editor viewport, Play, web, playable ads, mini-games, and compiled into the iOS
and Android hosts.

Also: the editor can now create a plugin rather than only load one, it updates
itself instead of handing you a link, and a game that you leave stops rendering.

### Added

- **DragonBones animation.** Drop a `_ske.json` (or `.dbbin`) and its `_tex.json`
  into a project and they import as one asset type, the way Spine's `.skel` and
  `.atlas` do. **Create → DragonBones** makes an entity; the Details panel picks
  the armature and the animation from dropdowns filled by reading the file the
  entity points at, so you choose from what is actually in it rather than typing a
  name and finding out at runtime. The armature poses in the viewport as you edit —
  changing the animation, the scale or the flip shows immediately, without pressing
  Play.

  Two things differ from Spine, and the editor says so rather than papering over
  them. A DragonBones file is a *project* holding several armatures, so choosing
  one is a real step; and blending happens when an animation starts, not from a mix
  table set on the skeleton, so a crossfade is `fadeIn(name, seconds)` and the
  component carries a **Fade In Time** used on the first play too.

  Entities pointing at the same pair share one parsed skeleton and one atlas — ten
  of a character parse the file once. A packaged game carries the runtime only if a
  scene actually uses it: nothing is fetched, inlined or copied for a project
  without an armature in it.

  The new `dragonbones-demo` example is the whole feature in one scene.

- **The editor creates plugins.** The plugin system could load and run one but
  never help you make one — the guide's first step was "create the folder". There
  is a scaffold now: the manifest, an entry, a tsconfig and the typings sidecar it
  points at, with the id validated by the same function the loader uses, so the
  dialog cannot accept a name that would later be rejected. What a loaded plugin
  contributes is listed, and a plugin ships as a single file.

- **Settings → External Tools.** The script editor, the image editor and the
  browser. The script row is not a blank field: the editors actually installed are
  detected and offered, and leaving it alone means *automatic* — which names the
  one it would pick, so the row answers "what happens if I do nothing?".
  A code editor is handed the PROJECT and then the file, because a `.ts` opened by
  itself has no tsconfig: the SDK types staged into the project resolve to nothing
  and correct code gets red squiggles. Which arguments a program wants is derived
  from what it IS — its executable's name — so a VS Code browsed to by hand, in a
  directory nobody would guess, still opens the project. Anything the catalogue
  does not recognise gets the file alone: a paint program handed a directory would
  open the project folder as an image. A slot is registered rather
  than hard-coded — an asset type declares which kind of program opens it, the way
  it already declares its icon — so a plugin's type can say "open me the way
  scripts are opened", or bring a slot of its own, and the settings page grows a
  row without knowing it exists. Paths are per-user: an absolute path to an
  executable is true of one machine, and in project settings it would be committed
  and then be wrong for everyone else who opened the project.

- **The editor updates itself.** Until now an update notification could only hand
  over a link: the build is unsigned, and silent auto-update needs a signature it
  did not have. The check, the download and the install are now the editor's own —
  progress reports into the toast that announced the update, and the button becomes
  Restart when the download lands. The download comes from whichever source
  answered the check, mirror before origin, so it is as fast as the check was.
- **The macOS build ships a zip alongside the dmg.** Not a second thing to
  download — it is what an in-place update installs from. Squirrel.Mac swaps in a
  whole signed `.app`, which a dmg is not.
- **Releases can be signed and notarized.** `release-desktop.yml` reads five
  optional secrets (`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). Unset — on a fork, or before a
  certificate exists — the build still produces installers, and the editor keeps
  handing macOS users a link, because it checks its own signature before offering
  to update in place rather than discovering the problem after a 200 MB download.
- **The mirror publishes the updater's feed, and proves it.** `latest.yml` and
  `latest-mac.yml` are copied beside the very files they name, under their real
  names, so nothing has to be rewritten and no url is composed. Every file the
  channel files name is then fetched over the public base, and the mirror job fails
  on a miss — a feed naming a file nobody can fetch is an update that dies at the
  download.

### Fixed

- **A game you left kept rendering, and the phone got hot.** The Android host's
  frame loop had no pacing of its own: it called the frame immediately, forever,
  and trusted the swapchain's vsync present to be the thing that slowed it down.
  When a present did not block — a surface being torn down returns instead — the
  only brake was gone. A backgrounded demo was found 11.5 million frames in,
  holding a quarter of a CPU core to draw about one frame a second. The display
  drives the frame now, through the Choreographer, which is what iOS already does
  with a CADisplayLink and the web does with `requestAnimationFrame`; and frames
  stop when the game is not the thing you are looking at. Backgrounded, it now uses
  no measurable CPU at all.
- **Animations ran fast on a high-refresh phone.** The host stepped the game at a
  fixed 1/60s while presenting at whatever the panel runs at, so a 120 Hz device
  played everything at 2.02× — which reads as "the animations are too quick"
  rather than as a clock bug, and is why it lasted. A frame now reports the time
  that actually passed, clamped the same way the web loop clamps it, so a game
  behaves the same after a stall wherever it runs. Fixes iOS and Android together.
- **Double-clicking a script did nothing.** The open table only knew about editors
  the editor ships, so every type without one — `.ts`, `.js`, `.esshader`, `.png` —
  fell off the end of it in silence. Opening now always resolves to something: the
  editor's own editor, then the program set for that kind of file, then whatever
  the OS opens it with. The Content Browser's **Open** entry appeared for folders,
  scenes and materials only, standing in for "is this openable at all?"; that
  stopped being a real question, so it is offered for everything.
- **Reordering in the Outliner did not change what you saw.** Scene order is paint
  order within a sorting layer, and the viewport kept drawing the old one until the
  scene was reopened — so a drag changed the saved file, Play and the exported game
  while the thing in front of you disagreed. Measured on three overlapping sprites:
  identical pixels after the drag, a different picture after reopening. Order is a
  projected change like every other one now.
- **A field driven by a controller ignored your edit.** Details showed the
  component's own value, took the change, and the gear overwrote it from the
  current page on the next frame — with nothing to say the field was driven,
  because the marker only appeared while the Controllers strip had a controller
  selected. Being driven is a fact about the scene, so all of it is read from the
  binding now: the field shows what applies, says it is driven, and an edit reaches
  the page it belongs to.
- **A clicked button stayed lit.** Pressing focuses it (so Enter and Space act on
  what you clicked), the driver ranked `focused` above `normal`, and the Button
  prefab painted `focused` the same grey as `hover` — so a mouse-clicked button
  wore the hover look until focus moved somewhere else. Reported by someone who
  recoloured `normal` and never saw that colour again. Focus now has a colour of
  its own.
- **The update toast's Download button 404'd.** It opened a directory url that
  object storage has never served — for anyone, on any release. It was composed in
  two places and verified in none; both now use the link the release job already
  publishes.

## [0.34.1] - 2026-07-27

0.34.0 made a game packageable for Android. This one makes the package
installable — it was refused by the phone, twice, for reasons no check we had
could see.

### Fixed

- **Android: the packaged APK would not install.** `android:configChanges` and
  `android:screenOrientation` are names for numbers. Shipped as the strings they
  look like, the platform runs `Integer.parseInt` over them and gives up on the
  whole package (`INSTALL_PARSE_FAILED_UNEXPECTED_EXCEPTION`, naming the flag
  list it could not read). Both encoders now resolve those through one table of
  AOSP's values, so the APK's manifest and the bundle's cannot disagree about
  what a word means. It then still would not install: an activity with an intent
  filter and no explicit `android:exported` is refused on Android 12+, and ours
  declares one — which the platform could not find, because it reads attributes
  by resource id with a search that assumes the array is sorted, and ours were in
  document order. They are sorted now. The regression tests read the compiled
  manifest the way the platform does, by resource id, rather than rendering it
  back as text — a decoder that prints the manifest shows the flags spelled out
  and looks correct, which is how this shipped.
- **Scrolling a dropdown's own list closed it.** The action name in an Events row
  is a suggestion list, and scrolling it dismissed it — so the only options
  reachable were the ones that happened to fit. Same for any Select with more
  options than its popover shows, and any long context menu. A popover is placed
  from a rect captured when it opened, so it has to close when the page moves
  under it; the listener that notices is on the window in the capture phase,
  because a scroll inside a panel reaches it no other way. What that caught as
  well was the list's *own* scrolling. It now ignores a scroll whose target is
  inside the popover — the one kind that means the list is being used rather than
  moved — and Menu shares the fix rather than getting its own.
- **A release publishes only once it carries everything.** 0.33.0 went public with
  no runtime templates, so every editor's Download button 404'd and nothing
  noticed; the job that uploads them then failed again while 0.34.0 was cut,
  because it runs the repo's own CLI without installing what that CLI imports. It
  now uses the shared toolchain setup like every other job, and the pipeline ends
  with a check that the draft carries both installers, both update manifests, the
  template index and a template per platform — naming whatever is missing — before
  flipping the release public.

## [0.34.0] - 2026-07-27

Shipping, continued. 0.33 made Android and iOS packageable; this release makes
what comes out of them **yours to finish** — Android exports an Android Studio
project beside the APK, so a game that has to add an SDK, a permission or an
Activity is no longer stopped by an assembled package it cannot open. The runtime
templates those targets need are published with the release for the first time,
and downloaded from a **mirror** that is asked before GitHub and proves itself
before being trusted.

Spine grew in both directions at once: **2.1 through 4.3**, which meant binding a
runtime that no longer exists as C and one that predates most of what the modern
one assumes. And the editor became extensible — plugins contribute inspectors,
overlays, tools, asset types and menus.

### Added

- **Spine, from a 2015 editor to the current one.** A project authored in Spine
  **2.1** or **4.3** used to open as nothing: the runtime reads the version out of
  the skeleton, and neither matched anything the engine vendored. Both now do, so
  the supported set is **2.1 / 3.8 / 4.1 / 4.2 / 4.3** — each a WebAssembly backend
  loaded only by a project that uses it. 4.3 could not simply be added: that
  release deleted the hand-written C runtime and regenerated it as a wrapper over
  the C++ one, so the module binds spine-cpp directly and renders through spine's
  own `SkeletonRenderer`. 2.1 is the opposite end — colour as loose floats,
  weighted meshes as their own attachment type, no clipping and no transform or
  path constraints — and its runtime shipped **no binary reader**, so a `.skel`
  from that era is refused by naming the export setting to change rather than
  failing as a corrupt file. Export 2.1 skeletons as JSON.
- **Android: export the project, not only the package.** *Package as* in the
  Android section now offers an **Android Studio project** beside the installable
  APK — the route for a game that has to add an SDK, a permission, a service or an
  Activity of its own, which an APK is a dead end for. It is an ordinary Gradle
  project: your content under `app/src/main/assets`, the engine's prebuilt
  libraries under `jniLibs`, the host's Java shim as source, and identity in
  `app/build.gradle.kts` where AGP reads it. Both outputs come from the same
  runtime template, so the choice costs nothing. **Re-exporting rewrites the game
  and leaves the build scripts alone** — a project that has grown an SDK survives
  its game being rebuilt.
- **Downloads come from a mirror, and prove themselves before being trusted.** The
  editor asks a Cloudflare copy of each release before GitHub — measured at **3.0
  MB/s against 2.0** from Shanghai — for both the runtime templates and the update
  check. Preferring a mirror is safe because trusting one never was: every archive
  is checked against the size and SHA-256 the release's index states, and a copy
  that is missing, stale, truncated or substituted fails that check and hands the
  download to the next source, ending at GitHub. `ESTELLA_RELEASE_MIRROR` points
  the editor at a company share, an offline copy, or nothing at all.

- **One package installs on a phone AND in an emulator.** A runtime template is
  now one artifact per PLATFORM rather than one per architecture — iOS already
  worked that way, with both slices inside one xcframework — so the Android
  template carries `arm64-v8a` and `x86_64` together and every package it
  assembles offers both. Nothing to choose, and no second template the editor
  would never ask for.
- **iOS: the first launch after an install is as fast as the rest.** The runtime
  template now carries the SDK's precompiled bytecode on iOS as it already did on
  Android, and the export ships it as a bundle resource — so the host reads the
  compile instead of parsing a ~700 KB bundle on first run. Measured in the
  simulator: **4.5 s → 9 ms**. And when bytecode is declined for any reason, the
  host now says which source it declined and why, rather than silently falling
  back to a parse that only shows up as a slow launch.
- **A packaged game carries its own icon.** *Project Settings → Packaging → App
  Icon* takes one square PNG (1024×1024 is ideal) and every installable target
  uses it: Android as the launcher mipmap, iOS as the asset catalog Xcode derives
  its sizes from. Nothing resizes it — both platforms scale, so one image is all a
  project keeps. Android needs a resource table for this (`android:icon` must be a
  reference, not a path), and that table is now written directly in both encodings
  — `resources.arsc` for the APK, `resources.pb` for the bundle — rather than
  bringing aapt2 back to build one. Projects that set no icon ship Estella's mark
  instead of the platform's placeholder.
- **Google Play: Package Project writes the App Bundle (`.aab`) too.** Play has
  required a bundle rather than an APK for new apps since 2021, so packaging for
  Android stopped at sideloading. Tick **Google Play App Bundle** in the Android
  section (or `cli native --package --aab`) and the export writes one beside the
  installable APK — the same content from the same template, with the manifest in
  aapt2's protobuf encoding and a JAR signature, which is what a bundle is. Still
  no JDK: the PKCS#7 block is written directly. The manifest is parsed once and
  written twice, so the bundle and the APK cannot describe different apps — a test
  decodes both and compares them, and CI validates the bundle with `bundletool`.
- **Runtime templates are published with the release, and the editor downloads
  them.** The Android and iOS rows offer **Download** (with progress) beside
  *Install from file…* for offline installs and mirrors. What is downloaded is
  checked against the digest in `native-templates.json`, which the release
  publishes beside the archives — a truncated download, a proxy's cached copy or a
  captive-portal login page fails by name instead of installing as a broken
  template. Dawn and QuickJS-ng are now **pinned** in `toolchain.manifest.json`
  and fetched by `cli native --fetch-deps`, which also removes the hand-run cmake
  recipes from `native/README.md`: the build produces Dawn for a target the first
  time it needs it, so CI and a contributor run the same two commands.
- **Android: Package Project hands back a signed APK, with no Android SDK.** With
  the Android runtime template installed, the editor compiles the manifest to
  binary XML, writes the aligned zip and signs it with **APK Signature Scheme v2**
  — so packaging needs no aapt2, no zipalign, no apksigner and no JDK, on whatever
  OS the editor is running on. Signing uses a development key generated on first
  use (an RSA key and a self-signed certificate in PEM, inspectable with
  `openssl`); `--key`/`--cert` sign with your own. Native libraries now ship
  **uncompressed and 16 KiB-aligned** (`extractNativeLibs=false`), which the OS
  maps straight out of the package — a smaller install, and the posture Android
  15's page size wants. Each of the three formats is verified against an
  implementation that is not ours: the signature by a from-spec Python verifier,
  the manifest by androguard and its resource ids by AOSP's own table, the archive
  by a real `unzip`.
- **iOS runtime templates — shipping to a phone no longer needs the engine
  sources.** A native app's compiled half (the engine, Dawn, QuickJS, the linked-in
  Box2D / Spine / video runtimes) carries no project data, so it is now built once
  per release and shipped as a **runtime template** you install into the editor,
  instead of every developer cloning the engine, building Dawn (multi-GB) and
  installing a CMake/Ninja/xcodegen toolchain to package a game. **Package Project
  → iOS** with one installed writes a complete, double-clickable Xcode project
  around the exported content — the only thing left is Xcode itself, which Apple
  requires. The iOS row says which template it wants and installs one from a file;
  a template is matched **exactly** against the editor's version, because the SDK
  bundle is compiled into the app binary. `cli native --target ios` emits the
  template for the machine it built on (`--template-out` writes the distributable
  archive), so an engine checkout is now only what *produces* a template, never
  what consumes one.

- **Editor plugins.** Extend the editor with your own TypeScript: commands (with
  keybindings, palette and menu entries), dock panels, Inspector sections,
  viewport gizmos and tools, asset types, entity templates, settings, and
  Outliner/Content-Browser context-menu rows. Plugins live in
  `.esengine/plugins/<id>/` (or per-user, across projects), need **no build
  step** — the editor compiles them and re-compiles on save, re-activating the
  plugin and reopening its panels — and get full typings with nothing to install:
  the editor writes `@estella/editor-api`'s declarations into the project so they
  always match the running editor. A plugin registers through the same registries
  the editor's own features use, so a contributed command *is* a command and a
  contributed panel *is* a dock panel; scene edits go through the editor's command
  layer, so they are undoable and survive Play → Stop. Errors are attributed in
  the Output Log, timed in the profiler, and a repeatedly-failing plugin is
  disabled rather than allowed to break a surface. See the
  [Editor Plugins](https://esengine.github.io/estella/guides/editor-plugins/) guide.

### Fixed

- **Spine: a mesh weighted to more than three bones corrupted the heap.** The
  vendored spine-c read a weighted mesh's vertices into a buffer sized for three
  bones per vertex, and a fourth wrote past the end — so a binary skeleton whose
  meshes bind more bones than that could take out whatever was next to it in
  memory. Upstream's fix grows both buffers; the 4.2 runtime is updated to it.

- **The iOS host did not compile.** A `__weak` reference had landed in
  `platform/ios.mm`, which builds under manual reference counting — so every iOS
  build had been failing since. Now `__unsafe_unretained`, which is what a
  non-owning reference means in that file.
- **`cli native --target ios` merged whatever slices it found.** Building the
  device slice and then running in the simulator quietly linked a months-old
  simulator slice, so the app under test was not the engine that had just been
  built. The framework step now names a slice that predates the SDK bundle
  compiled into it.

### Security

- **Project platform profiles now require approval.** A `.esengine/platforms/*.mjs`
  packaging profile is imported into the editor's main process with full system
  access, and used to be loaded with no prompt the moment anything asked what
  platforms a project could package for — while the *less* privileged renderer
  plugins were gated. Both now pass one trust prompt and appear in one list
  (Window ▸ Plugins). An unapproved profile is not imported at all, and says so in
  the Package dialog instead of showing an unexplained not-ready target. The file
  format is unchanged; existing projects need no migration, only a one-time
  approval.

## [0.33.0] - 2026-07-26

Shipping. Two targets stopped being foundations and became things you can
actually upload: 0.32's native mobile host became **Android** and **iOS** rows in
the Package dialog with no subsystem left un-ported, and the **playable** target
grew per-network profiles. Every ad network disagrees on three things — how big
the file may be, what must sit in `<head>`, and which function sends the player to
the store — so those three are now a per-network **profile**, and the networks the
editor ships are written against the same contract a project uses to add one we
don't. The rest came out of packaging all 41 examples for web and playable and
booting every single one, which is how the bugs below were found rather than
shipped. No project/asset format or WASM ABI break.

### Added

- **Android and iOS package from the editor.** 0.32 shipped the native platform
  seam; this release makes it a target you pick. Two rows, not one "Mobile": they
  package through different toolchains (aapt2 + apksigner vs Xcode), so a single
  row could not say what to run, whether this machine can run it, or where the
  package comes out. The export writes app **content** (the engine, SDK and game
  runtime live in the app binary) plus an `app.config.json` carrying the identity
  the OS needs; `cli native --package` assembles it, and an iOS export writes the
  **Xcode project** itself when the engine is built for iOS on that machine.
  A missing native toolchain is reported as a *different severity* from a missing
  engine runtime — the content is written either way, and assembly can run on
  another machine.
- **Every subsystem now runs on a device.** Physics, Spine, video, text (OS-font
  glyph rasterization), materials and `.esshader`, KTX2 with mip chains, audio
  (miniaudio), the platform soft keyboard, HTTP over the OS stack, app lifecycle
  and memory warnings. The three that ship as WebAssembly side modules on the web
  are compiled into the host binary instead, and `app.sideModules` still answers
  for them, so the runtime's feature gating is unchanged. The export names any
  subsystem a target cannot render, with the scenes that use it, rather than
  quietly shipping half a scene — no target currently has a gap.
- **`alwaysInclude` asset groups.** A build ships what it can *reach* from the
  entry scenes, which is blind to anything only code names: a texture in rich-text
  markup, a clip played by url, a prefab spawned by path. Those were culled, and
  the first anyone heard of it was on a device, because the editor serves the
  project straight off disk. A folder can now say `alwaysInclude`
  (**Content Browser → right-click → Delivery**), in the same `asset-groups.json`
  that already decides local / subpackage / remote. Off by default: reachability
  is what keeps a build from shipping everything.
- **Playable ad networks.** A network is a `PlayableAdProfile` — data plus two
  emit hooks — chosen in **Package Project → Playable → Ad network**, where the
  other per-build decisions already live (shipping the same game to several
  networks is an ordinary week, not a project property). Each network gets its own
  output folder, so packaging for one no longer overwrites the last. Ships Meta,
  Google App campaigns, Unity Ads, AppLovin and a generic MRAID profile, each
  written from that network's published spec with its size cap attributed to where
  the number came from — a stale figure is then checkable rather than folklore.
- **A network the editor doesn't ship.** Drop `kind: 'playable'` in
  `.esengine/platforms/<id>.mjs` (or scaffold it from the dialog) and it appears in
  the same dropdown, resolved by the same loader, packaged by the same pipeline —
  supporting a network is never a privileged path. The selected profile names the
  file that defines it with a reveal button, and one that fails to load reports why.
- **`playableCta()` / `hasPlayableCta()`.** The one call a game makes when the
  player takes the call to action. Game code never names a network: the export
  injects the bridge this dispatches through, and with no network selected it is a
  no-op, so the same scene still runs in the editor and on the web.
- **ZIP delivery.** A profile can declare `delivery: 'zip'` (Google accepts only an
  archive); the export writes `playable.zip` with `index.html` at the root and
  measures the LIMIT against the archive, since that is the file being uploaded.
  The writer is deterministic — a fixed timestamp, so the same input yields
  byte-identical output — and is tested against the system `unzip`.

### Changed

- **A playable no longer pins screen orientation.** Inside an ad SDK the container
  is the SDK's business, so `@media (orientation:portrait)` reports the container
  and turning the phone need not change it — the rotate-to-fit overlay could hide
  the canvas for good. Playables stay responsive (every network asks for that);
  the orientation is only *declared* where a platform wants it, e.g. Google's
  `ad.orientation` meta tag. The web export keeps the overlay, where a player
  opened the page themselves and the query really does track the device.
- **The `-t playable` engine target is retired.** It built `esengine.single.js` and
  an inline demo HTML template that nothing had read for a long time — the playable
  export inlines the WEB runtime (glue as a blob module, wasm as base64). Its sync
  mapping was also what `wasm.manifest.json` derived its variant list from, so the
  manifest now names the two variants that exist. The guides stop telling you to
  run it before a first playable export.
- The Package dialog no longer resizes under the cursor when you switch target: its
  height came from its content while the dialog is centred, so every switch jumped
  the window. Fixed height with a viewport cap, content column scrolls — the way
  the settings dialog already worked.

### Fixed

- **A playable's video played nothing.** The scene loader installed the realm's
  `resolveRef` as the video resolver, so a clip ref resolved only to a logical
  path. On the web that path IS the URL, so it played; a single-file playable has
  no such file, so every clip drew a blank white quad. Ref → path → the backend's
  URL for that path, which is the inlined data URL for an embedded realm.
- **A web build's own orientation-lock script was blocked by its CSP.** The policy
  listed the import map's hash only, so the browser refused the sibling inline
  script: every export logged a violation and shipped without the lock. Both hashes
  are now derived from the source that emits them, gated by a test that hashes
  whatever inline scripts the page actually has.
- **The installer carried local export output.** The examples/templates filters
  excluded `**/dist/**`, but an export writes `dist-<platform>` — so whatever a
  developer had exported rode along inside the example it came from (57MB of
  examples, 43MB of it stale packages). CI escaped it because those dirs are
  gitignored, which is why it went unnoticed.
- **`dist` claimed to build installers but skipped `bundle-mcp`**, so a locally
  built installer declared `dist-electron/mcp` in `asarUnpack` with nothing behind
  it. Both dist scripts now go through `build`, the single producer. (CI runs
  `build` separately, so published releases were intact.)
- A playable ad network created from the dialog is selectable immediately instead
  of only after reopening it, and stays findable afterwards.

### Performance

- **Fresh-install-to-first-frame on a device: 14.4s → 0.6s.** QuickJS is an
  interpreter and parsing the SDK bundle costs about fourteen seconds; the host
  cached that compile, but a cache does not exist until one launch has paid for it
  — and that launch is the one right after an install. The bytecode is now built
  with the app and rides along in its assets, each source carrying a hash of the
  bundle it came from so a stale one is skipped rather than trusted. Best effort:
  a build machine without a compiler still produces a working app.
- **Physics on a device solves across worker threads**, syncs transforms in bulk
  and interpolates in the module, and recomputes parented membership with the
  reconcile rather than per step. Android is told the frame loop has a deadline
  (ADPF).

## [0.32.0] - 2026-07-23

Reaching further. Where 0.31 was about authoring gameplay over your art, this
release extends **where an Estella game runs and how it ships its content**: a
foundation for a true native mobile host (embedded Dawn + a JS engine, not a
WebView), content-addressed hot-update with CDN / subpackage asset delivery,
custom GLSL shaders that now run on the WebGPU backend with zero author effort,
and a modern text-input stack (multiline, IME, rich text). Underneath is a pass
that single-sources a set of platform, asset and shader declarations. No
project/asset format or WASM ABI break — your projects open unchanged.

### Added

- **Native platform foundation** (pre-1.0; the host itself is unshipped). A
  DOM-free `PlatformAdapter` and an injected `NativeBridge` let the same engine
  wasm + TS SDK run on an embedded Dawn (WebGPU) + JS-engine host on iOS/Android
  — a real native app, not a WebView — through the new `esengine/native` entry.
  The C++ renderer gained a native window surface seam
  (`WebGPUDevice::configureSurface(NativeSurface)`) so a host can hand it a
  `CAMetalLayer` / `ANativeWindow`, the C++ counterpart of the TS
  `RenderSurfaceSource { kind: 'webgpu' }`. A headless no-JIT frame benchmark
  proxies the iOS interpreter constraint, so the form factor is measurable
  without a device.
- **Content-addressed hot-update + asset delivery.** A shipped game can update
  its assets without a rebuild: every asset URL is its content hash (immutable,
  cacheable), an update is a manifest diff, and applying one is atomic with
  download-integrity verification and rollback — scene `@uuid` refs to remote
  assets rebind transparently. Assets group by folder into **local / subpackage /
  remote (CDN)** delivery from one `.esengine/asset-groups.json`, authored in a
  new editor GUI with per-build CDN profiles and an offline on-disk content cache.
- **Custom shaders on WebGPU.** A `.esshader` authored in GLSL now runs on the
  WebGPU backend with no manual step: the editor generates its WGSL twin from the
  GLSL when the project opens (GLSL stays the single source; the WGSL twin is a
  generated derivative), regenerates it when the GLSL changes (a stored
  source-hash detects staleness), and CI enforces twin coverage and freshness.
- **Modern text input.** `TextInput` gains multiline caret / selection / click
  across `\n`-broken lines, live IME preedit with the candidate window anchored
  at the caret, and inline `<img>` runs in rich text — a hidden textarea is the
  single editing source of truth.

### Changed

- **Single-sourced platform, asset and shader declarations.** The platform
  adapters now share one primary-pointer synthesis (and the mini-game adapter
  finally releases the pointer on touch-cancel), one capability-surface shape
  (audio and video backends are optional and default to a silent Null;
  `unbindInputEvents` is declared rather than `as any`-reached) and one
  device-pixel-ratio facade; the asset delivery-mode vocabulary is exported once
  and the editor derives its menu and badges from it; remote-vs-local asset URL
  routing resolves one way; and the Tiled object shape→collider decision is one
  function shared by the runtime and scene paths.

### Fixed

- Render-texture minimap example rendered upside-down.

## [0.31.0] - 2026-07-22

Authoring a game on top of your art. Where 0.30 sharpened the editor itself,
this release is about **building playable levels over a single background image**
— paint collision, drop gameplay markers and trigger areas as real entities, and
edit every collider shape by hand, all without a tileset. The other half is a
pass over the **inspector and UI authoring**: progressive disclosure, a visual
flex-layout editor, an anchor grid, and shaders you can finally see, share and
switch. No project/asset format or WASM ABI break — your projects open unchanged.

### Added

- **Collision (obstacle) layers.** A tilemap layer that references the built-in
  `builtin:collision` palette instead of an `.estileset`: paint solid / slope /
  half / one-way / sensor cells straight over any background (e.g. one big
  image) and they spawn static colliders at Play, shown live by the tile-
  collision overlay. It renders nothing and reuses the whole tile→collision seam
  (chunk store, paint tools, greedy box merge, one-way/sensor). Each layer can
  carry its own **physics material**.
- **Markers + Trigger Areas — native object placement.** The modern "object
  layer": place gameplay objects as real ECS entities, not a parallel object-
  group structure. `Marker` is a named point (spawn / waypoint / location) you
  can `Query(Marker)` and filter by `type`, with a custom **key→value property
  map**; "Trigger Area" is a Create preset (Transform + static RigidBody + sensor
  BoxCollider + Marker) that reuses the unified collider gizmo for shaping. Both
  serialize, edit in the Inspector, and are query-able — no C++/ABI change.
- **`.tmj` object groups converge onto real entities.** Imported Tiled point
  objects become queryable Markers, shape objects become Trigger Areas, and every
  object-group shape now rides one edit-visible region path instead of a
  `.tmj`-only structure.
- **Hand-editable collider shapes.** Drag a circle's centre + radius, drag
  polygon vertices, pick the one-way direction (no longer always up), and set the
  per-tile collision material — all inside the shape editors. An always-on
  collision overlay and Marker pin gizmos keep it visible while you work.
- **Shareable shaders.** `.esshader` is now a first-class asset type (SHD badge),
  not an auto-spawned mystery file. The material inspector's Shader section picks
  from built-in templates + every project `.esshader`; switching re-reflects the
  parameter surface, and several materials can point at one shared shader.
- **A modernized inspector.** Progressive disclosure collapses noise by default;
  a visual flex-layout section with editable padding, a clickable 3×3 anchor grid
  (shared with the flex widget), and an inline Controllers strip bring UI
  authoring inline.
- **Multi-selection align + distribute tools**, **Tilemap in the Create-entity
  picker**, and **animation-frame reordering with a set-uniform-duration action.**

### Fixed

- **Render targets no longer trip a GL feedback loop.** A target's own texture
  could stay bound to a sampler while it was drawn into — undefined per the GL
  spec, and a per-frame `GL_INVALID_OPERATION` on some drivers (it fired every
  frame in the render-texture example). The device now detaches a target's
  attachments from every sampler slot when the target is bound.
- **A persistent entity that outlives a scene unload is promoted to global**
  instead of being dropped with the scene.
- **`Mut()` write-back records `Changed` for builtin components**, so change-
  detection queries see edits made through a mutable handle.

### Performance

- **Retained Yoga node tree.** The UI layout keeps its `YGNode`s across frames
  instead of rebuilding them, and skips the layout solve entirely on a fully
  static frame.

## [0.30.0] - 2026-07-21

The editor grows up. Where 0.29 was about the prefab system, this release is
about the **editor itself** — a top-to-bottom pass over how it feels to use.
Selection, transforms, play mode, the data panels, the asset editors and the
global chrome were all audited against Unity, Unreal and Godot and rebuilt for
correctness, consistency and keyboard/accessibility parity. Nothing here changes
the SDK API, the project/asset formats or the WASM ABI — your projects open
unchanged; the editor around them is sharper.

### Added

- **Maximize On Play + focus mode.** An opt-in "Maximize Viewport on Play" (in
  the play dropdown) hands the whole workspace to the running game, restored on
  Stop; **F11** toggles a focused viewport any time. The live canvas is only
  hidden behind the maximized group, never remounted, so the engine keeps
  running.
- **Content Browser multi-select + batch operations.** Ctrl/Shift-select ranges,
  Ctrl+A, batch delete behind one confirmation with a single undo, and
  multi-asset drag into folders. The Sources folder tree gains a right-click
  context menu and inline (F2) rename.
- **A viewport mode chip** you can click to open a mode's companion tools, and
  **sticky mode pins** — an explicit Scene/UI/Tilemap lock that ordinary clicks
  no longer clear, so you can paint tiles or lay out UI while selecting other
  things.
- **One shared empty state** across every panel (Outliner, Content Browser,
  Sequencer, the graph editors…), each with a real call-to-action.
- **Runtime `.esanimator` loading by path**, so animation controllers resolve at
  runtime the same way other assets do.

### Changed

- **Calmer play-mode chrome.** The centered "● PLAY" pill that covered the game
  is gone — running now reads as a soft accent ring around the viewport (amber +
  dimmed frame when paused, so a frozen frame never looks like a hang). The
  primary transport is a real **Play↔Stop** toggle (Restart moved to a side
  button), and Pause swaps to a resume glyph.
- **Selecting a node no longer restructures your workspace** — it switches the
  mode's tools/overlays but never flings docked panels open over what you were
  doing. Opening a mode's panels is now an explicit gesture.
- **Unified node-graph editors** (State Machine, Behavior Tree, Material,
  Animator) — shared framing/fit-to-content, Add affordance, and empty states.
- **Consistent inspector controls** — every dropdown runs on one
  keyboard-navigable, ARIA-correct listbox; vector fields show mixed values
  per-axis; number fields honor each field's step/range.
- **More actions reachable as commands** — Restart, the performance overlay,
  Reset Layout, and the Help menu items are now real, rebindable commands in the
  Command Palette; Build/Compile/Package are disambiguated.

### Fixed

- **Scale gizmo no longer explodes near the pivot.** Scaling is delta-based off
  the gizmo's on-screen size instead of a distance ratio, so grabbing the center
  box or an entity's body can't produce a runaway factor. Rotate and scale
  snapping now snap to an absolute grid (15°/30°, 0.1 increments), and Alt-drag
  clones only once you actually drag — a bare Alt-click no longer stacks a copy.
- **The zoom % readout is honest**, derived from the real view scale so it stays
  correct through Frame Selected, the minimap and device presets.
- **Several data-loss paths sealed.** Delete/Backspace can no longer fall through
  from the Tileset/Flipbook editors — or past an open context menu, popover or
  dialog — to silently delete the scene entity behind them. Destructive confirm
  dialogs focus Cancel, so a reflexive Enter can't discard or delete. Escape now
  truly cancels a mixed-selection field edit instead of overwriting other
  entities; multi-select Add Component unions correctly.
- **Rebinding a shortcut warns on conflicts** instead of silently shadowing
  another command; global shortcuts are suppressed while a modal or transient
  overlay owns the keyboard.
- **Broad keyboard / focus / ARIA repairs** across the Outliner, Content Browser
  and inspector; context-menu and popover focus returns to its opener; the
  Content Browser footer and the inspector's property filter now do what they
  say.
- **Prefab robustness.** Apply/flatten no longer leak dangling or external entity
  references, re-parenting is a first-class override, and flatten is
  order-independent; Play is disabled in Prefab Mode (a prefab has no scene to
  run).
- **Post-processing survives a warm re-play.** Stopping and playing a scene with
  a Post Process Volume no longer black-screens on the second run: the shutdown
  path kept the render pipeline's own post-process object registered so the lazy
  re-init reuses it, instead of orphaning it behind a duplicate the renderer
  never drew through (which dropped the mandatory linear→sRGB encode).

## [0.29.0] - 2026-07-21

Prefabs grow up. What was a flat, copy-on-instantiate mechanism becomes a real
**prefab system with a stable identity model and a full editor workflow**: every
node in a prefab carries a hierarchical address, so instances track their source
through renames and restructures, and the editor gains the whole round-trip —
Prefab Mode, variants, apply/revert with a change preview, unpack, and
per-instance reference binding. Two more pillars land alongside it: an
**animation-controller editor** (the new `.esanimator` asset) with shared-Inspector
clip tooling, and four **advanced particle modules** — noise, sub-emitters, trails
and force fields — all pure-CPU, so they run byte-identically everywhere, WeChat
included.

### Added

- **Prefab identity model.** Every entity in a prefab now carries a hierarchical
  stable address (`slot` / `localId`) instead of a positional index, so an
  instance tracks its source entity across renames, re-parenting and structural
  edits. Deleting a node in a prefab cascades to every instance; adding one
  projects into them. A single strict validator (`validatePrefab`) guards the
  format and is enforced in CI.
- **Prefab Mode.** Double-click a `.esprefab` to open and edit its *structure* in
  the editor — reusing the Outliner, Inspector and Viewport — and save it back in
  place. You can enter Prefab Mode from an instance in the scene, and the
  return-flow drops you back where you came from.
- **Prefab variants.** Create a variant from an instance, then edit the variant's
  own structure in Prefab Mode with base-tracked saves; variant and nested-prefab
  resolution share one code path.
- **Apply / revert with a change preview.** Applying an instance's overrides back
  to its prefab first shows a diff of exactly what will change. Instances that have
  drifted from their prefab (stale overrides) are surfaced with a one-click
  clean-up.
- **Unpack Prefab** detaches an instance from its prefab, baking its current state
  into plain scene entities.
- **Prefab instances in the Outliner.** Instances read with a warm tint and a
  right-click menu (Select source / Apply / Revert), so a prefab instance is
  visually and functionally distinct from a plain subtree.
- **ExposeRef — per-instance reference binding.** A prefab that references an entity
  *outside* itself now leaves that reference unbound; each instance binds it in the
  Inspector, where entity-reference fields (builtin **and** project-component
  fields) render as a scene-entity picker. An unbound slot reads muted.
- **Animation-controller editor** (the new **`.esanimator`** asset). An
  `AnimatorController` graph — states, transitions, conditions and parameters —
  authored in a dedicated editor that mirrors the FSM graph model; the payload is
  the runtime def, with no compile step.
- **Frame events in clips.** `.esanim` v1.3 persists an optional `events[]`
  (`{frame, name, data?}`), and the Flipbook editor gains an events bar and
  frame-strip markers to author them (backward-compatible — 1.2 clips still load).
- **Clip preview stage.** The Flipbook editor replaces its static thumbnail with a
  checkerboard preview: the current frame over onion-skin ghosts of its neighbours
  (toggle + depth in the transport), plus a Loop Mode dropdown.
- **Shared-Inspector inspection channel.** An editor can push a sub-object
  selection — a Sequencer keyframe's value + interpolation, or a timeline's
  duration/fps/wrap — into the one shared Details panel, so keyframe and clip
  properties edit through the same `ComponentSection` engine as entities and
  materials. A shared Transport + Save button unify the animation editors.
- **Advanced particle modules** — all pure-CPU, byte-identical on every platform
  (WeChat included) and free when unused:
  - **Noise / Turbulence** — a divergence-free curl-noise flow field advects each
    particle (`noiseStrength`, `noiseFrequency`, `noiseScrollSpeed`,
    `noiseOctaves`).
  - **Sub-emitter** — fire a referenced child emitter's burst at a particle's birth
    or death (shell explosions, trailing puffs).
  - **Trail** — a per-particle ribbon that follows a particle's motion.
  - **Force Field** — directional / radial forces that push particles through a
    region.
  - **Floor collision** (Collision phase 1) — particles bounce off a floor plane.

### Changed

- **`.esprefab` is now format v2** (hierarchical identity). Projects migrate forward
  automatically on open, and a repo-wide **Resave All Prefabs** command plus a
  format gate keep a project's prefabs on the current version. Within the `0.x`
  line older projects continue to open; forward compatibility (an older engine
  opening a v2 prefab) is not guaranteed.
- Creating a prefab from an entity that references outside itself now asks to
  **expose** those references — they are left unbound for instances to rebind —
  rather than simply clearing them. Same clearing behavior, framed for the new
  ExposeRef workflow.

### Fixed

- The `sprite-animation` example's spritesheet demo is corrected, and its textures
  reference through stable `@uuid` refs.

## [0.28.0] - 2026-07-19

A hardening pass. No new pillars this time — instead a systematic, subsystem-by-
subsystem audit files the sharp edges off the runtime: audio buses, Spine, the
timeline, physics, tilemaps, the ECS core and the editor each shed a cluster of
lifecycle, teardown and correctness bugs that had survived releases. The one new
capability is a rendering one — **tilesets with padded atlases now sample
cleanly** — and the docs, examples and guides are trued up to match the fixed
behavior.

### Added

- **Tileset margin & spacing are honored end to end.** The `.estileset` / Tiled
  importer already parsed a tileset's `margin` (border before the first tile)
  and `spacing` (gap between tiles), but the runtime UV path was pure grid math,
  so any atlas with padding sampled an offset region and bled toward the
  neighbouring tile. Both values now carry all the way through to the per-slot UV
  offset/step (and the `setTilesets` slot table gains optional `margin` /
  `spacing`), so each cell samples its own texels; a gapless atlas is unchanged.

### Fixed

- **Physics.** The character controller's `skinWidth`, `maxSlides`, `snapLength`
  and `slideOnCeiling` were dead at runtime — the native mover hardcoded its
  iteration and ignored them; all four are now wired through, so skin margin,
  slide count, stair/slope floor-snap and ceiling-stop behave as their inspector
  tooltips promise. Kinematic bodies now carry riders standing on them, disabled
  bodies and re-parented joints behave, and a parented body's transform sync
  preserves scale.
- **Audio.** Ducking and BGM crossfades tear down cleanly, pooled nodes no longer
  cross-route or NaN the panner, a volume blend fades to each param's neutral and
  honors the global weight, concurrent preloads of one URL decode exactly once,
  and WeChat `stop()` is idempotent.
- **Spine.** Re-loading a Spine entity frees the old instance and skeleton, the
  plugin submits meshes once even after a manager swap, tint resets when cleared
  (mix duration is per-asset), and listeners are cleaned by entity rather than
  instance id.
- **Timeline & animation.** A looping timeline no longer double-fires events at
  the loop seam, keyframes default missing tangents to `0`, and tween
  composition completes while sprite animation keeps pace.
- **Tilemap.** Tile-collision queries honor the cell's flip flags, the animation
  clock uses a double accumulator (no drift on long runs), a tileset swap clears
  stale animations and collision, visible-chunk culling is orientation-aware,
  isometric `worldToTile` rounds to the containing tile, and a destroyed layer
  stops ticking.
- **Rendering & particles.** A rounded-rect's corner radius scales with the
  transform, looping particle sheets cycle instead of freezing on the last
  frame, `play()` before an emitter's first update isn't dropped, and
  `maxParticles` is clamped so bad data can't OOM.
- **Scenes, assets & materials.** A load cancelled by a concurrent unload can't
  orphan entities (it rejects with the new `SceneLoadCancelled`), scene unload
  releases materials through Assets and a reload restores a slept scene,
  materials release their bound textures on unload, scene serialization detaches
  from live world storage, an alpha-less `{r,g,b}` material color survives,
  resource defaults stop aliasing across worlds, and texture metadata survives an
  evictable release.
- **Core, plugins & networking.** `world.set` adds a missing builtin through the
  full insert path, `Removed` fires on despawn and duplicate names can't corrupt
  the name index, plugins retire their `onDespawn` subscriptions on cleanup, the
  gesture detector releases per-touch state on touch end, `createPolygon` guards
  a degenerate axis span against NaN UVs, locale plural forms are validated as
  strings at load, `playOnAwake` stops re-warning an un-preloaded clip every
  frame, prefab diffs keep entity refs in prefab-local id space, and netcode
  interpolation is frame-rate independent (a replication client's disconnect
  retires its subscription and state).
- **Editor.** Material-graph node params edit by their own key instead of a
  hardcoded `value`, editor state resets on a project/scene switch, and
  multi-select edits keep per-entity data in a single undo step.

### Performance

- Render batches dedupe redundant program + blend binds on a pipeline switch and
  pin a draw's unused sampler slots to white.
- The editor gets O(1) entity lookup, a gated pivot and cached ref-counts, and
  on-canvas handle drags suspend re-render (cancelling cleanly).
- The volume post-process rebuilds only when its effect set changes, query
  iteration precomputes its dependency ids, and timeline activation writes a
  component only when it flips.

### Documentation

- The guides are trued up to the fixed behavior: the character-controller tuning
  fields, tileset margin/spacing on `setTilesets`, and `SceneLoadCancelled` are
  now documented (en + 简体中文).
- The Editor guide and quick-start onboarding are refreshed, every guide that
  lacked them gains "See also" cross-links, and the custom-bus audio example is
  corrected (`playSFX` takes no bus option).

## [0.27.0] - 2026-07-18

The manual catches up with the engine, and the API learns to read one way.
The docs site grows from per-subsystem overviews into a **fine-grained manual**:
new foundational chapters finally teach what nothing taught before — that one
world unit is one design pixel, that `Canvas.pixelsPerUnit` is the physics
meter scale, how quaternion rotation works in 2D — and the UI manual splits
into nine subchapters written from source, in both languages. Eight new
examples cover every previously example-less pillar, and chasing them through
live Play runs flushed out real engine bugs that had been hiding for releases:
within a layer, **z now actually orders sprites**, and a `RenderTexture` can
finally be shown by a Sprite.

### Added

- **Foundational documentation chapters** (en + 简体中文). Core Concepts gains
  "Transforms, Units & Coordinates" (the Transform component, Y-up, the
  world-units-are-design-pixels doctrine, quaternion rotation and its
  helpers, parenting), "Screen & Design Resolution" (Canvas, every scale
  mode's fit math, `ScreenScaling`, why UI px are design px, safe areas) and
  "App Setup & Lifecycle" (`createWebApp`/headless options, the plugin
  model, lifecycle events, subsystem health, side modules, hot reload);
  Utilities gains "Profiling & Diagnostics" (stats overlay, `Logger`, frame
  capture, texture budgets).
- **The UI manual, split into nine subchapters** — Overview / Layout / Text /
  Widgets / Lists & Scrolling / Interaction / Theming / Data Binding /
  Controllers — documenting the previously invisible surface: dimension
  semantics and anchor presets in code, the real rich-text tag set, the
  focus/drag pipelines, the ListView virtualization contract, all twelve
  theme color roles, and two-way widget binding.
- **Eight new examples**, all verified in live editor Play runs:
  `camera-follow` (FollowTarget damping/dead zone, screen shake, view-target
  blends), `save-load` (versioned SaveManager slots with a live v1→v2
  migration), `scene-flow` (menu → levels through SceneManager fades over a
  persistent shell), `input-actions` (rebindable InputMap actions +
  gestures), `timers-demo`, `trail-demo`, `render-texture` and
  `drawing-demo` (immediate Draw, retained Graphics, procedural Mesh2D).
  The catalog also lists the previously uncatalogued `chat` and
  `ui-controller`.
- **Play == ship scene registration.** Pressing Play now registers every
  project scene under its export name (siblings lazily by path), so
  `SceneManager.switchTo` behaves identically in the editor and in a
  shipped build.
- `RenderTextureHandle.texture` — a resource-table handle components can
  actually consume (`Sprite.texture`, `UIVisual.texture`), registered
  through the same external-texture channel video frames use.
- The `Mesh2D` component and the animator sub-machine helpers
  (`enterStatePath`, `leafStateOf`, `evaluateAnimatorPath`) join the main
  barrel; Spine's wiring surface (`SpinePlugin`/`SpineEvents`/`Spine`) is
  mirrored into the main barrel exactly like physics.

### Changed

- **The public API reads one way** (breaking, pre-1.0). The physics class is
  now `PhysicsAPI` and the resource token `Physics` — `Res(Physics)` like
  `Res(Audio)`/`Res(Tween)` everywhere else. Six `Api`-suffixed classes are
  now `API` (`CameraViewAPI`, `SpriteAnimationAPI`, `AnimatorControllerAPI`,
  `PostProcessAPI`, `LocalizationAPI`, `TimelineAPI`). The deprecated
  `getAllRegisteredComponents` alias is gone (use `getComponentRegistry`).
- **One plugin-construction shape.** A lowercase `xPlugin` export is always a
  ready-to-add `Plugin` value; configurable plugins expose a PascalCase
  class. `lifecyclePlugin` is now such a value (configure with
  `new LifecyclePlugin({ autoPause })` — previously a factory call).
- **Plugin wiring moved to one barrel.** `webAppFactory` now only ships the
  app factories; the UI pipeline plugins, the physics/spine wiring and
  `PostProcessPlugin` live in a dedicated `core-plugins` barrel, the
  Timeline surface joined `core-content`, and engine-internal
  `init*/shutdown*API` functions left the public surface.
- **Director and scene APIs are callable from systems.** `setViewTarget`,
  `shakeCamera` and `transitionTo` accept the `CameraDirector` /
  `SceneManager` resource state alongside the `App`, so gameplay systems no
  longer need an App handle they cannot get.
- `Canvas.pixelsPerUnit` is documented (tooltip included) as what it actually
  is — world pixels per physics meter — and the abandoned
  texture-px-per-unit helpers on the C++ component are gone.

### Fixed

- **z actually orders sprites within a layer.** The draw sort key assumed
  z ∈ [-1, 1] and truncated: any real-world z wrapped through the bit mask
  and sorted non-monotonically, and the blended stages had the painter's
  order inverted. Depth now maps through order-preserving float bits —
  transparent draws back-to-front, opaque front-to-back.
- **Runtime-loaded scenes unload cleanly.** Entities of a scene registered at
  runtime carried the `SceneOwner` tag but were never adopted into the scene
  instance's entity set, so `switchTo` away from such a scene leaked every
  entity it had spawned.
- **`RenderTexture` + `Sprite` no longer renders white.** Pointing
  `Sprite.texture` at the raw device `textureId` sampled the white fallback;
  the new `texture` handle goes through the resource table.
- **PreviewPlugin's fallback camera un-zoomed.** It still derived its ortho
  size from the abandoned px-per-unit doctrine — a 100× zoom-in whenever a
  scene had a Canvas but no active camera.
- The physics guide's joint samples used a `world.spawn(Component, …)`
  overload that does not exist; unit contracts (meters vs world pixels) are
  now stated on `PhysicsAPI` itself and in the guide.

## [0.26.0] - 2026-07-17

Tilemaps leave the square grid, and projects make the UI their own. The editor
now **authors** isometric, staggered, and hexagonal maps natively — orientation
is a first-class layer property with its own grid overlay, brush ghost, and
New-Tilemap picker, not a read-only Tiled import artifact — and terrain
painting gains the modern **corner-Wang** model, where one terrain set blends
many terrains (grass ↔ sand ↔ water) painted on a half-cell corner grid. On
the UI side, a project can now **re-skin the built-in widget palette per color
role** from Project Settings, shipped to every runtime, and the UI editor gets
design-tool reflexes: palette drops nest into the container under the pointer
(with a live outline of the would-be parent), and anchor edits are per-axis
and never move the widget.

### Added

- **Native isometric, staggered & hexagonal map authoring.** The runtime
  already rendered all four orientations, but the editor could only author
  orthogonal maps. Orientation (+ hex side length, stagger axis/index) is now a
  first-class `TilemapLayer` property end to end: the New-Tilemap dialog gains
  an orientation picker, the Inspector shows the fields (hiding them when
  inert), and a pure tile-geometry seam (`tileCellCenter` / `tileCellOutline`,
  mirroring the C++ placement math) drives an orientation-aware grid overlay,
  selection/hover cells, and the brush ghost. Merging the C++ placement
  branches also fixes imported staggered maps ignoring `staggeraxis` /
  `staggerindex`. Three painted showcase scenes — an iso island, a staggered
  river patchwork, a pointy-top hex strategy map — ship in `examples/` with
  two small CC0 tilesets.
- **Corner-Wang (multi-terrain) autotiling.** Alongside the existing
  edge/corner-blob peering, a terrain set can now carry **colors** with each
  tile assigning a color to its four corners — the "circle in the corners"
  technique — so one set blends many terrains and the terrain brush paints
  colors onto a half-cell corner grid, re-tiling affected cells by exact corner
  match with a nearest-mismatch fallback. The tileset editor grows the color
  palette (add/rename/recolor/remove) and per-tile corner dots; a
  procedurally-generated 45-tile grass/sand/water demo set and a blended-island
  scene show it off.
- **Project-level theme color overrides, end to end.** Beyond picking
  dark/light, a project can now override the widget palette per color role:
  `features.ui.colors` carries a role → hex map validated against the theme's
  color roles, every runtime boot (web, play realm, WeChat, playable) resolves
  base + overrides before re-theming, and the export chain now ships the theme
  at all — it previously dropped `features.ui` entirely, so light/overridden
  projects shipped dark. Project Settings → UI grows a **Theme Colors** group
  with a full color picker per role (unset rows show the inherited base), and
  the edit viewport previews changes live, so editing, Play, and shipped
  builds resolve identically.
- **Palette drops nest into the container under the pointer.** A widget
  dragged from the palette used to always land at the Canvas root; the drop now
  hit-tests the UI under the pointer and parents into the deepest plain layout
  container, so dropping onto a panel or row nests Figma-style — and while
  dragging, the would-be parent shows a live dashed outline, distinct from the
  selection outline and cleared on drop/leave.
- **Per-axis anchor edits that never move the widget.** The anchor picker used
  to write both axes on every change, resetting the other axis' margins — a
  hand-positioned widget jumped on any anchor edit. Anchors now classify and
  write per axis, and applying one bakes the node's live resolved box into the
  pinned insets, so Start/End/Stretch keep the widget exactly where it was and
  leaving a Stretch axis freezes the resolved size. Plus viewport polish: the
  design-resolution label clamps into view, device presets snap the preview
  orientation to the design's aspect, and Dialog/TextInput get proper palette
  icons.
- **Tilemap editor reflexes.** Layer rows reorder by drag (on top of the
  context-menu move up/down), the random-brush toggle gets the **D** key while
  painting, and the terrain tool's no-terrains empty state now carries an
  **Open Tileset Editor** button instead of a dead-end hint.

### Fixed

- **Change-detection queries type-check in systems.** `defineSystem` rejected
  `Query(Added(...))` / `Query(Changed(...))` params at the type level even
  though the runtime fully supports them; the canonical `QueryArg` is now
  shared so the types can never drift again. (#52)
- **The painter toolbar no longer clips at narrow panel widths.** The tools
  row wraps instead of clipping the terrain/flip/rotate/random tools off the
  right edge at the default dock width, and the active-brush preview moves to
  the palette bar where it is always visible.
- **Non-orthogonal grid overlays no longer vanish on the left.** The
  shaped-cell overlay culled canvas-relative coordinates against page-relative
  bounds, dropping the whole left band of iso/hex grid cells whenever docked
  panels inset the viewport canvas.
- **Chat example bubbles read like chat.** Bubble text is left-aligned
  regardless of side and bubbles size to their wrapped text instead of a fixed
  width.

## [0.25.0] - 2026-07-16

The UI system grows up, and the editor breaks out of a single window. Widgets
stop being closures full of hidden state and become **data**: every stateful
control — button, toggle, dropdown, slider, dialog — carries its behavior in a
component driven by a system, so a Toggle or Dropdown placed in the editor is
fully functional without a line of code, keyboard access is on by default, and
any widget value can be two-way bound to a signal. One state mechanism —
`UIController` + `UIGear` — replaces the old per-entity `StateMachine` /
`StateVisuals` pair across the whole engine, and it doubles as an authoring
surface: a Controllers panel, gear dots on Details fields, and a record mode
that keys edits into the active page, all previewing live in edit mode. On the
editor side, any dock panel — and now the Viewport itself, engine canvas and all
— can pop out into its own OS window and move to another monitor. Tilemaps gain
rich per-tile collision you can author and *see*: circle, one-way, sensor, and
material shapes, slope presets, Tiled parity, and runtime tile-collision
queries — with the entity collider gizmo generalized to draw and edit all six
shapes through the same geometry seam.

### Added

- **The editor pops out into multiple windows.** Any model/store-driven dock
  panel — Inspector, Outliner, Content Browser, Console, the graph editors — can
  now be moved into its own OS window and dragged to another monitor, and so can
  the **Viewport**: the single engine canvas rides the DOM into the popout with
  its live WebGL context intact (a same-origin move preserves the context — no
  engine multi-instancing), Play-in-viewport works there too, and gizmo drags,
  keyboard, and resize all resolve to whichever window hosts the panel. Popouts
  are same-origin `window.open`, so a popped-out panel shares live selection,
  stores, and edits with the main window with zero cross-window messaging, and
  dockview restores the popouts after a reload. Works in the packaged app as
  well (the packaged renderer is served over loopback http to satisfy the
  same-origin requirement).
- **UI Controllers & Gears.** A `UIController` is a named set of "pages" scoped
  to a UI root; a `UIGear` binds any component field to per-page values that snap
  or tween as the page changes. It generalizes the old per-entity state pair into
  one shared, multi-page, any-field mechanism — no new asset type, no C++ — and
  it is not play-gated, so the editor previews a page the instant it changes. The
  authoring surface ships with it: a dockable **Controllers** panel, a gear dot on
  each Details field that binds it to the active controller, and a **record mode**
  that captures subsequent edits into the current page. Data-driven bridges
  (`ui.setPage`, `bindControllerPage`) drive pages from game code, and a bilingual
  guide documents the whole flow.
- **Widgets as data — and two more of them.** Toggle, dropdown, slider, and
  dialog behavior now lives in components + behavior systems rather than factory
  closures, so an editor-placed control just works: a dropdown closes on an
  outside click, a slider drags and takes arrow/Home/End keys, a dialog dismisses
  on Escape or scrim click — no code. Two missing widgets close the set:
  **`TextInput`** (with an Auto / Bitmap / SDF render-mode selector, clipping, and
  horizontal scroll) and **`ScrollView`** (the non-virtualized sibling of
  `ListView`), and `ListView` gains measured **auto-height** rows via a public
  `measureText`. `bindWidgetValue` gives two-way binding between a signal and any
  widget value. Text, Image, and Container primitives join the editor's Create → UI
  palette, and a **chat demo** (a `ListView` log + a `TextInput` composer) shows
  them together.
- **Keyboard accessibility, on by default.** Widgets carry a `Focusable`;
  Enter/Space synthesize a click on the focused control (text fields keep those
  keys), Escape or a click on empty space clears focus, and the interaction driver
  gains a `focused` state (disabled > pressed > hover > focused > normal). Modals
  trap focus, dropdowns take open-state keyboard navigation, overlays get proper
  scrollbars, and rich text word-wraps.
- **Rich per-tile collision you can author and see.** Tile collision grows beyond
  box|polygon: **circle** shapes plus cross-cutting **one-way** (solid-side
  normal), **sensor**, and **material** (density/friction/restitution) modifiers,
  authored with a brush-bar in the tileset editor and with **one-click slope /
  half-tile presets**. The same collision is now **drawn in the scene viewport**,
  shapes authored in Tiled's own tile-collision editor parse into the identical
  model (finite and infinite layers alike), and the runtime answers
  `tileCollisionAt` / `isTileSolid` / `tileCollisionAtWorld` with no physics
  raycast. `.estileset` files round-trip byte-for-byte.
- **One collider gizmo for all six shapes, convertible in place.** The entity
  collider gizmo — previously box + circle only — is rebuilt on the shared
  `ColliderShape` projection, so a polygon, capsule, segment, or chain collider is
  visible and its vertices are draggable for the first time, through the same
  geometry seam that draws physics debug and the tile-collision overlay. A
  segmented control on the collider's Details card **converts** box ↔ circle ↔
  polygon in place, preserving material, sensor, filter, and where you drew it,
  as one undo step.
- **More tilemap authoring reflexes.** A **probability-weighted scatter** brush
  (per-tile weights authored in the tileset editor), **hollow** rect/ellipse tools
  (Alt for an outline / ring), a **floating-selection move** (drag inside the
  marquee to lift a region and land it as one undo step, Esc to restore), and
  editor-convention muscle memory — modifier keys, a layer menu, and tileset batch
  authoring.
- **A project-declared UI theme.** Project Settings gains a UI section: the
  built-in widget palette (`light`; dark is the default) rides the same
  project-config channel as physics/audio to every shipped runtime — web,
  playable, WeChat — and applies at boot, re-tinting prefab-instantiated widgets
  to the project's palette.
- **A unified viewport grid control.** The grid display toggle joins grid snap in
  one place instead of two.

### Changed

- **One state mechanism — `StateMachine` / `StateVisuals` retired.** Widget
  interaction states now build from the shared `UIController($interaction)` +
  `UIGear` layer, and with no consumers left the legacy trio retires end to end:
  the TS components, systems, and `StateChanged` event; the C++ `StateMachine` /
  `StateVisuals` structs and the `VisualState` EHT entry (wasm rebuilt, ABI hash
  rotated). Scenes still referencing the retired components **migrate forward
  automatically on load**. Semantics are preserved — custom pages like `'loading'`,
  `fadeDuration` as a linear gear tween, and live theme re-tint of the interaction
  colour gear.
- **Widget factories return handles, not bare entities.** Every factory now
  returns a `{ entity, dispose }` handle (`createButton` was the last holdout),
  assembles interaction through one `makeWidgetInteractable` helper, and
  `createListView` takes its host plugin explicitly. Toggle's `silent` transition
  parameter is retired — every widget reports its change identically. The
  composition sugar (`buildUINode` / `buildUIVisual` / `buildText` /
  `spawnUIEntity`) moves from `widgets/` to `core/compose`.
- **The Canvas2D-era rich-text image machinery is gone.** `DefaultImageResolver`,
  `setImageResolver`, `getImageResolver`, and `ResolvedImage` were built for the
  retired Canvas2D renderer, resolved to DOM bitmaps the pipeline cannot draw, and
  had zero product consumers. The `<img>` grammar still parses (it simply does not
  render yet), so a future engine-texture implementation starts from the grammar,
  not from DOM plumbing.
- **Dead UI surface swept.** A ~12-symbol dead helper cluster in `ui/util`, a
  zero-importer `controller/index.ts` barrel, tombstone comments, and an
  `ARCHITECTURE.md` still describing the retired FSM are all removed. `UIMask`
  drops its phantom `Alpha` / `maskTexture` / `inverted` fields (C++ only ever had
  `enabled` + scissor/stencil), and `TweenSystem` now owns the full
  `anim_override_` flag lifecycle — fixing a latent bug where a once-tweened UI
  entity permanently escaped layout control of that axis.

### Fixed

- **Playable exports resolve Spine textures.** A Spine atlas in a playable build
  now resolves its textures from the inlined asset map instead of failing to draw.
- **A wedged Play no longer hangs the editor.** A play-realm prepare that gets
  stuck now times out instead of hanging forever.
- **Number settings without a max no longer clamp to 100.** Unbounded number
  fields stop clamping to a phantom maximum of 100.
- **Paint preview matches what it paints.** The tilemap paint tools' preview is
  aligned with the tiles they actually place, and several multi-tileset bugs are
  fixed.
- **Theme roles survive into prefabs.** Theme role tags persist into
  prefab-instantiated widgets, settled gears re-arm correctly, and scroll/list
  behavior is corrected.
- **Truthful render-system timing.** The profiler attributes the render system's
  present/vsync wait to a distinct wait band instead of counting it as phantom CPU
  time, and the status bar / panel re-render less during a viewport transform drag.

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

[Unreleased]: https://github.com/esengine/estella/compare/v0.37.0...HEAD
[0.37.0]: https://github.com/esengine/estella/compare/v0.36.0...v0.37.0
[0.36.0]: https://github.com/esengine/estella/compare/v0.35.0...v0.36.0
[0.35.0]: https://github.com/esengine/estella/compare/v0.34.1...v0.35.0
[0.34.1]: https://github.com/esengine/estella/compare/v0.34.0...v0.34.1
[0.34.0]: https://github.com/esengine/estella/compare/v0.33.0...v0.34.0
[0.33.0]: https://github.com/esengine/estella/compare/v0.32.0...v0.33.0
[0.32.0]: https://github.com/esengine/estella/compare/v0.31.0...v0.32.0
[0.31.0]: https://github.com/esengine/estella/compare/v0.30.0...v0.31.0
[0.30.0]: https://github.com/esengine/estella/compare/v0.29.0...v0.30.0
[0.29.0]: https://github.com/esengine/estella/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/esengine/estella/compare/v0.27.0...v0.28.0
[0.27.0]: https://github.com/esengine/estella/compare/v0.26.0...v0.27.0
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
