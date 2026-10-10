# RM-009 stage one verification — 2026-10-08

Scope: pseudolocalization and an editor text-box inspector. The roadmap card
remains In Progress; this is not complex-script or device acceptance.

## Checks

- SDK: 29 checks across `ui-localization-debug`, `locale-table` and
  `ui-measure-text` pass. Catalogs and interpolated values survive preview;
  unknown keys stay visible; wrapping and truncation risks are diagnosed.
- Editor: typecheck, Vite build, and 28 i18n/menu/command checks pass.
- All 64 examples/templates typecheck against the current SDK.
- Public API: all 16 entry snapshots match. SDK test type debt remains
  187 existing diagnostics, with zero new diagnostics.
- Built-in browser, actual WebGL2 editor: 11/11 fixture checks pass, including
  Yoga-computed sizes, pre-Ellipsis overflow, wrapped height, Chinese/Japanese/
  Korean bounds, explicit Arabic/Thai limitations and unchanged authored data.
- Window → UI Text Inspector opens a closable dock panel; 100% preview and
  selecting the English entity work. The panel reads the editor realm and
  labels its snapshot; an edited snapshot requires refresh before selection.
- CLI Web export includes the scene and six locale tables without warnings.
  The exported game loads and locale switching changes the localized label.

## Limits and observations

Arabic joining/bidi, Thai shaping, rich-text metrics, custom-font metrics,
real IME, minigame/native devices, actual device focus delivery, hit regions and performance
acceptance are not covered. Host fallback fonts require visual review; this
inspector measures advances/line height, not ink, stroke or shadow extents.

Some immediate built-in-browser screenshots show only changed text while a
later stable-frame screenshot shows all labels. The cause is unresolved; do
not use these captures to claim flicker-free exported-game acceptance. A
temporary no-cache comparison was reverted; no renderer cache changes ship.

The existing theme gate still reports the same 18 findings in CameraPreview,
GizmoMenu, TilemapReview and Viewport. It reports none in the new panel/styles.
The CSS-variable gate passes. Full CI/device acceptance is not asserted.

## Reproduce without desktop test runners

Build the SDK, then run `node tools/ui-localization-browser.mjs` and visit
`http://127.0.0.1:5194/__localization` in a browser. Open the inspector through
the Window menu. The fixture uses the paired editor revision and launches no
Electron or native test window.

Export with `node pipeline/bin/estella.mjs export examples/ui-localization-debug
--out <output-directory>`; serve that directory with a normal HTTP server.

## Focus inspection increment — 2026-10-08

The runtime Tab path and SDK `inspectFocusTraversal` share the same read-only
policy. The editor UI Inspector has Text and Focus order views. Inspection
never moves focus or emits focus/click events. This is the editor realm's
snapshot; live-game-only dialogs and scripts need runtime acceptance separately.

- SDK: 14 focus tests pass, including four new inspection checks. Runtime
  forward/reverse Tab navigation agrees with inspection, disabled controls are
  reported, host hierarchical visibility is respected, and closing a dialog
  restores controls outside its subtree. Missing host visibility is disclosed.
- Editor: 26 existing i18n/menu/controller checks, typecheck and Vite build pass.
- Built-in WebGL2 fixture: 14/14 checks pass, including host visibility, the
  sample's three buttons in order, and unchanged authored scene data.
- Manual Web checks: select LocaleButton, disable Interactable in Details,
  observe stale snapshot/disabled selection, refresh to two navigable controls
  and one disabled entry, undo, and observe stale state again. No edit was saved.
- No local native test runner was launched. The card remains In Progress;
  layout boundaries, pointer hit diagnostics and device acceptance remain open.

## Layout and input configuration increment — 2026-10-08

- UI Inspector adds Layout and input with local dimensions, world axis-aligned
  bounds, configuration gates and parent-mask review. It never invokes the
  stateful pointer raycast. Bounds are not clipped screen-space hit regions.
- Editor: typecheck, production build and 23 layout/i18n/menu checks pass.
  CSS-variable gate passes; theme gate retains the same 18 existing findings.
  Layout tests cover scaled geometry,
  parent masks, ancestor pointer passthrough, disabled and hidden controls,
  unavailable visibility, hierarchy cycles and unresolved sizes.
- Built-in WebGL2 fixture: 19/19 checks pass, including 13 resolved UI boxes,
  three input candidates, ten decorative boxes and unchanged authored data.
