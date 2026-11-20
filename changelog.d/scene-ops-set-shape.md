---
section: Fixed
commits:
  - fix(editor): a set op in the wrong shape says the shape it takes
---
**apply_scene_ops explains a set written in the wrong shape.** A set op written like set_field ({component, field, value}) failed with an internal TypeError; it now says that set takes fields as {"Component.field": value} and shows what the op held.
