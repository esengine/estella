---
section: Changed
commits:
  - feat(render): qualityRunsEffect answers whether a quality level runs an effect - by the effect's type and by every rule the engine applies (the skipped list, post-processing off, temporal anti-aliasing keeping TAA and dropping FXAA), so a settings screen asks the engine instead of reading skipEffects
---
**`qualityRunsEffect(profile, 'ssao')` says whether a quality level runs an effect.** A level's effects are one list now
(`skipEffects`), and the resolved profile holds no `ssao` field: code that read `quality.profile.ssao` calls
`qualityRunsEffect(quality.profile, 'ssao')` instead. It answers by every rule the engine applies, not the list alone: a level
with post-processing off runs nothing, and one that smooths with temporal anti-aliasing runs TAA whatever it skips and never
FXAA. A project file or a player preference that still says `ssao: true` or `ssao: false` is read as before.