- Manual Web checks: expand LocaleButton, Select to locate the authored entity,
  change Pointer Events to None, observe stale snapshot and disabled selection,
  capture again and observe pointer passthrough, then undo and capture again.
  No verification edit was saved.
- Browser startup reports missing desktop MCP bridge and optional DragonBones
  module; these targeted checks do not establish an error-free application.
- The card remains In Progress. Actual clipped/occluded pointer delivery,
  platform shaping, IME/accessibility/devices and performance remain open.
  No local Electron/native test runner was launched.

## UI Debugger element inspection — 2026-10-09

- Default Elements view provides engine picking, actual hierarchy, shared
  selection and live component values. Text and Focus order are auxiliary views.
  No clipping estimates or automatic input-success verdicts are displayed.
- Screen UI editor picking and outlines use ScreenOverlay; world UI retains its
  camera projection. SDK publishes the shared projection/domain helpers and the
  runtime MaskMode enum. SDK build and all 16 built declaration API checks pass.
- Editor: 29 hierarchy/property/picking/layout/i18n/menu tests pass. Picking tests
  cover cancellation of delayed replies, rejection of non-UI replies and no
  authoring drag. Typecheck and production build pass.
- Built-in WebGL2 fixture: 27/27 checks pass, including real nested ancestry,
  resolved layout, raw Interactable values, native editor picking and unchanged
  authored scene data. Manual pick selects Inside in both hierarchy and Details;
  editing Width 120 to 160 updates computed size without refresh. Undo restores
  120. Verification edits were not saved.
- The standalone browser lacks the desktop project/play bridge. Running-game
  picking is covered by async host integration tests; actual play acceptance and
  event tracing remain open. Startup MCP/optional DragonBones messages remain.
- No local Electron/native test runner was launched. RM-009 remains In Progress.

## Gizmo interaction — 2026-10-09

- Selected-only applies to camera/light/marker/particle/auxiliary icons as well
  as geometry. Non-rendering camera/light/marker/audio/probe/empty entities lose
  their icon pick boxes when hidden. Existing sprite/mesh and other 2D renderer
  selection paths remain available. Icon pick size follows the display setting.
- UI resize handles appear only with the Rect tool and an editable single UI
  selection. Hidden handles use display:none, including before the first paint,
  so opacity cannot leave invisible pointer targets. UI Debugger picking hides
  the handles and invalidates overlay visibility when armed/cancelled.
- 76 gizmo geometry/display/picking/i18n tests, typecheck and production build
  pass. CSS-variable gate passes. Built-in WebGL2 fixture remains 27/27.
- Manual Web checks: selected Inside hides the unselected camera icon; Move and
  Select show no UI resize handles; Rect shows them; switching back hides them.
  Clicking adjacent Partial selects it. Show all restores the camera icon and
  selected-only hides it again. No local Electron/native runner was launched.


## UI Debugger event observation — 2026-10-09

- Engine #74 and editor #11 merged after successful current-head checks.
  Engine Android API 29–36 checks passed; editor Typecheck + tests passed.
- SDK observer reports immutable post-handler dispatch facts without payload
  or event mutation methods. It does not register a game listener or consume
  pending events. Root and actual bubble dispatches share an identity.
- SDK: 4 observer tests plus 18 existing UI event tests pass. Editor: 26
  recorder/panel/picking/i18n/menu tests pass, including stop/clear, queue
  replacement, bounded retention, payload exclusion and runtime selection.
- Built-in WebGL2 fixture: 32/32 passes. Five new checks use the real SDK
  queue and handlers for propagation/default prevention. They do not simulate
  actual pointer hit-testing or establish running-game delivery acceptance.
- Manual browser check: Events tab is disabled outside Play and explains its
  empty state without a fault verdict. Theme styling matches the panel.
- Recording defaults off, stores at most 200 dispatch rows, polls at 250 ms
  with requests coalesced and releases on stop/unmount/session teardown.
  History truncation is explicit. Filtering retains matching event paths.
- Typecheck, production build, CSS-variable gate, SDK build and 16 built API
  declaration checks pass. No local Electron/native runner was launched.
- Actual Play pointer dispatch, devices, IME/accessibility, shaping and
  performance acceptance remain open. RM-009 remains In Progress.


## Actual Play pointer dispatch — 2026-10-09

- Engine #75 and editor #12 merged after successful current-head checks:
  Android API 29–36/report and editor Typecheck + tests all passed.
