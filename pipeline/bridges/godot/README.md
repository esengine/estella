# Godot scene capability bridge

This bridge exports scene data for Estella's normal glTF import pipeline. It
does not embed a second runtime or translate GDScript. Generated scenes and
third-party assets belong in a separate validation project, outside this repo.

Tested with Godot 4.7.2 and the complete Godot demo Platformer 3D scene. Run a
trusted source project in headless mode, with absolute paths for output:

```powershell
$env:ESTELLA_SOURCE_SCENE = 'res://game.tscn'
$env:ESTELLA_SCENE_OUT = 'E:\validation\PlatformerNative.glb'
godot --headless --path E:\source-project --script E:\Estella\pipeline\bridges\godot\export_scene.gd
```

Import the resulting GLB through the editor's `import_assets` MCP tool or the
pipeline's standard model importer. The adjacent `.bridge.json` and the MCP
import result report unsupported features. Keep those diagnostics with the
validation result. The bridge strips scripts before adding the instantiated
scene to the tree; loading/instantiation can still execute resource or script
initializers, so this is not an untrusted-project sandbox.

## Representation

- GridMap cells retain their authored render transforms and collision shapes.
  Repeated geometry uses the standard importer geometry sharing path.
- `KHR_materials_unlit`, alpha cutoff/blending, textures,
  `KHR_node_visibility`, and visibility animation pointers use native materials,
  `NodeVisibility` and timeline property tracks.
- `OMI_physics_shape` / `OMI_physics_body` become `RigidBody3D`,
  `CompoundCollider3D`, and static `MeshCollider3D`. A compound region stays one
  primitive body plus, when needed, one detailed static triangle body. Local
  shape rotation, offsets, mass, and model placement scale are preserved.
- Billboard CPUParticles3D become native `ParticleEmitter` plus
  `ParticleModelUnits`. The latter applies model placement scale to authored
  size, speed and gravity once. It updates when scale or authored values change.
  Textures, bursts, size curves and color gradients use existing native paths.
- Coin `emitting` keys use timeline particle events, so replay resets and starts
  the native emitter. They do not run source scripts or method tracks.

## Bounded bridge metadata

The JSON under `extras.estella` is a narrow data schema, not arbitrary component
deserialization. A node may contain `billboard` (0 or 1), validated `rigidBody`
settings (`fixedRotation`, `continuousCollision`, `gravityScale`,
`linearDamping`, `angularDamping`), or `particle` with `emitter`, model `units`,
and an optional glTF texture index. Materials accept additive `blendMode: 1`.
Animations may contain `particles: [{ node, events: [{ time, action }] }]`,
where action is `play`, `stop` or `reset`. Timeline events target imported node
paths. Invalid entries are skipped with warnings; particle counts and array
sizes are bounded. Root `extras.estella.warnings` carries source conversion
diagnostics into the normal import result.

## Current boundaries

- Gameplay, source signals, scripts, method tracks, enemy AI, and Godot's
  character controller logic need an Estella implementation. The validation
  project's controls demonstrate engine capabilities, not a full game port.
- WorldEnvironment, proximity fade and source-specific shaders/postprocessing
  need native setup. Current procedural gradient baking covers the linear and
  radial modes used by this sample; source render output is not pixel-identical.
- Local particle simulation, arbitrary mesh particles, directed velocity/spread,
  and some Godot emission shapes are not faithfully mapped. Sphere particles
  currently use the engine's radial velocity. Relevant source differences are
  reported by the bridge.
- Moving/sensor concave mesh compounds are rejected with diagnostics. Partial
  angular locks need a richer rigid-body schema. Rotated primitives under a
  nonuniform placement scale must be baked; unsupported placement is rejected.
- Particle event dispatch works through both `TimelinePlayer` and the active
  animator timeline motion. Blends follow the animator's existing event selection;
  a fading predecessor cannot fire effects. Other native event-track kinds and
  nested sequence motions still need animator-specific coverage.

Regression coverage lives in pipeline `gltf-scene-semantics` and
`model-geometry-sharing`, SDK visibility/particle/timeline/physics tests, both
physics backend smoke suites, and the native transform traversal test. Keep
editor image, interaction, and performance evidence in the external validation
report; passing importer tests alone does not prove device acceptance.
