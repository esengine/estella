---
section: Fixed
commits:
  - fix(scene): diagnose malformed scene records across loading and export
---
**Malformed scene records are reported at their location.** Scene loading and export report the entity, component, or prefab record that cannot be read. The asset cook can still process other scenes when a broken document is outside the package.
