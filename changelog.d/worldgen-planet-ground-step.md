---
section: Changed
commits:
  - perf(worldgen): a world on a planet is laid out in a second where it took ten - the ground under what is placed was read every metre and a half whatever the world's size, which for a world of trees tens of units across seen from the air was a thousand ground points a tile and a hundred and fifty tiles a square, and every square of a face waited on one worker; `WorldGen.groundStep` says how far apart the ground is read, and a face's squares are spread over the workers by where they are
---
**A world laid out on a planet fills in about a second, where a large one took ten or more.** The ground under what is placed was read every 1.5 units, a spacing meant for a world walked on foot; a world of large things seen from the air read thousands of ground points for every square it laid out. `WorldGen.groundStep` sets how far apart the ground is read (the cost of a square falls with its square), and the squares of one face of the planet are now spread over the worker threads instead of queuing on one. Measured on a planet of radius 58,000 with trees out to 3,000 units: 242 pieces in 1.1 s, where there were none for 4 s and 45 after 10.
