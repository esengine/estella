---
section: Added
commits:
  - "feat(text): give Text a second shadow drawn behind the first"
---
**Text can carry two shadows.** `shadow2Color`, `shadow2Blur`, `shadow2OffsetX` and `shadow2OffsetY` add a second drop shadow
drawn behind the first, as CSS's two `text-shadow`s are: a wide soft one under a tight one keeps light words legible over a
bright sky or snow without a panel behind them. A clear colour, the default, is none, so existing text draws as it did.
