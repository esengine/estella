# Render lab

Small scenes with known answers, drawn by Blender (Cycles) and by the engine from the same glTF, the same camera, sun and sky. A sphere's
brightness is a formula and a shadow's edge is where a ray goes, so what the two renderers disagree about points at one formula.

Scenes are listed in `lab_specs.py`: `balls_sun`, `balls_env` (six spheres, dielectric and metal at roughness 0.15 / 0.45 / 0.9, under a sun
alone or a uniform white sky alone), `shadow`, `shadow_soft` (a floor, a box and a sphere, a hard sun and one of 3.4 degrees), `strands`
(cards of fine stripes seen small: a cut-out, an opaque one, a ramp).

```bash
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"; O=D:/estella/output/render-lab
"$B" --background --python tools/render-lab/build_lab.py -- balls $O/balls.glb             # the scene, as a GLB
"$B" --background --python tools/render-lab/lab_ref.py -- balls_sun $O/balls.glb $O/ref_balls_sun.png
BACKEND=webgl2 bash tools/render-lab/run-lab.sh balls_sun $O/balls.glb                     # or BACKEND=webgpu (opens a window)
python tools/render-lab/lab_compare.py balls_sun $O/ref_balls_sun.png $O/engine_balls_sun.png $O/cmp_balls_sun.png
```

Blender renders with the Standard view transform and the engine with no output transform, so the two PNGs compare as they are. A Blender sun of
strength S lights a white diffuse surface to S / pi; the engine's sun of intensity I to I, so the lab gives Blender pi times the engine's intensity.
`sourceAngle` is in degrees in the engine and radians in Blender. Spheres stand three metres apart so one does not light another (the engine has
no bounce light by default; Blender has twelve bounces).

## Global illumination

`gi_specs.py` holds four rooms of boxes, built the same way on both sides: Blender draws the boxes in metres, and the engine draws them as `builtin:cube` in centimetres. There is no sky, so every pixel the sun does not reach directly shows only what the GI method gives it. Cycles (12 bounces) is the truth here, not another engine's approximation.

| Scene | What it asks |
| --- | --- |
| `gi_room` | A Cornell-like room lit through a skylight: bounce brightness, colour bleed off the red and green walls, the block's shaded face |
| `gi_away` | The same light with the camera turned so the lit patch is off screen: light the picture does not show |
| `gi_leak` | The room closed with the sun outside: anything inside is leak |
| `gi_emissive` | Closed and dark but for an emissive panel |

```bash
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"; O=D:/estella/output/render-lab/gi
"$B" --background --python tools/render-lab/gi_ref.py -- gi_room $O/ref_gi_room.png
EFFECTS='[{"type":"voxelGI","enabled":true,"uniforms":{}}]' bash tools/render-lab/gi-run.sh gi_room vgi    # BAKE=1 bakes lightmaps first
python tools/render-lab/gi_compare.py gi_room $O/ref_gi_room.png vgi=$O/engine_vgi.png
node tools/render-lab/gi_cost.mjs $O/web_vgi                                                              # frame ms, GPU ms per pass
```

### 2026-11-05 results

Each figure is a region's linear value in the engine as a share of Cycles' value there; 1.00 matches. A `MeshRenderer.color` is linear albedo, on both sides. A first pass linearized it for Blender only, which made Cycles' walls darker than the engine's, so the direct light read 1.19 and the bake 1.6. WebGL2 numbers come from headless Chromium. The WebGPU column is the compute path, rendered in the MCP's hidden editor.

| Region | Cycles | SSGI (radius 400) | Voxel GI default, WebGL2 | Voxel GI default, WebGPU | Bake, 2 bounces | Bake, 8 bounces | Bake, 12 bounces |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `gi_room` ceiling | 0.056 | 0 | 0.15 | 0.12 | — | 0.90 | 0.93 |
| `gi_room` back wall | 0.043 | 0.01 | 0.08 | 0.04 | 0.59 | 0.92 | 0.94 |
| `gi_room` floor in shade | 0.042 | 0 | 0.01 | 0 | 0.59 | 0.95 | 0.96 |
| `gi_room` block, shaded face | 0.014 | 0 | 0 | 0 | 0.10 | 0.82 | 0.93 |
| `gi_away`, every region | 0.006–0.03 | 0 | 0 | — | | | |
| `gi_emissive` ceiling | 0.24 | 0.04 | 0.08 | — | | | |
| `gi_emissive` floor | 0.21 | 0.03 | 0.05 | — | | | |

- **The bake is right once it bounces enough.** With 8 bounces it lands within 5–18% of Cycles, and with 12 within 4–10%. Two bounces, which was the default, left a light-walled room at about half its light. The default is 8 now, and the inspector goes to 16. More bounces cost little: a 252k-lumel bake took 1.7 s at 2 bounces and 2.4 s at 8.
- **The real-time methods give a fraction of the bounce.** Voxel GI gives 0.04–0.15 of it, SSGI about none. Faces that only a later bounce reaches get nothing.
- **Nothing off screen, until the sun's map.** Both real-time methods seeded from the frame's own picture, so `gi_away` was black under them. The WebGPU cache now also reads the sun's shadow map back into world points (kernel `gi_sun`). With the default cascades `gi_away` gets 0.12–0.31 of Cycles, and with a fixed 6 m reach 0.10–0.28. `gi_leak` stays black.
- **One bounce, until the feedback.** The WebGPU inject adds albedo × the last gather, so light keeps bouncing.
  - 12 cm voxels, `gi_room`: ceiling 0.50–0.57, red wall 0.55–0.62, back wall 0.43–0.50, floor in shade 0.51–0.58 (was 0).
  - Default 40 cm: frame light share 1.09 (mean |d| 0.0092, the lowest of every run). The ceiling and red wall overshoot (1.4–1.6) because a coarse voxel straddles both sides of a corner.
  - The block face that only the off-screen, unlit front wall sees stays at 0.02: what the camera neither sees nor the sun lights is still missing.
