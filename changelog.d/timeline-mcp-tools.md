---
section: Added
commits:
  - feat(editor): MCP tools that add timeline tracks, items and keys as the Sequencer does
---
**An agent can build a cutscene on a timeline.** The editor's MCP has a `timeline` tool group: `timeline_add_track` adds a track of any type (camera cuts, nested sequences, animation, spawn, activation, Spine, sprite, audio, particle, camera shake, marker, event) on an entity named by id or name path, `timeline_add_items` puts shots, clips and moments on it with their fields named as the file stores them, and `timeline_set_keys` keys any animatable field, making its property track. They run the Sequencer's own commands, so what they add is what the panel adds, one undo step a call; a wrong track type, field or entity is refused with the right ones. Before, an agent could only change what a timeline already held.
