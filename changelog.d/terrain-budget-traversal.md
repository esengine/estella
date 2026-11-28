---
section: Changed
commits:
  - perf(terrain): stop quadtree trials once they exceed the page budget
---
**High-detail terrain fits its page budget faster.** The renderer stops checking a candidate detail range as soon as it exceeds the available pages. The selected detail range and terrain patches are preserved.