- **Fine grids drew nothing.** Below about 12 cm one sample a frame lands in a voxel, and the cache ages its count by 0.93 and truncates (1 → 0). It never reached the 2 a ray asks for. Samples now count 16.
- **Shadow map traps.** The atlas is packed colour (unpack the rgb), not a depth texture, and a depth binding silently falls back to a dummy. Its z is clip z × 0.5 + 0.5, so undo it before the inverse, or every point lands toward the light and a closed room fills with sun.
- **No colour bleed, until the albedo attachment.** On the red wall the real-time red channel was 0.11–0.15 of Cycles while green and blue were 0.5–0.85, so the bounce arrived grey. Both effects guessed the receiver's colour from the lit picture, which is black where the sun does not reach. Since the scene pass writes the albedo beside the normal, Voxel GI gives:
  - WebGL2: ceiling 0.72–0.90, red wall 0.75/0.73/0.77, back wall 0.32–0.45.
  - WebGPU compute: ceiling 0.57–0.71, red wall 0.48–0.57.
  - Emissive room: ceiling 0.44–0.52 (SSGI 0.36–0.43).
  
  Still about 0: the floor in shade and the block's face, which need a second bounce, and `gi_away`. Render gates `gi-room-baked` and `gi-room-voxel` hold the bake and the albedo path.
- **No leak in `gi_leak`.** That is only because the lit outside is never on screen.
- **Banding.** The WebGL2 voxel fallback and SSGI band visibly in the emissive room.
- **Built-in meshes did not draw their bake until d39f6842e.** They had no `TexCoord1` at runtime.
- **Screenshots can come too early.** One `BAKE=1` shot came out with no indirect light at all; rerun, it was fine. The shot waits a fixed 12 s, and once that was not enough for the atlas to load.

GPU cost at 1280×720, WebGL2, on this desktop:
- SSGI: gather 0.8–0.9 ms + apply 0.4 ms. Frame 1.25 → 2.8 ms.
- Voxel GI: voxels 0.6 ms + gather 1.9 ms + apply 0.1 ms. Frame → 4.3 ms.

### Calibration (2026-11-05, WebGPU)

| Run | Frame light share | Regions |
| --- | --- | --- |
| `gi_room` at 40 cm, before | 1.09 | 0.98–1.61 |
| `gi_room` at 40 cm, after | 0.95 (mean \|d\| 0.0093) | 0.71–1.51 |
| `gi_room` at 12 cm, before | 0.65 | 0.43–0.62 |
| `gi_room` at 12 cm, after | 0.74 | 0.54–0.84 |
| `gi_away` with cascades, before | 0.23 | — |
| `gi_away` with cascades, after | 0.35 | 0.24–0.57 |

`gi_leak` stays black. The block face that only the unlit, off-screen front wall sees stays at about 0. What changed:

1. **No distance falloff.** A hit used to be scaled by 1 − t/range. Now only the last 15% of the range fades out.
2. **Coverage.** Each voxel accumulates the surface area put into it, in word 7. For a screen sample that is its 2×2-pixel footprint measured on the surface; for a sun sample it is its texel on the surface. A ray takes covered × radiance and goes on through the rest of the voxel. A bright patch filling a corner of a coarse voxel had lit like the whole voxel, which was the coarse-grid overshoot.
3. **A seen mark (tag bit 1).** Voxels the picture showed this frame keep their own colour rather than the sun's assumed albedo. This measured no different here, but it is the right priority.

The remaining under-shoot at 12 cm (about 25%) has no single cause found. Rays still escape through partly covered voxels and past the facing test.

Trap: the first frame captured right after the hidden editor restarts can be a stale one (no GI). Step and capture again before you read anything.

### The WebGL2 fallback (2026-11-05)

The fallback has no compute stage, so it gets the same two things a different way, inside `gi_voxels`, where every atlas texel is one
voxel:

- **Sun.** The voxel's centre is projected into the sun's map (`#pragma lights`, `findSun`). The map's z (clip z × 0.5 + 0.5), taken
  over one voxel toward the sun, turns into a distance. A sunlit surface within 0.75 voxels of the centre, measured along the ray, is
  in the voxel; half a voxel missed a floor lying on a cell boundary. Its normal comes from the same test at two offsets. It is used
  only where the picture showed nothing of the voxel.
- **Bounce.** A voxel with content traces two rays through last frame's atlas (`u_feedback`) along its facing, and adds albedo × what
  they bring. The albedo is the footprint's mean from `u_sceneAlbedo`, or the sun's assumed albedo.

| Scene | Before | After |
| --- | --- | --- |
| `gi_room` at 40 cm | 0.56 | 1.00 (mean \|d\| 0.0078) |
| `gi_room` at 12 cm | — | 0.80 (two runs, the same) |
| `gi_away` at 12 cm | 0 | 0.20 |
| `gi_leak` | — | mean 0.006/255, max 10/255 |

The voxel pass went from 1.11 to 2.45 ms (frame 4.4 → 5.1 ms). There is no coverage term here (the atlas has no spare channel), so
coarse grids still overshoot regionally: the ceiling is 1.4 at 40 cm. One headless run of 12 cm read 0.51. A rerun twice read 0.80,
so take a single low reading as a capture timed before the grid filled.
