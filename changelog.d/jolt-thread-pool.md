---
section: Changed
commits:
  - perf(physics3d): step the 3D world on a thread pool on devices
---
**3D physics uses several cores on desktop and mobile builds.** On native platforms the 3D world now steps on a thread pool
sized like the 2D world's: the cores beside the game and render threads, at most four, and the calling thread alone on a machine
with fewer than two to spare. A pile of 392 bodies went from 1.06 ms to 0.59 ms a step on a 20-core desktop. The results do not
depend on the thread count: positions and contact events are bit-identical with 0, 2 and 4 workers. Contact and sensor events now
come in one fixed order on every platform (by entity, then by contact point), and moved bodies by body id, instead of the solver's
internal order, so
code that took the first contact of a step as "the" contact should look for the pair it means. Web builds stay single-threaded.
