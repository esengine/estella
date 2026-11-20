---
section: Fixed
commits:
  - fix(editor): viewport settings survive a restart, and Settings reads as Unreal's preferences
---
**Grid size, snapping, grid and gizmo visibility are remembered after the editor is closed.** They were reset every launch, whether changed in Settings or on the viewport toolbar. Settings is also laid out as Unreal's preferences: names in one column, every control lined up at the start of the value column, and each group's Advanced fold a flat row.
