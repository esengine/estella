---
section: Fixed
commits:
  - "fix(editor): let post-effect dials take any value, inside their slider or not"
  - "fix(sdk): tell a post-effect choice from a dial, and let a fog lie on a high plain"
---
**A post effect's dials take any value again, inside their slider or not.** A uniform with a whole-number step was treated as a switch, so a height fog's base height above 50 m (the floor of a plain 400 m up, or a valley in the mountains) was refused by `set_field` and clamped in the inspector. Only real choices (a whole-number step and a handful of values, such as Light the Scene) keep to their values now, and the fog's slider spans a sea to a high plain. Rules graphs (`.esproc`) written outside the editor also get their asset meta, so the editor no longer reports them missing.
