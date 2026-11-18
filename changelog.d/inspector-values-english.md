---
section: Changed
commits:
  - fix(editor): a field's value keeps the engine's words in a Chinese editor - an empty or full mask, an empty asset slot and an unset option read None, Everything, Nothing and (none) like the English option names beside them, where 全部 sat over Color | Depth; field and option names follow the code, the editor's own chrome follows the UI language
---
**In a Chinese editor, the Details panel's names and values are the engine's own, in English.** Component, field and
option names were already English, because they are the names a script uses; the words for an empty or full mask, an
empty asset slot and an unset option were translated, so a Culling Mask read 全部 beside a Clear Flags of
Color | Depth. Those are now None, Everything, Nothing and (none) as well. Panels, menus, buttons and other editor
chrome still follow the interface language.
