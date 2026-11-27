---
section: Changed
commits:
  - perf(editor): keep parent moves local to their sibling lists
  - perf(ecs): support ordered reparenting without sorting the world
---
**Moving a node between parents costs less in large scenes.** The editor inserts the node directly at its authored sibling position, keeping animation targets and UI hierarchy order stable without reordering unrelated entities.
