---
section: Fixed
commits:
  - fix(ui): keep transient text field and dropdown visuals out of scene snapshots
---
**Input fields and open dropdowns now survive repeated scene saves and reloads without duplicating text or menu items.** Saving preserves field values, selected options, and your own labels, fills and masks. Reopening starts the dropdown closed and lets the field acquire keyboard focus again, including in older snapshots saved during typing.
