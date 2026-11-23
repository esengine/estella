---
section: Fixed
commits:
  - fix(scene): preserve render registrations across scene handoffs
---
**A scene can hand its HUD and camera effects to another scene during loading or unloading.** Finishing an earlier unload or rolling back a failed load preserves the replacement draw callback and camera binding, even when both scenes use the same function and effect stack. Pausing or sleeping a scene bypasses its cameras individually, so other cameras sharing the stack keep rendering and authored pass settings survive the pause.
