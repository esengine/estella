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
validation 84; pixel-predicate tests 4. No local desktop/Electron verifier ran.

## Second backend

The built-in browser reports **no WebGPU adapter**. That is unavailable coverage,
not a pass. The same full-corner predicate is registered as the PR-tier
`sprite-nine-slice` scene on WebGL2 and WebGPU, so a CI machine with an adapter
can run it. The roadmap must retain pending acceptance until this passes.

## Reproduce without desktop windows

```sh
pnpm render-host
node tools/sprite-nine-slice-browser.mjs
```

Open both printed URLs and click **Run pixel checks**. `PROBE_OUTPUT` optionally
saves JSON reports. Local evidence is retained outside the repository in
`output/sprite-nine-slice/`: WebGL2 report/screenshot, unavailable WebGPU report,
and the platformer export report. No native-device acceptance is claimed.
