---
section: Fixed
commits:
  - "fix(editor): roll a failed apply_scene_ops back inside an agent call, and write fields the present state hides"
---
**A failed `apply_scene_ops` call no longer leaves part of its work in the scene.** The tool is documented as all or
nothing, but when an agent called it through MCP and a later op failed, the entities the earlier ops had already created
stayed in the scene, even though the call reported the whole batch as failed. Now the batch is undone completely, and
anything the same call did before the batch is kept.

A field the Details panel hides because of the component's current state can also be written now, for example a
particle emitter's radius while its shape is a point. The value is kept and takes effect when the state changes. Before,
such a write was refused as "no field", so setting the shape and the radius in one `set` succeeded or failed depending
on the order of the keys.
