---
section: Changed
commits:
  - perf(material): retain draft material resources across preview draws
  - perf(editor): reuse off-scene material drafts for camera changes
---
**Rotating an off-scene material preview or changing its shape reuses the current draft.** The preview prepares a new draft when the document or its asset bindings change.
