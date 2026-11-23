---
section: Fixed
commits:
  - fix(assets): scope texture load settings to their request and app
---
**Each App uses its own quality level when decoding mesh textures.** Starting or closing another App leaves that policy intact, including when a packaged scene replaces its asset loader. Turning quality management off restores full-size textures. A texture load that starts another load keeps its own color space and sampler settings.
