---
section: Added
commits:
  - feat(editor): the Content Browser folds a model's products under the model
  - feat(pipeline): a model import records in each product's .meta the model it came from
---
**The Content Browser folds a model's imported assets under the model.** As Unity folds a model's sub-assets, a `.gltf`, `.glb` or `.fbx` is one entry with an arrow, and its meshes, materials, animation clips and prefab show right after it, on one band, only while it is open; a folder that held a model and its fifteen hundred meshes now lists the model. Each product's `.meta` records the model it came from (`source`), which a re-import keeps; a project imported before folds by the names the import gives. A search still lists everything, and Browse to Asset on a folded product opens its model. Nothing moves: the products are the same files, referenced as before.
