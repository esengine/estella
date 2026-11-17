---
section: Fixed
commits:
  - fix(audio): music made on a worker joins its loop without a step, and a stale worker bundle turns a gate red - the sound worker's committed text was built before the loop-seam fix (b129fd4b5) and was never rebuilt, so a game that makes its music on a worker still filtered every round of a loop from rest; and it kept those clips under SOUND_RENDER_REVISION 3, the revision that promised the fix
---
**Music a game makes on a worker joins its loop without a step.** The loop-seam fix for a piece of music with a tilted master never reached the worker that makes music in a running game, so where workers were available a looping theme still started each round as if silence came before it. The worker is built from today's synthesis again, and clips made by the old one and kept in the browser are made once more on the next launch instead of being played.
