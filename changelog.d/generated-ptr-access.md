---
section: Changed
commits:
  - perf(ecs): queries read every fully covered engine component straight from the wasm heap
---
**Queries and `Mut()` write-back read every engine component whose fields all have a fixed place in memory straight from the wasm heap.** The web build used to export a pointer function for only eight components, so a query over `UIInteraction`, `Light`, `UIVisual`, `RigidBody3D`, the 3D colliders and about forty others marshalled the whole component through embind on every row. EHT now writes those functions for each of the 47 components whose layout covers every field, and for none of the five that hold a string or a list (`BitmapText`, `SpineAnimation`, `DragonBonesAnimation`, `ShadowCaster2D`, `SpringBone`), which keep the marshalled path so a row never loses a field. `Canvas.designResolution`, an unsigned pair, is now read and written as integers; the native core used to read it as two floats.
