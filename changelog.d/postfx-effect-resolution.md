---
section: Added
commits:
  - feat(render): the effects that are drawn small take their size from the quality level - effectResolution multiplies the size ambient occlusion, fog light, screen-space GI, lens flare and the voxel GI gather draw at, down to a floor each effect declares; it is the first entry of a table of per-level settings (QUALITY_SETTINGS) that the profile, its parsing, player preferences and the editor row are all made from
  - feat(settings): the quality level's effect resolution is a row of its post-processing group - the row is made from the engine's table of per-level settings (QUALITY_SETTINGS), with its label, description, range and three defaults read from there, so the next setting added to the table needs no editor change; only a value that differs from the level's own default is written to project.esproject
---
**A quality level sets how large the effects that are already drawn small are drawn.** Ambient occlusion, the light in
height fog, screen-space GI, the voxel GI gather and lens flare are worked out at half the picture's size; a level's **Effect resolution** now multiplies that size (1 as authored, 0.5 a quarter, 0.25 an eighth),
down to a floor each effect declares where its picture would break up. The passes over the whole picture (tone mapping,
FXAA, grading) stay at full size. Low draws them at an eighth (ambient occlusion at a quarter, its floor), Medium at a quarter and High as
before; on `bistro` at Medium those passes went from 4.6 ms to 1.6 ms on a desktop GPU at a phone's resolution. Ambient
occlusion's depth-aware upsampling widens its tolerance with the ratio, so a quarter-size term does not band on grazing
ground. Clouds and bloom keep their size. It is a row of the level's post-processing group in Project Settings,
`effectResolution` in a profile, and a player preference (`Quality.setPreferences`).
