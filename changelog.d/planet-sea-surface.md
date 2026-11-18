---
section: Added
commits:
  - feat(terrain): a planet's sea has waves, shallows and a shore - trains of slope laid over the sphere so they stay where they are when the planet is moved and fade where a pixel cannot hold them, water that is clearer and paler over a shallow bottom read from the frame's depth, foam where it runs out against the ground, and a surface that mirrors the sky seen along it, where the sea was one flat colour at one opacity; `seaWaveLength`, `seaWaveSteepness` and `seaShallowDepth` say how
---
**A planet's sea has waves, shallows and a shore.** The sea of a `Planet` was a sphere in one colour at one opacity. It now carries waves (trains of slope laid over the sphere, which stay where they are when the planet is moved and fade out where a pixel cannot hold them), is clearer and paler over a shallow bottom, breaks white where it meets the ground, and mirrors the sky when seen along it. `seaWaveLength`, `seaWaveSteepness` and `seaShallowDepth` set them. It does not rise and fall: the flat water's displacement, ripples and caustics are not on the sphere.
