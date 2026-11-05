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

Each figure is a region's linear value in the engine as a share of Cycles' value there; 1.00 matches. WebGL2 numbers come from headless Chromium. The WebGPU column is the compute path, rendered in the MCP's hidden editor.

| Region | Cycles | no GI | SSGI (radius 400) | Voxel GI default, WebGL2 | Voxel GI default, WebGPU |
| --- | --- | --- | --- | --- | --- |
| `gi_room` ceiling | 0.030 | 0 | 0 | 0.30 | 0.23 |
| `gi_room` back wall | 0.021 | 0 | 0.02 | 0.17 | 0.09 |
| `gi_room` floor in shade | 0.018 | 0 | 0 | 0.02 | 0.01 |
| `gi_room` block, shaded face | 0.004 | 0 | 0 | 0 | 0 |
| `gi_away`, every region | 0.010–0.014 | 0 | 0 | 0 | — |
| `gi_emissive` ceiling | 0.16 | 0 | 0.07 | 0.12 | — |
| `gi_emissive` floor | 0.14 | 0 | 0.04 | 0.08 | — |

- **Too little light.** Where the engine's GI reaches at all, it gives a tenth to a third of the bounce Cycles does. Faces that only a second bounce reaches (the block's shaded side, the floor away from the patch) get nothing.
- **Nothing off screen.** Both methods seed from the frame's own picture, so `gi_away` is black under every method. A surface cache lit independently of the view is what changes this.
- **No colour bleed.** On the red wall the engine's red channel is 0.10–0.32 of Cycles, but green and blue are 1–5×. The bounce arrives grey, and the wall's albedo does not tint it the way Cycles does. The green wall shows the same.
- **No leak in `gi_leak`.** That is only because the lit outside is never on screen, so there is nothing to leak.
- **Banding.** The WebGL2 voxel fallback and SSGI both band visibly in the emissive room.
- **The bake showed nothing on built-in meshes (fixed the same day).** A `builtin:` mesh had no `TexCoord1` at runtime, so `MESH_LIGHTMAP` never turned on. The templates now carry the bake's own unwrap. Since the fix, the baked `gi_room` is 1.5–1.8× Cycles everywhere (ceiling 1.53, back wall 1.64, floor in shade 1.9, the block's shaded face 1.6), with dark seams at chart edges. This calibration gap is still open, and it is on top of the 1.19 the direct light shows.
- **Direct light is 19% bright.** The sun patch is 1.19 of Cycles on both backends. This is separate from GI and not explained yet.

GPU cost at 1280×720, WebGL2, on this desktop:
- SSGI: gather 0.8–0.9 ms + apply 0.4 ms. Frame 1.25 → 2.8 ms.
- Voxel GI: voxels 0.6 ms + gather 1.9 ms + apply 0.1 ms. Frame → 4.3 ms.
