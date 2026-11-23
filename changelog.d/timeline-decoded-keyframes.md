---
section: Changed
commits:
  - perf(timeline): adopt decoded keyframes when loading animation files
  - perf(editor): pass animation file text directly to the shared loader
---
**Opening or reloading animation files reuses their decoded keyframes.** Native and web players, the Sequencer and editor previews avoid a second set of curve objects when reading files. Timelines built from script objects still have independent, editable keys.
