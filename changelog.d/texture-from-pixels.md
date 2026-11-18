---
section: Added
commits:
  - feat(asset): a texture can be made from pixels at run time - Assets.createTexture takes RGBA bytes a game worked out as it ran (a map of a world it has just generated) and answers a texture a material or a MeshRenderer takes, colours or numbers as it says, and releaseBuiltTexture gives it back; there was no way to a texture but a file or a render target
---
**A texture can be made from pixels at run time.** `Assets.createTexture({ width, height, pixels }, { srgb, flipY })` takes RGBA bytes and answers a texture handle for a material (`Material.setUniform(m, 'u_map', { __textureRef: true, textureId })`) or a `MeshRenderer.texture`; `srgb: false` says the texels are numbers a shader looks up and not colours. `Assets.releaseBuiltTexture` gives it back. A game that works a picture out as it runs, such as a map of a world it has just generated, had no file to load it from.
