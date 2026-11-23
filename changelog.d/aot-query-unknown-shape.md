---
section: Fixed
commits:
  - fix(aot): a system querying a component with no known shape stays interpreted instead of refusing the whole compiled module at boot
---
**A compiled system that queries a component with a text field no longer stops the game from starting.**
A system marked `@compiled` that only filtered on such a component (a string default, or one the SDK
declares, such as gameplay's `Health`) compiled, and then the runtime's shape check refused the whole
module: the game failed to boot with "AOT module refused: built for components …". The compiler now
refuses that system with the line, and every other compiled system loads.
