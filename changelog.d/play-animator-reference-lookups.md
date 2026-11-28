---
section: Changed
commits:
  - perf(editor): resolve shared controller paths once per play snapshot
---
**Animator preview replies reuse controller paths across entities.** Scenes with many animators sharing a controller spend less time resolving assets in the preview process, while each reply still reflects asset moves and individual playback state.
