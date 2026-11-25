---
section: Fixed
commits:
  - fix(editor): keep the Content Browser's column header above the rows it scrolls over
---
**The Content Browser's Columns view keeps its header readable while scrolling.** Scrolled, the header used to sit a little below the top of the list with the rows drawn over it, so in a narrow dock it showed as a stray "Name" among the files. It now stays at the top edge, above the rows.
