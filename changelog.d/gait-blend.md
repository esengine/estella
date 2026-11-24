---
section: Fixed
commits:
  - fix(animation): a gait blend keeps its stride as its mix changes
  - feat(animator): a blend stop takes a sync phase
---
**Going from a walk to a run blends the stride instead of jumping to it.** A blend whose mix changed read its clips at another point of their cycle, so the legs jumped a step; it now keeps its place in the cycle. Its root motion is read over the stretch of each clip the pose was, so the feet stay planted through the mix. A blend stop gains Sync phase (`phase`), the point in its own cycle a clip is at when the blend's starts, which lines up two gaits that start on different feet. And a Third Person Controller walking by its animation brings the speed it asks for up at its own acceleration, so a gait changes over the time the character takes to reach it.
