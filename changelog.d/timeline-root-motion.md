---
section: Added
commits:
  - feat(timeline): animation tracks move their rig by its clips' root motion
---
**Animation tracks have root motion.** With a track's Root motion on, a clip's root track says where the character travels instead of where it stands, as Unity's Apply Root Motion does: the rig moves from where it stood, each clip going on from where the one before left it, a looping clip travelling lap after lap, crossfades blending, and the rig staying where it got to after the last clip. It is worked out from the clips at every time, so scrubbing and looping put the rig in the same place, in the Sequencer's preview and in play. Before, a walk clip on a timeline walked on the spot it was made at.
