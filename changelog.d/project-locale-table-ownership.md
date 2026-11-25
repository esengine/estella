---
section: Fixed
commits:
  - fix(i18n): share ordered locale tables across scene and plugin loads
---
**Localized labels keep the same translations across scene switches and loading speeds.** Scenes and plugin startup share one project-owned copy of each table. Discovered files follow logical path order and explicitly listed tables take precedence in their declared order. Hot updates replace the affected table, including removed keys. A failed update keeps the last working translations. The asset plugin can load tables on headless apps and releases their scene assets on shutdown.
