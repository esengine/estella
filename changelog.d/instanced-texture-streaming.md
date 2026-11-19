---
section: Fixed
commits:
  - fix(render): placements ask for the texture size their nearest drawn instance needs, and plants a world grows start their textures small, so a forest's textures are streamed
  - fix(editor): texture streaming is called 纹理流送 in the Chinese editor, the name the documentation and the industry use - the quality settings said 贴图流式加载 and 贴图流式预算 while the World Streaming page said 纹理流送, so a search for one found neither the other nor the setting
---
**A forest's textures are streamed.** Texture streaming holds a mesh's textures at the size its views need, but it only
heard from meshes drawn one at a time: a mesh drawn as many placements (`MeshInstances`, which is how `PlacedFoliage` and
a world's plants draw trees, bushes and rocks) told it nothing, so their textures stayed as large as their files however
far the trees stood, and they were not started small either, since no scene names the plants a world grows. Placements
now ask for what their nearest drawn instance needs, by the same sum a single mesh uses, and a world's plants start their
materials and textures small. A mesh that is drawn but cannot say how much texture its surface holds now asks for the
whole texture, where it asked for nothing and a texture that started small stayed small while it was on screen. In the
Terrain & Water example at the Low quality level, the engine's estimate of GPU memory is 232 MB where it was 450 MB with
streaming on (512 MB with it off): its 56 plant textures start at 256 and settle at 64 or 128 for the trees in view. The
Chinese documentation and editor call the feature 纹理流送 throughout, and the level-of-detail page no longer reads as
saying texture streaming is missing.
