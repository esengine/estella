---
section: Fixed
commits:
  - fix(assets): the audio Compress tooltip no longer says to turn it off for loops
---
**The audio Compress tooltip no longer tells you to turn it off for loops.** It said MP3's encoder delay broke seamless
loops, but the export has recorded each clip's real length and played it from past that silence since 0.104.1; the
tooltip now says so.
