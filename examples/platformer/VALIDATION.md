# Sprite nine-slice acceptance

RM-088, 2026-10-08. Existing master already implements Sprite Auto/Simple/Tiled/
NineSlice, `size`, shared batch geometry and editor Rect resizing. This increment
adds the stretchable platform sample and repeatable pixel acceptance.

## Local WebGL2

The built-in browser used Chrome 155 on Windows. The engine render host loaded
the real wasm, runtime texture decoder and five-entity fixture. All 10 checks
passed. Four complete 8×8 corner blocks are identical between a 32×32 Sprite,
a 160×32 Sprite and a 160×32 UIVisual: 512 compared RGBA pixels. Simple mode is
a negative control and visibly changes the corner pixels; legacy Auto still
infers the same texture border. Frame capture agrees with draw replay.

Both NineSlice and Simple produced two draws in two passes, with two RunStart
breaks. Sprites and screen UI use separate passes; the nine-slice geometry adds
no extra draw or state break relative to Simple. This is a batching check, not
a frame-time performance claim.

The platformer Web export succeeded with no warnings/errors, including physics
and Basis decoding for its existing KTX2 asset. The four platforms retain their
authored widths, collider sizes and transforms; only their draw mode and the
texture's shared 8-pixel border change.

Windowless regression: editor Rect drag 11 and texture-border geometry 19 tests;
SDK import settings 13, generated field metadata 1, scene format/loading/
validation 84; pixel-predicate tests 4. Two existing post-process test fixtures
were brought up to date with quality filtering and initialization state; their
31 rendering/present tests also pass (163 local tests in total). All 63 example
projects pass type checking. No local desktop/Electron verifier ran.

## Second backend

The built-in browser reports **no WebGPU adapter**. That is unavailable coverage,
not a local pass. The same full-corner predicate is registered as the PR-tier
`sprite-nine-slice` scene on WebGL2 and WebGPU. Both passed in
[branch CI](https://github.com/esengine/estella/actions/runs/37783264188):
WebGL2 in 1.0s and WebGPU in 7.9s. These are whole verifier durations, not frame
times. The complete renderer jobs passed on both backends. The run predates
the post-process mock repair; engine code, fixture and pixel predicate are identical.

The full build was not green: the old post-process mocks caused 14 SDK failures,
and editor camera-preview CPU budgets / selected-only 3D gizmo checks also
failed on master before this increment. These are distinct from the passing
render jobs. Six stale API snapshots were synchronized to unblock static checks.

The exported test copy temporarily gave the canvas `tabindex=0` so the browser
locator could focus it for Space/ArrowRight. The engine and game code were
unchanged; jump and movement rendered without console errors. The attribute
was removed afterward so the retained package has the original export markup.

## Reproduce without desktop windows

```sh
pnpm render-host
node tools/sprite-nine-slice-browser.mjs
```

Open both printed URLs and click **Run pixel checks**. `PROBE_OUTPUT` optionally
saves JSON reports. Local evidence is retained outside the repository in
`output/sprite-nine-slice/`: WebGL2 report/screenshot, unavailable WebGPU report,
and the platformer export report. No native-device acceptance is claimed.
