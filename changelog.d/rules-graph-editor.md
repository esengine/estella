---
section: Added
commits:
  - "feat(pipeline): wire, order and preview rules graph nodes"
  - "feat(editor): edit rules graphs as nodes, with what each node makes beside them"
---
**Rules graphs open in a node editor.** Double-click a `.esproc` and its nodes are laid out on the canvas the material graph uses, each card showing how many plots and parts it makes. Wire nodes by dragging, add them from a menu grouped by what they do (make plots, cut, pick, stand on the land, build, reuse), and edit the selected node's fields beside the canvas, where a top-down preview shows what that node makes (plots outlined, parts in their colours) a moment after each change. Components are edited in the same canvas, and Apply to scene saves and puts the result in the open scene. A graph that does not run says why and marks the node.
