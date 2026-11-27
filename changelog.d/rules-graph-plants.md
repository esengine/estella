---
section: Added
commits:
  - "feat(pipeline): stand plant models from a rules graph with a `plant` node"
  - "feat(editor): apply the plants of a rules graph as one PlacedFoliage, made as a land's are"
---
**A rules graph can stand real trees.** A `plant` node puts one of the graph's `plants` (a model and its cheaper ones,
as a land names them) on each plot, carried with its plot through a component like any part. Applying the graph leaves
the plants out of the packed meshes and grows them in one PlacedFoliage, each choosing its detail by its distance, so a
town's street trees and the woods on the hills round it are drawn the same way.
