---
section: Fixed
commits:
  - fix(editor): save tiled terrain images and manifests as a batch
---
**Tiled terrain saves publish their images and manifest together.** An encoding failure leaves the files untouched. If a file fails to publish, the editor rolls back the batch and keeps the terrain dirty so it can be saved again.
