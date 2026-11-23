---
section: Fixed
commits:
  - fix(resources): preserve the current owner when rebinding cache paths
---
**Replacing a resource at the same path keeps the new resource available by name.** Existing users can finish with the previous resource. Renaming or releasing it preserves the replacement, and an unused copy gives back its cache memory immediately.
