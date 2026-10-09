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
