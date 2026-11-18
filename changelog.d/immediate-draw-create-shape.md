---
internal: ImmediateDraw's method that keeps a Graphics shape on the GPU is named createShape, so it is no longer mistaken for the engine's one MeshHandle mint; nothing a project can call or see changes.
commits:
  - refactor(render): ImmediateDraw::createShape keeps a Graphics shape on the GPU - it was named createMesh like ResourceManager's MeshHandle mint, so mesh-provenance read a retained shape buffer as an undeclared MeshHandle producer
---
