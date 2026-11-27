---
section: Fixed
commits:
  - fix(assets): align saved material texture loads with live preview
---
**Saved materials leave empty texture slots unassigned.** The runtime also loads independent maps together and keeps the maps that load if another fails.
