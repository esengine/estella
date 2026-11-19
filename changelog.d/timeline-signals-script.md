---
section: Added
commits:
  - feat(timeline): timeline markers and events reach visual scripts as timeline:<name>
---
**Visual scripts hear a timeline.** Each named marker or event the playhead crosses is also sent as the entity event `timeline:<name>`, to the entity its track is about and then up to the player, as Unity's Signal Receiver does: an On Event node of that type in a visual script reacts to it, with the track's entity as `target` and the player as `other`, and event bindings and state machines hear it too. The Sequencer's name fields say so. Before, only code reading `TimelineEvent` could react to a cue.
