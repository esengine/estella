---
section: Fixed
commits:
  - fix(pipeline): preserve Photoshop layer identities on reimport
---
**Scene edits stay on their Photoshop layers when a PSD or PSB is reimported.** Moving a layer, renaming it, or deleting its neighbor preserves its prefab identity and texture references when Photoshop supplies a layer ID. Existing prefabs keep their earlier IDs where their layers can be matched. A removed layer leaves the source's texture picker, while scenes using its PNG directly keep their image. Indistinguishable layers without IDs receive new identities and an import warning.
