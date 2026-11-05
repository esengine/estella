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
- **Nothing off screen.** Both real-time methods seed from the frame's own picture, so `gi_away` is black under them. A surface cache lit independently of the view is what changes this.
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
