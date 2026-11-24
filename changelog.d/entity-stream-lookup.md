---
section: Fixed
commits:
  - fix(core): support entity IDs in generic stream output
---
**C++ formatters and test assertions can print entity IDs regardless of header order.** Stream output keeps the same packed numeric value.
