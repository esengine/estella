---
section: Fixed
commits:
  - fix(water): a river's banks roll over into the ground instead of folding, so the terrain draws them without a saw
---
**River banks no longer saw-tooth.** Where a river's bed met the ground above its banks the cut folded sharply, and a fold at any
angle to the terrain's grid was drawn by its cells as a row of teeth along the bank. The bank now rolls over into the ground across
a width tied to the river's (half of its half-width, or less on a low bank, so the roll never reaches under the water and the
waterline stays where it was). A river cut in stretches is now cut as one: a point under two stretches is shaped once, by the part
of the river nearest it, so the bank is the same whichever stretch it falls in.
