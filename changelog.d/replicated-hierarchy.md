---
section: Fixed
commits:
  - fix(net): preserve visible hierarchies across replication changes
---
**Visible children keep their identities and attachments when a replicated parent leaves view.** Children reattach when their parent returns. Reparenting, detachment and reconnects update the hierarchy of existing ghosts in both 2D and 3D scenes.