- Added a separate browser fixture staging the production host via
  buildPlayRealm, using its SDK/WASM/import-map page and real project scripts.
  Only the native project URL/staging IPC are adapted to local HTTP.
- Built-in browser actual coordinate clicks: Inside records press/release/click
  and dispatches to Inside → InnerMask → OuterMask → Canvas. The project handler
  increments Text to Clicks 1 and changes UINode width 120→160; reading the
  selected runtime entity confirms these values. No synthetic queue emit is
  used for these pointer checks.
- Partial's click reaches InnerMask, where the real handler stops propagation
  and prevents default. No OuterMask/Canvas click step is displayed for that
  event. Filtering by click retains the matching recorded paths.
- Stop recording: another click changes Text to Clicks 2 and width to 120,
  while history stays at 25 rows. Panel unmount: the runtime query reports
  recording=false. Warm Stop/Start: recording=false, rows=0; clicks and
  propagation work again in the rebuilt world.
- Clarified Interactable ancestor and blockRaycast semantics in the Events
  panel. A filter with no matches now has its own empty state. 13 targeted
  panel/recorder/i18n tests, typecheck and production build pass.
- No Electron/native runner launched. This fixture does not establish desktop
  custom-scheme, device, IME/accessibility, shaping or performance acceptance.
  RM-009 remains In Progress.


## Live focus and dynamic UI — 2026-10-09

- Engine #76 / editor #13 merged after editor Typecheck + tests passed at the
  fixed current head. Android workflow did not trigger for the verification
  tool/docs/gitlink-only engine change; no new Android evidence is claimed.
- Focus view now reads actual runtime FocusManager and inspectFocusTraversal
  facts, polling only while mounted with one request in flight. Edit-world
  traversal is live too. Failed/late replies clear or cannot replace data from
  a different session; missing manager is shown as unavailable, not no focus.
- Real browser Play click spawns Runtime button (Focusable tabIndex=2): Focus
  grows from 2 to 3 entries; Elements shows Canvas/OuterMask/InnerMask/Runtime
  button and actual 150x32 UINode/component values. Selecting it uses a
  spawned-world reference. Deleting the selected node removes its row and
  old component details.
- Native browser Tab input changes FocusManager to Inside with focusVisible;
  Enter activates its project handler and deletes the dynamic node. Focus
  list automatically returns to 2 entries. These are actual key events.
- Found follow-up: repeated Tab can move DOM/browser focus out of the iframe.
  Game-manager focus and browser focus are different states. Complete keyboard
  traversal, desktop custom-scheme, devices, IME/accessibility, shaping and
  performance remain open; no success verdict is inferred from a focus record.
- 14 targeted panel/helper/event/i18n tests pass, including dynamic updates,
  read-only policy/manager capture, request coalescing and late-response
  rejection. Typecheck, production build and CSS-variable gate pass.
- No local Electron/native test runner launched. RM-009 remains In Progress.


## Web keyboard handoff — 2026-10-09

- Engine #77 and editor #14 are merged. Editor Typecheck + tests passed at
  their current head; the tool/docs/gitlink-only engine increment did not
  trigger Android CI. This does not establish device acceptance.
- Web key callbacks can explicitly claim the host default. FocusPlugin claims
  Tab only with eligible controls, and Enter/Space only with eligible game
  focus outside TextInput. Paused/edit mode do not claim these defaults.
  Ordinary host form/button/link/contenteditable controls and browser shortcut
  chords keep their DOM behavior. Input-router consumption also claims defaults.
- The parked engine textarea has tabIndex=-1. Composition confirmation/cancel
  keys do not activate gameplay or submit/cancel the text editor mid-composition.
  This guard is covered by DOM tests; real device IME acceptance remains open.
- ShiftLeft/ShiftRight are recognized. Tab captures Shift at its keydown edge
  so releasing the complete chord before the next frame still reverses order.
  Blur/unbind releases held keys; cleared frame state cannot retain old Shift.
- Built-in browser, production Play host/SDK/WASM, actual key input: Tab cycles
  Inside → Partial → Runtime button → Inside; Shift+Tab reverses through the
  three entries. Browser focus stays in the game iframe. Enter on Inside
  removes the dynamic control (3→2); Space recreates it (2→3). Clicking the
  host Focus button then Tab moves to the host Elements button normally.
- 89 targeted SDK tests and editor typecheck pass; SDK build, 16 API surface
  and built-declaration checks, and stability inventory checks pass.
