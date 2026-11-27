---
section: Fixed
commits:
  - fix(native): match Web children component membership
---
**Native and Web agree on empty `Children` components.** After an entity's last child leaves, native `World.has`, `tryGet` and component queries continue to see the empty component, matching the Web runtime.
