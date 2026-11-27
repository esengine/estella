---
section: Added
commits:
  - "feat(pipeline): lay out places with a rules graph"
  - "feat(editor): rules tools write, look at and apply rules graphs"
---
**An AI agent can lay out towns and cities by rules through the editor's MCP tools.** A `.esproc` is a graph of nodes, each one operation on plots of ground: cut them into grids, quarters, lots and wall runs with gates, pick some by a sum or a tag, stand them on a land, and build upward from them (terrace, body, eaves, roof), with pitched roofs, and with reusable components (a hall, a house that picks its own plan, a pagoda, a gate tower) that work as parameterised assets. Any number can be a sum over the plot (`"=4 + rand(id) * 3"`, `"=if(row > 3, 12, 6)"`, `noise(x, z, 700)` for districts that change smoothly). `rules_write` runs it and answers a plan seen from above and what each node made, `rules_edit` changes one node, `rules_views` looks closer and `rules_apply` puts the result in the scene, packed by default into one mesh per cell of ground so a city of tens of thousands of parts is a few hundred entities. Sums elsewhere (model sources) also gain comparisons, `&&`, `||`, `!`, `if()` and `noise()`.
