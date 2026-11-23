---
section: Fixed
commits:
  - fix(water): a web package with water installs it, so its water material loads and the water is drawn
---
**Water is drawn in a web package again.** An exported game with water showed none: its water material
failed with "The built-in shader builtin:water ships in esengine/water, which this package did not
install". The SDK's build had moved water's registration into a shared file the package's bundler was
told it could drop, and it did. The file is now declared as one that runs, and the build check that
guards these files also catches a registration reached through named imports, which is how this one
slipped past it.
