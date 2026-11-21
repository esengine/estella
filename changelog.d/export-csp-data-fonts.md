---
section: Fixed
commits:
  - fix(export): a web export's page lets in fonts embedded as data: URLs
---
**A web export's page lets in fonts embedded as data: URLs.** Its security policy named no font source, so a font a page's CSS
embeds as a `data:` URL (a game's own `@font-face`, or one the browser adds) was refused and logged as an error on every load.
