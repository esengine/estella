---
section: Fixed
commits:
  - fix(render): Draw can draw over the whole frame, the screen's UI included - registerOverScreenDrawCallback runs once a frame after the screen overlay, through the view of the last camera drawn to the screen, and the engine draws what it collected in a pass of its own over the finished frame; a core without that pass draws them with the scene as before
  - fix(editor): the transform gizmo and the editor's overlay lines draw over a Canvas's screen UI - the overlay registers as an over-screen draw callback, so an image the size of the design view no longer hides the rotate ring and the handles under it
---
**The transform gizmo is no longer hidden under a Canvas's UI.** In the scene view, the move, rotate and scale handles and the editor's other overlay lines (collider outlines, light ranges, camera frustums) were drawn with the scene, and a screen-space Canvas is drawn after the scene, so an Image covering the design view hid the rotate ring and the handles wherever they crossed it. They are now drawn after the screen's UI, over everything the view shows. A plugin can do the same with `registerOverScreenDrawCallback`.
