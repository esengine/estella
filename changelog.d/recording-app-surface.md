---
section: Fixed
commits:
  - fix(recording): follow the render surface of the recording app
---
**Web recordings capture the game canvas that belongs to the running app.** A preview or thumbnail on the same page no longer ends up in the video. Checking recording support before the game opens works on later attempts, and finishing a recording or leaving Play releases the capture tracks.
