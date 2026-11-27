---
section: Changed
commits:
  - perf(editor): reuse the scene child index for branch paths
  - perf(project): ship faster editor branch path queries
---
**The Sequencer and Animator can list paths under an entity faster in large scenes.** The editor reuses the scene's child index between hierarchy edits and reads current names and components when building paths.
