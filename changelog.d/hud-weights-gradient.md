---
section: Added
commits:
  - "feat(ui): draw text at any weight with tabular figures, and shade screen UI with a Gradient material"
---
**Screen UI can be drawn the quiet way a designed HUD is: light type, steady numbers and lines that fade.** `Text.fontWeight`
draws text at any weight from 100 to 900 (300 light, 700 bold), and a shipped variable font is registered with the weights
on its axis so each one is drawn as asked. `Text.tabularNumbers` gives every figure the width of the widest, so a timer, a
score or a count does not shift as it changes. The new built-in `Gradient` shader runs a colour across a `UIVisual` or a
sprite at an angle or out from its centre and can melt either end to clear: gold hairlines that fade out, a shade behind a
menu, a compass whose ends dissolve. The screen UI skill for AI agents now teaches how to build a restrained HUD with them.
