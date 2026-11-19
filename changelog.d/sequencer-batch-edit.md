---
section: Added
commits:
  - feat(editor): the Sequencer selects, moves, copies, pastes and splits many keys and clips at once
---
**The Sequencer edits many things at once.** A box dragged over the lanes selects the keys and clips it touches, Shift/Ctrl-click adds one, and dragging any of them moves them all as one undo step. Ctrl+C, Ctrl+X, Ctrl+V and Ctrl+D copy, cut, paste at the playhead and duplicate a selection in its own tracks; S splits the selected clips at the playhead, the second part carrying on where the first stopped; Delete and Ctrl+A work on the whole selection. Before, keys and clips were moved and deleted one at a time and a clip could not be cut.
