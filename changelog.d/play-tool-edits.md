---
section: Fixed
commits:
  - fix(editor): while a game runs, a tool edits what the Details panel would
---
**An AI agent no longer changes the saved scene behind a running game.** While a game was playing, the editor's own panels changed the running game and offered to keep the changes at Stop, but tools such as set_field, apply_scene_ops and add_component wrote straight into the saved scene, where the running game never saw them. Now set_field changes the running game, as the Details panel does, and Stop offers to keep it; edits that cannot be made to a running game (adding or removing entities and components, saving) are refused with a note saying to stop the game first. Edits to an open asset editor still work while playing.
