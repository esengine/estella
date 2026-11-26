---
section: Fixed
commits:
  - fix(camera): query world coordinates using the drawn render origin
  - fix(editor): refresh viewport overlays on render origin changes
  - fix(project): ship render origin aware viewport overlays
---
**Camera picking follows the drawn scene in large worlds.** Screen rays, world-space UI queries, and viewport projections use the relative view-projection and its frame origin when render-origin rebasing is enabled.
