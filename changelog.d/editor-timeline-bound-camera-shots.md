---
section: Fixed
commits:
  - "fix(sequencer): offer bound cameras when adding and editing shots"
  - "fix(editor): ship timeline camera binding authoring"
---
**Sequencer shots can target cameras through TimelinePlayer bindings.** The Add Shot menu and Details both list cameras under the player and its bound entities. Details writes the selected camera path, so a change to the scene cannot move a pending selection to a different camera. The track's Add menu stays open when a delayed scroll event leaves its button in place.
