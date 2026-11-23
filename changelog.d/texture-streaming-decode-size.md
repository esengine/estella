---
section: Fixed
commits:
  - fix(textures): honor streaming size across runtime decoders
---
**Streamed image textures now honor their requested size in exported games.** Web, single-file playables, minigames and native runtimes upload mesh textures at the configured starting resolution and can restore the original on the same handle. Minigames now apply the project's rendering options at startup, including the quality profile that controls texture streaming. The size limit also applies to procedural image recipes and custom decoders that return the whole image. Older hosts without in-place texture replacement load the full image from the start.
