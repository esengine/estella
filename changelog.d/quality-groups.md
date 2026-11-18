---
section: Changed
commits:
  - feat(render): a quality level is twelve groups of settings, each declared once in a table that now also holds switches, fixed choices and names - the profile, its defaults, its parsing, player preferences and the editor's rows are made from it; each effect drawn small has a resolution of its own in its group, every effect is listed in the group it belongs to, ambient occlusion is left out only by the list of skipped effects, and a project's older fields read back unchanged
  - feat(settings): the quality levels are a table per group with Low, Medium and High side by side - every cell is edited in place, a cell is marked changed against its own level's default and reset on its own, a group's effects are a matrix of effect by level, a window too narrow for three columns keeps the one-level page, and a value set back to its level's default leaves project.esproject
---
**The quality levels are twelve groups, each a table with Low, Medium and High side by side.** Project Settings →
Rendering lays out what a level spends as Resolution & Anti-Aliasing, View Distance & Draws, Lights & Shading, Shadows,
Global Illumination & Occlusion, Reflections, Sky & Volumetrics, Post-Processing, Effects & Particles, Terrain & Foliage,
Water and Textures & Memory: a row a setting, a column a level, every cell editable. A changed cell is tinted and reset on
its own, compared only with its own level's default; a group's effects are ticked in a matrix of effect by level, in the group
each belongs to (screen-space reflections under Reflections, ambient occlusion and GI under Global Illumination & Occlusion,
fog and sky under Sky & Volumetrics); a cell that does nothing at its level (MSAA under temporal smoothing) is dimmed; a
narrow window goes back to editing one level at a time. A value set back to its level's default is removed from
`project.esproject`. Whether ambient occlusion runs is now said only by the level's skipped effects: a profile's older
`ssao` switch is read into that list, and every other field an older project wrote reads back unchanged. The still-sky
switch, which could only be set in the project file, is a row of Sky & Volumetrics.
