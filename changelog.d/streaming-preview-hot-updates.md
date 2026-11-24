---
section: Fixed
commits:
  - fix(assets): verify and retain streamed texture previews during updates
---
**Hot updates now verify streamed texture previews before activating a build.** The download plan counts each shared file once, including a replacement preview for an otherwise identical texture. Remote meshes can load their small preview from the CDN, and the disk cache protects the previews needed by the current and rollback revisions.