- No Electron/native runner launched. Desktop custom-scheme, device keyboard,
  real IME/assistive technology, shaping and performance acceptance remain
  open. RM-009 remains In Progress.


## Dynamic dialog and focus eligibility — 2026-10-09

- Engine #78 merged after the current-head Android API 29–36, packaging and
  report checks all passed. Emulator boot coverage is separate from device
  keyboard/IME acceptance.
- FocusSystem now clears focus and its visibility when an entity becomes
  disabled, hidden, outside an open dialog, invalid or loses Focusable. Pointer
  focus uses the same live eligibility rule. Enter/Space rechecks after
  synchronous focus handlers so opening a modal cannot activate the old
  background control in the same frame.
- Built-in browser using the production Play host and real game key input:
  Inside creates Runtime button; M adds an actual UIDialog to that entity.
  Focus shows 1 eligible/2 outside-dialog entries and no current focus. Enter
  leaves background Text at Clicks 1 and the dialog present. Tab focuses the
  dialog button; Enter confirms and removes UIDialog, restoring 3 entries.
  D disables the focused button: 2 eligible/1 disabled and no focus. E restores
  it; Shift+Tab can focus it again. No injected event queue or world mutation
  from browser evaluation was used.
- 37 targeted SDK tests pass, including stale disabled/removed-component focus,
  modal background activation, pointer focus eligibility and a synchronous
  focus-handler modal change. SDK build and 16 API/built declaration checks pass.
- No Electron/native runner launched. Multiple/nested modal arbitration,
  real devices, IME/assistive technology, desktop custom-scheme, complex text
  shaping and layout-cache performance remain open. RM-009 is In Progress.


## Hidden dialog ancestor — 2026-10-09

- Active-dialog filtering now uses the same resolved hierarchical visibility
  as control traversal. A dialog whose own display is Flex but whose ancestor
  is hidden cannot exclude the visible page controls from the Tab ring.
  If host visibility is unavailable, the inspection still reports that limit.
- Built-in browser, production Play host and actual game keys: click Inside,
  M opens the real UIDialog, Tab focuses Runtime button. H hides its parent:
  2 page controls become navigable, the dialog entry is hierarchically hidden,
  and old focus clears. Tab focuses Inside. V shows the parent again: page
  entries become outside-dialog, focus clears, and Tab returns to the dialog.
- 39 targeted SDK tests, SDK build and 16 API/built declaration checks pass.
  Tests cover ancestor-hidden modal restoration/despawn and one visible modal
  remaining active alongside another hidden modal. No local Electron/native
  runner launched. Modal stacking order, real devices, IME/accessibility,
  desktop custom-scheme, text shaping and cache performance remain open.

## Authored input and dialog inspection — 2026-10-09

- Engine #81 merged after its packaging, Android API 29–36 and PR report
  checks passed. Emulator checks do not establish device input acceptance.
- UI Debugger Elements previously omitted TextInput and UIDialog in the
  editor world. It now shows their actual component fields, including value,
  readOnly, focused, cursorPos and closeOnEscape/closeOnBackdrop. Runtime
  selection continues to use the existing live component snapshot.
- The ordinary browser fixture authors these components through SceneCommands
  and checks their real editor-world values. All 35 checks pass with WebGL2,
  including detached inspection and unchanged scene data after reading/picking.
  Three editor regression tests and typecheck pass.
- Built-in browser panel interaction: select Inside, expand TextInput, edit
  Value in Details to updated 中文; Elements synchronizes to the same value.
  Select OuterMask and expand UIDialog: closeOnEscape=false and
  closeOnBackdrop=true match the authored fields.
- The browser fixture has unrelated existing limitations: desktop MCP is not
  available and the optional DragonBones module is not staged. No native
  runner was launched. Device IME/accessibility and the remaining RM-009
  acceptance items are still open.


## Quick click focus and actual text entry — 2026-10-09

- Engine #80 merged after current-head Android API 29–36, packaging and report
  checks all passed. This is emulator boot evidence, not device input acceptance.
- Actual Web input exposed a quick-click bug: press/release/click events were
  emitted, but a press and release both arriving before a frame left
  UIInteraction.justPressed/justReleased false. FocusSystem could miss a real
  click on a text field. Preserve the projected edges until the next frame,
  even when the final held pressed state is false.
- A regression using the real interaction plugin, pointer book and FocusPlugin
  fails before the fix, then passes: actual press/release/click order, both edge
  flags, pointer focus without keyboard highlight, and next-frame edge reset.
  The host hit result is mocked in this test; real Web hit testing is below.
