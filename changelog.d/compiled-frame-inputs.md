---
section: Fixed
commits:
  - fix(aot): resolve live frame inputs before component addresses
---
**Compiled systems in packaged WebAssembly games now send and receive project events through the same bus as scripts.** A sprite or mesh keeps moving correctly when reading a resource or event grows its component pool. Resource and event fields also retain their values if the WebAssembly heap grows during a read or write. Web and native hosts run the script for a frame when a required resource mirror is unavailable and retry compiled execution on the next frame.
