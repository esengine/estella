---
section: Fixed
commits:
  - fix(sequencer): anchor the track menu and render the current clip independently
  - fix(runtime): load authored asset snapshots for play and timeline renders
---
**The Sequencer’s Track menu stays beside its button, and Render includes unsaved timeline edits.** The menu opens above a bottom dock, scrolls long track lists, and supports keyboard access to target entities. Both 2D and 3D renders use their own game instance, so exporting keeps a paused playtest at its current frame. Each render writes its frames to a separate folder.
