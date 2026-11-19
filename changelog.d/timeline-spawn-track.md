---
section: Added
commits:
  - feat(timeline): spawn tracks bring in an entity from a prefab for the span of a clip
---
**Timelines spawn entities.** A spawn track makes a prefab, under the track's entity and by the name its clip gives it, while the playhead is inside the clip, and takes it away when the playhead leaves or the timeline stops, as UE's spawnables and Unity's Control track do. The timeline's other tracks address the instance by that name, so a cut scene can bring in a creature, animate it and film it without it standing hidden in the level. The prefabs are loaded when the player first plays, and the Sequencer's preview shows the instance as you scrub without it ever becoming part of the scene.
