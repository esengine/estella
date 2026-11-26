---
section: Fixed
commits:
  - perf(runtime): spread main-thread jobs over the frame budget where there are no workers
---
**Mini-games and other hosts without workers no longer freeze while textures and recipes load.** Where a host has no web workers
(WeChat and other mini-game hosts, an old WebView), or the workers fail, KTX2 transcoding, `.esimage` drawing and `.essound` /
`.esmusic` rendering used to run in one go on the main thread: a scene with a few hundred compressed textures held one frame for
seconds. They now wait their turn inside the frame's budget, the same one world streaming and bakes share, a texture or clip at a
time, and run anyway when frames are not being drawn (a paused game, a hidden editor). Hosts with workers behave as before.
