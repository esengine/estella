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
real IME, minigame/native devices, focus paths, hit regions and performance
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