- Production Play host/SDK/WASM in the built-in browser: T adds createTextInput.
  Clicking it now focuses Runtime input. Native m/d/e and inserted Chinese text
  produce mde 中文 without triggering fixture hotkeys. Ctrl+A replacement to
  hello 中文 and Enter run actual change/submit handlers; Events records these
  and selecting its spawned-world row reads TextInput.value=hello 中文,
  cursorPos=8, focused=false after submit. Tab/Shift+Tab leave and return to the
  native editing surface correctly. Fixture shortcuts are ignored while editing.
- 88 targeted SDK tests, SDK build and 16 API/built declaration checks pass.
  No Electron/native runner launched. Character entry does not establish a
  real IME candidate-window session. Device IME/accessibility, modal stacking,
  desktop custom-scheme, text shaping and cache performance remain open.

## Recording across debugger tabs — 2026-10-09

- Switching away from Events previously unmounted the observer and silently
  stopped recording. Keep the opt-in recorder mounted across Elements, Text
  and Focus views. Hidden controls are absent from the accessibility tree;
  closing the panel or stopping Play still stops observation. Reopening reads
  existing trace history without restarting recording.
- Seven editor event/focus tests and typecheck pass. The panel regression uses
  the real EntityEventQueue and UIEventTrace: filter preservation, dispatch
  while on Elements/Focus, no queue consumption, close cleanup and historical
  records on reopen without accepting events emitted while closed.
- Built-in browser, production Play host/SDK/WASM and complete debugger panel:
  record with filter click, click Inside while on Elements and Focus, return
  to Events. Recording stays active, filter stays click, and 24 actual dispatch
  records include both clicks and ancestor bubbling. Closing the panel reports
  recording=false, rows=24; another real click does not increase this count.
  Reopening Events restores 24 records with recording stopped. Stop Play
  disables recording. Screenshot: local ui-recording-tabs.jpg evidence.
- No Electron/native runner launched. This improves the UI debugging workflow;
  device IME/accessibility, modal stacking, shaping and cache performance remain
  separate acceptance items. RM-009 remains In Progress.

## Nested modal focus — 2026-10-09

- An open nested UIDialog now excludes its ancestor modal's other controls
  from the focus ring. Hidden/closed nested dialogs restore the ancestor's
  scope. Independent dialog branches retain the previous union policy;
  sibling stacking order remains unresolved.
- The new regression fails before the change: the outer dialog remains
  eligible. After the fix, 31 targeted focus/quick-click tests pass, including
  stale focus clearing, hidden/closed/removed nested dialog components, and
  independent visible branches. SDK build and 16 source/built API checks pass.
- Built-in browser, production Play host/SDK/WASM: click Inside, press N to
  create the actual outer/nested UIDialog hierarchy. Focus shows one navigable
  control and three outside-dialog controls (including Runtime button).
  Tab/Shift+Tab focus Nested confirm. Enter despawns it; Tab returns to
  Runtime button, while the two page controls stay outside the outer dialog.
- No local Electron/native runner launched. Device IME/accessibility,
  independent modal stacking, custom-scheme, shaping and cache performance
  remain open. RM-009 and RM-008 are still the two unfinished 0.94.0 cards.

## Text overflow cache correctness — 2026-10-09

- The cached renderer signature omitted overflow. Changing only Visible,
  Clip or Ellipsis could reuse the old geometry indefinitely. Include overflow
  in the signature, with omitted overflow equivalent to the Visible default.
- The real renderer cache regression fails before the fix: cached Visible
  geometry differs from fresh Clip layout. After the fix, all three modes
  match fresh geometry; a second static entity retains the same batch and
  performs no new glyph layout reads. 35 renderer/cache tests pass, along with
  SDK build and 16 source/built API checks.
- Built-in browser production Play/SDK/WASM: click Inside, then O changes
  only the overflow mode after installing the same long text. Clip truncates
  without an ellipsis, Ellipsis adds it, Visible extends beyond the label box
  until the real ancestor mask clips it. No injected game state or event queue.
- This is cache correctness evidence, not a performance benchmark. Same-device
  cache/reflow timings, complex shaping and device acceptance remain open.
  No local Electron/native runner launched; RM-009 remains In Progress.

## Text cache key collision — 2026-10-09

