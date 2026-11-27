---
section: Changed
commits:
  - perf(editor): reuse parent frames during multi-object moves
---
**Dragging many objects under a nested parent does less transform work.** The viewport reads and solves each shared parent frame once per pointer update, including when the parent has non-uniform scale or zero depth.
