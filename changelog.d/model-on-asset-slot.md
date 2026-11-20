---
section: Added
commits:
  - feat(editor): a model given to an asset slot takes its fitting product, or offers a menu of several
---
**A model dropped on a Details asset slot puts in the product the slot takes.** A mesh slot gets the model's mesh, a material slot its material, a prefab slot its prefab; where several fit, such as the meshes of a many-part model, a menu at the drop asks which, as Unreal does, and where none fits the slot says so instead of refusing silently. The Content Browser now keeps its selection, greyed, while an entity is selected, so a slot's **Use Selected Asset** button works from the Details of a selected entity; before, selecting the entity cleared it and the button was always disabled.
