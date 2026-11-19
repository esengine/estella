---
section: Added
commits:
  - docs(skills): estella-performance teaches an agent how to find and fix what makes a game slow - measure the warmed running frame, tell CPU from GPU from waiting, find the system or the draws that cost, apply the engine's own fixes, and prove the gain with the same measurement on the device
---
**An agent working through the editor's MCP now has a performance skill.** `skill_guide { skill: "estella-performance" }` starts from one rule: no claim without a number, and no fix without a measurement. It covers measuring the running game once it is warm with `profile_frames` (and why `waitMs`, a stalled frame or a background window are not results), judging desktop numbers at a phone's speed, and measuring on the device through a development build or a recorded `.esprof`. For the CPU it shows how to find the system that costs, and the usual fixes: narrower queries, `activeWhen`, writing only on change. For the GPU it reads `get_stats` and `capture_frame`'s break reasons, then names the engine's own answers: atlases, `StaticBatch`, `LODGroup`, shadow casters, quality levels. It ends with finding leaks by `resource_census` and reporting the before and after.
