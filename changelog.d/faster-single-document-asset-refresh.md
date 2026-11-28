---
section: Changed
commits:
  - perf(assets): bypass the project reference cache for single-document updates
---
**Saving an individual scene or prefab updates its asset dependencies faster.** The scanner reads the affected document directly and uses the project-wide reference cache for full scans and updates that affect multiple documents.
