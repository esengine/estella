---
section: Added
commits:
  - "feat(pipeline): build a 2D rig and its clips from a description, and draw them for review"
  - "feat(editor): rig tools that let an agent build and animate a 2D skeletal character"
---
**An AI agent can make and animate a 2D skeletal character through the editor's MCP tools.** The new `rig` group has four
tools. `rig_write` builds an `.esrig` (with its `.esmesh` and `.esprefab`) from a picture of separate parts, bones given
from joint to tip, and the bones each part follows. It answers with a sheet showing the pose, which bones move each part,
and a test that bends every joint. It also warns about joints that nothing covers, parts placed away from their bones, and
boxes that cut a drawing. `rig_clip_write` writes a motion as an `.estimeline`, with turns in degrees and moves in pixels.
Its answer shows the frames side by side and laid over each other, the paths of the hands and feet, and how far a planted
foot slides. `rig_read` and `rig_clip_read` give back a rig or a clip in the same form, ready to change and write again.
The rig opens in the Rig editor and the clip in the Sequencer, and the placed prefab plays the clip.
