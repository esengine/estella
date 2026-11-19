---
section: Added
commits:
  - feat(timeline): ScreenFade fades the screen to a colour and TimeDilation slows the game, components a timeline keys like UE's Fade and Time Dilation tracks
  - feat(editor): the Sequencer adds Fade and Time dilation tracks
---
**A cutscene fades to black and slows time.** `ScreenFade` (`amount`, `color`) fades the screen to a colour, drawn over everything in 2D and 3D by a canvas of its own that never takes the pointer; `TimeDilation` (`scale`) slows or speeds the game, multiplying the game's own `Time.scale` so a paused game stays paused. A timeline keys them on ordinary property tracks, as UE's Fade and Time Dilation tracks do, and a script can set them directly. The Sequencer's Track menu adds either to the root with a key at the playhead.
