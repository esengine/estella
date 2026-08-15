// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  renderScenes.mjs — the pixel gates, as a registry.
 *
 * There were two lists. CI inlined twenty scene invocations in build.yml, and
 * desktop/package.json declared forty-four `verify:render:*` scripts. Neither
 * was authoritative, so they drifted both ways: thirty-two declared verifiers
 * were run by nothing at all (spine, video, particles, every material scene,
 * text, ktx2, four tilemap variants), and five scenes CI runs had no name a
 * developer could reproduce them by.
 *
 * All of them pass — this is not a list of broken checks. It is a list of
 * checks that could not have caught anything, which is the same problem the
 * golden corpus exists to refuse: green about the things it happens to run.
 *
 * `tier` is the cheapest run that pays for a scene; each tier includes the
 * cheaper ones. `pr` is exactly what CI ran before this file existed, so
 * adopting the registry changed no CI cost.
 */

/** Cheapest tier a scene runs at; tiers are cumulative. */
export const TIERS = ['pr', 'nightly'];

/**
 * What still separates the second backend from the first: a CI runner has no
 * Dawn adapter, so nothing here runs it. Where an adapter exists every scene
 * passes — both backends read the frame the same way, off the engine's buffer.
 */
export const WEBGPU_GAP = 'no adapter on a CI runner; with one they all pass (`--backend webgpu`)';

/**
 * Every pixel gate. `env` is handed to desktop/scripts/headless-verify.mjs
 * verbatim — an empty one is the default sprite scene.
 */
