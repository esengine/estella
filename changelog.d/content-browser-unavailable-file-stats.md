---
section: Fixed
commits:
  - fix(editor): stop retrying unavailable Content Browser file stats
---
**The Content Browser stops repeatedly requesting unavailable file sizes and modification times.** File details are requested once per filesystem revision. A refresh reads them again so they can appear when the files become available.
