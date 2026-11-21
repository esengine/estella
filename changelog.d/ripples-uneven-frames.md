---
section: Fixed
commits:
  - fix(water): ripples step in substeps of one length, so uneven frames no longer make the water shake
---
**Water no longer starts shaking wildly after a stutter.** A water zone with ripples (the rings a boat or a dropped body leaves) could suddenly turn into a field of large jittering blotches. Each step of the ripple simulation read the previous one as a velocity under its own length, so a long frame after short ones (a hitch, a busy editor, a background tab) amplified every wave, and a few hitches grew a ripple without bound. Ripples now step in substeps of one fixed length and carry the rest of a frame to the next; they die away the same at any frame rate.
