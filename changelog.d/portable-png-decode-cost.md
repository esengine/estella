---
section: Changed
commits:
  - perf(assets): speed up portable PNG decompression
---
**Large data PNGs load faster on hosts without streaming decompression.** The shared inflater uses prefix lookups for short
codes and groups checksum arithmetic while preserving the original height and weight samples.
