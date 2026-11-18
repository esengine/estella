---
section: Added
commits:
  - feat(render): the low quality level reads probe volumes per object and holds no probe atlas, and the frame stats say what probe volumes cost - QualityProfile.probesPerPixel, renderer_setProbesPerPixel, and the draws reading per pixel and per object with the atlas's GPU bytes
  - feat(editor): get_stats reports what probe volumes cost - the draws that read one per pixel and per object, the brick atlas's GPU bytes and the ten texture reads a per-pixel lookup makes, from the viewport and from a running game
---
**The low quality level reads probe volumes one value per object, and the stats say what probe volumes cost.** A mesh without lightmap UVs reads its probe volume per pixel, ten texture reads a lookup from a 3D atlas of bricks; at the low level (`probesPerPixel: false` in its profile, which a project can change at any level) it reads the one value where it stands, as a mesh with lightmap UVs always has, and no probe atlas is held on the GPU. The frame stats and `get_stats` report `probes`: the draws that read per pixel and per object last frame, the bytes the atlas takes, and the reads a lookup makes. The profiler records the same as `render.probes.*` counters.
