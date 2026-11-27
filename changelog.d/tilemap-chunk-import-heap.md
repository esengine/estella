---
section: Changed
commits:
  - perf(tilemap): write saved chunk text directly into the engine heap
---
**Large tilemap saves load faster in web runtimes with native text encoding.** The SDK transfers Base64 chunk text directly into the engine heap. Existing scene files and runtimes that use the string import continue to work.
