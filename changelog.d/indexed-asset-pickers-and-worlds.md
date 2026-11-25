---
section: Fixed
commits:
  - fix(editor): show the assigned asset in pickers across reference formats
  - fix(assets): resolve indexed references consistently in streamed world builds
---
**Asset pickers show the assigned file in scenes saved with a path or UUID.** The inspector marks it in both the list and thumbnail views, supports keyboard selection after filtering, and lets you clear an unresolved reference. A copied asset still pastes correctly after a rename. Script graph calls show the called graph’s name and pins, and skeletal previews can load files by bare UUID. Streamed world exports use the same asset identity to place prefab instances in their cells and include their meshes in distant geometry.
