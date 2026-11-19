---
section: Added
commits:
  - feat(timeline): animation clips extrapolate past their ends and animation tracks layer with masks
---
**Animation tracks extrapolate and layer.** A clip can go on before and after itself as Unity's clip extrapolation does (hold, loop, ping-pong or continue), filling the time until the next clip at full weight, and the Sequencer draws that stretch as a band. Several animation tracks on one rig are now layers in track order: each later one overrides or adds (beyond its clips' first frame) by its weight, only on the joints its mask admits, so a wave over a walk or a breath over anything is a second track. Before, a clip stopped at its end unless the track held the last one, and a second track on the same rig replaced the first.
