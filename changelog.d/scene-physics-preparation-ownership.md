---
section: Fixed
commits:
  - fix(scene): cancel retired physics preparations without blocking live scenes
---
**Prefetching a scene leaves the live 2D and 3D physics settings alone.** The first scene to publish with a solver chooses its world settings. A discarded preload or an unloaded scene gives back its acquired assets while its physics module is still in flight. Other scenes can use the shared download or start immediately with their own ready module. Custom scene loaders can use `ctx.signal` to cancel their own work on retirement.
