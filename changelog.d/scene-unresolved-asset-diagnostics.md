---
section: Fixed
commits:
  - "fix(assets): report each unresolved scene reference once"
---
**Scene loading reports each unresolved asset reference once.** An unresolved texture or other asset is listed once even when many scene entities refer to it, so the missing-asset count reflects distinct references.
