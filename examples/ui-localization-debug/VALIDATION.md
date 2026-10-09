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

## Ancestor mask inspection increment — 2026-10-08

The inspector shows the ancestor mask chain, mode and bounds. Unrotated 2D
scissor rectangles estimate contained/partial/fully-clipped geometry; stencil,
rotation, unavailable bounds and malformed hierarchy explicitly require review.
These are world-rectangle estimates, not actual hit or visibility verdicts.
Projection, pixel rounding, stencil alpha, occlusion and pointer delivery remain
runtime acceptance work. The public SDK now exports MaskMode at runtime as well
as in declarations, avoiding an undefined enum for inspector consumers.

- SDK build and all 16 source/declaration API checks pass.
- Editor: 26 layout/i18n/menu checks pass with a single thread worker. An initial
  fork-worker run exited unexpectedly; the bounded thread run completed cleanly.
  Tests cover nested intersection, contained/partial/full clipping, disabled
  masks, rotated/stencil/unresolved masks and unchanged inspection data.
- Browser verification includes a dedicated nested-mask scene. The fixture
  removes its first disposable scene through SceneCommands before loading the
  second; inspection itself does not alter either authored snapshot.
- Built-in WebGL2: 27/27 checks pass. Manual widening of InnerMask from 200 to
  280 makes the snapshot stale; refresh changes Partial to contained and Outside
  to partial. Undo restores the original geometry; no manual edit was saved.
- Editor typecheck/production build and CSS-variable checks pass. The theme
  gate retains the existing 18 findings; browser startup still reports missing
  desktop MCP bridge and optional DragonBones, as in the prior increment.
- No local desktop/native runner was launched. RM-009 remains In Progress.