export const SCENES = [
  { id: "sprite-default", tier: "pr", webgpu: true, env: {  } },
    // Editor grid on/off pixel diff — guards the custom-draw reflected material path (drawMeshWithMaterial + MaterialConstants UBO).
  { id: "editor-grid", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_GRID: "64", ESTELLA_VERIFY_STEPS: "3" } },
  { id: "mesh2d", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/mesh2d.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mesh2d.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.30,\"y\":0.556,\"rgb\":[255,0,0],\"tol\":40},{\"x\":0.70,\"y\":0.556,\"rgb\":[0,255,0],\"tol\":40},{\"x\":0.30,\"y\":0.40,\"rgb\":[255,0,0],\"tol\":40}]" } },
  { id: "parallax-shape", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/parallax-shape.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/parallax-shape.textures.json", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":40},{\"x\":0.25,\"y\":0.5,\"rgb\":[255,0,0],\"tol\":40}]" } },
  { id: "tilemap-flip", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/tilemap-flip.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/tilemap-flip.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.40,\"y\":0.36,\"rgb\":[255,0,0]},{\"x\":0.60,\"y\":0.36,\"rgb\":[0,255,0]},{\"x\":0.40,\"y\":0.58,\"rgb\":[0,0,255]},{\"x\":0.60,\"y\":0.58,\"rgb\":[255,255,0]}]" } },
    // Parallax on a cached-chunk tilemap: the camera moves while the layer model is untouched, so only the per-frame origin/parallax merge (not a revision-bump rebuild) can place the tiles — guards against baking camera-dependent offsets into the chunk cache.
  { id: "tilemap-parallax", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/tilemap-parallax.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/tilemap-flip.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_MOVE: "{\"component\":\"Camera\",\"to\":[48,-16],\"steps\":3}", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.30,\"y\":0.40,\"rgb\":[255,0,0]},{\"x\":0.10,\"y\":0.40,\"rgb\":[0,0,0],\"tol\":20},{\"x\":0.50,\"y\":0.40,\"rgb\":[0,255,0]}]" } },
    // BitmapText's first pixel coverage: a 2-glyph synthetic .fnt atlas (red A, green B) pins glyph layout, atlas UV orientation and the one-DrawCommand-per-text path.
  { id: "bitmaptext", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/bitmaptext.esscene", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "3", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.40,\"y\":0.5,\"rgb\":[255,0,0],\"tol\":20},{\"x\":0.60,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":20},{\"x\":0.5,\"y\":0.15,\"rgb\":[0,0,0],\"tol\":20}]" } },
  { id: "ui-mask", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/ui-list-mask.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/ui-list-mask.textures.json", ESTELLA_VERIFY_W: "800", ESTELLA_VERIFY_H: "600", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[255,0,0],\"tol\":60},{\"x\":0.9,\"y\":0.5,\"rgb\":[0,0,255],\"tol\":60},{\"x\":0.5,\"y\":0.85,\"rgb\":[0,0,255],\"tol\":60},{\"x\":0.5,\"y\":0.15,\"rgb\":[0,0,255],\"tol\":60}]" } },
    // Camera.cullingMask over sorting layers, for world content AND for UI — whose `layer` encodes tree order, so it belongs to its Canvas' layer instead. Layers 1 (the Canvas) and 2 (blue) are cleared from the mask, so only green and yellow survive; unmasked, the full-screen HUD covers both.
  { id: "camera-culling", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_PLAY: "1", ESTELLA_VERIFY_SCENE: "/scenes/camera-culling.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/camera-culling.textures.json", ESTELLA_VERIFY_W: "320", ESTELLA_VERIFY_H: "180", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.25,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":30},{\"x\":0.75,\"y\":0.5,\"rgb\":[255,255,0],\"tol\":30}]" } },
    // Where the UI layout box SITS. The camera is driven away from the origin at runtime, so the box moves without resizing: the unparented Canvas (a screen root) must travel with it — red/green stay in their quadrants — while the Canvas parented to a world entity must not, landing blue at the anchor's own world position. Before screen roots existed the whole HUD stayed at the origin and this frame came back black.
  { id: "ui-screen-root", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_PLAY: "1", ESTELLA_VERIFY_SCENE: "/scenes/ui-screen-root.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/ui-screen-root.textures.json", ESTELLA_VERIFY_W: "640", ESTELLA_VERIFY_H: "360", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_MOVE: "{\"component\":\"Camera\",\"to\":[5000,-800],\"steps\":4}", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.25,\"y\":0.25,\"rgb\":[255,0,0],\"tol\":30},{\"x\":0.75,\"y\":0.75,\"rgb\":[0,255,0],\"tol\":30},{\"x\":0.75,\"y\":0.25,\"rgb\":[0,0,255],\"tol\":30},{\"x\":0.25,\"y\":0.75,\"rgb\":[0,0,0],\"tol\":30}]" } },
    // Y-sort: same scene twice — mask on flips the overlap to the lower (higher-Y-key) entity; mask off preserves submission order. Both asserted so neither path can silently regress.
  { id: "ysort-on", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_YSORT: "1", ESTELLA_VERIFY_SCENE: "/scenes/ysort.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/ysort.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":30},{\"x\":0.5,\"y\":0.25,\"rgb\":[255,0,0],\"tol\":30},{\"x\":0.5,\"y\":0.75,\"rgb\":[0,255,0],\"tol\":30}]" } },
  { id: "ysort-off", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/ysort.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/ysort.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[255,0,0],\"tol\":30}]" } },
    // Depth layers (2.5D): same scene twice, one project setting apart. The near sprite is in the LOWER layer and both merge into ONE draw call, so inside the batch the order is fixed by index — no amount of sorting can produce the depth answer, which is what makes the pair discriminating.
  { id: "depth-on", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_DEPTH_LAYERS: "6", ESTELLA_VERIFY_SCENE: "/scenes/depth-layers.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/depth-layers.textures.json", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.573,\"y\":0.5,\"rgb\":[255,0,0],\"tol\":60}]" } },
  { id: "depth-off", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/depth-layers.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/depth-layers.textures.json", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.573,\"y\":0.5,\"rgb\":[0,0,255],\"tol\":60}]" } },
    // Motion trail: move a TrailRenderer entity across the frame in play mode, asserting the ribbon rasterizes as a green band (head/mid/tail) with black above it — the CPU-ribbon-through-the-batch-face path.
  { id: "trail", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_PLAY: "1", ESTELLA_VERIFY_SCENE: "/scenes/trail.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/trail.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_TRAIL: "{\"from\":[-200,0],\"to\":[200,0],\"steps\":20}", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.80,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":50},{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":50},{\"x\":0.25,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":60},{\"x\":0.5,\"y\":0.15,\"rgb\":[0,0,0],\"tol\":30}]" } },
    // Linear-light pipeline (colorSpace: 'linear'). The lit falloff moves 52 to 125 (perceptually-uniform light); the mid-gray texture must ROUND-TRIP exactly (sRGB store → hw decode → blit encode = identity) — a missing sRGB upload variant would read ~187, so tol 6 is a hard discriminator.
  { id: "linear-lit", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_COLORSPACE: "linear", ESTELLA_VERIFY_SCENE: "/scenes/mat-lit-point.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-lit-point.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,254,0],\"tol\":25},{\"x\":0.75,\"y\":0.5,\"rgb\":[0,125,0],\"tol\":25}]" } },
  { id: "linear-midtone", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_COLORSPACE: "linear", ESTELLA_VERIFY_SCENE: "/scenes/srgb-midtone.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/srgb-midtone.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[128,128,128],\"tol\":6}]" } },
    // Post-process chain guards — bloom's first CI pixel coverage. The gamma scene pins the LDR multi-pass chain; the linear scene is the HDR discriminator: threshold 1.5 sits above anything an 8-bit chain can store, so glow OUTSIDE the sprite (x=0.64) proves over-range light survived the float intermediates — the same scene blooms NOTHING in gamma mode.
  { id: "bloom-ldr", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_PLAY: "1", ESTELLA_VERIFY_SCENE: "/scenes/bloom-ldr.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/bloom-ldr.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "10", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.61,\"y\":0.5,\"rgb\":[0,130,0],\"tol\":35},{\"x\":0.70,\"y\":0.5,\"rgb\":[0,32,0],\"tol\":25},{\"x\":0.85,\"y\":0.5,\"rgb\":[0,0,0],\"tol\":12}]" } },
  { id: "hdr-bloom", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_PLAY: "1", ESTELLA_VERIFY_COLORSPACE: "linear", ESTELLA_VERIFY_SCENE: "/scenes/hdr-bloom.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/hdr-bloom.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "10", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":25},{\"x\":0.64,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":35},{\"x\":0.85,\"y\":0.5,\"rgb\":[0,0,0],\"tol\":12}]" } },
  { id: "video", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_PLAY: "1", ESTELLA_VERIFY_SETTLE_MS: "2500", ESTELLA_VERIFY_SCENE: "/scenes/video-playback.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/video-playback.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.25,\"rgb\":[255,0,0],\"tol\":90},{\"x\":0.5,\"y\":0.75,\"rgb\":[0,0,255],\"tol\":90}]" } },
  { id: "video-ui", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_PLAY: "1", ESTELLA_VERIFY_SETTLE_MS: "2500", ESTELLA_VERIFY_SCENE: "/scenes/video-ui.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/video-ui.textures.json", ESTELLA_VERIFY_W: "800", ESTELLA_VERIFY_H: "600", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.25,\"rgb\":[255,0,0],\"tol\":90},{\"x\":0.5,\"y\":0.75,\"rgb\":[0,0,255],\"tol\":90}]" } },
  { id: "spine", tier: "nightly", webgpu: true, rendersOnly: "measured: of 2025 sampled points, none sits in a region flat enough to survive CI's rasterizer — the skeleton has no interior that wide", env: { ESTELLA_VERIFY_SCENE: "/scenes/spine-test.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/spine-test.textures.json" } },
    // Seeded on purpose: unseeded, 171 of 2025 sampled points differ between two
    // runs at the same step count, and a run nobody can reproduce is a run whose
    // failures cannot be told apart from its variety.
  { id: "particles", tier: "nightly", webgpu: true, rendersOnly: "seeded it reproduces exactly, but its particles are single points — no region is flat enough for a probe to survive CI's rasterizer", env: { ESTELLA_VERIFY_PLAY: "1", ESTELLA_VERIFY_SCENE: "/scenes/particle-demo.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/particle-demo.textures.json", ESTELLA_VERIFY_STEPS: "90", ESTELLA_VERIFY_SEED: "1234" } },
  { id: "particles-gradient", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_PLAY: "1", ESTELLA_VERIFY_SCENE: "/scenes/particle-gradient.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/particle-gradient.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "20", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":90}]" } },
  { id: "particles-sizecurve", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_PLAY: "1", ESTELLA_VERIFY_SCENE: "/scenes/particle-sizecurve.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/particle-sizecurve.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "20", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":110},{\"x\":0.28,\"y\":0.5,\"rgb\":[0,0,0],\"tol\":50}]" } },
      // The bright centre the chain leaves, and a corner it does not reach. Three
    // sampled points were flat interior; this takes the middle one.
  { id: "postprocess", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_PLAY: "1", ESTELLA_VERIFY_SCENE: "/scenes/postprocess-effects.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/postprocess-effects.textures.json", ESTELLA_VERIFY_STEPS: "30", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[255,255,255],\"tol\":30},{\"x\":0.06,\"y\":0.94,\"rgb\":[0,0,0],\"tol\":20}]" } },
      // One point INSIDE a glyph and one off it. Measured: of 2025 sampled points
    // exactly one sits in a stroke wide enough to be flat either side of it, and
    // the rest of the frame is the background this distinguishes it from.
  { id: "text", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/ui-text-sdf.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/ui-text-sdf.textures.json", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.42,\"y\":0.42,\"rgb\":[255,255,255],\"tol\":30},{\"x\":0.9,\"y\":0.9,\"rgb\":[0,0,0],\"tol\":20}]" } },
    // Two identical labels in one-line boxes, Visible beside Clip. The differential
    // is the point: a truncation that does nothing leaves BOTH second lines drawn,
    // which one label alone could not say. Probes measured, not guessed.
  { id: "text-overflow", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/ui-text-overflow.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/ui-text-sdf.textures.json", ESTELLA_VERIFY_W: "800", ESTELLA_VERIFY_H: "600", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.051,\"y\":0.167,\"rgb\":[255,255,255],\"tol\":30},{\"x\":0.051,\"y\":0.35,\"rgb\":[255,255,255],\"tol\":30},{\"x\":0.551,\"y\":0.167,\"rgb\":[255,255,255],\"tol\":30},{\"x\":0.551,\"y\":0.35,\"rgb\":[0,0,0],\"tol\":20}]" } },
  { id: "text-rect", tier: "nightly", webgpu: true, rendersOnly: "measured: its glyphs are thinner than any neighbourhood a probe can safely sit in — zero flat interior points", env: { ESTELLA_VERIFY_SCENE: "/scenes/ui-text-rect.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/ui-text-sdf.textures.json" } },
      // One point inside each box the flex tree lays out, taken from the middle of
    // its flat interior — so a layout that moves a box fails rather than a frame
    // that merely drew something.
  { id: "uinode", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/ui-node-flex.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/ui-node-flex.textures.json", ESTELLA_VERIFY_W: "800", ESTELLA_VERIFY_H: "600", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.08,\"y\":0.26,\"rgb\":[38,38,46],\"tol\":20},{\"x\":0.32,\"y\":0.18,\"rgb\":[64,204,89],\"tol\":25},{\"x\":0.16,\"y\":0.18,\"rgb\":[217,64,64],\"tol\":25},{\"x\":0.56,\"y\":0.16,\"rgb\":[77,115,230],\"tol\":25}]" } },
  { id: "filled", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/ui-visual-filled.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/ui-visual-filled.textures.json", ESTELLA_VERIFY_W: "800", ESTELLA_VERIFY_H: "600", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.18,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":40},{\"x\":0.40,\"y\":0.5,\"rgb\":[255,0,0],\"tol\":40},{\"x\":0.58,\"y\":0.75,\"rgb\":[0,255,0],\"tol\":40},{\"x\":0.58,\"y\":0.25,\"rgb\":[255,0,0],\"tol\":40},{\"x\":0.30,\"y\":0.20,\"rgb\":[0,255,0],\"tol\":40},{\"x\":0.20,\"y\":0.333,\"rgb\":[255,0,0],\"tol\":40},{\"x\":0.30,\"y\":0.833,\"rgb\":[0,255,0],\"tol\":40},{\"x\":0.20,\"y\":0.70,\"rgb\":[255,0,0],\"tol\":40}]" } },
  { id: "tilemap-transform", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/tilemap-transform.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/tilemap-transform.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.40,\"y\":0.36,\"rgb\":[255,255,0]},{\"x\":0.60,\"y\":0.36,\"rgb\":[0,255,0]},{\"x\":0.40,\"y\":0.58,\"rgb\":[0,0,255]},{\"x\":0.60,\"y\":0.58,\"rgb\":[255,0,0]}]" } },
  { id: "tilemap-multiset", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/tilemap-multiset.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/tilemap-multiset.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "6", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.40,\"y\":0.36,\"rgb\":[255,0,0]},{\"x\":0.60,\"y\":0.36,\"rgb\":[0,255,0]},{\"x\":0.40,\"y\":0.58,\"rgb\":[0,0,255]},{\"x\":0.60,\"y\":0.58,\"rgb\":[255,255,0]}]" } },
  { id: "tilemap-spacing", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/tilemap-spacing.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/tilemap-spacing.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "6", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.40,\"y\":0.36,\"rgb\":[255,0,0]},{\"x\":0.60,\"y\":0.36,\"rgb\":[0,255,0]},{\"x\":0.40,\"y\":0.58,\"rgb\":[0,0,255]},{\"x\":0.60,\"y\":0.58,\"rgb\":[255,255,0]}]" } },
    // Tiled tile (GID) object: an object-layer object with a gid renders as a
    // positioned Sprite (bottom-left anchor, tileset UV).
  { id: "tilemap-gidobj", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/tilemap-gidobj.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/tilemap-gidobj.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "10", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":40},{\"x\":0.5,\"y\":0.12,\"rgb\":[0,0,0],\"tol\":30},{\"x\":0.8125,\"y\":0.375,\"rgb\":[0,0,255],\"tol\":40},{\"x\":0.9375,\"y\":0.375,\"rgb\":[255,255,0],\"tol\":40},{\"x\":0.875,\"y\":0.8125,\"rgb\":[0,0,255],\"tol\":40},{\"x\":0.875,\"y\":0.9375,\"rgb\":[255,255,0],\"tol\":40}]" } },
  { id: "material", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-tint.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-tint.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[255,0,0],\"tol\":40}]" } },
  { id: "ktx2", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/ktx2-sprite.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/ktx2-sprite.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,180,0],\"tol\":50}]" } },
  { id: "material-instance", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-instance.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-instance.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":40}]" } },
  { id: "material-texture", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-tex.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-tex.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":50}]" } },
  { id: "material-switch", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-sw.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-sw.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.25,\"y\":0.5,\"rgb\":[255,0,0],\"tol\":50},{\"x\":0.75,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":50}]" } },
  { id: "material-lit", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-lit.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-lit.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":50}]" } },
  { id: "material-lit-point", tier: "pr", webgpu: { ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,253,0],\"tol\":25},{\"x\":0.75,\"y\":0.5,\"rgb\":[0,52,0],\"tol\":25}]" }, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-lit-point.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-lit-point.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":50},{\"x\":0.75,\"y\":0.5,\"rgb\":[0,64,0],\"tol\":60}]" } },
  { id: "material-lit-normal", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-lit-normal.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-lit-normal.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.333,\"y\":0.5,\"rgb\":[0,252,0],\"tol\":45},{\"x\":0.667,\"y\":0.5,\"rgb\":[0,36,0],\"tol\":50}]" } },
  { id: "material-lit-spot", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-lit-spot.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-lit-spot.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,228,0],\"tol\":55},{\"x\":0.75,\"y\":0.5,\"rgb\":[0,0,0],\"tol\":35}]" } },
  { id: "material-lit-flatnormal", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-lit-flatnormal.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-lit-flatnormal.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":30}]" } },
  { id: "sprite-lit", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/sprite-lit.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/sprite-lit.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":30}]" } },
  { id: "material-builtin-lit", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-builtin-lit.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-builtin-lit.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[0,255,0],\"tol\":30}]" } },
  { id: "material-dissolve", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-dissolve.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-dissolve.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[255,0,0],\"tol\":30}]" } },
  { id: "material-graph", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-graph.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-graph.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[255,0,0],\"tol\":40}]" } },
  { id: "material-preview", tier: "pr", webgpu: { ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[255,0,0],\"tol\":40}]" }, env: { ESTELLA_VERIFY_SCENE: "/scenes/mat-tint.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mat-tint.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_PREVIEW: "{\"w\":64,\"h\":64,\"rgb\":[255,0,0],\"tol\":45}" } },
  { id: "tilemap-hex", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_SCENE: "/scenes/tilemap-hex.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/tilemap-hex.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "6", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.40,\"y\":0.40,\"rgb\":[255,0,0]},{\"x\":0.60,\"y\":0.40,\"rgb\":[0,255,0]},{\"x\":0.50,\"y\":0.55,\"rgb\":[0,0,255]},{\"x\":0.70,\"y\":0.55,\"rgb\":[255,255,0]}]" } },
  { id: "postprocess-lut", tier: "nightly", webgpu: true, env: { ESTELLA_VERIFY_PLAY: "1", ESTELLA_VERIFY_SCENE: "/scenes/lut-grade.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/lut-grade.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "10", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.292,\"y\":0.5,\"rgb\":[0,0,255],\"tol\":40},{\"x\":0.708,\"y\":0.5,\"rgb\":[255,0,0],\"tol\":40}]" } },
  // mesh2d's scene and assertions, with its geometry frozen onto the GPU mid-run.
  // Equal pixels IS the claim, so it borrows the assertions rather than restating
  // them; a run that froze nothing fails on its own count.
  // The same again, geometry arriving from a FILE: an .esmesh loaded through the
  // asset layer replaces the inline payload. Its fixture is written by the
  // engine's own encoder from this scene's vertices, so the assertions hold.
  { id: "mesh-asset", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_MESH_ASSET: "/scenes/two-triangles.esmesh", ESTELLA_VERIFY_SCENE: "/scenes/mesh2d.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mesh2d.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.30,\"y\":0.556,\"rgb\":[255,0,0],\"tol\":40},{\"x\":0.70,\"y\":0.556,\"rgb\":[0,255,0],\"tol\":40},{\"x\":0.30,\"y\":0.40,\"rgb\":[255,0,0],\"tol\":40}]" } },
  { id: "mesh-resident", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_MESH_RESIDENT: "1", ESTELLA_VERIFY_SCENE: "/scenes/mesh2d.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mesh2d.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.30,\"y\":0.556,\"rgb\":[255,0,0],\"tol\":40},{\"x\":0.70,\"y\":0.556,\"rgb\":[0,255,0],\"tol\":40},{\"x\":0.30,\"y\":0.40,\"rgb\":[255,0,0],\"tol\":40}]" } },
  // A material drawing GPU-resident geometry. Its shader writes only a fragment,
  // so the ENGINE owns the vertex stage and compiles a second variant for this
  // source; wrong placement or an ignored tint moves the probes.
  { id: "mesh-material", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_MESH_ASSET: "/scenes/white-triangles.esmesh", ESTELLA_VERIFY_MESH_MATERIAL: "/scenes/mesh-material/tintonly.esmaterial", ESTELLA_VERIFY_SCENE: "/scenes/mesh-material.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mesh-material.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.30,\"y\":0.556,\"rgb\":[0,0,255],\"tol\":40},{\"x\":0.70,\"y\":0.556,\"rgb\":[0,0,255],\"tol\":40},{\"x\":0.5,\"y\":0.12,\"rgb\":[0,0,0],\"tol\":30}]" } },
  // What a normal is FOR: two coplanar triangles, one white colour, normals
  // facing the viewer and +X, under a head-on directional light. Only a shader
  // reading them can tell the halves apart — which is what the two probes are.
  { id: "mesh-lit", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_MESH_ASSET: "/scenes/lit-triangles.esmesh", ESTELLA_VERIFY_SCENE: "/scenes/mesh-lit.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mesh-lit.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.30,\"y\":0.556,\"rgb\":[255,255,255],\"tol\":40},{\"x\":0.70,\"y\":0.556,\"rgb\":[0,0,0],\"tol\":40}]" } },
  // A whole glTF import on screen, through the prefab it produced: geometry, the
  // inline image, and the baseColor factor as the tint. The probes sit at the
  // texel centres of a 2x2 image, so a flipped V swaps colours between them.
  { id: "mesh-textured", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_PREFAB: "/scenes/textured-quad.esprefab", ESTELLA_VERIFY_SCENE: "/scenes/mesh-textured.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mesh-textured.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.3333,\"y\":0.4167,\"rgb\":[128,0,0],\"tol\":40},{\"x\":0.6667,\"y\":0.4167,\"rgb\":[0,128,0],\"tol\":40},{\"x\":0.3333,\"y\":0.5833,\"rgb\":[0,0,255],\"tol\":40},{\"x\":0.6667,\"y\":0.5833,\"rgb\":[128,128,0],\"tol\":40}]" } },
  // The source's own hierarchy, placing the pieces. Two probes need the parent's
  // offset to have reached the child, and the fourth is background only if the
  // child's scale survived — ignore the tree and everything stacks on the origin.
  { id: "mesh-nodes", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_PREFAB: "/scenes/node-tree.esprefab", ESTELLA_VERIFY_SCENE: "/scenes/mesh-nodes.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mesh-nodes.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.3667,\"y\":0.40,\"rgb\":[255,0,0],\"tol\":40},{\"x\":0.45,\"y\":0.40,\"rgb\":[255,0,0],\"tol\":40},{\"x\":0.7667,\"y\":0.60,\"rgb\":[0,255,0],\"tol\":40},{\"x\":0.7667,\"y\":0.5333,\"rgb\":[0,0,0],\"tol\":30}]" } },
  // mesh-lit's geometry and light, shaded by a MATERIAL whose fragment reads the
  // normals the engine's vertex stage hands it. RED, so the fallback (the mesh
  // shader, taken when a variant fails) cannot pass for it — that draws white.
  { id: "mesh-material-lit", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_MESH_ASSET: "/scenes/lit-triangles.esmesh", ESTELLA_VERIFY_MESH_MATERIAL: "/scenes/mesh-material-lit/litmat.esmaterial", ESTELLA_VERIFY_SCENE: "/scenes/mesh-lit.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mesh-lit.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.30,\"y\":0.556,\"rgb\":[255,0,0],\"tol\":40},{\"x\":0.70,\"y\":0.556,\"rgb\":[0,0,0],\"tol\":40}]" } },
  // A mesh assigned IN THE EDITOR: a cold ref reaches the World only through the
  // live loader + re-projection. The quad covers the gap between the scene's own
  // two triangles, so the frame says which geometry is drawn.
  { id: "mesh-assign", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_SET_FIELD: "{\"entity\":1,\"component\":\"Mesh2D\",\"key\":\"mesh\",\"value\":\"/scenes/textured-quad.esmesh\"}", ESTELLA_VERIFY_SCENE: "/scenes/mesh2d.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mesh2d.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.5,\"y\":0.5,\"rgb\":[255,255,255],\"tol\":40},{\"x\":0.30,\"y\":0.556,\"rgb\":[255,255,255],\"tol\":40}]" } },
  // A normal map over FLAT normals: the quad faces the viewer, so without the map
  // both halves take the same light. Its texels point -X and +X, so the lit half
  // and the unlit one are the tangent frame, derived per pixel from derivatives.
  { id: "mesh-normalmap", tier: "pr", webgpu: true, env: { ESTELLA_VERIFY_PREFAB: "/scenes/normalmap-quad.esprefab", ESTELLA_VERIFY_SCENE: "/scenes/mesh-normalmap.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/mesh-normalmap.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "4", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.375,\"y\":0.5,\"rgb\":[180,180,180],\"tol\":45},{\"x\":0.625,\"y\":0.5,\"rgb\":[0,0,0],\"tol\":30}]" } },
  // Takes the GPU away for real and captures AFTER the cycle: the four points
  // sample the atlas, so they fail unless the content came back. A vertex-colour
  // scene passed with the re-upload deleted. No webgpu — no GL extension there.
  { id: "device-loss", tier: "pr", env: { ESTELLA_VERIFY_DEVICE_LOSS: "1", ESTELLA_VERIFY_SCENE: "/scenes/tilemap-flip.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/tilemap-flip.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.40,\"y\":0.36,\"rgb\":[255,0,0]},{\"x\":0.60,\"y\":0.36,\"rgb\":[0,255,0]},{\"x\":0.40,\"y\":0.58,\"rgb\":[0,0,255]},{\"x\":0.60,\"y\":0.58,\"rgb\":[255,255,0]}]" } },
  // The player's case: nothing asks for the recovery, only frames pass, and it
  // happens FOUR times — backgrounding a tab is not a one-off, a recovery that
  // works once and never again passes any single-round check, and it takes
  // three rounds to measure whether the host's object tables are growing.
  // Three on WebGPU, where a loss is a destroyed device and the replacement can
  // only come from the page: the rounds check that the engine adopts a NEW one
  // each time. Object tables are a GL notion there and read zero.
  { id: "device-loss-auto", tier: "pr", webgpu: { ESTELLA_VERIFY_LOSS_ROUNDS: "3" }, env: { ESTELLA_VERIFY_LOSS_ROUNDS: "4", ESTELLA_VERIFY_DEVICE_LOSS: "auto", ESTELLA_VERIFY_SCENE: "/scenes/tilemap-flip.esscene", ESTELLA_VERIFY_MANIFEST: "/scenes/tilemap-flip.textures.json", ESTELLA_VERIFY_W: "256", ESTELLA_VERIFY_H: "256", ESTELLA_VERIFY_STEPS: "2", ESTELLA_VERIFY_EXPECT: "[{\"x\":0.40,\"y\":0.36,\"rgb\":[255,0,0]},{\"x\":0.60,\"y\":0.36,\"rgb\":[0,255,0]},{\"x\":0.40,\"y\":0.58,\"rgb\":[0,0,255]},{\"x\":0.60,\"y\":0.58,\"rgb\":[255,255,0]}]" } },
];

const rank = (tier) => TIERS.indexOf(tier);

/** Scenes that run at `tier`, cheaper tiers included. */
export function scenesAtTier(tier) {
  const want = rank(tier);
  if (want < 0) throw new Error(`unknown tier "${tier}" (have: ${TIERS.join(', ')})`);
  return SCENES.filter((s) => rank(s.tier) <= want);
}

/** The scene file a registry entry loads, or null for the default scene. */
export function sceneFileOf(s) {
  const p = s.env.ESTELLA_VERIFY_SCENE;
  return p ? p.replace(/^\//, '') : null;
}
