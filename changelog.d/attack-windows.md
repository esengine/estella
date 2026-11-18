---
section: Added
commits:
  - feat(animation): a clip event with a duration is a window - a melee swing sweeps its anchor's path over its active window, a transition can wait for a window on the clip being left, and a trigger buffers a press for a set time
---
**A clip can declare windows, and a melee swing reaches along the path its weapon travelled.** A `customEvent` on a
timeline clip may carry a `duration`: it is then a window, open over that stretch of clip time, which the animator
reports every frame its playhead is inside it (`AnimatorController.openWindow(entity, name)`, `windowsOf(entity)`). A
window shorter than a frame is still reported on the frame that passed over it; only the state being played holds one,
so a clip left early (cancelled into a dodge, crossfade included) shuts it on that frame; and each opening has its own
id, so two attacks back to back are two. `MeleeAttack` reads an `attack-active` window as its active frames: while it
is open, the swing sweeps spheres along the line from where its anchor was to where it is, so a blade that moves
farther in a frame than its own reach still meets what it passed, and it lands on each target once per opening. The
`attack-start`, `hit` and `attack-end` beats work as before, and a clip that states both swings once. The Third Person
3D example's attack declares its active frames as one window.
