---
section: Fixed
commits:
  - fix(ui): give an auto-sized Text its text's size in flex layout
---
**A Text left auto in a flex row or column takes its text's size.** A label whose UINode had no width or height came out
with no size at all, so labels in a row or a column drew over one another and the container's gap seemed ignored. It now
measures as wide and as tall as its text, as a CSS text box does, and a wrapped label grows as tall as its lines at the
width it is given.
