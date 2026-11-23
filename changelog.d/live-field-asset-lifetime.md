---
section: Fixed
commits:
  - fix(assets): retire unused entity bindings after live component edits
---
**Changing a sprite or mesh texture now releases the entity's unused texture acquisition.** Clearing a handle or removing the renderer also gives the acquisition back once the entity's last field stops using it. Other fields, prefab instances and explicit owners keep their resources. The asset monitor follows live texture, font and material assignments and removals.
