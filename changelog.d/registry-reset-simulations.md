---
section: Fixed
commits:
  - fix(ecs): retire scene state when a registry is cleared
---
**Clearing a world releases its tile layers, trails, particles and spring-bone poses before entity IDs are reused.** The replacement scene recomputes its transforms and Canvas layout. Other worlds on the same engine keep running, including when the previous scene still has a GPU particle step or a subtree removal in progress.
