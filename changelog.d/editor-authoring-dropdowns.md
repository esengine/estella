---
section: Fixed
commits:
  - fix(editor): unify authoring dropdowns and nested keyboard navigation
  - fix(project): ship consistent authoring dropdowns
---
**Terrain, script graph, sound event and world rule dropdowns follow the editor theme.** Long lists fit above or below the field in short windows. Selecting road segments with different layers, mesh axes or collision profiles shows a mixed value, and a change across the selection can be undone in one step. Escape closes the active list inside the terrain toolbar. Scrolling through script variables keeps the canvas zoom fixed, and typing the start of a name focuses the matching option.
