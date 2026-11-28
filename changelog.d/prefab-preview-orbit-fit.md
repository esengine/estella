---
section: Fixed
commits:
  - fix(render): fit prefab preview geometry in the camera frame
---
**Prefab mesh previews fill the available thumbnail at the chosen angle.** The camera fits the visible geometry to the thumbnail's aspect ratio, including long or thin meshes in wide, tall, and oblique views.
