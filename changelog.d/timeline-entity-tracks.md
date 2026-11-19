---
section: Added
commits:
  - feat(timeline): a TimelinePlayer sends the events and markers it crosses as TimelineEvent, and an activation track switches an entity whole
  - feat(editor): the Sequencer authors every track the runtime plays, as bars and pins edited in the Details
---
**Every timeline track is authored in the Sequencer, and its events reach the game.** The Sequencer's Track menu adds activation, Spine, sprite animation, audio, particle, marker and event tracks on any entity below the timeline's root; spans are bars dragged and resized on the lane, moments are pins, and a selected item is edited in the Details, as in Unity's Timeline and UE's Sequencer. A `TimelinePlayer` now sends each event and marker its playhead crosses as a `TimelineEvent` (name, payload, time, the playing entity and the track's entity); before, only a timeline an Animator state played reported its events. An activation track now switches its entity on and off whole, children included, as Unity's Activation Track does; it used to flip only a 2D renderer's `enabled`, so a mesh, a light or a child stayed on.
