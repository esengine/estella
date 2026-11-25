---
section: Fixed
commits:
  - fix(editor): keep generated assets current across import and export
  - fix(editor): finish source reimports before play and export
---
**Play and export now wait for source imports to finish.** Changing a model’s scale during a reimport updates its generated prefab with the latest value. Changed Aseprite sheets and animation clips are ready together. OpenEXR and six-face cube environments can be reimported from the Content Browser. Switching projects also keeps the previous project’s scans out of the new project’s asset list.
