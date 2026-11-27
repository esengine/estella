---
section: Added
commits:
  - "feat(pipeline): stand made models from a rules graph with a `model` node"
  - "feat(editor): apply the models of a rules graph, each as its own entity"
---
**A rules graph can stand models made elsewhere.** A `model` node puts one of the graph's `models` (a mesh from
model_write with its material and texture) on each plot, scaled on each axis, turned and tilted with it: the few large
things a place is built round, such as floating isles or crags. Applying the graph makes each its own entity beside the
packed meshes, so a place laid out by rules is no longer only the built-in shapes.
