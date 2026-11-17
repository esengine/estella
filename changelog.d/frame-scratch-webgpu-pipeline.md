---
section: Changed
commits:
  - perf(render): the frame's scratch lists keep their memory from one frame to the next - particles, GPU particles, trails, the render graph and the tree order each built and freed lists every frame
  - perf(render): WebGPU does not set the pipeline a pass already has - every merged draw set its pipeline again, and each set marked the bind groups for a rebuild (a lookup per uniform slot and texture unit, two cache searches and two calls into the browser) even when the pipeline had not changed
---
**Particles, trails, the render graph and the WebGPU backend spend less per frame.** Lists the frame rebuilt and freed every frame (the particle system's colliding emitters and sub-emitter bursts, the GPU particles' parameter staging, the render graph's culling, the order of a tree-sorted layer for each camera) keep their memory, an idle trail no longer makes and drops its state every frame, and WebGPU no longer sets the same pipeline again for each draw of a pass, which also rebuilt that draw's bind groups. What is drawn does not change.
