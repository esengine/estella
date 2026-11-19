---
section: Added
commits:
  - feat(timeline): an animation track plays skeletal clips on a rig, easing them in and out and crossfading where they overlap
  - feat(editor): the Sequencer adds animation tracks, draws their eases and crossfades, and previews the blend
---
**Timelines animate 3D characters.** An animation track plays skeletal animations (the `.estimeline` clips a model import writes) on a rig, as Unity's Animation Track and UE's Skeletal Animation track do: each clip has a start, a length, a Clip In offset, a speed and a loop, eases in and out over the rig's own pose (its Animator's for the frame, or its rest pose), and crossfades with a clip it overlaps; a track can hold its last pose. The timeline now runs after the Animator, so an animation track at full weight decides the pose and a property track has the last word on a field both animate. The Sequencer adds the track from its Track menu, draws the ease ramps and the crossfade, edits a clip in the Details and previews the blend while scrubbing.
