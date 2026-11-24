---
section: Fixed
commits:
  - fix(web): load compiled systems for the active engine memory
---
**Web games with compiled systems now start with threaded rendering enabled.** A threaded Web export includes compiled systems for both shared and ordinary WebAssembly memory. The runtime loads the variant matching the engine the browser started, including when the same package falls back to single-threaded rendering. Newly built modules also identify the manifest they were compiled with, so a mismatched pair is reported at startup.