- Pipe-joining unescaped text and font family produced the same key for
  `A|B` / `Arial` and `A` / `B|Arial`, allowing stale geometry after both changed.
  Serialize the parameter tuple with JSON escaping to preserve field boundaries.
- The real renderer regression fails before the fix (three cached glyphs instead
  of the new single glyph), then passes. An unchanged subsequent draw keeps the
  same batch without glyph reads. 36 renderer/cache tests, SDK build and all
  16 source/built API checks pass.
- Built-in browser production Play/SDK/WASM: K twice changes the same entity
  between those pairs; the canvas shows only A after the second press, and
  Elements → Inside → Text shows content A and fontFamily B|Arial.
- No local Electron/native runner launched. This proves cache correctness;
  cache/reflow performance, shaping and device acceptance remain open.

## UI hierarchy alignment — 2026-10-09

- The Play browser fixture now loads the production app.css button recipe;
  previous screenshots missed its flex layout and did not represent button
  alignment in the editor. Keep this shared stylesheet in browser validation.
- UI Debugger tree labels stay on one line with ellipsis; icons retain 14px
  width. In the narrow browser pane, all eight real rows have 26px height and
  16px depth steps, including Runtime dialog host and its Runtime button child.
- Selecting the truncated Runtime dialog host shows its full name/path and
  real component values. Editor typecheck passes. No desktop runner launched.

## Paired CPU cache measurement — 2026-10-09

- Added a browser-only, reproducible measurement page using the real SDK
  CanvasGlyphRasterizer, GlyphAtlas, SdfTextRenderer and submission interface.
  An in-memory atlas store and submission sink deliberately exclude GPU/WASM.
  This is a cache-on versus cache-cleared comparison, not a historical code
  before/after comparison or a newly shipped runtime optimization.
- Both paths use 200 identical bilingual labels, prewarmed glyphs and text
  variants; ten paired batches of ten frames alternate execution order.
  Exactly 0/2/20/200 labels change each frame. Exact vertex/index/entity geometry
  comparison passes for all four cases, outside the timed section.
- Built-in Chrome 155 on Windows, devicePixelRatio 1.25: median batch-average
  frame milliseconds, rebuilt → cached: static 4.290 → 0.070; 1% changes
  3.990 → 0.110; 10% 3.690 → 0.480; 100% 4.010 → 4.060.
  All-changing text offers no measured cache benefit. Raw samples and execution
  metadata are in cache-cpu-web-2026-10-09.json. P95 refers to batch averages;
  it does not describe individual frame tail latency. No speed threshold.
- GPU/WASM submission, Yoga reflow, end-to-end frame timing, SDF rasterization,
  complex shaping and target devices remain unmeasured. Warm-up/JIT/background
  load affect results; do not convert these ratios into a game FPS claim.
  RM-009 remains In Progress. No local Electron/native runner launched.

## Actual WASM layout measurement and test lifetime — 2026-10-09

- A browser-only fixture loads the existing editor engine WASM (SHA-256 in the
  raw report). One Canvas, twenty flex rows, four hundred controls: all 421
  nodes' local positions and dimensions agree for 0/1/10/100% updates and both
  changed width states. Changed widths are checked explicitly to reject no-ops.
- Ten paired batches of twenty layout calls alternate normal manual dirty
  signals and forced property refresh. Both retain Yoga nodes; this is not a
  fresh-node rebuild or historical before/after benchmark. Timing includes
  UINode writes and uiLayout_update, excluding App scheduling, Transform, text,
  rendering and GPU. Browser-generated layout-cpu-web-2026-10-09.json preserves
  every sample and the loaded WASM build hash.
- Median batch-average update milliseconds, forced → normal: static
  0.060 → 0.015; 1% changes 0.125 → 0.125; 10% 0.505 → 0.495;
  100% 4.290 → 4.390. Dirty layouts show no extra benefit against a forced
  property refresh, since both perform that work. P95 describes batch averages.
- Running the existing integration suite exposed three async not.toThrow
  assertions that did not await tick before deleting the registry; they logged
  deleted-Registry errors while reporting success. Await the actual tick Promise,
  verify root dimensions after one/sixty ticks, and fail on logged system errors
  (App can catch them without rejecting tick). Seventeen real-WASM integration
  and incremental-versus-fresh-registry tests now pass without system errors.
- No runtime optimization is claimed. End-to-end frame timing, changed-subtree
  scope optimization, shaping and device acceptance remain open; RM-009 remains
  In Progress. No local Electron/native runner launched.
