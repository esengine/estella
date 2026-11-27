---
section: Added
commits:
  - "feat(pipeline): wire, order and preview rules graph nodes"
  - "feat(editor): edit rules graphs as nodes, with what each node makes beside them"
  - "feat(pipeline): run rules graphs again only where they changed, and make components of their parts"
  - "feat(editor): preview rules graphs off the window, select nodes by box, copy them and make components of them"
---
**Rules graphs open in a node editor.** Double-click a `.esproc` and its nodes are laid out on the canvas the material graph uses, each card showing how many plots and parts it makes. Wire nodes by dragging, add them from a menu grouped by what they do (make plots, cut, pick, stand on the land, build, reuse), and edit the selected node's fields beside the canvas, where a top-down preview shows what that node makes (plots outlined, parts in their colours) a moment after each change. Components are edited in the same canvas, and Apply to scene saves and puts the result in the open scene. A graph that does not run says why and marks the node.

The preview runs off the window and keeps what each node made, so a change to one node runs that node and what reads it (the status line says how many ran); Chang'an's 174 nodes run whole in about 0.7 s and an edit to one ward rule in about 0.4 s. Nodes are selected by click, Shift/Ctrl-click or a box dragged on empty canvas (the material graph takes the box too), and copied, cut, pasted and duplicated with Ctrl+C/X/V/D. A selection becomes a component in one step, with one `use` node in its place, and lays out the same as before; inside a component the preview shows what its first use made, with how many plots use it. A component's `ground` now stands on the land where its plot is in the world, and sums can read the plot's world place as `wx` and `wz`.
