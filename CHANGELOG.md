# Changelog

All notable changes to Estella are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [VERSIONING.md](VERSIONING.md) for what "the public API" means for an engine
like Estella (the SDK API, the editor project/asset formats, and the WASM ABI) and
what we treat as a breaking change.

Version numbers here track the **Estella release** — the engine + editor + SDK
shipped together, matching the Git tags and GitHub Releases. The SDK is not
published separately; it ships inside the editor.

## [Unreleased]

### Fixed

- **The zoom readout lied about a turned view.** It measured the scale by
  projecting the world x axis onto the screen, so an eye looking down that axis
  read as 1% — nothing about the zoom had moved. It now divides the canvas height
  by the extent the view sees, which is what zoom means in either projection.

- **The reset affordance only appeared after a drag.** Whether the eye was turned
  was a flag every path had to remember to set, and only Alt-drag did: turning the
  view from a command or from the automation door left the way back hidden. The
  viewport polls the view itself, alongside the zoom readout that already
  reconciles the same way. The automation door also grew the read half of
  `setViewOrbit` — without it a driver can turn the view but can only judge the
  result by eye.

- **A mesh could not be clicked in the viewport.** The editor's box for an entity
  came from its Sprite size, and anything else fell back to the square it draws
  for a camera or a light — 24 world units. So an imported model, however large,
  was selectable only near its own origin, and marquee-select, Frame and the
  minimap all boxed it wrong. A mesh has no size field: its extent is in its
  vertices, and for GPU-resident geometry not in the component at all. The engine
  answers with the box it culls by (`meshWorldBox`), since only it knows which of
  the two is the live geometry. With the answer withheld, the gate's hit test
  120 units out comes back with nothing — which is what it did before.

- **A mesh assigned in the editor did not appear.** The edit realm resolved a
  ref to a live handle in two places — one per scene-opening door — and they had
  drifted: the automation door resolved textures and nothing else, while the
  project door had no loader entry for `mesh` at all, so a mesh picked in the
  Inspector projected as handle 0 and drew nothing (the scene-open preload was
  the only way one ever reached the screen). Resolution is the realm's now, in
  one binding both doors install, and `mesh` is an entry in the loader table like
  every other loadable type — which also means a re-imported `.esmesh` refreshes
  in place instead of staying the geometry it was at load. A test now asserts
  that every asset field a component declares has a slot to load it from, so the
  next such field cannot ship half-connected.

- **A prefab named by path was missing from the editor and present in the
  package.** The editor's prefab cache took `@uuid:` refs and nothing else, so a
  scene whose instance names its prefab the other legal way — a project path,
  which the runtime loader accepts — opened with that instance simply absent. The
  same scene shipped with it. Refs resolve by one rule now, the registry's.

  Found by carrying a project through the whole chain rather than by a unit: the
  new `model-import` example (a glTF imported to mesh + image + prefab, placed by
  a prefab instance) came back with an empty editor frame and a correct packaged
  one. It certifies `model-import` in the golden corpus, so the import chain is
  now part of what a release argues from.

- **A rigged model imported as a still one, without saying so.** Skins, morph
  targets and animations are what separate a model that moves from one that does
  not, and the import carried none of them and mentioned none of them — the
  result looked like a working import of a broken file. Each is reported now,
  per primitive and per file. So is a `KHR_texture_transform` on a texture
  reference, whose uv rewrite the import does not apply.

- **An imported texture ignored the sampler the model asked for.** A glTF names
  its filter and wrap per texture; the products were minted with the engine's
  defaults, so pixel art came in smoothed and a clamped atlas came in repeating.
  Those settings now seed the product's `.meta` — on the FIRST mint only, since
  after that they are the file's own. A source that addresses u and v
  differently says which one it kept.

- **A compressed model imported as a heap of vertices on the origin.** Draco and
  meshopt hold a primitive's geometry inside an extension, so its accessors point
  at nothing — and an accessor with no view reads as zeroes, which the spec allows
  and which for POSITION means every vertex at (0,0,0). Nothing said so. Such a
  primitive is now skipped with the reason and what to do about it (re-export
  without compression), as is one whose POSITION carries no data at all.

- **A sparse accessor was read in its unmodified state.** The spec's sparse
  storage replaces some of an accessor's values — or supplies all of them, since
  its base view is optional. Ignoring it produced geometry that loads without
  complaint and is simply wrong. It is applied now, base view or not.

- **A model copied into the project lost its own files.** A `.gltf` names its
  buffers and images by relative uri, and only the source itself was copied — so
  a `.bin` beside it (what "glTF Separate" exports) stayed outside, and importing
  the copy again read nothing. Every uri the source points out to now travels
  with it, at the same relative path, so the copy is a model in its own right.
  One that reaches outside the model's folder lands beside it and says so, rather
  than being written wherever the path leads.

- **A model dropped into the editor produced nothing.** Importing a `.gltf`/`.glb`
  copied the file in and stopped there — the engine loads no model format, so the
  user was left with a file nothing could draw and no way to reach the importer
  except a terminal. The import now runs at the moment the file arrives, writing
  the meshes, images and prefab beside the source (beside it, not in the folder
  the browser happens to show, so re-importing lands on the same files and keeps
  their identity). An image the model points at is copied in with it when it came
  from outside the project, since a copied model no longer sits beside its
  textures. What the source says and this engine cannot draw is reported where
  the import happened, not swallowed.

- **A model source could be picked where a mesh was asked for.** `.gltf` and
  `.glb` were typed as `mesh`, so the Inspector offered them for `Mesh2D.mesh` —
  a reference that can never resolve, failing at load with nothing on screen to
  say why. They are their own type now: the source a mesh was imported FROM,
  never one of the products.

- **`.esmesh` was missing from the asset registry the runtime ships by.** The
  format had a loader, a `.meta` type and an editor slot, but no entry in the
  SDK's own table — which is what a WeChat build reads to know a file must be
  packed. A mesh reached that platform as a missing asset.

- **A device that came back drew the placeholder, and said it was fine.** Losing
  the GPU parks every texture on the white placeholder and lists it as awaiting
  re-upload. The re-upload asked the asset layer to load the texture again — and
  the load answered out of the residency cache, whose entry for that path was the
  placeholder it was about to replace. The handle was retargeted onto it, the
  list emptied, and the device reported itself Live with the screen white. Every
  count agreed; only the pixels disagreed.

  A texture awaiting re-upload is no longer a residency hit, since it does not
  hold its path's content until something puts it back. And ending recovery is no
  longer the caller's to assert: the criterion is the engine's list, so
  `markDeviceRestored` answers how many textures are still missing instead of
  declaring the device whole on request.

- **The second loss never recovered.** Measured over four rounds, only the first
  worked; from the second the device stayed Recovering forever, with one more
  texture stranded each round — all of them the same atlas, at different handles.
  Getting bytes onto the GPU creates a second pool record, and that record stayed
  findable under the path it had claimed, so the next loss swept it up as a
  texture nobody could re-upload.

  A re-upload no longer claims the path (the identity belongs to the handle being
  recovered) and the GPU object now MOVES onto that handle rather than being
  borrowed from a record left behind. The sweep is driven by the engine's list
  instead of this layer's cache, which is the subset that hid the difference.

- **A lost context stopped leaving its objects behind.** Across five losses the
  host's object tables only grew — buffers by 18 a round, textures by 4, programs
  by 7 then 9 then 11. Those tables are global to the page, so nothing about a
  dead context frees what it minted. The releases now happen at the LOSS, the one
  moment they are both safe and free: on a lost context each is a silent no-op
  that still frees the host's wrapper, while after the rebuild the same call
  hands a new context an old one's object. Per round it is now +2 programs and +1
  buffer, with textures, VAOs and framebuffers flat.

### Added

- **A Draco model is still a model.** The other compression a glTF can arrive in,
  and the only one Blender's exporter offers — so it is what an independent artist
  ships when they turn compression on. Unlike meshopt, Draco holds a whole
  primitive's geometry in one blob and leaves the accessors saying only what the
  data means, so the importer now takes an attribute from either storage and draws
  every conclusion above it — vertex count, colour components, the `normalized`
  scale — from the accessor exactly as before. The ~800KB decoder loads only for a
  file that carries Draco.

- **A compressed model is still a model.** Geometry arriving meshopt-compressed
  was reported as unimportable and skipped — an honest answer, but it left the
  common case of a model off the internet as a file nothing could open, since
  gltfpack and glTF-Transform write it by default. `EXT_meshopt_compression`
  compresses bufferVIEWS, and a decoded view is exactly the bytes the view already
  declares, so accessors, strides, sparse overrides and images are untouched by
  the decode. Import is async now: that await is also what lets a Draco decoder be
  loaded only when a Draco file turns up. A meshopt fallback buffer — a length and
  no uri, by design — is no longer reported as a file that could not be read.

- **The viewport says which way it faces.** Alt-drag turns the editor's eye, and
  nothing said where it had ended up — a reset button was the whole vocabulary,
  so "which way am I looking" and "put me square-on to that side" had no answer.
  The indicator is the navigation gizmo a DCC puts in a viewport corner: the world
  axes as they point on screen, each end a click that stands the eye on that axis
  and looks back down it. An axis leaning toward the eye draws short, which is the
  cue that says how far the view has turned.

  Where they point is read off the very basis the camera is built from, not from a
  second copy of the rotation, and the gate holds that against where the camera
  actually projects those axes — one scale factor for all three, so direction and
  foreshortening are both asserted. The eye is allowed onto the poles here, unlike
  a drag: looking straight down IS a standard view, and the view basis has its own
  pole branch for it. The indicator appears only once the eye can see depth, since
  a square-on orthographic view is the 2D editor.

- **A mesh can hide another one.** Nothing an imported model carried said it was
  solid, so two of them resolved by paint order — which cannot draw two surfaces
  that pass through each other, however their z is sorted. `Mesh2D.opaque` says
  it: no blending, depth written and tested, and the draw sorts into the opaque
  stage (ahead of blended ones in its layer, so 2D content still lands on top).
  `Mesh2D.cullBackfaces` skips the inside of a closed model.

  A glTF states both — `alphaMode` and `doubleSided` — and both were being
  reported as unimportable. They are the two the import now carries, on their own
  defaults (OPAQUE, single-sided), so a model arrives occluding itself the way it
  was authored. The layer-wide depth setting is unchanged and still does what it
  did; this is the same decision made by one draw about itself.

- **The editor's eye can turn.** A model imported from a glTF could only be
  looked at head-on: the editor view stood on the -Z axis with no way off it,
  which is fine for 2D and useless for anything with a back. Alt-drag now orbits
  it (the DCC gesture), in both projections — an orthographic view turned
  off-axis is the isometric one. Pitch stops short of the poles, where the up
  vector is parallel to the view and the frame would roll.

  The orbit is the general case and the 2D view its yaw = pitch = 0 special case:
  the matrix built there is asserted to be, cell for cell, the one that path
  always built, so turning the feature on cannot move a 2D scene. Screen→world
  was already a ray against the z-plane rather than an axis-aligned inverse, so
  picking, dragging and framing follow the turn — the gate hit-tests through the
  orbited view to hold that. A turned view offers the way back in the viewport's
  own toolbar.

- **A material can draw geometry that carries normals.** Since materials learned
  the mesh vertex source, one could only be used on geometry WITHOUT normals: a
  vertex layout may not declare an attribute its shader ignores, and the engine's
  canonical vertex stage read none. It reads them under `MESH_NORMALS` now and
  hands the fragment `v_worldNormal` and `v_worldXYZ`, so a material can light
  itself on a mesh exactly as it does on a sprite — the same `applyLighting2D`,
  the same `perturbNormal`. A material that does not ask for normals is
  unchanged; the store keys its compiled variants by shader AND vertex shape.

- **A normal map, with no tangent channel to import.** A mesh can now carry one
  (`Mesh2D.normalMap`), and its tangent frame is derived per pixel from the
  screen-space derivatives of position and uv — the surface the shader is already
  shading. The alternative was a TANGENT vertex channel, which most exported
  models do not have (Blender writes one only when asked), so the geometry would
  have decided whether the feature worked at all.

  The frame math lives in the lighting the `Lit2D` domain injects, beside the
  `sampleNormal` that unpacks the texel — one `perturbNormal` for every lit
  surface rather than a copy per shader, so a sprite material can light itself
  the same way a mesh does. The map rides the `LIT` variant (it needs normals to
  perturb) and binds to sampler slot 1, which a draw owns for itself; the batch
  stream's other slots are a merge product, chosen per vertex.

  Caught by the second backend only: WGSL's `dpdy` has the opposite sign to
  GLSL's `dFdy`, which flips the tangent and bitangent and lights the wrong half
  of the surface. The importer carries `normalTexture` across now, and leaves it
  out for geometry with no normals — there it would be a reference nothing reads.

- **An imported model stands where it was built.** The import read the mesh list
  and nothing else, so every primitive of a model landed on the origin, stacked.
  It now walks the source's node tree: each node becomes an entity carrying its
  own translation, rotation and scale (a node given as a matrix is decomposed,
  since a Transform holds TRS), children hang off parents, and one mesh drawn by
  several nodes is one product referenced from each. A node's further primitives
  become its children, because a `Mesh2D` draws one mesh.

  `--scale` sizes the model on its root. A glTF is authored in metres and a world
  unit is a design pixel, so a real-world model arrives a few pixels across; the
  import says so when it produces one rather than guessing a factor, since
  nothing in the file says which it is.

- **A glTF arrives with its images and its colours.** The import now reads the
  materials too, and what it produces for each is not an `.esmaterial`: the
  engine's mesh path is `texture(uv) * vertexColor * tint`, which is what glTF
  calls baseColor, so the image and the factor land on the `Mesh2D` that draws
  the geometry. A material would have been the weaker product — a material's
  shader writes only a fragment, so it cannot read normals, and a layout may not
  declare an attribute its shader ignores. Nearly every real model has normals,
  so that route produces something most of them cannot be drawn with.

  Images the file carries inline (a GLB chunk or a data URI) are written beside
  the meshes; an image already on disk is referenced where it lies, because a
  copy is a second thing to keep in sync with what the artist edits. The import
  also writes one `.esprefab` naming which geometry is drawn with which image and
  tint — the products are separate files, and nothing else records how they go
  together. Asset refs are project-relative, so the project is found above the
  source unless `--project` says otherwise.

  V is flipped at that boundary: glTF puts uv (0,0) at the image's top-left and
  the engine uploads textures bottom-up. Each convention is right on its own,
  which is why the pixel gate — four probes at the texel centres of a 2×2 image —
  found it as an exact vertical swap. Everything a PBR material says beyond
  baseColor (metal, roughness, emission, a normal map, an alpha cutoff, a
  single-sided flag, its extensions) has no consumer here yet and is reported
  rather than quietly lost.

- **One material, two vertex sources.** A material could not draw GPU-resident
  geometry: its program is built for the batch stream, whose vertices are already
  world-space, so it would place the mesh at its local origin and leave the
  per-object attributes unconsumed. For any material that writes only a fragment
  the engine already owns the vertex stage, so the answer is a second vertex
  SOURCE rather than a second shader — `MESH` selects the branch that reads a
  model matrix, and everything the author wrote is untouched. The variant
  compiles on first use and is cached from the material's own source, which the
  store now keeps beside its handle.

  A shader that writes its own vertex stage is refused rather than retargeted:
  adding the feature to one compiles a program that still ignores the per-object
  transform, which is exactly the failure this prevents.

- **One attribute vocabulary for both vertex sources.** The 2D batch reads
  `0=position, 1=color, 2=texCoord`; the mesh channels were written
  `0=Position, 1=TexCoord0, 2=Color`. Neither was wrong alone, which is the
  problem — a shader written against one samples the other's colour as a UV, and
  only the frame says so. `MeshChannel` now matches the batch for its first
  three, and the engine's own uploads name their channels by semantic rather
  than repeating literal locations.

  This also closes something the resident path opened: a material's shader is
  built for the batch vertex source, so drawing GPU-resident geometry with one
  would place it at its local origin and leave the instance attributes
  unconsumed. Until a material can be compiled FOR this vertex source, the mesh
  program wins and the material is reported once rather than silently obeyed.

- **A mesh's normals light it.** `applyLighting2D` has always taken a normal —
  the 2D path passes it the constant (0,0,1), because a sprite has no other — and
  Light2D already carried Point, Directional, Ambient and Spot with a position
  that comes from a vec3 Transform. The lighting was 3D-ready; what was missing
  was geometry with normals to hand it. The mesh shader declares `domain Lit2D`
  for the light math it injects rather than for the canonical vertex stage that
  domain also supplies, so one set of light math serves every lit surface.

  Normals ride a shader variant: a vertex layout may only declare attributes its
  shader consumes, so the channel, the normal matrix and the lighting are inside
  one switch, and geometry without normals is still drawn by the program that
  does not read them. The normal matrix is per object, because under a
  non-uniform scale the model matrix is the wrong transform for a normal. The
  importer carries NORMAL where the source has it.

- **glTF geometry becomes meshes a project owns.** `estella import-gltf <file>`
  writes one `.esmesh` per triangle primitive beside its source. An import, not a
  cook: a glTF holds many primitives, so it is a source that produces several
  engine assets rather than one file becoming another — which is all a cook step
  can model. The products land on disk, where a project can see them, reference
  them and diff them, and the cook then ships them as the engine format they
  already are. Byte stride is honoured (an interleaved export read as tightly
  packed gives wrong vertices rather than an error), normalized integer
  accessors are scaled per spec, and `.glb` containers are read alongside
  `.gltf` with external or data-URI buffers.

- **A mesh is a reference a scene can hold.** The format alone was not enough —
  nothing could name one, so a scene could not point at geometry the way it
  points at a texture. `Mesh2D` declares the field with `asset = mesh`, the scene
  loader resolves the ref and binds the handle beside the texture and material it
  already binds, and the content browser shows `.esmesh` with a type of its own.

  `AssetFieldType` gained `'mesh'`. The api-surface baseline reports that as a
  note: widening a released `@public` union keeps every value that was already
  legal, but an exhaustive `switch` over the old set stops compiling, so it is
  called out rather than passing silently. A union that LOSES a member is still
  a broken promise, and a test pins that direction.

- **A mesh is a file.** Mesh was the one asset that was not one: textures,
  shaders, materials, fonts, clips and prefabs each have a format on disk and a
  loader, while geometry could only be built at runtime, so a project could not
  store a mesh or ship one. `.esmesh` is self-describing — the channel table is
  written out rather than implied by a mask, so adding a channel (normals,
  tangents, skin weights) is an append to the vocabulary rather than a format
  version, and a mesh without normals stays a file without normals instead of
  one carrying zeroes. A channel's semantic is its shader attribute location, so
  a shader reading normals at 3 reads them from any mesh that has them.

- **Geometry can stay on the GPU.** Every triangle the engine drew had its
  vertices written into the frame's transient pool by the CPU first — the draw
  list resolved both the layout and the buffers from that pool, so there was no
  way to draw geometry that simply lives on the device. That is right for a
  sprite stream that changes every frame, and a per-frame re-upload of anything
  that does not.

  A draw can now name its own vertex buffer, index buffer and layout, with the
  frame streaming only the per-object transforms. The arrangement is not new —
  the particle path has always been a static quad in slot 0 with a per-instance
  stream in slot 1 — so the same mesh drawn twice costs one more transform
  rather than a second copy of its vertices. A mesh is buffers, layout and
  bounds as one record, and it declares only its own channels: the transform is
  appended by the engine, so nothing above has to know how one reaches a shader.

  `mesh2d_makeResident` freezes a component's inline geometry onto the GPU —
  the same vertices, uploaded once. Its gate is the mesh2d scene and the mesh2d
  assertions, run again with the geometry frozen mid-run: equal pixels is the
  whole claim, on both backends.

- **A game that loses its GPU comes back on its own.** Every piece of a recovery
  was in place and nothing called it: the only caller outside the engine was a
  test probe, so a shipped game that lost its device stayed on the placeholder
  until someone closed the tab — and the path could pass a gate, driven by hand,
  while never running for a player. The driver lives with the asset layer, retries
  with a backoff because a browser returns a context when it is ready, and is
  timed off unscaled delta so a paused game still recovers.

- **A lost WebGPU device is replaced.** The second backend had no recovery at
  all: a WebGPU device belongs to whoever created it, so the backend declined to
  rebuild one — correctly — and nothing ever handed a replacement over. Since
  0.53 lets a shipped build ask for WebGPU, that was a path a player could reach
  and never come back from. The replacement is acquired through the same boot
  helper as the first, so it negotiates the same features, and is taken up by the
  next recovery attempt — one order of operations for both backends.

- **Losing the GPU is a pixel gate, on both backends.** The whole harness for
  this existed — a probe that takes the context away for real, a driver for the
  full cycle, assertions on each step — and nothing declared it, so of 52 pixel
  gates none was a device loss. It now runs on every PR: once driven by hand, and
  once as the player's case, where nothing asks for a recovery and only frames
  pass. The scene samples an atlas, so the probes fail unless the content
  actually came back; the first attempt reused a vertex-coloured scene and passed
  with the re-upload deleted. Four rounds on WebGL2 (three on WebGPU) hold that a
  recovery works more than once, and the object tables are checked for slope
  rather than for a number nobody has a baseline for.

- **The C++ harness list is checked from the side that let two through.**
  `CPP_TESTS` calls itself the single source of truth so a harness cannot be
  compiled-but-never-run, and the gate over it read that list to decide what to
  build — so it could only confirm the list's own contents. `test_device_loss`
  and `test_physics_interpolation` were declared with `add_test`, built by nobody
  and run by nobody. The gate now reads the other direction too, and that half
  needs no compiler.

## [0.53.0] - 2026-08-14

### Fixed

- **The WebGPU backend was fine; the way it was measured was not.** Its ten pixel
  gates had one passing, which read as a backend that could not be shipped on.
  They were read with a different instrument: GL asserts against the engine's
  buffer, while WebGPU had no readback on the web, so the runner captured the
  composited page — a colour-managed path that turns a painted `rgb(0,255,0)`
  into `rgb(58,254,32)` with no engine involved.

  The engine now returns its own pixels on both backends (`captureFramePixels`),
  and on the web that copy rides the surface pass's own encoder, because the
  browser presents the swapchain image with that submit. Measured that way,
  **both backends pass all 52 pixel gates**, and the registry declares every one
  of them instead of ten.

- **A compressed texture reaches the WebGPU backend.** KTX2 was WebGL2-only: the
  loader probed WebGL extensions, which answer for one backend and answer "none"
  for the other, so a KTX2 asset arrived as the white placeholder. The device
  answers what it samples (not the adapter, whose offer is void until the device
  asked for the feature), the engine publishes the features a host must request,
  and the upload goes through the ResourceManager both backends implement.

- **A shader with switches runs on WebGPU.** Twin generation skipped any shader
  carrying a `#pragma switch`, so a material with a static switch compiled on one
  backend and not the other. WGSL has no preprocessor, but the engine already
  resolves `#ifdef` over a twin body at assembly time — the generator emits every
  combination and nests them behind it, which is the GLSL side's own variant
  logic in the shape the other target reads. Three toggles is the ceiling: each
  one doubles the emitted programs.

- **A web boot no longer logs a Dawn error, and no longer copies every frame.**
  The initialisation clear ended its render pass but not its frame, so the first
  real frame reused a swapchain image the browser had already expired — one
  "Destroyed texture used in a submit" per boot. And the web surface was
  configured RGBA8 while the canvas preferred `bgra8unorm`, which costs a
  full-frame copy on every present; the host now passes the canvas' preference
  in, and the capture path normalises byte order so consumers are unaffected.

### Added

- **Post-processing is a declared graph, not two framebuffers.** The chain was a
  fixed ping-pong — every pass at full resolution, each reading the one before it
  plus the scene wired to a hard-coded unit — and the per-camera and screen-level
  chains were two copies of that loop. A pass now declares what it reads, what it
  writes and at what fraction of the frame; the graph culls what the image does
  not depend on, hands out targets from a pool keyed by shape, and takes one back
  the moment its last reader has run. A bloom chain of seven links still costs
  two targets, because that is what the allocator does on its own for a linear
  chain. What it unlocks is what could not be expressed before: a link at half
  size, and a pass reading something other than its predecessor.

- **A shipped web build can ask for WebGPU.** Project Settings → Rendering
  carries the request into `game.config.json`, and the exported host falls back
  to WebGL2 wherever the browser has none — which is what makes opting in free.
  Mini-games and playables always run WebGL2; their hosts offer nothing else.

- **The schedule can say which systems' order nobody decided.** A system's
  parameters already declare what it touches, and the schedule only ever used
  them to look up values. Read as sets they answer whether two systems conflict
  and whether anything decided which runs first — where nothing did, the order
  falls out of registration, so moving a plugin in the build list can change what
  a game does with nothing to point at.

  `app.scheduleAmbiguities(schedule)` names those pairs and what they disagree
  over; `app.scheduleBatches(schedule)` shows how much of a schedule is
  inherently sequential.

  A system that reaches through `GetWorld()` can now say what for
  (`touches: { reads, writes }`) instead of being assumed to touch everything.

- **Every gameplay system says what it touches, and the answer is used.** All of
  them took the World and declared nothing, so the analysis above reported nine
  ambiguous pairs in the engine's own schedules — every one of them "the World
  itself", a finding with no action attached that hid the one real collision.
  Four of those systems could always have said (perception, nav follow, the
  character controller, the stats overlay, which touches no component at all).

  The three that genuinely run authored data — the state machine, the behaviour
  tree, `defineBehavior` — got a way to answer rather than an excuse. A
  registered action or condition declares its reach; `property.set` derives it
  from the path the graph carries, since the component it writes is unknowable at
  registration and plain in the data. A system's own `touches` may therefore be a
  **function**, answering from the graphs actually loaded. One leaf that never
  declared makes the whole claim `opaque` — a union that silently dropped it
  would be a claim the scheduler trusts and the frame disproves.

  Nine ambiguous pairs became one: `VelocitySystem` and `NavAgentSystem` both
  writing Transform with nothing deciding the order. That one is now declared
  (the order registration already produced, so nothing moves), and a test holds
  the engine's schedules to zero.

- **A system that waits no longer holds the ones it has nothing to do with.**
  The schedule awaited each system before starting the next, so one parked on an
  `await` stopped everything behind it. A system now starts beside an unfinished
  one when it neither depends on it nor touches what it touches — which is the
  declarations above being spent rather than reported.

  This is concurrency, not threads: a synchronous system runs to completion the
  moment it starts, so what overlaps is the *waiting*. Nothing in the engine is
  async, so its own frame is unchanged; two of your async systems loading
  different things now wait at the same time. Ordering edges still hold — a
  `runAfter` is a stronger statement than access, and overlap requires
  independence in the dependency graph as well.

### Fixed

- **A scene is checked the way a prefab has always been.** A prefab has been
  validated at every gate it passes since it got a format — editor open, runtime
  load, cook, CI — while a scene, the document a game ships, was checked nowhere.
  A repeated entity id made the loader keep whichever entity came last, and every
  reference to that id landed on the wrong entity with nothing to say so.

  Ids, topology, parent cycles and entity references are now one set of checks
  both documents are read by; each format adds only what is its own. The loader
  refuses the two findings it cannot honour and reports the rest, and the CI gate
  reads every scene in the repo as well as every prefab.

- **Two people editing one scene stop naming the same entity.** A session
  numbered new entities from the highest id in the file, so two people who opened
  the same scene both used that number and the merged file had two entities
  answering to one id. Sessions now start a random distance past it, the way
  prefabs already mint theirs.

### Changed

- **A plugin's agent tool is named the way the wire can address it.** Enabling
  the LDtk plugin made every message to the built-in agent fail with
  `400 tools[101].name: string does not match pattern '^[a-zA-Z0-9_-]+$'`, and
  nothing in that pointed at plugins: the built-in catalog is exactly 101 tools,
  so index 101 is whatever a plugin contributed first. Two rules, each right on
  its own — registration REQUIRED the name to start with `${pluginId}.`, plugin
  ids are dotted, and no model endpoint accepts a dot in a tool name. They refuse
  the whole request rather than the tool, so one plugin took the agent down with
  it.

  **Plugin authors:** a tool's name is now your plugin id with its dots folded to
  `_`, followed by your own — plugin `acme.level-tools` registers
  `acme_level_tools_bake-occlusion`. Letters, digits, `_` and `-` only, up to 64.
  A tool named the old way is refused with the reason in the Output Log, and the
  agent drops any that reach it regardless, so an old plugin can no longer take a
  conversation with it.

- **A project packages without the editor.** Cooking a project and packaging it —
  the asset database, the textures, atlases, audio and video, the addressable
  manifest, every export target from web to Steam, and the game host a shipped
  build boots into — lived inside the Electron main process. Anything that wanted
  a build needed the process that edits one: CI, a build server, a machine that
  never opened the editor.

  All of it is a package of its own now, and `pipeline/bin/estella.mjs export`
  (or `cli.js export`) ships a project from the command line, taking the engine
  runtime from the build tree so a machine that built the engine and never built
  the editor can still produce a game. The editor calls the same code; there is
  no second packaging path to drift.

  Two gates hold the line: one refuses an import from the pipeline into anything
  above it, and one packages a real example from the command line on every run.

## [0.52.0] - 2026-08-14

### Added

- **One hierarchy, and gizmos on the running game.** The Outliner had two trees
  with a picker between them, and the reason was never a UI decision: a document
  id and a realm handle are different numbers for the same entity, so the two
  could only be switched between. They are one tree now — an authored row keeps
  its key, so expansion, scroll and selection survive Play and Stop, and what the
  game spawned collects under Runtime.

  The running frame gets gizmos with it. The editor cannot read the realm's
  canvas and does not try: the realm answers where the selection is drawn, what
  is under a point, and where a drag lands, because it holds the camera that
  composed the frame. Points cross normalized to that canvas, so a device ratio,
  a letterboxed viewport or a device preset cannot put the gizmo beside the thing
  it points at. The pointer stays the game's until the Inspect toggle takes it.

- **The transform tools work on the running game too.** Play had one gizmo and
  edit had three, which made the tool you had picked mean nothing the moment you
  pressed Play. W/E/R choose which gizmo is drawn over the running frame, and
  they obey the snap setting in both realms — the same drag used to land on 32 in
  the editor and on -33.603 in play. What snaps is the result, not the gesture: a
  sprite already at 7° lands on 15/30/45, the rule the editor's own gizmo has
  always used. The grid toggle comes along to the tool palette, since the docked
  toolbar that holds the snap menu is hidden while the game runs.

- **The HUD is clickable in the running game.** Clicking hit-tested only world
  entities, so UI laid out in the screen space of its own camera was unreachable.
  The realm picks UI first and then the world, which is the order the editor's
  own viewport has always used, and the outline follows: a UI node's box is its
  resolved layout, projected through the camera that composed it. That box
  carries no origin and the overlay draws no handles without one — a UI node is
  placed by layout, so dragging its transform would be accepted, overwritten on
  the next relayout, and look like nothing happened.

- **Stop can hand back what you changed while playing.** A play session's edits
  ending at Stop is what makes them safe to make, and also a famous way to lose
  an afternoon of tuning. What is offered back is what a PERSON changed: a diff
  of the world cannot tell that from what the game did, so the journal records
  the addresses the op layer was asked to write, which is where every deliberate
  edit already passes. The offer is a sticky toast rather than a dialog — Stop
  must not wait on an answer — keeping is one undo step, and entities the game
  spawned are counted rather than dropped quietly.

- **A row the game destroys stays in the tree.** The Outliner showed the realm's
  tree projected through the document's identity, so an entity the game destroyed
  simply stopped being reported and its row vanished from the scene you were
  editing. The two trees are merged now: live rows as the realm reports them,
  plus a tombstone for every authored row it no longer has, struck through and
  carrying no eye. With nothing of the document running there are no tombstones —
  a realm that is booting, or that has moved on to another scene, is not this
  scene with holes in it.

- **A live entity can say which document row it came from.** `SceneOrigins` and
  `enableSceneOrigins` keep the map every scene load already builds on its way to
  spawning, recorded on both spawn paths and off unless an App opts in: a running
  game never asks, and the table would be the editor's cost charged to every
  player. `entityWorldBox` and `uiNodeWorldBox` move to the SDK beside it — the
  editor outlines and hit-tests the box the renderer draws, and two derivations
  of it agree until a pivot or a parent scale is involved.

- **A plugin can be a package the project depends on.** Plugins were a folder, so
  sharing one meant exporting a `.esplugin` and importing it, with no version, no
  update, and no way for the two halves of one plugin to arrive together. A
  direct dependency shipping a `plugin.json` is now a plugin: it lists in the
  Plugins panel like any other and needs trust the same way, and since approval
  covers a version, an npm update asks again by construction. Only direct
  dependencies are read — a package that arrives because something else depends
  on it is not something the project asked to run in its editor.

- **A project can install a plugin from its own bundle** — `addPlugin`, the
  module-level twin of `App.addPlugin`, because a bundle is imported before an
  App exists. Draining what a bundle registered is one call,
  `flushPendingRegistrations`, since a host that can drain half of it eventually
  will.

- **A plugin can teach the editor to read a new file format.** The editor could
  be told a file type exists — its badge, its icon, what double-clicking it does
  — but not how to turn one into something the engine reads.
  `ctx.assets.registerImporter` claims extensions and is called when a claimed
  file appears or changes, and on Reimport in the Content Browser. What it writes
  is an ordinary project asset, which is the whole design: the registry, the
  inspector, cooking and the shipped build learn nothing about the foreign
  format. The call is the editor's, not a click's, so the failure modes are the
  contract — a throw and a rejection both report against the plugin and leave the
  other importers running, and a file is never imported twice at once.

- **An LDtk importer**, `estella-plugin-ldtk`: an npm package, written against
  the public editor API alone, doing something the engine genuinely cannot do.
  Drop a `.ldtk` into the project and its map appears, image paths re-based and
  flip bits intact.

- **The editor ships its own plugins.** A fourth discovery scope for the ones
  that arrive with the app — trusted, because installing the app was the
  decision, and listed in the panel like any other. A project that depends on the
  package, or drops a copy in `.esengine/plugins/`, shadows the shipped one,
  which is how you run a fork of a feature we ship. The audio mixer is the first,
  rewritten against the public API alone, and three gaps it could not have worked
  around are filled generally rather than for audio: `ctx.project.feature` /
  `setFeature` (a settings block, persisted and live-applied through the one door
  every project setting now goes through), the `projectChanged` event, and
  `ctx.locale` for a plugin that renders its own UI.

- **Host capabilities a package can reach**: `platformCanOpenData`,
  `platformOpenDataPostMessage`, `platformOpenDataCanvas`,
  `platformSetCloudKeyValues`, `platformCreateCanvas`, `platformDevicePixelRatio`,
  and `createCanvasTexture` — a texture whose content is a canvas something else
  draws on. For share and payment: `platformShare`, `platformCanShare`,
  `platformOnShareRequest`, `platformCanPay` and `platformRequestPayment`, with
  `PlatformShareOptions` and `PlatformPaymentRequest`. Each is exported because a
  shipped plugin holds it up, and no capability is public ahead of one. With them
  goes `extendPlatform`, for a host that can answer what its adapter cannot.

- **Five more starters, so New Project is a choice.** There was one starter —
  Blank — and forty-four examples beside it, which made "start a project" mean
  "pick a demo and delete the demo out of it". Each of the new ones is a skeleton
  rather than a showcase: 2D Platformer, Top-down, Playable Ad, WeChat Mini Game,
  and a UI Game whose three screens and every button are scene data — controllers,
  gears and `EventBinding` rows, with only the rules left in code. They are
  type-checked by the same gate the examples are, so a starter that stops
  compiling fails the push.

- **A Pixel RPG starter**, the seventh: a 16-pixel overworld with collision in
  the tileset, a four-way animated hero, a camera clamped to the map and snapped
  to whole pixels, and a sign that answers. Its art is drawn for it — nothing to
  license, and every texture imported `nearest`.

- **A plugin can put a button on the editor's activity bar** —
  `ctx.activityBar.register({ id, title, icon, run })`, with the glyph as the
  plugin's own inline SVG. The audio mixer uses it, which is how it got back the
  rail entry it had before it became a plugin.

- **`registerAction` takes a declaration**, not only a bare function — the form
  the docs already taught, and what turns an editor text box into typed controls
  for a game's own action.

### Changed

- **The share sheet and in-game purchase are a package, not engine services.**
  They moved to `estella-plugin-minigame-services`, which is what proved the
  runtime half of the plugin API was not actually reachable: every façade imports
  the platform, and none of those seams were public, so no service could be
  written outside the engine no matter how loosely it was coupled.

  Removed from `esengine` (all `@experimental`): `Share`, `ShareAPI`, `Payment`,
  `PaymentAPI`, `ShareCard`, `PaymentRequest`, `PaymentFailure`. Import them from
  the package and install it with `addPlugin` in the project's own entry. What
  stayed is as deliberate as what left: the takeover ceremony is not a mini-game
  service — it is what pauses a game under anything fullscreen, and ads use it.

- **The friends leaderboard is a package, not an engine service.** It moved to
  `estella-plugin-minigame-services` alongside share and payment, and with it the
  open data context it draws in. The engine keeps what only it can offer — the
  capabilities the board is built from — so a third-party board is built the same
  way ours is.

  Removed from `esengine` (all `@experimental`): `Leaderboard`, `LeaderboardAPI`,
  `createLocalLeaderboard`, `LeaderboardOptions`, `LeaderboardProvider`,
  `LeaderboardScope`, `LeaderboardStyle`, `LocalLeaderboardOptions`. Import them
  from the package instead, and add `open-data/index.ts` to the project with one
  line — `import 'estella-plugin-minigame-services/open-data';` — which is what a
  mini-game export now bundles as the context. A project that had no
  `open-data/` directory was getting the engine's board by default; it needs that
  file to keep one.

- **Play mode rehearses the open data CONTEXT, not a leaderboard.** It runs the
  project's own `open-data/index.ts` against an offscreen canvas and invented
  friends, and answers through the platform capabilities a device would — so any
  board is rehearsed, `submit()` reaches it, and a context that does not compile
  refuses Play the way it refuses an export. The stand-in that used to live in
  the service (`setProvider`, `createLocalLeaderboard`) is gone with it.

### Fixed

- **A stepped frame handed the boundary to nobody.** `stepFrames` says the loop
  is held off for its duration, and it is — but it resumed by CALLING the loop,
  which starts a frame inside the same microtask drain that resolves the call. So
  the caller never got a boundary: its very next statement already ran inside a
  live frame, and an input edge injected there landed past that frame's PreUpdate
  and was cleared by its Last. A driver clicking a button in the running game got
  `ok`, a game that never saw the click, and nothing anywhere to read. It resumes
  on the next animation frame now — a task, not a microtask.

- **A driven click is a press and a release, a frame apart.** `click_ui` and
  `play_input` sent every edge of a gesture in one turn, with no hover before
  either, which is not what a pointer does and survives only as long as nothing
  clears the edges first. Both spread the gesture over stepped frames and return
  on a game that has already reacted, so what the click caused is there to read.

- **A row picked in the running game is found in the tree.** Clicking the game
  selected the entity and the Inspector showed it, but the Outliner left it
  folded away under collapsed ancestors with nothing highlighted: reveal-on-select
  asked the document where the row hangs, and an entity the game spawned has no
  document row to climb. It is asked of the tree that is showing now, which
  expands each ancestor by the key that tree gives it.

- **A row the running game spawned says so.** A destroyed row explained itself on
  hover and a spawned one did not, though the row already knew which it was.

- **The starters' background colour reaches the screen.** Three starters authored
  `clearColor` on their Camera, which has no such field — the clear colour comes
  from `Canvas.backgroundColor` — so each warned at load and then drew on black.

- **One removed panel no longer costs the whole layout.** A saved layout naming a
  panel this build cannot render was refused whole by dockview, which was already
  true of any plugin panel left open when the editor quit. Layouts are pruned to
  what can be rendered before restoring.

- **Contribution ids are namespaced by construction, not by request.** The docs
  asked plugins to prefix their ids; a plugin registering `details` would have
  taken a built-in panel's. The host puts every contribution under its plugin id
  now, idempotently, so the convention and the guarantee are the same string.

## [0.51.0] - 2026-08-13

### Added

- **The profiler answers "where did this frame go", and its rows add up.** The
  numbers were all being measured already — per-system CPU, sub-frame scopes, the
  engine's C++ scopes — and the panel listed them side by side as one flat ranking,
  which is how a scope nested inside a system got counted twice and how "Systems"
  came to mean the windowed maximum of each while "Frame" meant one frame. There
  was no way to ask which subsystem a cost belonged to at all: `EnemyAISystem` and
  `TilemapSyncSystem` were two names in a list.

  A frame now folds into a tree of cost domains, each domain the sum of its
  systems, each system the sum of the scopes measured inside it with the
  unaccounted remainder named as such. `frame = cpu + wait + idle` holds, and so
  does every node against its children — asserted, because a tree whose rows do
  not sum is a worse answer than a list that never claimed to.

- **A system's domain comes from where it was registered, not from a table.** The
  scheduler already knew — a system added during `plugin.build()` carries that
  plugin, and the project bundle's drain is what tells user code from engine code.
  That fact only ever reached the liveness watchdog. It now reaches the profiler,
  so a project's own systems appear under `scripts` and every plugin's under its
  own name with nothing to declare and nothing to keep in sync. A plugin whose
  cost is not its name says so once at its declaration — `camera` produces
  `render` — rather than the profiler keeping a list of who really means what.

- **Blocking is not work, and a scope says which it is.** `measureFrameScope` takes
  `remainder: 'wait'`: whatever is left under that scope once the native scopes
  inside it are subtracted is CPU blocked, not a hotspot. The swapchain block the
  render submit absorbs — the 2.1ms that used to read as an empty scene's most
  expensive system — is now the only thing that reclassification is spelled as,
  instead of a subtraction the editor did to one hard-coded scope name. It keeps
  the same numbers on the same capture, and an `await` can now be declared the
  same way.

- **A system's time now comes with the reason for it.** "ProjectileSystem: 7.3ms"
  is where every profiler stops and where the actual question starts. Each system
  now reports what its queries walked that frame — how many times they were asked,
  how many entities that came to, and how many of those an `Added`/`Changed`
  filter then discarded — so 7.3ms reads as 7.3ms over 18,400 entities of which
  none had changed, which names the fix instead of the symptom.

  It is measured at `candidates_()`, the one seam every way of asking a query
  goes through, so `count()`, `toArray()`, `isEmpty()`, `single()`, `forEach` and
  iteration are all covered by construction rather than by six call sites
  remembering to. The switch is per-`World`, not a module flag: the editor realm
  and the play realm are separate Apps in one process and a shared one would have
  each turn the other's accounting on.

- **A system that runs four fixed steps is charged for four.** `flushSystem_`
  assigned each system's time rather than adding to it, so a system on a fixed
  schedule reported its last catch-up step and nothing else — a physics-bound
  frame read as a quarter of its real cost. It accumulates now, which is also
  what makes the frame tree's claim to add up true on any frame the accumulator
  had a backlog for.

- **An agent can read the profiler.** `profile_frames` samples the running frame
  for a window and answers where the time went: fps and percentiles, the frame as
  `cpu + wait + idle` with GPU alongside, what each cost domain came to, and the
  costliest systems — each with its scopes and what its queries walked. So "why
  does the boss fight drop to 40fps" is answerable with the system, the number,
  and the reason, rather than with a screenshot.

  It is ranked and truncated, and says how much it left out: the tree behind it
  is hundreds of rows and the caller has a context window, and a silently short
  list reads as the whole list. It registers an engine consumer for the duration
  of its window, because the profiler skips the cross-boundary engine read
  entirely while nothing is mounted to display it — a caller that just read the
  ring with the panel closed would get frames with no engine costs in them and
  no sign that was why. A window in which no frame ran reports `stalled` rather
  than a set of zeroes that reads like a fast frame.

- **A wait is not a row in the tree.** Blocked time was being subtracted from the
  system that absorbed it while the scope beneath kept its full wall-clock, so a
  `render.submit` of 0.36ms sat under a `RenderSystem` of 0.22ms — a child larger
  than its parent, in the tree whose whole claim is that it adds up. The tree is
  work: the wait leaves it and survives as the profile's `waitMs`, which the
  frame identity already carries. The assertion that missed it — children summing
  was only ever checked below the scope, never across a system holding one — now
  runs over every node of a frame that has a wait in it.

- **A draw-call count now says what it is made of.** `FlushReason` had a member
  for every way a batch can break and a decoder to read it, and the producer
  wrote the constant `FrameEnd` for every draw call ever recorded — the
  vocabulary existed and nothing populated it. The reasons were never anywhere
  else either: they are the conditions `canMergeWith` tests, and it answered with
  a bare boolean.

  The predicate now answers with the reason. Each frame publishes `batch.draws`,
  `batch.merged` and a `batch.break.*` counter per reason that actually
  occurred — shader, blend, layout, material, depth, cull, state, scissor,
  stencil, indexGap, textureSlots, instanced — so "6 draw calls" reads as
  "1 run start and 5 index gaps, with 41 commands merged away", and the capture
  records the true reason instead of the constant. The list cannot drift from the
  rule, because every member is a branch of the rule. `FlushReason` is gone; the
  names that replace it are the ones the merge actually uses.

- **A profile is a document, and the panel is its viewer.** The profiler only
  existed where the editor was attached, which is the wrong place: what drops to
  40fps drops on someone's phone. Recorded frames are now a portable `.esprof`
  the panel opens — the same rows, the same tree, the same sums, with where it
  came from stated on the page rather than assumed.

  The format lives beside the cost model rather than in the editor, because it is
  the same vocabulary: a capture is a list of frames in exactly the terms a live
  frame is measured in, so reading one needs no translation and no second
  implementation to drift. `summarizeFrames` is what the live window an agent
  asks for, an imported file and (next) a report from a shipped build all go
  through, so none of them can compute a different fps from the same frames. The
  editor's per-frame cost rides along in a field a shipped game simply omits.

  A file picked by hand is the one input guaranteed to sometimes be the wrong
  file, so the reader returns a refusal with the reason — not JSON, no version,
  frames that are not frames, a version newer than this editor reads — instead of
  throwing where a panel cannot say why.

- **A shipped game records its own frames.** `ProfileRecorder` writes the same
  capture the panel opens, from a running build, so the answer to "why is the
  boss fight 40fps on that phone" is measured on that phone. It measures nothing
  of its own — every number comes from a channel the engine already publishes —
  and `start()` turns on both halves of the instrumentation, because a capture
  missing the engine's C++ scopes reads as an engine that costs nothing rather
  than one that was not measured.

  It chooses no destination. `take()` returns an object and the engine opens no
  socket, has no endpoint and writes no file, which is also why there is nothing
  per-platform to wire: a recorder that never saves anything runs wherever the
  engine does.

- **`app.onFrameEnd` — the frame, once its timings are final.** The recorder
  needed a moment that did not exist: inside a system a frame is half-measured,
  and the last schedule is only last until something else registers there. The
  observer fires after the frame, and is a broadcast rather than a slot, so a
  game's own budget alarm can watch beside the recorder instead of replacing it.

- **An agent can read a capture off disk, not just the running frame.**
  `profile_capture` reads a recorded `.esprof` and answers with exactly what
  `profile_frames` answers, so a capture from a device gets *analysed* rather
  than merely looked at — which is what a recorder is for. The projection behind
  both is one pure function over a summary, so the live realm and a file cannot
  describe the same frames differently.

- **The worst frame, broken down on its own.** A report was averages and a
  `worstFrameMs` with nothing behind it — but the averages describe the frames
  that were fine, and a stutter is one frame. `worstFrame` now carries that
  frame's own domains. On a synthetic capture the mean reads 0.04ms and the
  worst reads 0.58ms; only one of those numbers is the reason anybody is looking.

- **Memory was a field nothing filled.** `CapturedFrame.memory` shipped in the
  capture format, the editor's writer never set it and the recorder set a third
  of it, so the memory graph of an imported capture was empty and no reader
  could tell "not recorded" from "no memory used". Frame samples carry their own
  heaps now, the recorder records all three, and both the panel and the report
  say `—` / `-1` where a source recorded nothing rather than showing a zero.

- **One derivation, three readers.** `buildFrameProfile` is a pure function over
  plain per-frame data, so the live view, a pinned frame and a recorded session
  cannot each round their own way to a different answer. The editor's own
  `presentWait` subtraction is gone; the panel, the unit bar and the systems table
  now all read the tree.

- **Capabilities — a layer of intent above the tool catalog.** A capability
  declares what a run is allowed to be about, orchestrating only tools it names
  and reaching them only through `call`. Both MCP fronts get them for free
  because they enter the same `TOOLS` list, and `check-capabilities` holds the
  line that every name exists and no effect is under-declared.

- **A file write is only irreversible if nobody kept the bytes.** The undo stack
  covers the document and stops at the disk, which is why thirteen tools that
  merely write project files sat beside running arbitrary code and asked before
  each one. `fileJournal` opens a transaction per turn, captures every project
  path a write is about to touch, and one Revert puts the set back — so those
  thirteen move to a `journaled` tier that runs unasked, for the same reason an
  undoable edit does. A path too big for the budget is recorded as unjournaled
  rather than skipped: a Revert that silently leaves a 400MB import behind,
  under a bar saying the turn came back, is the failure this exists to prevent.

- **One Revert takes back both halves of a turn.** The checkpoint undid the
  document and left every file the turn wrote. It now reverts the pair — the
  document first, so the restored files land on a scene already at its pre-turn
  state — and the change set lists entities and files together, which is what
  makes a run legible as one thing.

- **A History panel where an agent run is one row.** Ctrl+Z was the only way to
  read what had happened, and thirty-eight identical undos is not reading. A run
  is bounded by its own two checkpoints, so the newest one no longer swallows the
  edits made after it; clicking a row puts the project back to that point — every
  run past it, files included — and says how far that reaches before anything
  moves. Undone steps stay on the timeline, dimmed, because forward is a place
  you can go.

- **A turn ends with a verdict it did not write.** `done_when` takes claims, each
  naming the thing that settles it: a probe evaluated in the running game, or
  `manual` for what only a person can judge. The kernel computes the verdict, so
  no closing paragraph can reach it; the editor's own checks run underneath and
  can only ever fail a turn; and `unverified` is a verdict, because a run that
  claimed nothing should not read as one that passed.

- **Claims the project makes, which no run can weaken.** A project states its own
  standing criteria in its manifest, in the same shape a turn declares its own.
  A turn cannot add to them, weaken them or remove them, and they can only fail
  it. A claim a run proved gets a Keep button, so a project accumulates the
  checks nobody sat down to write.

- **The claim only a person can settle is one a person is asked.** `manual` said
  only a person could judge it and then nobody ever was. The run now stops short
  of passed until they answer — two buttons on that row — and the answer rides
  the event stream, so it survives the reload that rebuilds the transcript.

- **A criterion is asked at the moment it is declared.** One that already answers
  true is a guard on what worked before and can never be what shows the turn
  achieved something. Declared after the work it is still taken, but each one
  then counts only where the editor could show it false right then — which
  replaced a blunt refusal that, across four real runs, meant no claims at all.

- **A run cut off mid-work still says whether it left the project standing.**
  Out of rounds used to mean out of answers: no diagnostics, no compile check,
  an empty result list under a run that had changed five files. Its own claims
  are still not due, so this can only ever fail or leave unverified.

- **The running game, read by name.** `find_entities`, `inspect_entity`,
  `list_resources` and `get_systems` answer what the game is doing without a
  hand-written probe and without a confirmation — three shapes chosen so an
  answer cannot be misread: a `total` beside a capped list, `null` timings with a
  note, and an over-large value replaced in its own place.

- **Driving the game is not something to ask permission for.** `play_input`,
  `step`, `set_play` and `set_time_scale` are `ephemeral`: they move a realm that
  Stop discards and never touch the edit World. `set_play(state)` replaces
  `toggle_play`, so staging a paused situation is one call rather than a race.

- **Press the button, do not compute where the button is.** `click_ui` takes a
  NAME, puts the point to the engine's own hit test, and refuses rather than
  clicking whatever is there instead. `send_gamepad` hands a game a controller on
  a machine with none, held until released and outranking the poll at its index.

- **The shader picker's list, and the material that comes with it.**
  `list_shader_templates` answers which shaders a material can name, what each
  one takes, and a whole `.esmaterial` already bound to it. The stock templates
  are runtime values, so none of that was in a project's staged types: one real
  run searched for `sprite-outline` three times and missed three times while the
  template of that name sat in the engine.

- **`create_asset` without content is the New… menu.** Leave it out and the file
  is the one the editor's own create menu would have written — a scene with its
  camera, an empty state machine, a material bound to `template`. One table, each
  entry pointing at the definition that already existed.

- **`search_symbols` — which names exist.** The question that comes before
  `lookup_symbol`, and the one searching files cannot answer: the shipped types
  re-export under mangled aliases on a single line, so no grep of a project turns
  that into a list of what is available.

### Changed

- **`done_when` is served by the kernel, not the editor.** It is loop state and
  reaches no editor door, so `loopOnly` keeps it off the MCP fronts, which have
  no turn to declare anything about.

- **The material format version has a name.** `MATERIAL_FORMAT_VERSION`, beside
  the constants its sibling formats already had, shared by the three writers that
  each spelled `'1.0'` out.

### Fixed

- **Every launch was a new origin, so every preference started over.** The
  packaged renderer is served over a loopback origin and the port was ephemeral;
  localStorage belongs to the origin. The dock layout, the model beside the
  composer, the play target — twelve keys — came back to their defaults on every
  start, silently, because each falls back rather than failing. The port is
  remembered now, and anything already holding it falls back to ephemeral.

- **The saved model pick was read before its own key existed.** The store's
  initializer read a `const` declared below it; the dead-zone throw landed in the
  `catch` that is there for a browser refusing storage, which answered "nothing
  saved". A loud failure wearing the shape of a quiet one.

- **A verdict's failures were held back for want of a turn to sit on.** Context
  between rounds must follow a user turn, and a verdict speaks after the model
  has stopped — so everything a turn was being asked to fix stayed in the buffer,
  and the model was re-invoked with nothing new in it.

- **A claim the project makes, added while the project is open.** Standing
  criteria were re-read when the project opened or when the manifest was written
  through the editor's own door — never for an edit from anywhere else, which is
  most of how one gets into a project. Claims that silently did not load look
  exactly like a project that has none.

- **The reflex that checks the work was switched off by looking first.** "Have
  you looked at this?" was answered for a whole turn by any single glance, and
  the prompt opens by telling the agent to look before it edits — so the good
  behaviour was the off switch. It is a running answer to "has anything changed
  since you last looked" now, and reading the running game by name counts as
  looking, which it did not before.

- **A run that got nowhere twice stops being offered again.** Carry on was
  offered for any ending you could continue from, whether or not the run had
  produced anything to continue from — and each press starts a fresh budget.

- **A key already held answers that it produced no press edge.** A key stays down
  until released, so a second `key_down` makes no edge and the game does nothing,
  while everything read back afterwards looks perfectly healthy.

- **A search no longer passes off a mis-set regular expression as an absence.** A
  regex sent to a literal search matches nothing, and `[]` is what "it is not
  there" looks like.

- **A shut drawer was 384px of page nobody could scroll back from.** A closed
  drawer is still in the layout, parked off the edge; `body` said
  `overflow-x: hidden`, which takes the scrollbar away and leaves the box
  scrollable by code — and the focus a closing dialog hands back is code.

- **A history row moved the document and left the disk where it was.** Clicking a
  row before an agent run gave the scene from before it and the scripts from
  after — a state the project had never been in.

## [0.50.0] - 2026-08-11

### Added

- **Every exported symbol carries a stability tier, and there is no
  stable-by-default.** A creator had no way to tell which parts of a pre-1.0
  engine were settled, and the surface guard read an untagged symbol as stable —
  so 1487 of `index`'s symbols were promised by accident. An untagged symbol is
  now `@experimental`: freezing is something a maintainer does, never something
  they forget to prevent.

  Four tiers, each a JSDoc tag on the declaration, so it reaches the `.d.ts` a
  project compiles against and shows on hover. `@public` (Stable Candidate),
  `@beta`, `@experimental`, `@internal`. `sdk/etc/*.api.md` is the inventory and
  the reference publishes it in both locales.

- **`@public` has to be earned.** `check-freeze-bar` refuses the tag unless the
  symbol is documented, named by an SDK test, and imported by one of the games
  the release is certified against. A symbol that should be frozen and cannot be
  goes in `BLOCKED` with what it is short of — and the entry is re-checked every
  run, so the day the evidence arrives the gate says so instead of the note going
  stale. `--blocked` prints that frontier.

- **A frozen signature may only name types that are frozen and nameable.**
  `check-tier-leaks` refuses a `@public` symbol that names a weaker tier; the new
  R6 in `api-surface` refuses one that names a type no entry exports, which the
  tier check cannot see. The two compose: R6 forces a type to be exported, and
  the leak check then forces it to be frozen.

- **112 Stable Candidate symbols, 60 Beta.** The whole ECS vocabulary is frozen
  with no leaks left — `defineComponent`, `defineSystem`, `Query`, `Mut`, `Res`,
  `Commands`, `World`, the descriptors and instances they are spelled in, the
  schedule and clock every project registers through, the parameter factories,
  `Transform`/`Parent`/`Children`/`Name`, `Sprite`, `Text`, the input action and
  binding vocabulary, and the layout units.

- **A verdict per subsystem, at the size a creator builds in.** Nobody asks
  whether `AudioSource` is frozen; they ask whether they can build their game's
  audio on this, and some 1458 experimental symbols answer that the same way whether a
  subsystem was weighed or nobody looked. The reference now carries 22 subsystems
  with a tier and the reason for it — required for anything not frozen, because
  "not frozen" is a decision and has to read like one. `entry` names the symbols
  that carry each verdict and a gate holds the table against their tags, so it
  cannot quietly disagree with the code.

- **Certifying a capability now means exercising it.** The golden corpus is the
  argument that a release ships working games, and `certifies` was the claim
  carrying it with nothing reading the claim: `space-shooter` certified `audio`
  and contains no sound at all. Each capability now declares what exercising it
  looks like, matched against a project's sources *and* its scene and prefab data.

- **A sprite's pivot is authored in the unit you think in, and on the artwork.**
  `Sprite.pivot` is stored 0..1 so it survives a resize, and nobody authors in
  fractions — the report was having to do the arithmetic every time. The data does
  not move; the authoring surface does. `ES_PROPERTY(normalized_of=size)` declares
  that pivot is a fraction of its sibling, so the Inspector row offers a frac/px
  unit picker that shows 100px where the scene keeps 0.5 and divides back on
  commit. The unit is a persisted editor preference, never scene data; the
  denominator tracks the size rather than being baked, stands down on a zero size,
  and drops out of a multi-selection whose sizes disagree, because 32px is a
  different fraction per sprite.

  Above the numbers, the nine pivots a sprite almost always sits at get the same
  3×3 grid the UINode anchors use — and pivot leaves the Advanced fold, because
  changing where a sprite turns is everyday authoring and a picker nobody can find
  is no picker.

  The pivot you cannot name — a character's foot, a door's hinge, a cannon's mount
  — is dragged on the canvas. A sprite is drawn at `position - R*(size*pivot)`, so
  moving the pivot alone would slide the artwork out from under the cursor; instead
  the transform follows the cursor and the pivot absorbs the same offset, which
  leaves that expression unchanged at any rotation and scale. Both writes are
  absolute in one grab-time frame, so a long drag cannot compound, and they share
  the transaction every other on-canvas handle uses — one undo step. The handle sits
  at the entity origin and yields to the transform gizmos by appearing only under
  the pointer tool. A pivot outside 0–1 stays legal: nothing clamps it, because a
  swinging arm hangs off a hinge its own artwork does not contain.

### Changed

- **The Editor Plugin API is experimental, and outside the 1.x compatibility
  contract.** VERSIONING.md defined four surfaces and said nothing about the
  plugin API, which is the dangerous state: authors read it as settled,
  maintainers treat it as internal, and neither finds out until something breaks.
  It will keep changing after 1.0, for three stated reasons — the contribution
  registries are still converging on one mechanism, a plugin runs as trusted code
  in the renderer and the isolation an ecosystem needs would make the API
  asynchronous, and no shipped plugin holds any of these shapes up.

  Three things you can rely on instead: `engines.editor` is honoured, so a plugin
  outside its range is refused with a reason rather than half-loaded; breaking
  changes appear in this file under **Editor plugin API**; a contribution point is
  deprecated for one minor release before removal. Stated in the typings the
  editor writes into your project, in VERSIONING.md, and in the guide in both
  languages — with a gate holding the four in agreement.

- **`world.getEntitiesWithComponents` takes three arguments.** Its last three —
  a precomputed cache key, a compiled predicate and a dependency-id set — are the
  query cache's shape rather than a question a game asks, and exactly one of
  fifty-nine call sites passed them. *Migration:* nothing documented used them; if you
  did, they moved to `world.queryEntities`, which is `@internal` and may change.

- **The embedding contract left the surface a game is written against.** Two
  audiences were sharing one entry: a game is written against the engine, while a
  host — the editor, the packaged shell, the native runtime — binds an engine core
  to an `App`, and only the second needs to name the wasm module or the C++
  registry. That is also what made the frozen-signature closure look like 132
  symbols: `defineSystem` names `InferParams`, which reaches `World`, which exposed
  `getCppRegistry`, whose type names every builtin component. Splitting the two
  collapses it to 38 — the descriptor, def and instance vocabulary the ECS promise
  is actually spelled in. `World`'s and `App`'s bridge accessors are `@internal`
  for the same reason. *Migration:* `esengine` no longer re-exports
  `ESEngineModule`, `CppRegistry`, `CppResourceManager` or `BuiltinBridge` — import
  them from `esengine/wasm`, which already held exactly these types. All fifteen
  consumers in this repo were hosts, which is the argument.

- **`uiPickWorld` and `uiPickAllWorld` take the world.** They took
  `(engine, registry)`, so a game-facing guide had to tell game authors to reach
  `app.wasmModule` and `world.getCppRegistry()` — and its example did not compile,
  because neither name was ever bound. They take the world now and resolve the core
  themselves through `engineApi`. The parameter is `PickableWorld`, the two
  accessors picking actually uses, so a narrowed read-only view can pick without the
  helpers claiming to need a whole world. *Migration:* pass the world as the single
  first argument.

- **Animation and Audio are Beta, because something certifies them now.** Both were
  experimental for one stated reason — no golden project exercised them — and the
  reason moved when `examples/sprite-animation` and `examples/audio-demo` joined the
  corpus. `Animator` and `SpriteAnimator` are documented for the first time. What
  keeps animation off frozen is breadth: two of eighty animation symbols, with the
  whole timeline half untouched.

- **`InputMap.evaluate` and `CommandsInstance.spawnImmediate` are `@internal`.**
  Both are the engine's own call — the per-frame evaluation and the deferred-spawn
  mechanism — and neither was ever a promise.

- **`Camera` and `InputState` are Beta rather than frozen, and say why.**
  `clearFlags` is a bitmask whose C++ enum has no TypeScript spelling and
  `cullingMask` names layers no exported constant identifies; `InputState`'s
  per-frame touch state is reachable only as raw collections, with no accessor
  for started/ended and no write door at all. Freezing either would freeze the
  gaps in it.

- **`TextData.overflow` does something.** The Inspector offered a Clip / Ellipsis
  / Visible dropdown for a field that no layout or render path read, so every value
  drew as Visible with no warning. Both modes now drop the lines past the box
  height and trim a line past its width, with Ellipsis marking the cut. Two
  details are the contract rather than the implementation: a box too short for one
  line still shows one, because nothing is not an answer a reader can act on; and
  the mark goes on the last kept line whenever lines were dropped, even if that
  line fits, because it says "there is more" and not "this line was long".
  Trimming is whole-glyph — text does not go through a scissor.

  Rich text truncates by line only. Trimming one means measuring per run, and a
  run carries its own size and style.

  Twelve assertions on the pure layout, and a pixel gate that is a differential:
  two identical labels in identical one-line boxes, Visible beside Clip, so a
  truncation that silently does nothing leaves both second lines drawn and the
  pair says so. Making the truncation a no-op turns it red, which is what makes it
  a gate rather than a screenshot.

- **`examples/input-actions` demonstrates every binding kind it renders.** Its
  `formatBinding` switched on all eight while the project could construct four. It
  gains a `Zoom` action — a 1D axis over two keys and an inverted gamepad axis, the
  keyboard and pad twin of the pinch gesture already there — and its rebind now
  offers mouse buttons.

- **The corpus grew by three projects, so its coverage is backed.** Every false
  claim EVIDENCE found was a capability whose only real example sat outside the
  suite, so the fix was to bring them in rather than to declare holes.
  `examples/sprite-animation` certifies animation — the same key that walks the
  player switches its clip from Idle to Move, and the package answers it 0.73
  against a 0.15 floor. `examples/effects-gallery` certifies materials, a gallery
  of the built-in templates whose conveyor scrolls itself from the shader clock.
  With audio-demo that is 31 of 33 capabilities against 2 declared gaps — the same
  arithmetic as before this release and, for the first time, each claim backed by
  something in the project.

- **`examples/audio-demo` joins the certification corpus, and a run proves sound
  came out.** It was the one example that uses audio and it was outside the suite,
  so the pillar shipped uncertified while `space-shooter` claimed it. Certifying it
  needed a claim pixels cannot settle: the control that starts a sound redraws
  itself whether anything played or not, and a one-shot drum hit is over before the
  capture. So the project declares an `audio` block — a toggle to click for a
  sustained source, and a spectrum bar the game writes from an analyser bin of the
  master bus. The run reads that bar's height: 36.6 against a silent floor of 6.
  Aim the toggle at empty background and it reads 6, which is what makes the check
  a check.

### Fixed

- **A parent link has two halves, and three of the four writers wrote one.**
  `Parent` and `Children` are one relationship stored twice. `TransformSystem`
  starts at entities that have a `Transform` and no `Parent` and then walks down
  `Children`, so a subtree linked one way was never reached at all: `worldPosition`
  stayed (0,0,0) and every sprite in it drew at the world origin — and adding a
  `Transform` to the ancestors did not help, because the missing half was
  `Children`. The embind `addParent`/`addChildren` emplaced the component
  field-wise, so the web/wasm backend built one-way links while the native host
  routed its own through `es_setParent`; the editor's `addComponent("Parent")`
  emplaced a `Parent` naming `INVALID_ENTITY`, and `setField("Parent","entity")`
  wrote the field behind `setParent`'s back; `World.setParent` kept the C++ side
  correct but never updated the JS entity sets that `has()` and the query cache
  read. `HIERARCHY_COMPONENTS` declares the pair once in the EHT data model, and
  `World` routes `insert`/`set`/`remove` for those two components into
  `setParent`/`removeParent`, which now also maintain the JS mirrors, the
  `Added`/`Changed` records and query invalidation. `EntityCommands.childOf(parent)`
  gives the chained API a way to say this at all — before, `insert(Parent, {entity})`
  was the only spelling available, and it was the broken one.

- **A sprite handed a texture kept the 100×100 placeholder size.** Creating a
  sprite and assigning it a 64×48 image left the quad at the placeholder with the
  art stretched, and nothing on screen said why; dragging an image into the viewport
  was the only path that got it right, because that path alone decoded the file on
  its way to spawning an entity. The size now follows the texture at the one place a
  texture is assigned, and only while the size is still one nobody chose — the
  untouched default, or the fit to the texture being replaced, which is what makes a
  swap follow the new image. A size you typed is never overwritten. The fit
  necessarily lands after the write it reacts to, so it cannot join that undo step;
  rather than hide that, it is named "Fit Sprite To Texture" and can be undone on
  its own.

- **A collapsed folder in the Content Browser could not be reopened.** The twisty
  vanished with the folder, and `visibility: hidden` takes no clicks, so collapsing
  the tree was a one-way door. The same cause was hiding in plainer sight — no
  subfolder ever showed a twisty at all, so the tree was only ever one level deep.
  Whether a row could expand was counted off its own directory listing, and the
  listing is only fetched while the row is open, so every closed row reported zero
  subfolders and retired its twisty. Only an open listing can prove a folder
  childless: a row is assumed expandable until one says otherwise, and keeps that
  answer when it closes.

- **`pnpm run verify` could not run on a Windows checkout.** Three separate things
  stopped the pre-push gate before it could say anything true. `run-gates` never
  read `spawnSync`'s `error`, so a shell that would not start was reported as the
  first gate failing — sending the reader after a gate that had not run and was
  clean. `check-cpp-tests` read `CPP_TESTS` out of `build.yml` with a pattern
  containing `\n`, which CRLF never matches, so it threw "build.yml no longer
  declares CPP_TESTS" while reading as a local gate that works. And the C++
  harnesses did not compile: MSVC reads UTF-8 sources in the host ANSI codepage
  unless told `/utf-8`, so a test's emoji literal became a syntax error on one
  machine's locale and not the next's. A test behind a configure option this tree
  does not set is now told apart from a broken one by MSB1009 as well as by
  MSBuild's English phrasing, because an error code is the same in every language.

- **`world.set` on a component the entity lacked did not reach a query that had
  already run.** `set` is documented insert-or-replace, and the engine-component
  branch has always routed a new component through `insert` because queries and
  `has()` never see it otherwise. The script-component branch never got that
  guard: the query cache went unmarked, so a warmed query answered the old set
  forever, no `Added` tick was recorded, and `getComponentTypes` — and anything
  walking it — could not see the component at all.

- **The asset API was absent from the governed surface.** `AssetsData` recorded
  its whole body as the name of a local import alias no entry exports, so sixty-odd
  methods a game calls to load anything were outside the snapshot: no review diff
  ever showed them and the baseline guard could not have caught a break in one. A
  type alias whose target is a shape no entry exports now records the target's
  members. Five aliases were hiding one that way.

- **`InputMap.axis2d` named a duplicate `Vec2`.** `inputMap.ts` declared its own
  structurally identical interface, so the recorded surface said `Vec2` and meant a
  different type — which is why it compiled and why nothing noticed.

- **Four CHANGELOG headings rendered as plain text**, and `[Unreleased]` compared
  from two releases back. Both are now checked with the version, so this file's own
  bookkeeping cannot drift again.

### Documentation

- **The editor an agent can drive is a headline feature, not an extension point.**
  The built-in agent and the MCP server were documented well and filed badly — both
  under "Extending the Editor" beside editor plugins, a shelf whose label says
  "advanced topic for people modifying the editor", when the subject is one of the
  few things here no other 2D engine ships. Neither the README nor the landing page
  mentioned them at all, so a reader comparing engines had no way to learn any of it
  existed. `agents/` is a top-level group now, placed after Editor rather than under
  Extending, with the old URLs redirecting; the landing page gets an Agent-native
  card, and the README says the thing worth saying — sixty-five tools, the same
  pipelines the UI calls, one catalog behind both front doors.

- **Textures get their own page.** What formats are accepted, what the import
  settings do, and how to find out how big a texture is were spread across the
  Sprites guide, the Assets overview and the importer's own tooltips. Both answers
  to the size question are there, because they are for different situations:
  `loadTexture` returns `{ handle, width, height }` for an image your code asked
  for, and `getTextureDimensions(handle)` measures one a scene placed, where your
  code never saw a result object. It also states which end owns a sprite's size —
  the editor fills it in from the image and stops once the number is yours, while
  in code nothing fills it in.

- **The Sprites guide says how a pivot is authored**, not just what it stores: the
  preset grid, the px unit on the field and the viewport dot, with the one
  surprising thing about each, and that a pivot outside 0–1 is legal.

## [0.49.0] - 2026-08-10

### Added

- **`Time.scale`: a paused world that is still a running frame.** Stopping a game
  meant stopping the loop, and `App.setPaused` runs only `Schedule.Last` — which
  also stops UI layout, so the menu a pause exists to show could not be drawn. A
  project could gate its own systems with a `SystemSet` run condition, but that
  reaches half the loop: the character controller kept integrating the velocity
  last written to it, and navigation, behaviour trees and perception are engine
  plugins outside any set a project can name.

  `Time` now carries a `scale` applied to `delta` and to the fixed-step
  accumulation, plus `unscaledDelta` for whatever must keep moving. At 0 the
  frame still runs — systems tick, UI lays out, a menu draws and can dismiss
  itself — while everything that advances by `delta` advances by nothing, the
  physics step included, because the accumulator is scaled too. Measured on the
  flagship, two captures 80 frames into a pause: 6.6% of the frame changed
  before, 0.019% after.

- **A project can register a system set, so a pause is one condition instead of
  a flag checked in nine systems.** `defineSystemSet` takes a `runIf` and its own
  documentation shows a pause as the example, but the only door to register one
  was `App.addSystemSetToSchedule` — and a project's systems arrive through the
  module-level `addSystemToSchedule`, which takes a single system. There is now a
  module-level `addSystemSetToSchedule`, and the bundle drain expands a set into
  its members, so everything downstream (hot reload included) still sees a flat
  list of user systems.

- **Export Diagnostics: one document that answers "the editor crashed yesterday".**
  Everything a reproduction needs was already in the process — the build stamp the
  boot guard reads, the census `resource_census` reads, the log the console
  renders — with nothing that put them in one place. **Help ▸ Export Diagnostics**
  now writes a structured report: editor and engine build (ABI, git sha, built-at),
  the GPU, the project's shape, every census counter, the recent log, and the
  settings that differ from their defaults.

  The exporter knows no section names; a subsystem registers what it can say and
  the bundle walks the registry, so a plugin contributes diagnostics through the
  same door core uses. What a studio can hand out is decided per VALUE rather than
  per collector: names, paths and values travel as stable placeholders, and the
  full thing is a separate, explicit export. The placeholders are stable so one
  name reads the same everywhere it appears, and keep the shape, because a value
  that was `undefined` and one that was `0` are different bugs.

- **The bundle carries the run-up: what the editor was asked to do, in order.**
  One stream rather than one per source, because a reproduction *is* an order —
  opened a scene, deleted an entity, undid it, hot-reloaded, crashed — and two
  streams only carry that order if whoever reads them re-merges by timestamp.

  It is recorded at the two doors the editor already funnels through: the command
  registry's single dispatch point and the undo stack's single commit. A command
  that was **refused** is recorded too, since "I pressed undo and nothing
  happened" is a bug report that a stream of successes would show as silence. An
  undo names the step it reached, not just that undo occurred.

  The stream is kept unredacted, which is only defensible because what enters it
  is safe by construction: ids and shapes (`modify×1 Transform`), never a name or
  a value. Repeats collapse with a count, so a gizmo drag cannot push the
  interesting thing out of the buffer.

- **The GPU is readable while it works.** The engine captured its backend, vendor,
  renderer and driver version at init all along — a lost backend cannot be asked
  who it was — but the only way to read them was off a *loss report*, so a healthy
  session could not say which GPU it was running on. Identity is now its own type
  with its own accessor (`getDeviceIdentity()`), and the loss report snapshots it.

  On the web that answer used to be worthless anyway: `GL_VENDOR` and
  `GL_RENDERER` are masked, and every Mac reports "WebKit WebGL" — a browser, not
  a GPU. The unmasked strings are read where the browser allows it, so a report
  now names `ANGLE Metal Renderer: Apple M4` instead of a constant.


- **`examples/celestial-heights` — a game the engine is judged by.** Not a
  showcase: an ARPG built to be played from its first room to its boss, whose
  purpose is to find where the engine hurts. Everything below in this release
  that is not the editor came out of building it, and the rule was that a place
  it hurt got fixed in the ENGINE — a ledger (`engine-gaps.mjs`) held every
  workaround, with a gate that refuses a release while the ledger is non-empty.
  It ships at zero entries.

- **`CameraBounds`: a level's edge belongs at the edge of the screen.** A camera
  that follows a character walked off the map with it, and every project solved
  that by clamping in its own follow script — so the constraint lived in whichever
  system happened to move the camera. It is now a property of where the camera IS:
  applied after every camera mover, opted into per axis (max > min), centring the
  view when the interval is narrower than the viewport. Orthographic only.

- **`SceneManager.reload()`: a run can start over.** `switchTo(theSceneYouAreIn)`
  is a no-op — correct for a door, and no way at all to express dying, retrying,
  or starting a new run.

- **A prefab spawned at runtime belongs to the scene it landed in.** Entities
  created from script had no scene, so a scene switch left them behind — the
  spawner's bullets outliving the level. They now adopt the active scene at spawn;
  `scene: false` opts out for something deliberately global.

- **`NavAgent.radius` is finally read.** The field was declared and nothing
  consumed it, so every path was planned for a point and a body-sized agent
  clipped every corner. Paths are now planned against a clearance field (two-pass
  chamfer, out-of-bounds counted as blocked, computed on first ask and dropped
  when walkability changes). **The default changed from 12 to 0**: a field that
  never took effect would otherwise silently re-route every already-published
  project the moment it started working.

- **`Virtual('id')`: an input a thumb can reach.** A binding could name a key, a
  button or an axis, and nothing a finger touches. A named virtual input is an
  ordinary binding — it serializes, rebinds and lives in a `.inputmap` like the
  rest — so an on-screen control feeds the same action a key does, rather than a
  game reading screen rectangles that drift when the layout moves.

- **`PlatformAdapter.hasTouch()`.** "Show the on-screen stick only on a touch
  device" was unanswerable, so the alternative was to wait for a first touch —
  which asks the player to touch nothing, twice.

- **`randomSeed`, and one place a seed lives.** The engine's randomness was a
  particle-system member seeded from the clock, so a run could never be repeated:
  no replay, no reproducible bug report, and nothing constant to assert about a
  frame with particles in it. `RandomSource` is the engine's source now, still
  clock-seeded so an unconfigured game varies; pass `randomSeed` at boot and the
  run reproduces. Consumers take a NAMED stream rather than sharing a generator,
  so adding an emitter cannot change what something else rolled.

- **Atlas membership is declared, like delivery already was.** Which textures
  pack into one page was a `<name>.atlas/` folder convention known only to the
  cook. `.esengine/asset-groups.json` now carries an `atlases` section, resolved
  by `resolveAtlas` beside `resolveAssetGroup`. It is a SEPARATE axis from a
  delivery group on purpose: an atlas may span two groups, and a group may hold
  two atlases. The folder convention stays as the zero-config default.

### Fixed

- **A particle emitter now takes its world Y into the draw key, like everything
  else that draws.** Sprites set it, and a particle emitter's own trail set it;
  the emitter's main draw did not, so on a y-sorted layer a burst always sorted
  as though it stood at y = 0. Found while chasing a different bug, which it
  turned out not to be — recorded because the omission is real either way.

- **Writing a component from a system threw away the engine's own computed
  state, and a UI element that was written drew underneath its own background.**
  A HUD meter animated the ordinary way — query the `UIVisual`, assign
  `fillAmount` — came out as its parent track composited over it. Read back from
  the C++ pass that assigns it, the written element's `uiOrder` was 0 where its
  unwritten twin's was one above its parent's.

  `UIVisual` carries `uiOrder` and `uiCullBit`, which the UI render-order pass
  writes each frame and no `ES_PROPERTY` declares — correctly, since they are not
  authored and not serialized. But the generated binding replaced the whole
  component with a struct built from the declared fields alone, so every write
  from script reset the element's draw order to 0 and its canvas cull bit to
  nothing. `UINode` carries its resolved size and subtree alpha the same way.

  A component that already exists is now assigned field by field instead of
  replaced, so state the engine computed survives a write from script. This is
  generated for every component, not patched for one.

- **Navigation built from a tilemap was upside down, so enemies walked into
  walls and stood still in the open.** `navGridFromTilemapLayer` read tilemap row
  `y` for nav cell `y`, but the two count in opposite directions: a tilemap's row
  0 is its TOP (`centre.y = originY - (row + 0.5) * tileH`) while a nav grid's
  cell 0 is its BOTTOM (`cellToWorld.y = originY + gy * cellSize`). Every
  obstacle therefore landed mirrored about the map's middle, and no `origin`
  could correct it — the mirroring was in the row mapping, not the offset.

  The visible symptom was worse than a wrong path: an agent whose own cell fell
  outside the grid found no path at all and never moved, so an enemy that could
  plainly see the player simply stood there.

  The row is now flipped inside the wrapper, and `origin` keeps the meaning it
  has everywhere else — the world centre of the bottom-left cell. The pure core
  (`navGridFromTiles`) was always right and always tested; the seam where two
  subsystems with opposite conventions meet had no test, and now does.


- **Safe-area insets are asked for again, not decided on frame one.** The insets
  were read once when the plugin built and written once to the nodes that existed
  then. On iOS `env()` has no value until after the first layout, so that read was
  always zero; and a HUD loaded additively afterwards brought nodes nobody ever
  visited. The read is throttled and the nodes are walked every frame. Measured
  under a 44px notch: the node used to receive 0 and now receives 88.

- **Asking a resource store for a value is not the same as having one.**
  `get` materialised a default into the same table `has` reads, so one system
  touching a resource was enough to make an install gate believe its plugin was
  already there. Localization defaults to null, so an additively-loaded scene lost
  every translation — 38 errors on one scene, none after.

- **A body does not block the view of itself.** Line-of-sight cast from origin to
  origin while colliders sit at the feet (the 2.5D norm), so the ray entered the
  target's own capsule before reaching it. The symptom hid well: visible from the
  side, invisible from below. 49 sightings and no damage before; 571 and a hurt
  player after.

- **A desktop package built with default settings drew nothing.** Every format a
  KTX2 transcodes to is a 4x4 block format, and WebGPU refuses a compressed
  texture whose size is not whole blocks — WebGL does not, so the web package was
  fine and the native one could not create a single texture. A 70x70 sprite was
  enough to blank the frame. The cook ships such a texture raw and names it in a
  warning; the runtime no longer picks a block format for an image that cannot be
  whole blocks.

- **The same game no longer differs by an sRGB encode between desktop platforms.**
  The swapchain took whatever format the surface preferred, so whether it encoded
  on write was the driver's answer. The engine hands that surface values that are
  already display-encoded, so a platform whose preferred format was *Srgb encoded
  them twice. Measured: one platform read an exact sRGB encode of the other, on
  every probe.

- **A headless export could not compress a texture, and said nothing.** The Basis
  encoder finds its own binary through `import.meta.url`, and the headless path
  bundles the cook into a temp directory — so it looked for it beside the bundle
  and threw on every texture. Worse, the cook answered that by DROPPING each
  asset: no file staged, no manifest entry, and a report that said the build was
  clean. An asset the game reaches and the cook cannot produce is now an error.

- **The desktop runtime templates can be downloaded.** The Windows, macOS and
  Linux templates are published, valid and reachable; the button did nothing at
  all, because two different types were both called `NativePlatform` — the export
  targets (one `desktop` for three OSes) and the platforms a template is published
  for — and every layer above the download hand-narrowed it back to the mobile
  pair.

## [0.47.0] - 2026-08-08

### Added

- **Desktop is a real target: one export, an app per OS, and a Steam channel.**
  The desktop build used to be an Electron source tree you were expected to `npm
  install` and package yourself — the only target in the repository that handed
  its toolchain to the user. It is now the same three-layer path the phones take:
  a prebuilt runtime template (a native host on SDL3 with Dawn and QuickJS
  embedded, no Chromium), a pure-Node assembler, and a runnable build out the
  other side. Windows, macOS and Linux templates are published with each release,
  so an installed editor can package a desktop game with nothing else on the
  machine.

  One export assembles an app for *every* desktop template installed, not for the
  OS doing the building: the assembler never cared which OS ran it, and a Steam
  upload normally carries all of them at once. Signing a `.app` is the one thing
  that genuinely needs a Mac, and that is a warning on that one output.

  Steam rides the desktop target as a *channel*, not as a platform — it defines
  no runtime, no renderer and no asset format, only where a build goes. Selecting
  it writes the SteamPipe depot scripts and a `STEAM.md` carrying this build's own
  values: the depot ids, the launch string, the Auto-Cloud paths the game really
  writes to, and the achievement ids to create in the partner backend. The first
  run is always a preview, and `steam_appid.txt` is absent by construction rather
  than by an exclusion rule someone has to maintain.

  `Achievements` is an engine service like `Ads` and `Leaderboard`: it works with
  no store behind it (unlocks are recorded locally — the same data a game's own
  achievements screen reads), `available` says whether a store will also hear
  about it, and an id outside the project's declared set is refused where it
  happens instead of being accepted and silently dropped. Steam is one provider
  behind it, reached by loading the redistributable at run time and resolving the
  flat C API, so the engine binary contains no Valve code and no Valve header —
  the SDK is the developer's own download, named in Project Settings.

- **A lost GPU device is now a state the engine recovers from, not a black
  screen.** Every backend can lose its device — the browser fires
  `webglcontextlost` when the GPU resets or a tab is backgrounded too long,
  WebGPU resolves its `lost` future, a native driver resets under you — and the
  engine had no concept of it. The only thing that existed was a diagnostics
  report whose own comment said what happened next: *"The frames after it draw
  nothing."* Half-alive was not a risk, it was the documented behaviour.

  A device now has a status. A backend only *detects* its own kind of loss and
  says so; what "lost" then means — one report, one transition, submission
  stopped — is the same for GL, for WebGPU and for whatever comes after them. The
  report names the backend, GPU, driver and the frame it happened on, captured at
  init because a lost backend cannot be asked who it was (`glGetString` returns
  null once the context is gone), and those are exactly the fields that separate
  an actionable bug from an unexplained black screen. WebGPU's loss can only be
  subscribed to where the device is *created*, so the SDK reads the device back
  off the module and subscribes once for every host rather than each host
  remembering to wire its own.

  Then it comes back. `Assets.recoverFromDeviceLoss()` rebuilds the device, every subsystem
  that owns GPU objects, and the content, in the one order that works: shaders
  first (every cached program id is read back from those handles), then the render
  context (its 1×1 white is the placeholder textures are parked on), then the
  textures. The device is left *Recovering* — drawable, with placeholders, so the
  screen fills in rather than freezing for the length of the reload — until the
  asset layer re-uploads and declares it whole.

  The seam that made this affordable is that a `resource::Handle` names a texture,
  not the GPU object inside it. Swapping that object out and back is invisible to
  every component, material and font already holding one, so there is no rebind
  pass walking the world looking for holders, and no shadow copy of VRAM in system
  memory. Shaders take the other route and keep their sources — a few hundred KB
  across a project, against tens of MB for a texture's pixels — so a handle stays
  the stable identity there too.

  Recovery is a real regression test, not a claim: `ESTELLA_VERIFY_DEVICE_LOSS=1`
  drives a genuine `WEBGL_lose_context` cycle against the headless host and
  asserts the whole thing, ending on pixels. Two defects it exposed had to be true
  for recovery to be possible at all — the `webglcontextlost` listener never
  called `preventDefault` (whose default action is the browser abandoning the
  context *permanently*, so no rebuild path could ever have helped), and it was
  installed on `window`, which an unattached canvas has no path to because the
  event does not bubble. Either one alone meant a lost context stayed lost on any
  real page.

  One known residue: emscripten's GL object tables still grow across a loss
  (programs 5 → 21, buffers 18 → 52), because wrappers minted against the dead
  context are never reaped. The engine references none of them; it is bounded by
  how many times one session loses its device, and it gets its own pass.

- **The engine can be asked how many of anything are alive.** It could answer that
  for entities and nothing else. GL objects, listeners, physics bodies, cache
  entries and both heaps were reachable only by reading a private field of
  whichever class owned them, if at all — so the failure that actually ends an
  editor session, Play/Stop forty times and it crawls, had no instrument pointed
  at it, and every leak ever fixed here was found by someone noticing.

  `takeCensus()` is that instrument, and the tiering is the design. "Every counter
  returns to baseline" is wrong often enough to be useless, and a soak test that
  cries wolf gets deleted within the month: a texture cache holding `refCount==0`
  entries for revival is doing its job, a pool at its high-water mark is doing its
  job, and a JS heap is nobody's to control. So a counter declares which law it
  obeys — *conserved* (identical every cycle), *bounded* (may plateau, must not
  grow), *trend* (judged against a stated byte budget) or *info* (never asserted).
  Judging the slope rather than the value is also what makes it cheap: a leak
  rises from cycle one, so fifty cycles prove what ten thousand would.

  It is exposed to the editor's agent as the `resource_census` tool, so "did that
  get slower, and what is it holding" has somewhere to look. Also new, because the
  census wants exact numbers where it can get them: `es_getMallocBytes()` (the
  reserved wasm heap only grows, so a C++ leak hides until it crosses a growth
  step and then reads as one 16MB jump — this is exact and falls on free), and
  total body, shape, joint and tracking-row counts from physics. Only the *dynamic*
  body count had been reachable, and that is precisely the subset that cannot show
  the leak worth finding: a static body outliving its entity still collides.

- **A 50,000-asset project, and a set of costs it has to stay under.** Every scale
  problem this engine has had was reported by someone whose project was big enough
  to notice — 36k assets where deleting 22 files took 52 seconds, a folder of 788
  sprites that decoded 26 megapixels to show twenty. Nothing in this repository
  was ever that big: the examples exist to teach, so they are small, and a cost
  that only appears at 50k assets was invisible here until a user met it.
  `node tools/stress-project.mjs` generates one — 50,000 assets, 10,000 sprites,
  5,000 UI nodes with masks inside masks, 2,000 physics bodies, 500 skeletons,
  3,000 prefab instances with overrides, a 256×256×4 tilemap, and one scene
  holding all of it. It is generated rather than committed because 100,000 files
  would sit in front of every clone to store bytes that are a pure function of one
  script; the same seed gives the same tree byte for byte, in about eight seconds.
  `pnpm run scale` measures eighteen costs against it and holds each to a
  declared ceiling: project scan, incremental re-scan, delete, move, Find Usages,
  scene open and save, prefab instantiate, per-frame update, and what a scene
  retains after twenty open/close cycles.

  The ceilings are the point. The performance snapshot that already existed
  answers "did this change make it worse", and can always be accepted with
  `--update` — so a feature that takes scene-open from 200ms to 900ms passes by
  rewriting the number it is compared against. A ceiling cannot be raised by the
  change that breaks it. Because milliseconds do not survive a two-core shared
  runner, every budget is denominated in a reference workload measured in the same
  run — parse, loop, or file-read, whichever matches the metric's shape — so the
  same number means the same thing on a laptop and in CI.

- **Native games get mouse buttons, the wheel and gamepads.** The native input
  seam carried a single primary pointer, which is the whole of a touch screen and
  a fraction of a desktop. It now answers what the web adapter answers, verbatim:
  a pointer with a DOM button, a wheel in pixels, keys by DOM `code`, and gamepads
  *polled* the way `navigator.getGamepads()` is polled, because a pad has a state
  rather than events.

  Every one of those tables fails silently when it is wrong — the key or the
  button simply never arrives — so they are checked against a list written
  independently from the W3C spec rather than derived from the same header, and
  every standard button must be reachable exactly once. SDL and the DOM disagree
  on nearly every number involved (mouse buttons start at 1 and order the middle
  and right ones differently; a positive wheel means the opposite direction), so
  the two adapters are compared trace-for-trace against the same input.

### Changed

- **`AdsHost` is now `TakeoverHost`, and `new AdsAPI(host)` takes a `Takeover`.**
  The pause-and-silence ceremony an ad performs is the same one a store overlay
  performs, so it moved out of the ads service into `createTakeover(host)` — one
  ceremony for anything that covers the game, which is also what makes an overlay
  opening during an ad correct. Games do not construct `AdsAPI` (the services
  plugin does); code that referenced the `AdsHost` type should use `TakeoverHost`,
  which has the same four members.

- **A material names its texture and its shader by handle, not by a raw GPU id.**
  `material_setTexture` took a `resource::TextureHandle` and resolved it to a GPU
  id on the spot, and a layout's declared `default(white|black|flatnormal)` was
  resolved the same way once at registration; `material_define` did the same with
  a shader's program id, and filed the constants layout under it. All of them then
  outlived what they named — a hot update, an eviction or a device loss replaces
  the object behind a handle and the material keeps binding the id that is gone.
  These were the last places in the engine reaching past the indirection every
  other texture path relies on, which is exactly why they survived a re-upload
  badly. A binding now stores the handle and resolves per bind (a pool lookup is
  an array index and a generation compare, once per material per frame, not per
  draw call); the shader keeps its handle as the identity with the program id as a
  cache beside it, recomputed when the device rebuilds. `defaultTextureByName` had
  no callers left and is gone.

- **A texture load still in flight across `releaseAll()` now fails instead of
  resolving.** It used to hand back a handle the pool had already destroyed. A
  load that completed *before* the teardown cannot be un-resolved, so that result
  is void by contract; the callers that matter re-load after a teardown anyway.

- **`SceneManager.load` and `loadAdditive` are one implementation, and so are the
  two halves of `switchTo`.** Each pair was two copies of the same forty lines
  differing in three, which is the arrangement that stops agreeing — and it had:
  the additive door missed the sleep/pause restore, and the faded and plain switch
  paths held *different* locks, so "one switch at a time" was two invariants that
  happened to line up. Behaviour is unchanged except where the copies had already
  diverged; parity tests now make every claim of both doors from one table, so a
  third entry point has to join it.

- **One reference ledger for every asset kind.** Textures had their own accounting
  and the seven generic kinds — audio, materials, fonts, clips, timelines,
  tilemaps, prefabs — had a second copy of it with the same hole. What a resource
  *is* stays the caller's business (a texture gives a handle back to the C++ pool,
  a generic kind goes through `loader.unload`), but which generation a release
  belongs to is not something two implementations should each have an opinion
  about.

- **`pnpm run verify` type-checks the editor too.** It ran `tsc --noEmit` for the
  SDK and not for desktop, so a broken editor build could reach a push —
  and `editor-checks` does not fail on that, it runs whatever `dist-electron`
  already contained. A stale bundle answering questions about current code is
  worse than no answer. Five and a half seconds next to the twelve guards already
  there.

- **A packaging target's settings are edited on that target's page, next to the
  build they change.** What a target is called and identified by — the WeChat
  appid, the desktop app id and channel, Steam's app and depot ids, the Android
  version code — used to sit in the settings window in one flat list mixing every
  target, while the Package Project dialog that consumes them showed none of them.
  Shipping to Steam meant leaving the dialog, finding *Channel* among another
  platform's rows, and coming back; the dialog never said Steam existed.

  The line that decides where a value goes is now the only one there is: does it
  belong to a target, or to the project? A setting that names a target is shown on
  that target's page and nowhere else, so it has exactly one editor. What stays in
  **Project Settings → Packaging** is what holds whatever the project ships to —
  the application id, the icon, the achievement ids. Settings search still finds
  the moved rows and says where they are, rather than offering a second copy of
  the control.

  The declaration also carries when a row applies at all, so the Steam group
  appears on the Steam channel and the App Bundle row when the build produces a
  package — conditions that used to be hand-written in the dialog. And a target
  that ships to more than one place now branches the nav: **Steam** is listed under
  Desktop, because the left rail answers "where does this go" and that is the
  question someone has before they open the page. It is still a channel, not a
  platform — the build is the same desktop app.

### Fixed

- **A packaged native game started with half its project configuration.** There is
  one projection of `game.config.json` into a running realm, written so that a
  field added to the config reaches every host that spreads it — and the native
  host listed the fields it knew about instead of using it. So the physics
  configuration, the mixer state, the achievement ids and the Steam app id all
  stopped at the export, for Android and iOS as much as for the desktop build.
  Found because Steam never came up in a packaged game while nothing at all
  reported an error: nothing was broken, the value simply never travelled.

- **A native game had never received a key press — on any platform.**
  `NativeInputListener.onKeyDown` was declared optional, and `es_onNativeKey`, the
  entry point that would have fed it, was never written at all. So a keyboard on
  Android, on iOS and on the desktop host reached the game as nothing, with
  nothing reported: being optional is exactly how the missing half stayed
  invisible, and the handler is now required.

- **A settings list with something in it took the editor down.** Any list of rows
  in the settings window — the achievement ids, the screen presets — re-rendered
  without bound the moment it was not empty, until React tore the whole editor
  tree away (`#185`). One value was read on behalf of every setting type with a
  shallow compare, and a list of rows hands back fresh objects on every read, so
  its snapshot was never equal to itself. It had never been seen because no such
  list had ever *had* a row in it: adding one was impossible (below), and an empty
  list does compare equal.

- **Adding a row to a settings list did nothing.** A new row is blank, and a store
  may normalize a blank row away — an achievement id nothing could match is
  dropped on the way in and again on the way out — so the row was written straight
  through and never came back. The row a list's own validation rejects now waits
  in the control until it is real, and the store only ever sees rows it keeps.

- **A file path field covered its own label.** The control stated a fixed 300px
  width, which overflows *leftward* wherever the column is narrower than that —
  over the label naming it. It fills the column it is in, and carries the full
  path as its tooltip.

- **A tall group in the Package Project dialog was clipped instead of scrolling.**
  Its column let children shrink and then clipped the overflow, so a group taller
  than the space left simply ended mid-row with nothing to scroll to.

- **A packaged desktop game could not be typed into.** The platform seam hands a
  text field's value and caret to an OS editing surface — a UITextView, an
  EditText, a hidden textarea — and desktop has none, so every field rendered and
  swallowed every keystroke. The host is now that surface: a text model that
  holds UTF-16 (the unit the seam's selection indices are in), converts only
  where the value crosses into JS, and counts in characters rather than code
  units, so a name entry containing an emoji backspaces once and not twice.
  Committed text and IME preedit come from SDL; the caret, the selection, word
  movement, clipboard and Enter/Escape are the model's. Keys still reach the game
  as well as the field, which is what a browser does and what keeps play == ship.

- **The Steam checklist the export writes was never mentioned in the editor.**
  `STEAM.md` carries the values only the Steamworks backend can be told — the
  depot ids, the launch string, the Auto-Cloud paths, the achievement ids to
  create — and the Package dialog finished a Steam build by telling you to
  double-click the app. It now says what is beside it and offers to open it.

- **A desktop export reported writing a host page it never wrote.** The phase
  fired for every target; a native one has no browser to boot the game and writes
  no page. A progress line is a report of work, and one that reports work nothing
  did is read while looking for what actually happened.

- **A Windows game shipped with the default executable icon.** The assembler
  wrote the macOS `.icns` and had nothing for the PE, so every Windows build
  carried whatever icon the runtime template's executable happened to have. The
  icon is now written into the executable in pure Node — `rcedit` is a
  Windows-only binary and the assembler has to run on any OS, the same reason the
  APK's binary XML and the `.icns` are written here. The resource tree is rebuilt
  and appended as a new section rather than grown in place (`.rsrc` is not the
  last section an MSVC link emits), and everything the executable already held —
  the manifest that makes it DPI-aware among it — is carried across.

- **Every packaged desktop game opened 1280x720.** The window ignored the
  project's design resolution — a portrait game got a landscape window — because
  the host cannot read one: the window exists before any JS does and the host
  parses no JSON. The size now crosses the seam once, through the projection
  every other setting already travels, and the window is created hidden and shown
  when a frame has been drawn on it rather than sitting empty at a default size
  for the length of boot. It also raises itself when shown — a game launched from
  a shortcut that opens behind the window it was launched from is one the player
  has to go find, and a store draws its overlay only over the foreground window.

- **A headless export shipped every project setting at its default.** The script
  that packages a project without the editor — the one CI and the render checks
  use — bundles the editor's own manifest parser precisely so it cannot drift,
  then built the runtime config by not building one: no physics config, no theme,
  no declared achievements, and the wrong design resolution.

- **The Steam overlay did not pause the game.** It opens over a running game
  without changing anything a host can observe — the window keeps its focus and
  stays visible — so nothing fired and the player kept taking damage while
  looking at their friends list. It now runs the same ceremony a fullscreen ad
  does, and that ceremony became ref-counted in the process: opening the overlay
  *during* an interstitial and closing it must not resume a game the ad is still
  covering. Verified against a live Steam client, with the packaged game launched
  from a library: the overlay reports itself enabled and the callback arrives with
  the flag set.

- **A macOS game could never have reached Steam.** The host loaded the
  redistributable by its leaf name, and `dlopen` does not search the executable's
  directory — it takes a leaf through the system paths and answers "no such file"
  for a library sitting right next to the binary. The difference only shows once
  the app is packaged: running the binary out of its build tree happens to work,
  and a player double-clicking a `.app` does not. The platform now says where its
  own libraries are and the loader is given a path, which it also names when it
  fails, because "there is none" and "there is one and I looked elsewhere" read
  identically otherwise.

- **A Steam depot named an OS the build had not produced.** The desktop export
  assembled for the machine's own OS and then wrote the depot script with macOS
  hardcoded, so on Windows it mapped `<Name>.app/*` against a build that had
  produced `<Name>/` — matching nothing, uploading an empty depot, reporting
  success, and telling you to launch a bundle that does not exist. Depots now
  follow what was actually assembled, and the default depot ids are a per-OS
  table rather than a position in the build, so adding a second platform cannot
  renumber a depot a project already uploaded to.

- **A packaged desktop app weighed nothing, and everything twice.** The size
  report treated the app as a file, and `stat` on a directory answers a few dozen
  bytes of bookkeeping — so the deliverable passed every limit while its contents
  were counted a second time as loose files beside it.

- **A collider switched off was still solid.** Every collider carries an `enabled`
  flag — authored in the inspector, serialized, documented as "disable the shape"
  — that nothing read. The shape attach re-added each present collider
  unconditionally, so a platform turned off still blocked bodies and still stopped
  the character controller's mover, which finds its planes in the same Box2D
  world. A disabled collider is now equivalent to an absent one everywhere: no
  shape, no cast shape, no debug outline. The editor gizmo keeps drawing them,
  because that is where their geometry is authored. Data written before the field
  existed has no `enabled` at all, so only an explicit `false` switches a shape
  off.

- **Every scene opened in the editor added texture references and dropped none.**
  The editor called no release anywhere: opening a scene acquires a reference to
  each asset it uses, opening the next one acquires more, and the count on a
  shared texture only ever climbed. Its refcount never returned to zero, so the
  C++ pool could never evict it — the texture budget stopped meaning anything an
  hour into authoring. The instrument had to be fixed before the bug could be
  seen: the census reported `asset.refCounts`, which counts *keys*, so two scenes
  sharing two textures read a flat 2 while the references on them ran away.
  Opening a scene now hands back what the outgoing document held first, so an
  asset both scenes use is revived from the warm pool rather than refetched.

- **A packaged game's scene unload released no assets at all.** A shipped game
  registers its scenes with no `data` on the config — the bytes arrive inside
  `setup()` — and the scene manager's asset discovery was gated on having that
  data, so for every scene in a packaged build it never ran. Nothing was recorded
  and nothing was given back: each switch leaked its whole asset set, textures
  included. The editor's play realm hands the manager the scene data, so the one
  place this could be seen was the one place nobody ships from.

- **Four asset types were preloaded on every scene load and never released.**
  `SceneInstance` carried seven hard-coded buckets, and four types have joined the
  scene vocabulary since: tileset, statemachine, behaviortree, animatorcontroller.
  All four were loaded, each taking a reference, and unload had no bucket to give
  them back from — so every scene using a tileset, an FSM, a behaviour tree or an
  animator controller leaked one reference per load, for the life of the process.
  Switch between two such scenes and they pile up. The list is gone rather than
  extended by four: unload now walks whatever discovery reported, through the
  loader registry.

- **`releaseGroup` dropped fonts on the floor.** `loadGroup` handled `font` and
  `bitmap-font`; `releaseGroup` listed only `bitmap-font`, so every asset group
  carrying an outline font kept its reference for the life of the process. The two
  also addressed the asset differently — load honoured a remote group's CDN root,
  release did not — and releasing a key nobody holds is a leak that looks exactly
  like a working release. How a type is acquired and how it is given back are now
  declared side by side, and a loader with no release has to say so.

- **A hot reload stranded one texture, and one reference, every time.**
  `invalidate()` mints a new generation while the previous one still has holders,
  and the ledger had one slot per cache key — so their release was attributed to
  the replacement, and the texture they were actually handed had nobody left able
  to free it. The same shape hit all seven generic asset kinds: a superseded
  generation is out of the cache while its holders still owe a release, and an
  early return left their asset unreachable with `unload` never called.

- **`loadAdditive` left a slept or paused scene permanently dark.** It set
  `status = 'running'` and returned, so those entities kept their `Disabled`
  component, their renderables stayed switched off, and `wake()` — which requires
  status `sleeping` — became a permanent no-op with nothing able to bring them
  back. The comment explaining exactly this hazard sat above the branch that had
  it right.

## [0.46.0] - 2026-08-07

### Added

- **A camera renders a set of sorting layers, and a UI canvas belongs to one.**
  Every camera drew the whole scene, so a minimap or a split-screen view redrew
  the HUD inside its own viewport with no way to say otherwise. `Camera.cullingMask`
  selects layers — bit *i* is sorting layer *i*, all bits set by default, so an
  unconfigured camera draws exactly what it drew before. UI could not be addressed
  that way, because a UI element's `layer` is its position in the tree rather than
  a membership; `Canvas.layer` supplies the membership that field never carried —
  an ordinary sorting layer that changes no draw order and exists so a camera can
  include or exclude that canvas.

- **A UI root with no transform parent now follows the camera.** The layout box was
  computed with a position and consumed without one, so an unparented root — the
  ordinary HUD — sat at the world origin forever: move the camera and the HUD
  stayed behind, with nothing in the engine able to make it follow. A root with no
  transform parent is a screen root and the box's centre places it. Parenting a
  root opts out and pins that UI to a thing in the world, the same distinction CSS
  draws between a fixed box and one positioned by an ancestor.

- **A prefab can be created empty, not only extracted from an entity.** A prefab
  had to be born from an entity that already existed — build it in the scene, then
  Create Prefab. Starting from the asset (new prefab, opened, built up in Prefab
  Mode) had no door, which is how most people reach for one.

- **The built-in agent takes a list of providers, each declaring what it accepts.**
  There was exactly one custom provider, spelled out as four global settings and a
  key — so an endpoint could say where it is and nothing about what it accepts or
  how many of it there are. Providers are a list now, and a settings table row can
  hold a choice, a switch and a credential rather than only text and numbers,
  which is what forced records to be flattened into fixed global fields before.

- **Per-component inspector UI is contributed through the registry.** Fifteen of
  the editor's sixteen contribution registries already take built-ins under owner
  `core`, so built-ins and plugins read through one door. The inspector was the
  sixteenth, and its built-in half was a `comp.name === …` chain written directly
  above the contributed sections — in *two* panel bodies, which had drifted apart.

- **A component says whether it draws, where it is defined.** Field metadata has
  been authored at the field for a while (`ES_PROPERTY(min=…, tooltip=…)`); the
  component itself had no such place, so anything true of a whole component was
  re-stated wherever it was needed. `ES_COMPONENT` now takes annotations too —
  `renderable=<field>` naming the bool that gates its drawing, and `transient` for
  state a scene must not save — and a project's own component declares the same
  thing as `renderableField` / `transient` in `defineComponent`'s metadata. Declare
  it and the entity's eye, `setEntityVisible` and scene sleep/wake all reach your
  component and restore it afterwards. A name that matches no bool field on the
  component fails the build rather than reading as "draws nothing".

### Changed

- **`Registry::get` on a missing component now stops instead of handing back a
  shared object.** It used to answer a miss with a `static T` reset to defaults —
  so `registry.get<Transform>(deadEntity).x = 500` moved a process-wide static
  rather than an entity, nothing crashed, and the symptom surfaced somewhere else
  entirely. `emplace`/`emplaceOrReplace`/`getOrEmplace` did the same for an invalid
  entity. All of them now fail fatally on the violated precondition, through the
  same always-on guard every other engine check uses. C++ code that reads a
  component off an entity that does not have it now stops where the mistake is
  instead of drifting — which is what the JS side always did (`world.get` throws
  "Component not found"), so the two realms answer this the same way.

- **The scene format version is an integer, and `withScratch` refuses an async
  callback.** The format version was compared with `parseFloat`, which reads
  "1.10" as 1.1 and sorts it BELOW "1.2", and reads "1.0.1" as 1 — so once the
  format reached its tenth revision, a newer file would have been read as older
  and migrated backwards. With only "1.0" ever written, nothing could have caught
  it. It is now a single integer that counts up (`version: 1`); every file written
  before this is format 1, and reading one is unchanged. `withScratch` frees its
  scratch pointers in a `finally`, so an `async` callback — which returns at its
  first `await` — resumed onto a heap where every pointer it held was already
  freed. The docs said "must be synchronous"; the type now says it, and an async
  callback is a compile error at the call site.

- **A blended draw now sorts by depth before material.** The sort key ranked
  material above depth for every stage, so within one sorting layer three
  semi-transparent sprites at different z on materials B, A, B did not necessarily
  composite far-to-near — batching outranked the ordering that produces the
  picture. Correctness comes first for the stages where order IS the result: the
  Transparent and Overlay stages now spend the key's bits on depth, then shader,
  blend, flags and material. Opaque is unchanged — its result does not depend on
  the order, so material still groups first and depth only breaks ties for early-z.
  Draws at one z (the ordinary 2D case, where the sorting layer does the work) keep
  batching exactly as before, because their depth bits are identical and material
  still decides. Blended depth also widened from 14 bits to 20 — about a 0.004 step
  near z=10 — taking the bits from material, which is only a batching hint in the
  key (`canMergeWith` compares the full handle, so a truncated one costs a merge and
  never a wrong one).

- **`world.getEntitiesWithComponents()` returns a `readonly Entity[]`.** The array
  it hands back is the query cache's own entry, not a copy — sorting or pushing to
  it reorders or corrupts what every later reader of that query sees. Nothing in
  the engine did (all sixty-odd call sites read it), and now nothing can: the type
  says so. Reading, `for..of`, `.map`, `.filter` and indexing are unaffected.

### Fixed

- **A character controller put the character at NaN from the second frame.** Press
  Play on any project with a `CharacterController` — tilemap-demo and platformer
  both — and it stayed there for the session. The physics API is built through a
  path that runs no field initializers, so the pixels-per-unit default belonged
  only to the constructor nobody used there, and `getPixelsPerUnit()` answered
  undefined until something pushed a value. The controller system runs one system
  *before* the step that does the pushing, so its first frame scaled by undefined.

- **A WebGPU buffer upload read past the end of the caller's data.** `createBuffer`
  rounded the write length up to a multiple of 4 and handed that to
  `wgpuQueueWriteBuffer`, which reads exactly the length it is given — while the
  source allocation is only the size asked for. Rounding the allocation is right;
  rounding the read is not. One triangle of `u16` indices is enough to reach it.
  `resizeBuffer` did the same.

- **An RGB8 texture upload read a third past the end of its pixels.** WebGPU has no
  RGB8 format, so such a texture is created as RGBA8 — and the backend took bytes
  per pixel from the *created* format while the caller had allocated three bytes
  per pixel. Every upload read `width*height*4` out of a `width*height*3` buffer,
  and the rows that did land were channel-shifted.

- **A new entity no longer ships the engine's computed fields as authored data.**
  The Create picker copied a component's whole default record, `readonly` fields
  included — Transform's `worldPosition`/`worldRotation`/`worldScale`, which the
  engine composes from the local transform and the parent chain every frame. They
  went into the model, the saved scene, and any prefab extracted from it, where
  they are wrong the moment the instance sits under a different parent.

- **A link out of the project passed the editor's file sandbox.** `resolveInRoot`
  rejected `..` and absolute paths, purely lexically — and a symlink inside the
  project contains neither, so the read that followed went wherever it pointed.
  Reproduced with a Windows junction, which needs no elevation. Both sides are now
  compared with links resolved, including the root itself, since a project may
  legitimately live under a symlinked path.

- **Create Prefab acted on the row under the cursor, not the selection.** Every
  other multi-selection action in that menu resolves selection-or-target;
  Create Prefab passed the bare id, so it did not refuse a multi-selection — it
  quietly answered a different question.

- **A prefab changed on disk while open is reloaded rather than overwritten.** A
  scene in that situation is reconciled — seamless when clean, discard-guarded
  when not. Prefab Mode had none of it, because the watcher asked only whether the
  path was the open *scene*.

- **Unsaved work in any open document blocks a document swap.** The editor holds
  the scene plus every open asset editor (tileset, flipbook, FSM, behaviour tree,
  material graph, timeline), each tracking its own dirt. The guard read the
  scene's history alone, though the rule it implements is written down as the
  aggregate.

- **A failing `Mut()` write-back was retried on the way out.** On the clean path
  the flush ran and then set a "completed" flag, so a throw from the flush itself
  skipped the flag and the `finally` flushed the same entity again, under the
  error the first attempt raised. A callback that throws leaves finished edits
  genuinely owed a flush; a write-back that throws has already had its turn.

- **A slowly growing frame reallocated the GPU buffers every frame.** The CPU
  staging vectors double when they run out, but the vertex/index buffers were
  resized to exactly what the frame in hand needed — so a workload creeping upward
  (2.1MB, then 2.2MB, then 2.3MB) reallocated on the GPU every single frame,
  forever, while the staging behind it grew once. The GPU capacity now follows the
  staging capacity, so there is one growth rule instead of two. Measured on a
  200-frame rising workload: 200 reallocations before, single digits after.

- **A destroyed entity's handle could come back as a live one.** An `Entity` is a
  22-bit slot index plus a 10-bit generation, and recycling a slot bumped the
  generation with a wrap: once that counter had been through its thousand values
  it returned to 1, and the slot issued an id byte-for-byte identical to one it
  had already handed out. Anything still holding the old handle then pointed at a
  different entity, and `valid()` agreed. A thousand sounds distant and is not:
  measured on the real registry, the same raw id came back after 1022 recycles —
  seventeen seconds at 60fps for anything recycling a slot once a frame, and
  proportionally sooner for a pool that churns one several times within a frame.
  A slot on its last generation is now retired rather than recycled, so a handle
  is unique for the life of the registry. The `Entity` layout is unchanged: still
  4 bytes, still a plain JS number, still fits box2d's 32-bit user data. What it
  costs is index space, spent only by the churn that would otherwise alias, and
  `Registry::retiredSlots()` reports it. Running the index space out now says so
  in the log instead of quietly returning an invalid entity.

- **Exporting a project could ship files from outside it.** The IPC door already
  refused a path that left the project through a link, but the asset scanner and
  the cook never went through that door. A file named like content with a `.meta`
  beside it was indexed no matter what it was — and a symlink is a file. So a
  scene referencing it made the cook `readFile` straight through the link and
  write whatever it found into the shipped game, with no warning. A project is not
  trusted input: it is cloned, unzipped, copied from a template, or handed over,
  and exporting one is enough to carry files off the machine that exported it. The
  scanner now refuses a link that leaves the project — as a file, as a sidecar's
  content, or as a directory to walk into — and the cook refuses one again before
  staging bytes. A link that stays inside the project still works. Only links pay
  the extra `realpath`, so scanning is unchanged for everything else.

- **An additive scene unloaded during its own `setup()` came back as a ghost.**
  `setup()` is user code and may await for as long as it likes; an `unload()`
  during it tears the scene down completely — entities, systems, assets, its slot
  in the registry. `load()` re-checked the slot afterwards and aborted, but
  `loadAdditive()` went straight on to set `running`, add to the additive set and
  push to the draw order, resurrecting a scene that no longer existed and leaving
  whatever `setup()` spawned after the teardown in the world under it, owned by
  nobody. The check now lives in `loadSceneData_`, which both paths await: it
  returns only if the load still owns the slot, so neither caller has to remember.

- **A hot reload could leave an asset loading three times, or fail the reload with
  the old file's error.** `AsyncCache.invalidate()` aborts the in-flight load and
  drops its pending record, and hot reload asks for the same key again right away,
  so a second load registers under it. When the first one then finished it deleted
  `pending[key]` without checking whose record that had become — evicting the
  second load's, so the next request found nothing pending and started a third
  load of the same asset, with its own GPU allocation. On the failure path the
  dead request also wrote the failure cooldown that `invalidate()` had just
  cleared, so callers waiting on the new bytes were rejected with the old file's
  error. A timeout leaves the same window between the deadline firing and the
  request cleaning up after itself. A finishing load now touches the shared
  records only while it is still the one the key points at. A timeout that was
  never superseded still records its cooldown.

- **`Removed()` reported despawns from before anything was watching.** Losing a
  component reaches the change tracker two ways — by definition for an explicit
  `remove()` and for builtins on despawn, by component id for script components on
  despawn — and only the first checked whether anything actually tracks that
  component. So an untracked script component recorded a removal on every despawn,
  and a `Removed(X)` query created later reported entities that had died before it
  existed, while the same query over a builtin, or over the same component removed
  explicitly, reported nothing. One "was it lost" gate now, at the single entry
  point both paths go through. The removal watermark that `anyChangedSince` reads
  is unchanged for anything tracked — UI layout still learns a `FlexContainer` is
  gone.

- **A system that threw inside `forEach` left the world iterating.** The world
  refuses `spawn`/`despawn`/`remove` while a query is being walked — those would
  resize the arrays under it — so `beginIteration` and `endIteration` have to
  balance no matter how the walk ends. `forEach` called them around a bare loop
  with no `try`/`finally`, so a callback that threw skipped the decrement and the
  world believed it was iterating from then on. The failure does not appear where
  it happened: the callback's error gets logged somewhere, and the next unrelated
  `world.spawn()` fails with "Cannot spawn entity during query iteration". The
  system runner resets the depth at each system boundary, which limits this to the
  rest of that system and does nothing for a `forEach` outside one (an editor
  tool, a script holding the World). The iterator had the same hole in `next()`:
  `for..of` closes an iterator whose BODY throws, but not one whose `next()` does.
  Both close now, and a write-back that fails while an error is already on its way
  out no longer replaces it — the callback's error is the one worth reading.

- **Asking a query a question gave a different answer than iterating it.**
  `Added()`/`Changed()` are per-entity tick checks applied while iterating, not
  part of the entity set the query cache returns — and `count()` read that set
  directly. `Query(Changed(Position)).count()` therefore reported every entity
  that has a Position, while `[...Query(Changed(Position))].length` reported the
  ones that actually changed; a system deciding whether to run by `count()` ran
  every frame. `isEmpty()` had the mirror-image problem: it ran the iterator, and
  one step of a `Mut()` query writes that entity back and records a `Changed` tick
  for it — so asking whether a query was empty marked an entity as changed and
  fed a false positive to the next frame's `Changed()`. `single()` also handed
  back the iterator's shared row buffer, so holding one watched it get overwritten
  by the next call. Four places answered "which entities match" and now one does.

- **`registry.eachLive<A, B>` did not compile.** `Registry::each`/`eachLive` are
  variadic, so both read as available at any arity — but `eachLive` existed only on
  the single-component `View<T>`, and the multi-component `View<Components...>` had
  only `each`, which copies the whole dense entity array on every call so the
  callback may add or remove components. Nothing in the engine iterates several
  components through a callback (every hot path uses range-for, already live), so
  the combination was never instantiated and never failed to build — until a game's
  own C++ system asked for it. `View<Components...>` now has `eachLive` with the
  same contract as the single-component one, and a per-frame `Transform + Velocity`
  pass over 5000 entities costs 1.33× less than `each` with no per-frame allocation
  at all. `View<T>` also gained the `sizeHint()` and `getAll()` its multi-component
  sibling already had, so a template can iterate a view without knowing its arity.

- **The Registry's own example did not compile.** `for (auto [entity, pos, vel] :
  registry.view<Position, Velocity>().each())` was in the class docs and again on
  `view()`: `each()` takes a callback and returns void, so nothing about that line
  is valid. A new harness instantiates every arity × entry point × callback shape
  of the view API, which is what would have caught both this and `eachLive` — a
  template API is only checked where something calls it.

- **A slept scene kept drawing its characters, and hiding an entity still missed
  renderers.** 0.45.0 unified two of the three lists that answer "what draws
  here"; the editor's eye derived a different thirteen, and neither runtime list
  knew about a mesh, a trail, a DragonBones armature, a tilemap layer, a `Text` or
  a light — which is why a slept scene kept drawing its characters and kept
  lighting the level. Each component now declares what gates its drawing (see
  Added), so all three lists read one answer instead of three, and a tilemap layer
  is switched through its own `visible` field rather than an `enabled` it does not
  have.

## [0.45.0] - 2026-08-07

### Added

- **The built-in agent speaks OpenAI's protocol, not only Anthropic's.** Chat
  Completions is what OpenAI serves and what almost everything else implements —
  the other vendors, the aggregators, and every local runner (Ollama, vLLM, LM
  Studio). It is a second provider rather than a third dialect of the first: tool
  calls arrive as a field on the assistant message with their arguments as a
  string, each result goes back as its own message, and the stream is untyped
  deltas stitched by index. The Custom Provider gained a **protocol** picker;
  OpenAI ships as a provider with its address and protocol but not its model
  names, which you type — a list shipped in the editor would be right until the
  vendor's next release, and a name that no longer exists is not refused, it is
  quietly served by something smaller for the rest of the session.

- **The running world's Outliner folds, filters, and hides.** In Play, the Game
  tree was every row forced open with no twist, no search and no eye — a world of
  a few thousand entities arrived fully flattened. Rows start collapsed, the
  header carries a search box and expand/collapse-all, and the eye turns a live
  entity off to find out what it was. A UI node hides through `display`, so one
  click takes a whole HUD with it; a row with nothing of its own to hide gets no
  eye rather than one that does nothing.

- **`step` advances the game that is running, not the world that isn't.** A driver
  could press Play and then not observe the game at all: the realm runs on the
  browser's rAF clock, throttled to roughly a frame a second whenever the editor
  window is not focused — which it never is, for anything driving the editor from
  outside — so two reads a second apart came back identical and a healthy game read
  as a frozen one. `step` existed and advanced the EDIT World, the one the play
  realm's scripts are NOT in, silently; `play_input`'s own description told callers
  to use it for exactly the thing it could not do. It now advances whatever is
  running and says which. Underneath, `App.stepFrames(frames, dt)`: the loop held
  off, N frames of exactly `dt`, the pause and the clock restored after — a paused
  app still steps, because that is what stepping a paused game means. The probe
  surface gains `get`, `set` and `setResource` beside it, the three every probe was
  hand-rolling — `set` goes through insert, because what `get` returns is a copy for
  several component kinds and assigning to it moves nothing.

- **A screenshot a model without vision can read.** Half the endpoints an editor
  gets pointed at cannot receive an image, and the agent kernel used to tell such a
  model not to spend a call on a picture and to read its fields back instead. Fields
  cannot answer the question: a dogfood run on such an endpoint wrote a Breakout,
  read every value back exactly as it should be, and delivered a game that is GAME
  OVER within half a second. `screenshot` now takes `format: 'grid'` and answers with
  the same picture as text — a coarse colour grid cropped to the running game or the
  edit viewport, one letter per cell from a fixed 16-colour palette so the letters
  mean the same thing in every reply. Each cell reports its most unusual pixel rather
  than an average, because averaging is what makes a bullet, a thin sprite or a line
  of text vanish into its cell: an early version read a screen with a row of aliens
  across the top of it as blank.

- **An asset can be deleted by name, not by whatever is selected.** There was no tool
  for it, so an agent asked to remove a shader it had just written by mistake reached
  for the editor command behind the Content Browser's Delete — which acts on the
  selection in a panel it cannot see, and would have deleted something else entirely.
  `delete_asset` takes the path, sends the file and its `.meta` to the OS trash,
  re-scans, and answers with the asset's USAGES: a non-empty list means it just left
  those refs dangling. Trash and rescan now live in one module both doors call,
  because skipping the rescan leaves every `@uuid:` ref resolving out of a stale
  index — the file gone and the editor still believing in it.

- **An open asset document can be saved, and opening one waits for it.** The eight
  asset editors could be listed, read and written from outside — and then not saved.
  The only reachable save was `project.save`, which is context-aware by design: it
  writes whichever dock panel the user last clicked, so an edit to a material graph
  landed in the scene file, or nowhere. `save_asset_document` names the document and
  goes through the same registered save the panel's own button runs, which matters
  because for half these types the file is not a JSON dump — a tileset and a timeline
  have their own serializers, and a material graph COMPILES the sibling `.esshader`
  every material on it reads. `open_asset` now awaits the open; most openers read the
  file before they have a document, so it used to return while the read was in flight
  and the very next call could be told nothing was open.

- **A prefab instance can be named as it is created.** Ten instances of one prefab
  arrived as ten entities called what the prefab is called — a tree nobody can read,
  and to a driver ten entities it cannot tell apart, a name being the only handle it
  has on an entity it did not just make. Renaming afterwards always worked, so the
  only thing missing was saying it at birth, which is where it belongs: a rename
  after the fact is a second undo step. `create_entity` takes `name` and it lands in
  the same undo record as an ordinary name override.

- **Every component header links to what its fields mean.** You are looking at a
  RigidBody in the Details panel and you want to know what `gravityScale` does; every
  route to that answer went through knowing that physics is the guide to open. Each
  component header now carries a help affordance beside its options menu, opening
  that component's entry in the new reference. The address is generated from the same
  curated data the reference pages render, so the header and the page cannot disagree
  about where a component is documented, and it is absent for a project's own
  script-defined components, which the manual cannot document.

### Changed

- **The play probe's `find()` is a list, and an unknown name throws.** Every driver
  writes `find('Ball').length` and `[0]` first — the reading a list invites — and
  then spent three or four calls discovering a wrapper object. It is an array now,
  with `total` and `truncatedAt` hung off it. The unknown-name case stops being a
  shape: `{ error }` returned from a lookup is read by a caller that does not check
  as "nothing has that component", which is also what a typo in the name produces —
  the same answer for "none of them" and "no such thing". It throws, listing what IS
  registered. The surface itself is destructured into the probe's scope, so the
  `find(...)` its own description shows is what works.

- **`lookup_symbol` takes a list of names**, keyed by name in the reply. Learning an
  unfamiliar API is a dozen symbols, and that was a dozen round trips — 32 of one
  dogfood run's calls, before a line was written.

- **`agent_status` reports how the last turn ended.** Phase returning to idle says a
  turn stopped, not that it finished — a run cut off at the round cap idles exactly
  like one that answered the question. The drawer has shown the difference all along
  (a badge, and a Resume button); a driver polling status could not, and read half a
  game as a delivered one.

- **The agent brief says where the world's origin is, how a look is made, and what
  testing a game means.** A Space Invaders built from an empty project came out with
  its whole HUD 280 units above the top of the screen and the agent reporting it
  done, because the design resolution is 800x600 and nothing anywhere said the
  world's origin is the CENTRE of that box; the per-turn context now prints the
  actual visible range for the project's own resolution. The brief taught scenes, UI,
  scripts and input and said nothing about materials, shaders or meshes — so asked
  for a dissolve, the agent wrote a system that fades a tint, that being the only
  surface it had been told exists. And "look at it before calling it done" was too
  abstract to act on: a Breakout run spent 158 calls, 75 of them reading component
  data, took zero screenshots, and stopped with the ball spawning above the paddle
  heading down. The loop is now named — toggle_play, step, play_input, play_probe,
  screenshot — along with `Res(Prefabs)` for what a running game spawns, the second
  argument to `defineResource` (without it a resource answers to `Resource_49_`, a
  number that lands somewhere else next load), and the fixed spellings the injected
  2D fragment stage hands you.

### Fixed

- **`setEntityVisible` knew three renderers; the scene manager knew six.** Two
  lists answered the same question and disagreed, so calling this public API on a
  Spine armature, a particle system or a UI element silently did nothing at all.
  One list now, and a UI node hides through `display` — which the layout pass
  resolves down the tree, because hiding a panel has to hide what is inside it.

- **Deleting assets no longer re-reads the whole project once per file.** On a
  project with 36k assets, selecting a folder's worth and pressing Delete took 52
  seconds to show the confirm dialog for 22 files, and never came back for more.
  The dialog asked what references each asset one asset at a time, each answer a
  fresh disk walk; and the *incremental* re-scan recomputed the entire dependency
  graph anyway, because a removal changes the entry set and that was treated as
  "resolution changed". It is not: dropping an entry can only delete edges
  pointing at it. One scan for the batch, and only the documents that referenced
  something removed are re-read. Those 22 files now take 2.2 seconds.

- **The Content Browser no longer mounts a tile per file in the folder.** A folder
  of 788 sprites built 788 tiles and decoded 788 full-size images — 26 megapixels
  resident for the twenty on screen. Both views are windowed now, over the same
  scroll-window implementation the Outliner uses.

- **Stopping the agent mid-run no longer breaks the conversation** on endpoints
  that require every tool call to be answered.

- **Leaving Play no longer strands the Outliner and Details on the running world.**
  Stop takes the world picker away, so a choice that outlived the realm left both
  panels showing a world that no longer exists, with nothing on screen able to
  switch them back.

- **`prefabEntityId: '0'` is refused rather than dropped in silence**, and the
  sample code that still taught it was fixed. `'0'` is the id every prefab had
  before stable ids; a prefab saved by the editor since has a UUID, so an override
  carrying `'0'` aimed at nobody — every instance spawned at the position the
  prefab was authored with, and nothing said why. An override with no
  `prefabEntityId` now means the root, which is the entity a one-sprite prefab has.
  At the runtime spawn door an id the prefab does not have now throws, naming the
  root and the ids that do exist; the editor's own instance path keeps the old
  behaviour, an override left over from a since-deleted child being normal there.

- **Two files can no longer be the same asset.** Reported as a rendering bug: an
  image dragged from the Content Browser into the scene draws something OTHER than
  the picture the browser previews. It is not the renderer. A `.meta`'s uuid is the
  identity every stored reference is written against, and nothing checked that two
  of them were not the same — the registry being a uuid→path map, a shared uuid
  keeps one winner, the losing file is in no registry at all, and every reference to
  that uuid resolves to the winner. The drag reads the right uuid and the preview
  reads the path it selected, which is exactly why the two disagree and why the last
  place anyone looks is the sidecar. Duplicates arrive in bulk — a folder copied in
  with its sidecars, a script that stamped one uuid into every meta it wrote — which
  is how one project reached hundreds of them. The scan now gives each file its own
  identity back: first in path order keeps the uuid (deterministic, so a re-scan does
  not shuffle identities and existing refs still resolve) and the rest are re-minted
  on disk and reported.

- **A physics wasm older than the code that drives it says so once, not every
  frame.** Put a RigidBody in a scene, press Play, and both physics systems threw
  `_physics_capturePoses is not a function` twice a frame for the length of the
  session; two dogfood runs read that as "physics is broken" and turned physics off
  to get on with the game. The module was real — 117 `_physics_*` exports — and
  missing exactly the three the pose-interpolation commit added on the same day the
  binary was built. `PhysicsWasmModule` is a TypeScript interface, so it is gone at
  run time and nothing checked that the binary answered to it: a wasm built an hour
  before the JS that calls it installed as happily as a current one. The plugin now
  checks the frame loop's contract as the module loads and marks the subsystem in
  error if any of it is missing — the game runs WITHOUT physics and says why once,
  naming the missing exports and that the WASM build is a separate step.

- **A material parameter the shader never declared says so.**
  `Material.setUniform(m, 'u_amount', x)` against a shader whose slider is
  `u_progress` succeeded: the value was stored, the engine dropped it — MaterialStore
  keys the std140 layout by the reflected name, so a value under any other name has
  nowhere to land — and the effect never happened. What that looks like from outside
  is a broken shader, and spelling is the last thing anyone checks; a dogfood run
  lost most of an hour to it, then reported the work as done. The `#pragma param`
  parser behind the Material inspector moves to the SDK, and setUniform (and create,
  so a `.esmaterial`'s own `properties` are checked as it loads) warns once per
  shader+name, naming what the shader DOES declare. The built-in templates now derive
  their material defaults from their own source too — five of the seven carried
  `defaults: {}` while their shader declared four parameters, so a material made from
  Dissolve came out empty and the word `u_progress` appeared nowhere a caller could
  find it.

- **A dimension written by value gets a pixel unit, because Auto ignores the value.**
  `UINode.insetTop.value = 40` stored the 40 and moved nothing: every dimension field
  defaults to `unit: Auto`, and Auto means exactly "ignore the value", so the write
  was accepted, the field read back 40, and the layout placed the node as if nothing
  had been said. Measured on a dogfood HUD — three labels with insets of 8, 40 and
  260, all three resolving to the same world position, drawn on top of each other.
  Writing `unit` yourself still wins, in either order. The inspector's own control
  always did this; it was the automation door that left the unit behind.

- **`toggle_play` waits for the realm and answers with its state.** It returned the
  state from BEFORE the toggle, and entering play boots a separate realm
  asynchronously — so a driver that started a game was told `playing: false`, and one
  that stopped it was told `playing: true`, which is worse than saying nothing. It
  now resolves when the realm is ready (or gone), and answers with a boot error as
  state rather than hanging on a realm that never comes up.

- **`create_tilemap` answers with the entity it made, or says it made none.** Its own
  description promised the new entity id and it returned `ok`, because the underlying
  UI flow returns void. The two ways it can make nothing were worse: an untracked
  `.estileset`, or one that will not parse, pushed a toast and returned — right for a
  person watching the screen, no answer at all for a caller that is not one, so the
  headless door reported success for a tilemap that does not exist.

- **`open_scene` says so when nothing opened.** The editor can end a session with its
  project half out from under it — the file doors still answer, the asset registry is
  empty, no document is open — and every read then reports the shape of an empty
  project rather than a broken one: `get_scene_tree` gives `[]`, `list_assets` gives
  0, and `open_scene` on a scene file plainly there on disk answers `ok`. One dogfood
  run spent twenty calls looking for entities it could see in the file before
  concluding the path must be wrong. The underlying half-unloaded state is not
  reproduced yet; an answer that lies is worse than the fault underneath it, because
  it hides it.

- **A dropped connection costs the round, not the turn.** Two dogfood runs in three
  ended mid-build on `Could not reach the endpoint: terminated` — the model gateway
  closing a stream partway through, eighty-odd rounds of work on the floor. Retrying
  is safe for a reason worth stating: the provider appends the assistant message to
  the conversation only once the stream completes, so a stream that died left the
  session exactly as it found it. A round whose CONNECTION failed is now retried
  twice with backoff; a refusal, a bad request or a rejected key still end the turn
  at once, since asking those again only spends money.

- **`search_project_files` can see the SDK types, and a tool names its arguments.**
  The search walked content only, and `.esengine/sdk` is a dot directory — so the
  tool whose whole reason for existing is "nobody should page a 50k-line `.d.ts` a
  hundred lines at a time" was blind to that `.d.ts`. Searches for `SystemParam`,
  `defineSystem`, `interface PrefabOverride` all answered `[]`, which reads as "no
  such thing". `lookup_symbol` answered a class with the first 800 characters of its
  declaration, which for any real class is its private field block — `AudioAPI` came
  back as a dozen `private readonly`s, so "how do I play a sound" was unanswerable
  from the tool that exists to answer it; a class or interface now answers with its
  public members. And an argument no tool declared was dropped in silence:
  `write_project_file` given an `offset` — which `read_project_file` really does take
  — replied `{ok: true}` to what the caller believed was an append, having overwritten
  four hundred lines with the fragment. Unknown arguments are refused now, naming the
  ones that exist.

- **A symbol list written as text is still a symbol list.** `lookup_symbol` takes one
  name or an array, and a caller that means the array sometimes sends it as text:
  `'["Time"]'`. Taken literally that is a symbol named `["Time"]`, which nothing is,
  so the reply was an empty list — which reads as "no such symbol" and sends the
  asker off to page the `.d.ts` instead.

- **`create_asset` can name a material graph.** `.esmatgraph` was typed in exactly
  one place, the Content Browser's own table, and never in the SHARED meta table that
  `create_asset` inverts to turn a type into an extension — so asking for one
  answered "unknown asset type materialgraph". The same absence meant the scan, which
  types orphans by name, walked past a graph written by any other hand and left it
  unregistered.

- **Quitting one editor no longer retracts another's advertisement.** The MCP
  discovery file is one path per user, so two editors both write it and the second
  wins — and an unconditional delete on quit meant the editor that closed took the
  SURVIVING editor's entry with it, after which `--attach` reports "no running
  editor" while one sits there serving. It names its writer now, and asks before
  removing it.

### Documentation

- **The sidebar is a table of contents, not a listing of every page.** The rail
  rendered all 62 guide links at once with nothing collapsed, sixteen of them under
  one "Content & Flow" drawer holding content authoring, runtime services, five
  shipping targets and the editor's extension points — so nobody looking to ship an
  Android build would think to open it. And a page's URL said nothing about where it
  sat: 51 of 58 pages were `/docs/guides/<x>/` no matter which group displayed them.
  The groups are now the task a reader came to do, every page moved into the
  directory its group names, and the rail shows about 20 rows where it showed 69. Old
  addresses keep working through an append-only redirect table. One sidebar entry was
  already dead in both locales and is fixed here: the C++ API link, which Starlight
  prepended both the base and the active locale to.

- **One structural rule, and a gate that holds it.** The restructure ended with two
  shapes for the same thing — a directory chapter (`editor/viewport`) and hyphenated
  siblings (`gameplay/ai-perception`), the second being exactly the "a URL tells you
  nothing about where the page sits" the restructure set out to fix. It was a
  constraint rather than a choice: an image written as `../../../assets/…` encodes how
  deep its page sits, so a page could not change directory level without every
  picture on it going dark. `@/` is now an alias for src and all 136 image references
  go through it, so depth is free and the rule collapses to one line — a page's
  directory path is its sidebar path is its URL. `verify-doc-structure.mjs` fails on a
  page in no sidebar group, a sidebar entry with no page, a group page not labelled
  Overview, and **a page that exists in only one language**, which had no check at all:
  a missing translation just served English.

- **A component reference, derived from the registry the inspector reads.** The manual
  is task-shaped, which answers "how do I do X" and answers nothing when the question
  came from the Details panel. The reference lists all 77 registered components across
  seven pages with their fields, types and authoring defaults, none of it written down
  twice: `getComponentRegistry()` already holds it, merged C++ ctor values with the
  `editor_default=` overrides applied, so the default shown is the value you get when
  you add the component. That is the same registry the Details panel renders, so the
  reference cannot drift from the inspector, and `--check` runs in `pnpm run verify`.
  Anchors are not hand-derivable — "Bodies & colliders" is `bodies--colliders`, with
  two hyphens — so the link checker now resolves fragments as well as paths, against
  the ids the build actually emitted.

- **Two manual chapters were hiding behind one sidebar link each.** `editor/overview`
  was 3792 words across seventeen sections, and the AI guide put perception,
  navigation, state machines, behavior trees, the blackboard and the editor workflow
  into 3672 words behind one link — "how do I build a nav grid" and "what does a
  decorator do" were the same destination. Seven siblings each; both overviews keep
  their URL and the genuinely shared piece. Keyboard shortcuts is a lookup table and
  is now a page you can land on. The other long guides stay whole: particles,
  tilemaps, sprites, physics and lists are each one deep topic where a long page is
  the right shape — these two were containers.

- **The first behaviour example taught a write that does nothing.**
  `ctx.get(Transform).position.x += ctx.self.speed * dt` was the opening code of the
  Scripting guide, repeated in the PlayerController example and used as the
  `@example` on `defineBehavior` itself, and the entity does not move. `ctx.get`
  reaches `world.get`, and for a C++-backed component that returns a fresh object
  decoded out of the heap, so mutating it changes a value nobody keeps — while a
  script component hands back the stored object, which is why the neighbouring
  `ctx.self.facing = move` on the very next line does persist. Same call, two
  behaviours, and nothing said so. Measured rather than reasoned about: the taught
  form finished at x = 0 after sixty frames; read → mutate → `ctx.set` finished at
  exactly +100 for a speed of 100. `Query(Mut(Transform))`, what Quick Start teaches,
  was never affected.

- **Quick Start ended before anything was playable.** 258 words that added an entity,
  pasted a system, and stopped at "the sprite moves" — with no sprite to move, since
  Blank ships no art, and with the `Speed`-component-plus-`addSystem` ceremony in
  front of a reader who has not met either idea. It is now a run: Blank, Create →
  Shape, one `defineBehavior` in the declaration entry the template already has, Add
  Component, F5, arrow keys. Every step was executed in a real Blank project before it
  was written.

- **Name, Disabled and RuntimeOnly were documented nowhere.** They belong to no
  subsystem, so no subsystem guide had a reason to claim them, and they are exactly
  the ones a reader meets early: `Name` is what the Outliner shows, `Disabled` is what
  the active flag really is, `RuntimeOnly` is why a tilemap's layer entities are not
  in the saved scene. Core Concepts → Components has a section for them now. One
  correction fell out of writing it: the Outliner's eye is not `Disabled` — it is an
  edit-time visibility fold that never touches the tag.

- **The Chinese text page still said inline images do not render.** They do; the
  feature shipped with the text-subsystem work and the English page grew a section for
  it, while the translation kept the note that predated it and told a Chinese reader
  to place the icon beside the text with flexbox instead.

## [0.44.0] - 2026-08-05

### Added

- **The editor asks the TypeScript compiler about your project, and so can the
  agent.** The open project gets a language service (TypeScript's own, in the
  editor process — no separate server), and three doors onto it: writing a `.ts`
  file now **answers with that file's type errors**, `check_scripts` asks for them
  at any time, and `lookup_symbol` gives a name's real signature, its doc comment
  and where it is declared. `search_project_files` finds a line anywhere in the
  project. Between them they replace the two things an agent had before: entering
  play to find out whether its code compiled, and paging a 50 000-line `.d.ts` a
  hundred lines at a time to learn one method name — which cost most of a context
  window per API. A dogfood run that built a game spent 17 lookups and stayed
  under 20k of context where the previous one passed 70k without writing a line.

- **A probe can ask the running game what it thinks is going on.** `play_probe`
  gains `find(NAME)` — every entity carrying a component, with its live data —
  and `resource(NAME)` for the state that belongs to no entity (a score, a phase);
  `componentNames()` lists what may be asked for. Before them the realm published
  only `app` and `getComponent`, and `world.get` needs an entity id there was no
  way to obtain — worse, it returns a ZEROED object for an entity that lacks the
  component, so counting up from zero does not fail, it lies. Everyone who tried
  ended up reading private fields off the App.

- **A sorting layer can resolve by depth instead of paint order — 2.5D.** Check a
  layer under Project Settings → Rendering → Depth-sorted layers and what covers
  what is decided by the depth buffer, from each entity's `Transform` z; with a
  perspective camera, sprites at different depths occlude each other correctly
  from any angle with no sort order to maintain by hand. Depth belongs to the
  LAYER because half a layer sorted by depth and half by paint order is not a
  thing that can be rendered — there is no single sequence satisfying both — and
  a layer already works this way for y-sort. Inside such a layer the stage and
  depth state are derived, not declared: an opaque draw (blend mode `None`, new)
  writes depth and sorts front-to-back so early-z pays off, a blended one only
  tests and stays back-to-front, because a translucent draw that wrote depth is
  exactly how sprites clip each other into black edges. Y-sort and depth are one
  answer resolved in one place — y-sort IS a depth projected from world Y, so a
  layer claiming both keeps y-sorting. The scene target grows a depth attachment
  only when some layer asks for one. Default off: a project with no depth layer
  renders exactly as it did, to the pixel.

- **The editor viewport has a perspective eye.** The scene toolbar's 2D / 3D
  button switches the editor's own projection, which is the only way to look at
  2.5D content while authoring it. It keeps its own projection rather than
  following the scene camera — an orthographic view of a perspective scene is a
  working mode, not a mismatch — and zoom moves the camera there instead of
  widening a box, since changing the fov would alter the projection being
  previewed. Picking and dragging follow onto the plane each entity actually sits
  on, so a sprite at z = -400 is grabbable where it is drawn.

- **`describe_component` and `create_script`.** A component's fields could only
  be learned by creating an entity and inspecting it, and "what components
  exist?" had no door at all — so a driver guessed at both, a round trip per
  guess. And a script could only be written as a raw file, which nothing
  imports; `create_script` is the New Script dialog's scaffolder, wiring
  included, which is what makes a component addable and a system run.

- **The built-in agent can be driven.** Four driver-only tools — send, status,
  confirm, transcript — so a harness can run the editor's own agent against a
  real task and watch what it hits. Every fix above came out of the first three
  runs. They stay out of the agent's own tool list: an agent handed a tool that
  messages the agent is a loop with a bill attached.

- **The editor's authoring surface is gated.** The engine has had a pixel gate
  for a long time; every check that opens the real EDITOR was a script somebody
  ran once, on the machine that wrote it — which is how depth layers shipped
  reaching the play realm and neither the viewport nor a build. `verify:editor`
  runs them all (each in its own editor), CI runs it alongside the MCP
  end-to-end walks, and adding a check is adding one file to
  `desktop/scripts/editor-checks/`: the JSON-RPC plumbing, the PNG reader for
  pixel assertions and the temp-project builder are shared
  (`scripts/lib/editorDriver.mjs`), so a check is only its claim.

### Added

- **Text standing in the world can be ordered.** A `Text` with no layout box is a
  label in the world — the engine has always drawn one — but it was pinned to
  layer 0 with nothing in the component to reach for, so anything else on layer 0
  that drew later simply covered it: a board hiding its own pieces, a name tag
  behind the character it names. `Text.layer` is read the same way `Sprite.layer`
  and `ShapeRenderer.layer` are. Inside a Canvas the UI render order still
  decides, so the field cannot fight its own panel.

### Fixed

- **The first Play runs the code on disk, not the code from when you opened the
  project.** The play realm prewarms when a project opens, and that prewarm
  imports the project's script bundle; an ES module is evaluated once per URL, so
  the first cold Play re-imported the same URL and got that same module back.
  Everything written between opening the project and pressing Play was in the
  bundle on disk and absent from the running game — which, in a project being
  written, is all of it. A scene referencing components nothing had registered
  loaded anyway, dropping them with one warning per entity: a board of bricks
  that draws perfectly, has no Brick on it, and sits there while every system
  idles. The rebuild path had always cache-busted for this reason; the cold path
  now does too.

- **The editor frames what the game will show, not just its height.** The editor
  view adopted the scene camera's `orthoSize` as a half-height, which matches the
  game only while the panel is at least as wide as the design aspect. Narrower
  than that, the running game letterboxes — it keeps the design WIDTH — and the
  editor kept the height, so it showed strictly less than the game would and the
  design frame ran off the sides. It read as "stretched in the editor, fine after
  Play"; nothing was stretched, the two were framing by different rules.

- **The agent's brief taught an API that does not exist, and nothing compiled
  it.** It said to read the mouse with `input.isMouseButtonPressed(MouseButton.Left)`.
  `MouseButton` is the InputMap binding builder — a function, with no `.Left` — so
  the call passed `undefined` and read false forever: every game the agent built
  ignored the mouse, in silence, with nothing failing anywhere. The brief now
  teaches `isMouseButtonPressed(0)` and says what `MouseButton` is for, and every
  API it teaches is exercised by a fixture that CI compiles against the real SDK
  types. Prose about an API is code that nothing checks.

- **The agent has to look at what it built before it says it is done.** A turn
  that changed the scene and never once captured the viewport is asked to, before
  it can report. Diagnostics only cover what the editor can name; whether the
  content is on camera, whether it reads, whether it is where it was meant to go
  are things only the picture answers — and a dogfood run delivered a board half
  off screen with every write compiling and every diagnostic clean.

- **A turn that runs out of rounds lands its work instead of being cut off.** The
  per-turn cap (a backstop against a model retrying a failing call forever) was
  low enough that building a small game hit it, and it arrived without warning —
  so the round in which the agent would have summarised where things stood was
  the one it never got, and an unfinished turn looked exactly like a finished
  one. The cap is higher, and eight rounds out the agent is told to wrap up.

- **A long question stops eating the agent drawer.** The running turn's header is
  pinned so you can see which request is in flight; unclamped, a pasted paragraph
  of requirements held the top of the panel for the whole run and pushed the work
  itself off screen. It clamps to two lines now, with the full text on hover.

- **The viewport still draws on a machine with no usable GPU.** Chromium refuses
  WebGL2 outright ("WebGL2 blocklisted") where no hardware GL is available — a VM,
  a remote desktop, a blocklisted driver, a CI runner — unless software rendering
  is opted into, and the editor never opted in. The engine then never booted, so
  the project opened onto a blank viewport that never loaded a scene, and every
  question about the scene timed out. SwiftShader only ever takes over when
  hardware GL is unavailable: a slow viewport where there was no viewport at all.

- **A world label lands where it is put.** `rectTextBox` hands the boxed text path
  an origin already carrying the baseline (−0.8em); the boxless path started from
  a bare 0, so `verticalAlign: Middle` centred the block on a *baseline* rather
  than on the entity and every world label rode 0.8em high — half a square, on a
  chessboard. The origin is now a zero-height box for every alignment, so Top,
  Middle and Bottom sit on one ladder and each is the answer that box would give.

- **A system that fails to start says why every frame, not once.** Building a
  system's first query instances can throw — an unregistered component reaches
  `resolveGetter`, and that is exactly where it says so. The runner published its
  query cache before filling it, so whatever had been built before the throw
  stayed; the next frame read a SHORT array, found `undefined` where a later
  query belonged, and reported "cannot read properties of undefined (reading
  'resetTick')" from then on, with the true error long scrolled away. The caches
  are committed only once every parameter resolves.

- **A web package carries the SDK it can load, not all five.** `sdk/dist` holds
  every target's build side by side and the export copied the tree wholesale, so
  a browser package shipped the Node, WeChat, mini-game and native SDKs — each
  with a multi-megabyte source map — plus a megabyte of type declarations nothing
  at runtime reads. A chess board came to 27.5 MB on disk; the same build is now
  10.8 MB.

- **A new component reaches the running game.** Reaching the declaration entry is
  only half of a component being real: the editor reads that entry directly, so
  the component appears in Add Component and the scene saves it, but the running
  game only has what the startup entry imports. A project whose startup entry no
  longer imports its declarations authored components the game had never heard
  of, and said so only as "Unknown component type" in the play log, once per
  entity, after the scene was already built on them.

- **A new system knows where input comes from.** The system template named `Time`
  and `Transform` and nothing about input, so a system that needs a click reached
  for `document.querySelector('canvas')` — which works in a browser and nowhere
  else the project ships to, and makes the game redo the screen-to-world
  arithmetic the camera already knows. It now names `Res(Input)` and
  `CameraView`, and which one is not the door.

- **Two editor doors that had no honest answer.** `describe_component` for a name
  nothing declares returned `[]`, which reads as "that component has no fields"
  rather than "there is no such component"; it now refuses in the same words the
  add door uses. `set_run_mode` drives the edit World, which in the editor app
  does not have the project's scripts — its `false` meant "no Stop rebuild
  happened", not "failed" — so it now says which door it is and names
  `toggle_play`.

- **A scene with no camera says so, before Play goes black.** The editor renders
  through a view of its own, so a scene full of content and no Camera looks
  finished in the viewport and draws nothing the moment the game runs — the
  sharpest way the editor can lie to you.

- **A `play_probe` body is a program, not only an expression.** `a(); b();` came
  back as a syntax error, and a driver that ignored the reply saw its clicks
  quietly not happen. The tool also documents what the probe actually offers:
  `getComponent` takes a NAME and returns a DEFINITION, `world.get` a COPY, and a
  write only lands through `world.insert`.

- **Play refuses to run a game whose code did not compile.** The realm built the
  project's scripts and threw the result away, and the host swallows a missing
  bundle (builtin-only is a real way to work) — so a project whose `src/main.ts`
  failed to compile played with none of its own code and no message anywhere.

- **A `.esfsm` the editor cannot read opens empty, not fatal.** A hand-written
  state machine took the panel down with "Cannot read properties of undefined",
  in the one place the file could have been repaired from.

- **A write the layout will overwrite says so, in its own reply.** Asked to build
  a chess game, the built-in agent spent ten minutes making a board out of UI
  nodes placed with `Transform.position` — a field the layout owns and rewrites —
  and got an empty viewport with nothing failing anywhere. `apply_scene_ops`
  returns `warnings` now, naming the way that does work. The agent's brief also
  says where game content lives (the world, as Sprites; a Canvas is for HUD), and
  `load_scene` no longer describes itself as the way to open a project's scene —
  it is the headless fixtures door, and in a project it 404s.

- **Reading a project file answers, or says what is wrong.** A manifest written
  by a Windows tool (Notepad, `Out-File`) carries a byte-order mark, and
  `JSON.parse` calls that a syntax error: the project would not open, with
  nothing naming the file. Stripped at the one door every project read goes
  through. And a directory that does not exist now lists as empty rather than
  throwing `ENOENT` — "what is in src/?" is a question a project with no src/
  answers with "nothing".

- **An empty scene is a loaded scene.** `open_project` waited for the scene tree
  to be non-empty, so a new project — where every project starts — stalled the
  full thirty seconds and then reported that no scene had loaded.

- **A run the endpoint dropped can be carried on.** Stop and out-of-steps both
  offered "Carry on"; a turn killed mid-run by a dropped connection offered
  nothing, which is the ending that most needs it.

- **Compressed and uncompressed sprites no longer disagree about where a sprite
  is.** A screen point is a ray, and `screenToWorld` multiplied only the x/y
  columns of the inverse view-projection — correct orthographically, where a
  screen point names the same world x/y at every depth, and wrong under any
  perspective camera, where it answered with wherever the near plane happened to
  be. It intersects the ray with a world plane now, with the orthographic case as
  the degenerate form rather than a second branch.

- **An optional native binding no longer declares older hosts rendererless.**
  `hasRendererBindings` is an all-or-nothing probe: bind every renderer entry
  point and the SDK drives the frame, miss one and it hands the frame back. A
  capability added after a host shipped therefore has to stay out of it, or a
  shell that was working goes blank on an SDK upgrade.

- **A material's inherited vertex stage carries z.** A fragment-only `.esshader`
  — which is what a material normally is — gets a vertex stage injected by the
  shader parser, and that stage was flattening the position it was handed. On GL
  it hid (a shader may read fewer components than the buffer supplies); in a
  depth layer it would have resolved every fragment at z = 0, and on WebGPU the
  entry simply did not match the vertex format.

- **Depth-sorted layers now apply to the EDIT viewport, not only to Play.** The
  setting rode every stop y-sort had cut except the one that makes it visible
  while authoring, so a project could check the box, get 2.5D occlusion in the
  game, and author against a viewport still painting in list order — the setting
  was real everywhere except where it is set. `Renderer.setDepthLayers` is the
  live twin of the app option, and the store now pushes both masks from one
  place, since two call sites are how the second one gets forgotten.

- **A click selects what is drawn on top.** Picking ranked overlapping entities
  by sorting layer and list order, which is not the order the frame resolved:
  a nearer sprite lost the click to whatever was created after it, and in a depth
  layer — where the depth buffer beats the layer, per pixel — it lost to the
  sprite behind it. Ranking now mirrors the renderer's own rule, from the same
  two project masks (`layerOrderOf` / `compareDrawRank`, the JS mirror of
  `DrawList::layerOrder`).

- **Gizmos and selection outlines project through the entity's own plane.** The
  unproject side learned to take a plane; the project side still assumed z = 0,
  so under the perspective eye every overlay on off-plane content — outline,
  move handles, collider shapes, light and emitter gizmos, joint anchors, the
  tile overlays — was drawn at the entity's shadow rather than on the entity.

- **The editor grid covers the perspective frame.** It sized its quad from
  `orthoSize`, a field that view does not render through, and became a bounded
  island in the middle of the panel. What a view SEES on the z = 0 plane is one
  formula now (`editorViewHalfHeight`), so the grid, zoom, framing and the
  minimap rect cannot disagree — framing under the perspective eye wrote
  `orthoSize` too, which simply did nothing.

- **The editor's `pick` answers in source ids.** It handed back a runtime id
  every other door on that surface rejects, so an agent that picked an entity
  could not select it.

- **A shipped build is told about depth layers.** 2.5D reached the play realm
  and NO exported build — web, mini-game, playable or native — because the export
  re-derives the project's settings in the main process and that list never
  mentioned the depth mask. A game checked out as correct in Play and shipped in
  paint order, which is the worst shape a bug can take. The settings a runtime is
  told are now derived ONCE (`runtimeConfigOf`), shared by the play payload and
  every packaged target, and `tools/check-project-settings.mjs` fails a build
  where a setting does not reach a consumer — or is not declared there as a gap
  with a reason.

- **A shipped build gets the project's physics world and its mixer.** Both
  reached the play realm and stopped there: a game rehearsed at the gravity,
  solver and collision matrix it was authored with, then shipped on the engine's
  defaults, and a mixer whose buses were set previewed correctly and shipped
  silent. `game.config.json` carries all three now (declared values only, so an
  untouched project's config is unchanged byte for byte), and the mini-game and
  playable packagers embed `physics.wasm` for a project that declares physics
  even when no scene has a body — a game that spawns them from script used to
  ship the flag without the binary. The three hosts stopped restating the config
  by hand: `packagedAppOptions` is what an App is BUILT with and
  `packagedRuntimeInit` what is APPLIED to it, which is also how the web host had
  been quietly dropping the depth mask it was already being sent.

- **Switching the viewport between 2D and 3D keeps the framing.** The two
  projections zoom with different fields (a box half-height, a camera distance),
  so flipping the toggle jumped to whatever the other field happened to hold —
  the scene lurched about 2× on a button that is meant to change how depth looks,
  not what you are looking at. Found by the new editor gate on its first run.

- **The mixer applies when a project opens, not when its panel does.** Bus
  volumes, effects and duck rules were applied by the Audio Mixer panel, so a
  project's audio previewed at the wrong levels until someone happened to open
  it. Every setting the edit session can show is applied from one place now.

## [0.43.0] - 2026-08-04

A release about a game that is no longer alone once it ships. Four more of the
things a mini-game host can do for it — sign a player in, take a payment, draw a
friends leaderboard, and run the second JS runtime that leaderboard needs — two
things a project can now bring in for itself — an npm package, and a WASM runtime
the engine has never heard of — and, for the day after it ships, what the package
weighs and what went wrong on somebody else's phone.

### Added

- **A player can sign in through the host, and the engine refuses to fake the
  half that matters.** A mini-game host signs a player in and hands back a
  one-time CODE; turning that into an identity takes the app secret, and an app
  secret in a client is an app secret anyone can read. So the exchange belongs to
  the game's own server and the engine's job ends at the code — `Identity.login()`
  resolves with `{ code }` rather than a string, because destructuring makes the
  call site say the word, which is what stops `if (await Identity.login())` from
  reading like "I am now signed in". It rejects with the host's own words when
  the round trip fails, rejects immediately where there is no sign-in rather than
  awaiting a promise that never settles, and `sessionValid()` exists to SKIP a
  login. Unlike ads and the leaderboard there is deliberately no local stand-in:
  a pretend ad is still a real pause, but a pretend code is a string no server
  can exchange.

- **In-game purchase, and the device it is not allowed on.** Buying inside a
  mini-game is a permission, not a feature — on WeChat it is Android-only, and
  the same call on an iPhone is refused by the platform — so `Payment.available`
  answers for the DEVICE rather than for the API's existence, and a shop can stay
  shut instead of opening and failing at the tap. It does not interpret the
  host's error codes (they differ between vendors, and a cancel and a failure
  need different UI), and it grants nothing: a purchase the client believes in is
  a purchase an attacker can claim, so `request()` resolving is the cue to go and
  ask your server, not to add coins.

- **A friends leaderboard, including the half that runs somewhere else.** This is
  the one thing a team cannot build on top of the engine, for a structural
  reason: a player's friends are readable only inside the open data context — a
  second JS runtime with no engine, no WebGL and no wasm — which talks to the
  game through a canvas the game samples and a message channel with no way back.
  So the façade states the constraint instead of hiding it. `submit` writes the
  player's own row (the one cloud operation the main domain may do), `show` is a
  request rather than a question — what comes back is pixels, never rows, never a
  count — and `texture` is those pixels as an engine handle a UIVisual can wear,
  stable across every redraw. An API returning `Promise<Row[]>` would be the
  honest-looking one, and the one no host can implement. A working board ships as
  its own context bundle and the exporter uses it whenever a project supplies
  none; a project that supplies one wins. Play mode installs a local board that
  runs the ENGINE'S OWN board code against an offscreen canvas and invented
  friends, so the UI whose whole job is to look right can be looked at before
  there is a phone.

- **The open data context is a capability, and an export bundles one.** The
  platform half is three optional members under the same probing convention as
  share and ads — post a message in, take the shared canvas out, write this
  player's own cloud rows — implemented once for every mini-game vendor that has
  them. The export half is a second bundle for that second runtime, and the
  `esengine` alias is deliberately withheld from it: a context that imports the
  engine now fails to resolve at export instead of throwing on a device, which is
  the only other place that mistake would surface. `game.json` names the
  directory only when one was actually written, since the host compiles what that
  key points at.

- **A project can ship its own native module.** A third-party runtime that
  arrives as WASM — a vector-animation player, another solver — used to have to
  be fetched and instantiated by the game itself, which works on exactly the
  platform where doing it by hand is easiest and least necessary: a mini-game has
  no `fetch` and needs the binary IN the package, and a playable has no files at
  all. The machinery was already here and closed, so `SideModuleId` is opened the
  way `ExportPlatform` already is, and a project drops a module in
  `.esengine/modules/<id>/` with per-platform build directories — serving the web
  glue to WeChat would produce a package that builds clean and dies on a device,
  so it is refused rather than substituted. One invariant runs through the
  export: a module is DECLARED only if it was STAGED. Play stages from the same
  directory the export reads, so developing against a module no longer means
  packaging the game to find out whether it loaded, and registering over an
  engine id is refused rather than last-wins.

- **A new project can take an `npm install` straight away.** Project scripts are
  bundled with esbuild, which resolves out of the project's own `node_modules` —
  so `npm install protobufjs` has always worked and shipped with the game on
  every target. What did not work was the first step: no `package.json`, so npm
  wanted an `npm init` that nothing told you was a prerequisite. It is generated
  at creation now (slugged name, `private: true`), from one source rather than a
  copy in each of the forty-odd templates. And reaching for a Node built-in no
  longer fails with a bare `Could not resolve "crypto"` — the error names the
  importer, says why a game is not Node, and gives advice that depends on WHO
  reached: your own code gets pointed at web APIs, a dependency's import gets
  pointed at the package, because advice about code you did not write is useless.

- **Every packaging target now says what it weighs, and a build can be failed for
  it.** A shipped game is refused for being too big far more often than for being
  wrong, and the editor could say so for exactly one target; WeChat's 4MB main
  package had nothing at all. A limit is data now — a number, WHAT it counts
  (initial / total / deliverable), and where it came from, quoted verbatim so a
  developer checks it against that platform's docs rather than trusting us — so a
  host the editor has never heard of declares its own and is reported exactly
  like WeChat's. Where the bytes sit is read off the manifest the build just
  wrote, so 80KB of hot-updatable art is reported as costing the package nothing,
  because it does. `--enforce-budget` makes the build CLI exit non-zero and name
  the limit and the overage, opt-in because an oversized package is still a
  package and whether that blocks a release is the caller's call.

- **A shipped game can say what went wrong.** After a build ships the engine goes
  blind: a device loses its GL context, an asset 404s in one region, a system
  throws on frame 12,000, and all of it prints to a console on someone else's
  phone. Every error the engine raises already goes through the logger, so the
  bridge is a log handler and a game's own error handlers keep working untouched;
  what the log cannot see is what happens outside the frame, so the platform grew
  three optional subscriptions — uncaught host errors, a lost render context, and
  OS memory pressure, the warning that arrives before the process is killed.
  THE ENGINE NEVER PICKS A DESTINATION: no endpoint, no bundled vendor, nothing
  here opens a socket, and with no sink installed this still does its whole job
  locally. Aggregation is what makes it safe to leave on — a system that throws
  does it sixty times a second from every player at once, so the unit is the
  DISTINCT problem with a count, with numbers normalized away so "Entity 41 has
  no Transform" does not file a new problem per entity. Native reports the two
  signals only its shell can see; mini-games report neither, and the platform
  table says so rather than leaving a gap someone re-investigates.

- **A plugin can lend the agent a tool.** A plugin already extends what a PERSON
  can do here; the agent's entire vocabulary is the tool catalog, so a capability
  the agent cannot name is one added for half the editor.
  `ctx.agentTools.register(…)` keeps the handler in the renderer and sends across
  only what a session needs to describe the tool to a model, dispatching back
  through one door — a transport per plugin would be a second way for an agent to
  reach this editor. Namespacing is enforced rather than suggested (a tool named
  `delete_entity` would be called by a model that believes it knows what happens
  next), and refused out loud, since a plugin's docs will say the tool exists.

- **How hard the agent thinks is a setting, not a constant.** The plumbing
  reached the wire and no caller ever filled it in, so every turn ran at maximum
  depth whether it was building a menu or renaming three entities. It is its own
  setting rather than part of the model pick — the same model is worth running
  shallower — narrowed on the way through so an edited settings file cannot send
  an unknown depth to the endpoint, and shown beside the model in the picker,
  because together they are what the next turn will cost.

- **An entity the agent just touched says so, once.** The dot beside a touched
  row is a standing fact that lasts until the checkpoint is answered, and a
  standing mark cannot also carry "a second ago". Arrival now gets its own
  moment: the dot grows in and a ring leaves from under it, on the channel that
  is already the agent's — not a tint on the row, whose background belongs to
  selection and the drop target. Reduced motion keeps the dot and drops the
  travel. Nothing flashes when dots are cleared or when the panel is reopened; a
  tree that lights up when you look at it teaches people to ignore the light.

- **Sorting layers get all 32 nameable slots, not 8.** The settings page offered
  eight, the store read back eight, and the manifest parser already accepted
  thirty-two — so hand-editing the file past eight silently lost the rest. 32 is
  the honest number, because y-sort is a 32-bit mask over layer indices. The
  renderer was never the limit: `layer` is an i32 and sorts on any integer, and
  the named slots are a readability feature over it.

### Changed

- **An enum source now says whether its options are the only legal values.** Six
  sources feed the inspector's dynamic dropdowns and they are two different
  things wearing one mechanism: a spine animation is EXHAUSTIVE, a sorting layer
  is not — the names alias an i32 the renderer sorts on regardless — and neither
  is a locale key, where binding one before its table entry exists is the normal
  authoring order. Only the exhaustive reading was implemented, so naming a
  single layer closed the field down to that one option. Sources declare it once
  now and both writers read that declaration; an open enum's control is the
  suggestions plus a way past them. The one behaviour change: a closed enum
  refuses an ordinal it does not define, which is the rule that already governed
  its name-valued twin.

- **Whether a component may be authored is one answer, not the menu's.**
  "Runtime-only state is never authorable" and "this one has its own authoring
  door" existed only as filters while BUILDING the Add Component menu, so the
  command underneath and the automation surface would both author an
  `EventBinding` beside the one its panel owns, or write a transient runtime
  component into the scene file. One predicate answers now, and the automation
  door refuses out loud with the door to use instead.

### Fixed

- **Hiding a parent hides what it contains.** The eye writes a per-entity flag
  and five places read that flag directly, so each answered for ONE entity:
  hiding a group left every child drawing, still grabbable in the viewport, and
  shown as visible in the Outliner. Visibility is inherited, so it is one rule
  and now one function that all five ask. A toggle re-projects the SUBTREE, and a
  reparent re-folds — dragged under a hidden group the subtree has to go, dragged
  back out it has to return, and no visibility change is emitted for that. The
  Outliner still reads the row's own flag for the eye, so clicking it is never a
  no-op, while an inherited hide dims the row.

- **Stop answers during a tool, and a stream no longer floods the window.** Two
  reports with one cause between them: the window froze while the agent ran a
  tool, would not scroll, and Stop appeared to do nothing. Stop was honoured only
  BETWEEN tool calls — the abort signal never reached the dispatch — so the turn
  ends now even though the in-flight call still finishes, and the transcript says
  which of the two happened rather than implying the work was undone. The freeze
  was the streaming: a scene edit's arguments arrive as hundreds of JSON
  fragments, each costing an IPC message, a store update that rebuilt the run's
  whole entry list, and a re-render — which is also why Stop looked dead, since a
  blocked renderer cannot deliver the click. Consecutive deltas merge and leave
  on a frame's delay, at the one place events leave for the window, because
  transcript and status share a channel precisely because their order is meaning.

- **The run header counts tokens while you are waiting for them.** Usage was
  emitted once, after the response finished streaming — so the one number a
  person is looking for during a long wait was blank for exactly as long as the
  wait lasted. The input is known before a single token comes back, and the
  output accrues as it goes; the deltas are computed in the provider, which is
  the layer that knows the wire format, and the settle at the end pays whatever
  the stream did not already account for.

- **A field's declared constraints bind every way of writing it.** A ranged
  number clamped when dragged and when nudged with an arrow key and not when
  typed, so a slider stopped at its max while the box beside it wrote straight
  past; the automation door read no range at all; and a bitmask took bits nothing
  declares, which no layer can ever match. All three bind now, and the two doors
  differ only in how they say no — the control clamps, because a drag that stops
  at the end is what a person means, and the automation door REFUSES, because a
  caller that asked for 5 wants to hear so rather than find 1 stored.

- **A renamed sorting layer reaches the lists that label themselves with it.**
  The y-sort checkboxes and the collision matrix took their labels from a
  different setting than the one they subscribed to, so neither re-rendered when
  you named a layer: the list kept whatever names the dialog opened with, and a
  layer you had just named never became tickable.

- **A schedule that is not one says which system, and which value.** Project code
  is bundled with esbuild, which strips types without checking them, so a
  registration TypeScript would have rejected still runs — and it failed with
  "Cannot read properties of undefined (reading 'push')" from inside a minified
  bundle, naming neither the system nor the value. A member that does not exist
  and swapped arguments look nothing alike in the source and identical at
  runtime, so the message tells them apart and lists what a schedule can be.

### Documentation

- **An asset ref is rooted at the project, not at the assets folder.** The
  reference guide said "project-relative path" and then showed
  `'textures/player.png'`, which reads as "relative to the assets folder" and
  resolves to nothing. Six guides taught the rootless spelling while audio,
  tilemap, video and localization taught the right one — so whichever page you
  learned from decided whether your first load 404'd. Every example carries the
  `assets/` segment now, and the rule is stated on the `Assets` class itself,
  where someone writing code will actually be.

## [0.42.0] - 2026-08-03

A release about the last mile: what a game needs on the way out the door, and
four things that were quietly broken on the way in.

### Added

- **Ads and sharing are engine services now, not glue every game writes itself.**
  A rewarded video is four lines on the platform and a page of ceremony around
  them, and the ceremony is the part teams get wrong: `Ads.showRewarded(unitId)`
  pauses the game clock while the ad covers the screen (a revive must not cost
  the player their run), suspends the audio device without touching any volume
  the user set, restores both however the ad ends — including the error paths —
  and resolves with whether the reward was earned, folding in the hosts'
  load/show retry dance and the runtime that grants a reward without saying so.
  `Share.share(...)` and `Share.setShareCard(...)` cover both share surfaces
  (the game's own button, and the host's menu — asked at share time, so the card
  can carry a live room code). WeChat and Douyin are one family implementation;
  `Ads.available` is false where there is no ad system (web, native until a
  mediation provider is installed through the same door), and the editor's play
  mode installs a mock provider — so "watch an ad to revive" is a flow you can
  rehearse at your desk, real pauses included, without a device.

### Fixed

- **A torn-down system no longer leaves a dangling callback in the registry — in
  either direction.** Entity-destroy subscriptions are RAII now, end to end: the
  subscriber's Connection removes the callback when the subscriber dies, and the
  Connection itself is safe to outlive the registry (it holds a weak liveness flag,
  not a bare pointer). The half-fix that existed covered only one teardown order,
  and the order between a C++ system and the JS-owned registry is not guaranteed.
  Held by an AddressSanitizer harness that exercises both orders.

- **The renderer no longer interrogates the GPU about errors it isn't having.**
  Every frame ended with a drain of `glGetError` — a debug facility that shipped
  enabled, in every build, on every platform. Each call is a synchronous round
  trip to the GPU process; on a fast machine it hides, and on a slow or contended
  one it was the single largest item in the renderer's profile, starving the
  editor's automation surface into timeouts. Error checking is opt-in now
  (`GLDebug.enable()`), the on-demand probes still force a check, and the browser
  already reports WebGL errors to the console on its own.

- **Editor automation no longer times out when a call lands during a subframe
  load.** Driving the editor (MCP tools, the agent, the e2e) goes through a guard
  that waited for `did-finish-load` whenever the window reported loading — but
  the play realm prewarms in an IFRAME seconds after a project opens, the loading
  flag covers subframes, and that event only fires for the main frame. A call
  that drew the short straw awaited an event that had already fired for the last
  time. The guard polls now, bounded, and cannot be stranded.

- **Hot reload now actually keeps the World — in projects that exist.** Two
  gates rejected every real project while passing every unit test. Startup
  systems are consumed when they run, so a re-imported bundle always has ones
  the live side doesn't — structural mismatch, full restart, for anyone using
  `addStartupSystem`. And "no owning subsystem" was read as "user system", which
  swept up engine systems that register lazily outside a plugin build (the
  physics event bridge among them) — phantom structure, full restart, for any
  project with physics. User systems are now classified by the one boundary that
  defines them — they came through the project bundle's drain — startup is
  exempt in both directions, and every reload logs which path it took and why,
  so a fallback is a stated fact instead of a mystery about lost state. Proven
  live by the editor e2e: a logic edit mid-play swaps with state preserved, a
  schema edit forces the clean restart it must.

- **Compressed textures are no longer upside down.** Every uncompressed image is
  row-flipped at upload into the engine's texture orientation; a compressed KTX2
  cannot be — a 4x4 block has no row order to swap — so the cook's KTX2 came out
  vertically mirrored on every backend that drew it. It went unnoticed because
  everything that verified the path was symmetric: a solid green square looks the
  same both ways, and the photograph that would have shown it was only ever looked
  at on an iOS simulator, where it was filed as a native quirk. The orientation is
  baked at encode now, where flipping is free and exact, and a test holds the
  stored row order to the engine's — native and web draw the same file the same
  way up.

- **Coming back to a running game no longer kills it, sometimes.** On Android,
  recreating the activity — leave with Back and reopen, rotate, toggle dark mode —
  keeps the process and the booted engine but hands every later JS call to a new
  thread. QuickJS measures stack overflow from a stack top it records once, on the
  thread that created the runtime; when the new thread's stack lands lower than
  that mark minus the budget, every call — however flat — throws "Maximum call
  stack size exceeded", forever. Whether it lands there is address-space luck,
  which is why the same build died one smoke run in forty, first at
  `es_onNativeVisibility` (the first call after a resume) and then on every frame.
  The check is re-anchored to the calling thread at each host→JS entry now — the
  API's own answer to a runtime outliving its thread, at the cost of one stack
  pointer read.

## [0.41.0] - 2026-08-03

The editor's own agent is the headline, and this is the release where a user can
find out it exists: a conversation now lives with the project — its transcript and the
model's memory of it — so quitting no longer throws away what the agent was told, earlier
conversations can be picked back up, and a long one says out loud which of its runs have
been folded out of the model's reach. You can hand it a picture, and re-ask a run in
different words. All of it is documented, in both languages, for the first time.

Underneath, two things that only show up after you ship: a game's own `.json` data is an
asset now rather than a path you fetch and discover missing in the build, and a save
written by an earlier build is carried into the durable directory this release moves saves
to.

### Added

- **The agent's conversation outlives the window, and there is a guide to all of it.**
  Quitting the editor threw away everything the agent had been told, and nothing led back
  to yesterday's work. A conversation is kept with the project now, under
  `<root>/.esengine/agent/` beside the autosaves and for the same reason — what was asked
  and what it did are about THIS project. **Earlier conversations** lists them and picking
  one up restores both halves: the transcript you read and the memory the model answers
  from. You can drop or paste a **picture** into the composer (in a 2D editor "make it look
  like this" is most of what anyone wants to say, and until now only the agent could show
  pictures), and **re-ask** a run in different words — it opens the question prefilled
  rather than firing the identical words again, since wanting to put it better is the usual
  reason to run a turn twice.

  A long conversation also stops forgetting in silence. Past its context window the oldest
  runs fold away — what you asked survives word for word, the tool traffic does not — and
  the transcript now says so on the line where it happened, because runs still on screen
  that the model can no longer answer about read as a model ignoring you rather than one
  that was made to forget.

  None of this was documented anywhere: the only agent the guides knew about was MCP. There
  is now a **Built-in Agent** guide in both languages, screenshot-led, including the table
  of what it may do unasked — the tiers are drawn where Undo stops working.

- **A game's own data is an asset.** A `.json` that is not a Spine skeleton or a
  DragonBones pair — a level table, a tuning file, dialogue — was not an asset at all:
  no `.meta`, no uuid, nothing in the registry, so the only way to read one was to fetch
  its path by hand. That works in the editor, which serves the whole project, and 404s in
  the build, which ships only assets. The failure appears after release and nowhere else.

  It is a type now, `json`, with `assets.loadJson<T>(ref)`. Being a type is the point: a
  data file gets ref resolution (`@uuid:` and manifest paths, so moving it breaks
  nothing), one parse shared by every caller, group and subpackage delivery, and hot
  update — none of which a hand-rolled fetch can have. It is also always included in a
  build, like locale tables and for the same reason: the code that loads it is the only
  thing that names it, so reachability would cull every one.

  Two edges, deliberately: the content sniff still asks Spine and DragonBones first, so
  nothing that was already a skeleton becomes data; and the project's own configuration
  (`package.json`, `tsconfig.json` and their kind) never becomes an asset.


- **A UI node can say that it arrived on screen, or left it.** Everything a panel does when it
  appears — play the entrance, start the timer, refresh the count — had no event to hang on,
  because a node does not go away by itself: an ANCESTOR's `display` changed, and every node
  under it stopped being drawn without being told. The only way to notice was to walk the parent
  chain of every animated node, every frame, re-deriving what the layout pass had already
  computed. `shown` and `hidden` are those two moments on the same channel as `click`, so the
  answer is an EventBinding row rather than a system, and the whole subtree is told rather than
  just the node whose field changed.

  Visibility is read as the engine's own resolved bit, the same one rendering and hit-testing
  use, so it cannot drift from what you can see. That bit is reachable one entity at a time,
  which makes the scan the entire cost of the feature — so it is gated twice, and on a steady
  frame it is nothing: no listener, no scan (`EntityEventQueue.hasListenersFor` makes that O(1)),
  and no scan on a frame where no UINode was written and nothing moved in the hierarchy — the
  same pair of signals the layout solve and the physics reconcile already gate on. Measured in
  a real UI of 112 nodes: 0 reads per idle frame, one full pass on the frame a panel is toggled.

### Fixed

- **An export's output is no longer mistaken for the project's content.** `dist/` and
  `build/` were excluded; `dist-web/`, `dist-android/`, `dist-wechat/` and the rest were
  not — so the registry adopted a finished build's assets as if they had been authored,
  and they show up in the Content Browser. Harmless while nothing forced them into a
  build; with data assets always included, the next build would have shipped the previous
  one's manifest inside itself. Any `dist-*` folder is build output now.

- **Checking for updates showed nothing, and could show nothing forever.** The toast was
  posted only once the network had answered, so Help ▸ Check for Updates was a click with
  no visible effect for as long as the request took — and the requests had no timeout at
  all. `catch` catches a connection that fails, not one that is accepted and then never
  speaks, which is exactly what a filtered network does: the promise never settled, the
  command waited on it forever, and nothing was ever shown. Each source now gets six
  seconds, including the one electron-updater asks (which exposes no timeout of its own,
  so it is raced against a deadline).

  With that fixed, the answer can be honest. "No update" and "nobody answered" used to be
  the same `null`, reported the same way — a machine that had reached neither the mirror
  nor GitHub was told, in green, that it was up to date. The check now reports three
  outcomes, and the unreachable one offers the download page instead of a reassurance it
  has not earned.

- **A download that reported nothing looked like a download that had stopped.** Progress
  was a percentage inside a line of text, which sat at "0%" through connect, redirect and
  the whole of a differential download's first phase. Toasts can carry a progress bar now:
  indeterminate while there is nothing to be a percentage of, then the real figure with the
  download's size next to it. The line is also pinned while the download runs and re-posts
  itself if it was closed — the download outlives its toast, and "Restart" was the only way
  to install what it had just fetched.

- **One release, announced once.** The startup check and the menu item both raise the same
  notification, so clicking Check for Updates in the first seconds after launch answered
  with two identical lines. Announcing once does not mean announcing only once ever: a
  download that failed can be offered again, which running the real thing turned out to be
  the case that mattered.

- **A toast action no longer throws away the line it just wrote.** Pressing a toast's button
  always dismissed the toast, which is right for an action that leaves (open a page, restart)
  and wrong for one that keeps reporting on that same line: pressing Download blanked the
  screen for the second before the first byte report, right where the "did my click do
  anything" doubt lives.


- **The mock-wasm test harness left every engine-calling plugin inert.** `bootMockApp` connected
  the world but not the App, and `engineApi(app)` answers with the App's module — so plugins that
  reach the engine optional-chained it away and their engine branches never ran under test. They
  passed, silently testing less than they read as testing.

- **Saves no longer live in a directory the platform may delete.** Key/value
  storage went to the host's cache directory, whose stated purpose was the
  regenerable bytecode cache. On iOS that is `NSCachesDirectory`, which the system
  empties when it wants the space back and no backup includes — so a player's
  saves and settings could vanish between launches. Android put the same file in
  `files/`, which nothing reclaims: one API, two opposite promises. There is now a
  durable directory distinct from the reclaimable one (Application Support on iOS,
  `internalDataPath` on Android) and storage writes there. Android's cache
  directory is also a real cache directory now, so the hot-update store can be
  reclaimed instead of growing forever. Writes go through a temp file and a
  rename, so a kill mid-write cannot truncate a save.

  A save written by an earlier build is in the old directory, and moving where
  storage reads would have lost it on exactly the version that exists to keep it.
  So the first launch after the update reads the cache copy when the durable store
  has nothing, and writes it through — once, and only when there is nothing durable
  to prefer, so a stale copy can never overwrite newer progress. Nothing to do on
  your side if you have already shipped a native build.

## [0.40.0] - 2026-08-02

The agent went from working to being pleasant to work with. It answers from the keyboard
now, shows you the values a batch is about to write rather than how many there are, keeps
what you were typing when you close the drawer, and asks before it drops a conversation.
It renders tables, which it turns out models reach for constantly when comparing a few
entities.

Underneath, the UI layout stopped re-deriving every node's box every frame: Yoga has
tracked what changed all along, and resetting its nodes each pass was throwing that away.
Editing one field now costs a quarter of what it did.

The last part is the one that makes the rest keep: performance has a snapshot in the repo
and a gate in CI, the way the API surface has had for a while. Building it turned up that
eleven of the fifteen benchmark files had not run since the ECS moved directories — and
that `vitest bench` skips a file it cannot resolve and still exits 0, so nothing had said
so.

### Added

- **Performance has a snapshot now, guarded the way the API surface is.** This repo gated
  correctness hard — thousands of tests, pixel regressions, an API-surface snapshot, cycle
  and layer checks — and performance not at all: fifteen benchmark files, no CI job running
  any of them, no baseline anywhere. The UI layout re-derived every node's box every frame
  for months inside exactly that gap. `tools/perf-guard.mjs --check` asserts two things
  chosen to survive running on a different machine: **ratios** between benchmarks in the
  same run (the CPU cancels out, and each ratio states an architectural invariant — "editing
  a field is far cheaper than adding a node" *is* the incremental layout working), and
  **coverage**, how many cases produced a number at all. Tolerance is 30% deliberately: it
  cannot see a 5% slowdown, it is there for the 2×-and-up kind. Accept a change with
  `--update`, the same as the API snapshot.

- **The agent can be answered from the keyboard.** A passage that stops a run takes focus
  when it arrives — that is where the keyboard belongs while a run waits on it — and Enter
  is its primary action, Shift+Enter the for-this-run one, both labelled on the buttons
  rather than left to be found. The batch preview also shows the *values* it wants to
  write, as the same `before → after` the change set uses, where it used to say "3 fields"
  — which is exactly the part a preview exists to show. Strike-all takes a batch apart in
  one gesture, and an emptied one disables Apply instead of offering "Apply 0", which the
  kernel would have treated as a decline anyway.

- **The agent's answers render markdown tables.** Asked to compare a few entities or
  field values a model reaches for one, and the fallback was a paragraph of raw pipes
  wrapped in a 384px column — the least readable thing the renderer could produce. Column
  alignment is honoured, an escaped `\|` stays content, a ragged row is fitted to the
  header rather than shifting its cells, and cells go through the same inline parse as
  prose, so a code span naming an entity is still a way into the scene. The table scrolls
  inside its own box: the transcript never scrolls sideways as a whole. As everywhere
  else in this parser, a half-arrived table is not an error — a header stays a paragraph
  until its divider lands, so nothing flickers through being a narrower table first.

- **A run that was cut off says so, and can be carried on.** The turn loop is bounded so a
  model that keeps calling tools cannot spin forever, and reaching that bound was reported
  as an ordinary end of turn — on screen, a run cut off mid-task looked exactly like one
  that had finished, and the sentence that would have said otherwise is the one it never
  got to write. Both endings a run could have gone further from, that and Stop, now offer
  to carry on from where it stopped.

- **UI zoom, on Ctrl/Cmd +, − and 0.** On a 2K display the editor's numbers were too
  small to read, and the one setting that could fix it sat in a dialog with no menu row,
  no shortcut, and nothing on screen to say it existed. It is now a View-menu group and
  three rebindable commands walking a set of stops (80–200%), plus a status-bar chip that
  appears whenever the zoom is not 100% — click it to go back. Popped-out panel windows
  follow: Chromium keys zoom by origin, so they are born at the current one and change
  with it. Screenshot and MCP runs pin the zoom instead (`ESTELLA_SHOT_ZOOM=<percent>`
  to capture a zoomed shell), because Chromium persists per-origin zoom across restarts
  and one left behind by an ordinary session would silently rebase every later capture.

### Changed

- **The agent transcript animates the way the prototype does.** Runs, reasoning, tool
  details and the change set all fold on a grid row rather than being unmounted, so
  nothing appears as a jump cut and an expanded detail keeps its scroll; a finished run
  folds itself to its header when the next one starts; new blocks rise in as they arrive;
  and a confirmation flashes once on arrival so it is not read past.
- **The agent has a mark.** Four facets that light in turn while it works — in the drawer
  head, the empty state and the status bar, so "still working" is legible with the drawer
  shut. It wears the editor's own violet, not a palette of its own.
- **A run's header says which model answered it** and what it left in the scene (`+7 ~1`).
  The composer's picker only ever says what the *next* message will use, and a
  conversation can switch models between runs.
- **A tool row's glyph says what kind of call it is** — reading, writing, or the one that
  cannot be taken back — instead of turning green on success. Tinting every finished row
  green made the rows that matter harder to find.
- **The agent reads in parallel.** A run of consecutive read-only calls goes out together
  instead of one after another, so three lookups the model asked for in one breath are one
  wait. Writes stay strictly ordered, including against the reads around them — a read
  asked for after a write means "tell me what that did".
- **The confirmation gate asks once per run, not once per call.** An answer is now *Run it*,
  *Allow for this run*, or *Skip*; the middle one covers later calls of the same tool and
  expires when the run ends. A task that saves eleven files was eleven identical questions,
  which is the shape of gate people learn to click through without reading. Deliberately
  not persisted — an "always" that outlives the run is a permission switch nobody
  remembers flipping.
- **Reasoning shows how long it took**, a stopped or refused run explains itself in the
  transcript rather than only in its header badge, `@` offers project assets alongside
  entities, and re-ask is on the answer as well as on the run header.
- **The UI layout keeps Yoga's work, not just its allocations.** Yoga already tracks what
  changed — every style setter is `if (old != new) { set; markDirtyAndPropagate(); }`, and
  a solve skips the subtrees still clean — but the layout pass reset every node and rebuilt
  the whole hierarchy each frame, so none of it was reachable: the retained nodes reused
  allocations while re-deriving every result. Styles and hierarchy now persist, and only
  the nodes Yoga reports new layout for are written back. Editing one field costs a quarter
  of what it did (2000 nodes: 1.03ms → 0.25ms); a static frame is unchanged and a
  structural change still pays for a full resolve. Two things this made load-bearing: a
  `Registry` now has an instance id, because retained per-entity state is meaningless
  across registries (a scene reload or an editor play/stop would have served the new world
  the old world's boxes), and a node that loses its `FlexContainer` is actively told Yoga's
  defaults rather than left with the removed container's padding.
- **The UI dirty marks nothing ever produced are gone.** A per-node `LAYOUT_DIRTY` with a
  walk to the root, a `structure_dirty_` flag, and three bindings to reach them from TS —
  all of it inert, because the DFS rebuild that runs every pass marked every node dirty as
  it built them, so the gate reading those marks was always open. It was the half-built
  version of what Yoga already does per style field; two sets of marks for one question is
  what was worth deleting.
- **There is one way to be a summoned drawer.** There were two of them (the Content
  Browser from the bottom, the agent from the right) and one implementation and a half:
  the second wrote the scrim and the Esc key again, and got the slide and the focus
  handling by not having them — it cut in and out instead of moving, and Tab walked out of
  it into the panels its own scrim had just made unclickable. What differs between them is
  an edge and a size, which is now all either one states. Both are bounded to the
  workspace, so the menu bar and toolbar stay live and undimmed under a summoned surface,
  the way the status bar already did.
- **A streaming reply costs the run it belongs to, not the whole transcript.** Every token
  re-rendered every finished run in the conversation, and each of those re-read the undo
  stack twice in a full linear pass — so a long conversation over a long undo stack paid
  all of that per token. Runs and tool rows memoise, the change set counts from the list
  it already read, and a run's window in the history is found by binary search rather than
  scanned for.

- **The agent can edit the asset editors, not just the scene.** Animation clips, timelines,
  tilesets, materials, material graphs and the animator/state/behaviour graphs were
  unreachable: not components, and not plain files either — reading them off disk gives
  bytes that are stale the moment an editor holds unsaved edits. They now share three
  tools rather than six sets, because all eight share one document base: a field is named
  by dotted path (`frames.0.duration`, the same shape `set_field` uses), and one call is
  one undo step through the same door the panels write through. A path that does not
  already exist is refused rather than created. Tilemaps get their own tools instead —
  a cell is addressed by grid coordinate, which no field write reaches. The editor is not frozen during
  a turn, and an edit it made from a reading taken before you dragged something would
  silently overwrite you. It is now told between rounds, and told to re-read rather than
  handed a guess about what went stale.
- **It knows which room it is in**: the per-turn context now carries the editor's mode and
  the project's design resolution, so a tilemap task is not reasoned about as a UI one and
  coordinates stop coming out an order of magnitude off. And where the endpoint cannot
  carry images — which is true of Anthropic-compatible gateways generally — it is told
  up front that screenshots cannot reach it, instead of discovering that by taking one.
- **A batch of scene edits can be read before it lands, and cut down.** The change set
  under a finished run says what happened and only offers to revert the whole run; this
  says what is *about* to happen, while declining part of it is still free. Lines read in
  the scene's own terms (`rename entity 1` shows as "Sprite0 → Backdrop"), and striking a
  new entity strikes what refers to it — declining a create while keeping the write that
  names it is not a smaller edit but a failed batch. Since authoring is one undo step, the
  gate is neutral rather than a warning, and "Allow for this run" turns it off for the
  rest of a long build.
### Fixed

- **The benchmarks had not run since the ECS moved.** Eleven of the fifteen files still
  imported `../src/world` / `../src/query` / `../src/component` — the paths from before
  `src/ecs/` existed. `vitest bench` skips a file it cannot resolve and still exits 0, so
  the suite reported success while measuring nothing: 27 cases produced a number, 147 did
  not. It is **230** now, and the guard above fails if that number ever falls again. Fixing
  the rest turned up the API drift the silence had been hiding: `physics` instantiated
  through `locateFile`, which under the test environment fetches against localhost;
  `wasm-vs-world` re-declared Transform/Sprite/Camera locally and hand-wrote payloads that
  had all drifted (Camera's four viewport scalars are one `Vec4`; `Sprite` had gained five
  fields, so every embind case died on a missing one), and still measured `UIRect`, which
  `UINode` replaced; `spine` called `extractMeshBatches`, since replaced by the
  allocation-free `forEachMeshBatch(id, visitor)`, and submitted through a function renamed
  when that path was generalised to skeletal.

- **UI zoom no longer blurs the viewport or misplaces what you click.** It was applied as
  a CSS `zoom` on the body, which leaves `devicePixelRatio` at 1: every canvas — the
  viewport, the profiler graphs, the waveforms, the node graphs — kept its backing store
  at the unzoomed size and was upscaled to fit, and `getBoundingClientRect` drifted a
  whole zoom factor away from `clientWidth`, so viewport picking and gizmo dragging
  missed by more the further right and down you aimed (at 150% the right third of the
  viewport could not be hit at all). Chromium applies the zoom now, and raises the dpr
  with it: measured at 80/100/125/150/200%, canvases stay pixel-exact and a dragged gizmo
  lands under the cursor.
- **The viewport canvas is sized from its own layout box**, not `floor(clientWidth × dpr)`
  — which lost up to a pixel at fractional dpr, the case UI zoom makes ordinary.
- **A message typed while the agent was working is no longer lost.** The composer said
  "this will be the next message"; the host refuses a send mid-turn, and nobody held it —
  so the box cleared, the send was rejected, and what you typed was gone, replaced by a
  red banner. It is queued now, shown in the transcript while it waits, and sent when the
  turn ends. Stopping the turn drops the queue, because stopping means stop.
- **The agent's typing caret sits after the last character** instead of on its own line
  below the paragraph — it was rendered after the whole markdown block rather than inside
  it, which read as a stray blinking box rather than as text being written.
- **A tool row's result column says what came back.** It showed the first ~20 characters
  of the raw result, which for a JSON answer is `[{"id` — and the disclosure under it was
  the *same* string, flattened and cut at 160 characters, so expanding a row taught you
  nothing. The row now carries a one-cell summary (a list is its length, an object leads
  with its first named string) and the disclosure keeps the full result with its line
  structure intact.


- **A reloaded window rejoins the agent conversation instead of coming back to an empty
  drawer.** main owns the session, so it survives a reload; the transcript did not, and
  nothing could ask for what it had missed. Worse and silent: re-asking a run passed the
  renderer's array index while the session counted in its own turns, so after a reload
  those disagreed — re-asking the first visible run rewound the session to the start and
  discarded a conversation nobody asked to end. A run is now identified by the session's
  own coordinate, and the open conversation's event stream can be replayed on attach.
- **A long conversation no longer fails outright.** Nothing bounded how far one could
  grow. It now folds its oldest runs into a note at three quarters of the model's context
  window — keeping what *you* said verbatim, since intent governs the ninth run as much as
  the first — and a single tool result is capped and says so, naming the fix, because a
  silently truncated scene tree is one the model believes it saw in full.
- **Three things that only a real gateway could show**, found by driving the agent against
  a live provider through a recording proxy: compaction could never actually fire (the
  trigger trusted the endpoint's `input_tokens`, and a real one reported 33 for a request
  carrying thousands — it now takes the larger of that and the conversation's own weight);
  starting a new conversation made the window drop its runs (every session has a run 0, so
  the fresh one looked like a duplicate of the old — the reset travels in the event stream
  now); and folding a second time ate what the first fold had saved, so the earliest thing
  you asked disappeared one compaction at a time.
- **Losing a component counts as changing it.** `anyChangedSince` is the O(1) gate a
  consumer uses to decide whether to do any work at all, and it reads one per-component
  watermark; removal wrote only to the per-entity maps, so taking a component OFF an entity
  was invisible to it. Found from the other end: a UI node that lost its `FlexContainer`
  went on being laid out by the removed container's padding and justification, because the
  layout pass gates its whole solve on exactly that signal and was told nothing happened.
- **A conversation no longer disappears on a click aimed at the model name.** A session is
  built for one model, so switching has to end it — but that is the *cost* of the switch,
  not what was asked for, and doing it silently read as having lost the transcript rather
  than as having chosen to. Both it and New conversation ask first, and declining a switch
  now leaves the pick alone too: a selection saved for "next time" while the running
  conversation still answers on the old model is a picker that lies about what is running.
- **Pressing Esc no longer costs you the message you were writing.** The draft lived in
  the composer, and the drawer's composer unmounts when the drawer closes — so Esc, or a
  click on the viewport to check something before sending, threw away what had been typed;
  the docked panel and the drawer also disagreed about it. It is one draft now, restored
  at the height it was, and a summoned drawer puts the caret in it.
- **The one question most likely to scroll away was the one with nothing to say so.** The
  "waiting on you" notice and the arrival flash were written against the irreversible gate
  alone, so a batch preview — `apply_scene_ops` being the write the agent is *told* to
  prefer, and the only one it asks about by default — could scroll out of the transcript
  with nothing on screen to say the run was blocked on you.
- **A call that failed says why without being asked.** The result cell beside a tool row
  is clipped to a couple of dozen characters, which is enough to tell two successes apart
  and never enough to carry a reason — so the one row in a run worth reading was folded
  like all the rest. It opens itself now.

## [0.39.0] - 2026-08-01

The editor has an agent in it. You describe what you want done to the scene and it does
it through the same command layer your own clicks go through — so every turn is one undo
away from never having happened, and the tools that cannot be undone ask first. The key
it needs does not go where the other settings go: it is sealed by the OS keychain, and
the bridge it crosses has no way back.

The other half of this release is a bug that made shipped editors quietly worse than the
one we develop in: a project's own components never appeared in Add Component, in every
build anyone downloaded, for as long as the feature has existed.

### Added

- **A built-in agent, docked or in a drawer.** It holds a conversation in main rather
  than in the window, so a popped-out panel or a reload does not end the turn, and every
  window mirrors the same transcript. The transcript shows the work rather than
  summarizing it: what it is thinking, each tool call with its arguments as they are
  written, how long the turn has taken while it is taking it, and the failure — rate
  limit, bad key, wrong address, no answer at all — as which situation it is rather than
  as a status code.
- **The key is held by the operating system.** A `secret` setting type seals it with
  Electron's safeStorage (macOS Keychain, Windows DPAPI, libsecret/kwallet) instead of
  the plaintext localStorage every other setting persists to. There are three IPC
  channels — status, set, clear — and deliberately no `get`: the value crosses the bridge
  once, inbound, and main hands the plaintext only to the client that sends it. What a
  window can learn is one bit, which is why the row has no reveal affordance.
- **It can point at any Anthropic-compatible gateway.** A base URL and a model name, so a
  self-hosted or third-party endpoint speaking that dialect works without the editor
  knowing anything about it.
- **A whole turn reverts in one gesture.** The turn opens an undo checkpoint and the
  checkpoint bar over the viewport says what changed and offers to keep it or undo it —
  all of it, not the last edit of it. Tools are tiered by whether undo can reach them,
  and the tier where it cannot is the tier that asks before acting.
- **`@` refers to what you are pointing at.** A picker over the scene tree, filtered as
  you type, ids next to names because two things can share one; hovering an item echoes
  it in the Outliner and the viewport, so you can tell which "Panel" you are about to
  name. The current selection is offered as a chip rather than assumed.
- **Entity names in the answer are ways into the scene.** Resolved from code spans only —
  models write identifiers as code, English writes "the camera" — and live rather than
  cached, because the tree changes under the conversation and often because of it. An
  ambiguous name resolves to nothing, since a link that is right half the time is worse
  than no link.
- **The agent can see what it drew.** A viewport screenshot is a tool it can call, shown
  expanded in the transcript rather than behind a disclosure.
- **A run's change set, from a history that can say what it did.** Undo entries carried
  opaque closures that could reverse an edit but not describe one; they now describe it,
  so "what changed since this mark" is answerable with real add / modify / remove
  semantics and a field-level before → after.
- **MCP connects from Settings.** It had been reachable only through a launch flag, which
  meant restarting the editor with an argument to let a tool talk to it.

### Fixed

- **A shipped editor can see a project's own components.** Creating a script that defines
  a component and then looking for it in Add Component found nothing — in every build
  anyone has downloaded, and never once while developing. The extractor bundles the
  project's declaration entry with esbuild, which runs as a native subprocess: it cannot
  read inside app.asar, and both paths it was given pointed there — the SDK it inlines,
  and the directory it resolves the declaration from. esbuild refuses an import when the
  importer's directory does not exist, an absolute one included, so the entry never
  resolved. It failed silently on top of that: a refused extract writes no artifact, so
  the last one — usually the empty one — was reloaded and read exactly like "this project
  declares no components", with nothing in any log. The extract now reports its verdict,
  and Extract Component Schemas says so when it fails.
- **The Dawn dependency cache is written from the default branch.** It had been written
  from the release pipeline, which runs on a tag — and a GitHub cache is readable only
  from the ref that created it, its descendants, and the default branch. No tag is any of
  those for the next tag, so every release paid for a cold Dawn build and then wrote the
  result where nothing could read it. Whether a tag run can read the default branch's
  cache is not yet proven; the next release is what settles it.
- **The MCP endpoint has the driver it imports.** A refactor left it importing a surface
  driver that was no longer there, so the endpoint failed to load rather than failing to
  connect — a difference nothing in the UI could tell you.
- **Turning the agent endpoint on from Settings finds a window to talk to.** The setting
  opened it against a window that had never published the automation hook, so the
  endpoint listened and every call answered that there was nothing there.
- **`--build-deps` reaches the builder.** The flag was accepted and then dropped, so
  asking for dependencies to be built did nothing.

## [0.38.0] - 2026-07-30

Games built with v0.33.0 through v0.37.0 install on Android 10 and 11 and then fail to
start: the dynamic linker cannot resolve `APerformanceHint_getManager`, so it refuses
`libestella_js_host.so` and the process dies before any engine code runs. Six releases
shipped with it because CI booted one emulator, API 34, and the fault only exists below
API 31. The rest of this release is a UI port's worth of things that were silently
almost-right — a tween that started at its destination, a text field that could only
look like itself, a skeleton the eye icon did not hide.

### Added

- **Every supported Android version is tested on pull requests that touch the host.** One
  game is built once and installed on one emulator per release, 10 through 16, so a
  difference between two versions cannot be a difference between two builds. Each reports
  launch time, PSS, CPU and frame intervals. The version list comes from the runner's own
  system images rather than a written-down list. There is no pixel judgement in it — a
  legitimately dark scene and a dead renderer produce the same screenshot — so frames are
  published for a person to look at and the gate is limited to install, reaching `ready`,
  and recording no error.
- **A text field can be skinned, aligned, and drawn in the game's font.** `TextInput`
  forced its entity's `UIVisual` to a solid fill every frame, flattening the 9-sliced
  frame a UI pack draws input boxes with; its text was always left-aligned; and it took a
  font *family*, so a field on a panel in the project's own typeface rendered in Arial.
- **A clip anchors each frame, so shifting artwork keeps its feet planted.** `.esanim` 1.4
  adds a clip-wide `pivot` and a per-frame override, both normalized in the frame's own
  space — the space `Sprite.pivot` already uses. A clip that authors no anchor leaves
  `Sprite.pivot` as the entity set it, so existing projects see no change.
- **An activation track can switch a UI node off.** It drove `enabled` on sprites, spine
  skeletons and sprite animators — every renderer except the one whose whole vocabulary is
  show and hide. A UI node has no `enabled`; `display` is its show/hide, and the only one
  that takes the subtree with it, which is what an activation range means.
- **`UIPointerEvents` is exported.** `UINode.pointerEvents` is public and documented, but
  its enum never left the UI module, so the only way to write it was the raw `1`.
- **MCP can create, enter, edit and leave Prefab Mode.** Automation could extract a prefab
  and instance it and then had nothing: no way into Prefab Mode, no way to tell it was in
  one, no Apply / Revert / Unpack / Create Variant, and `get_entity` did not report that an
  entity was an instance at all.
- **MCP can wire a button.** `EventBinding` has no Add Component entry — the Details panel
  adds it implicitly — so `add_component` with that name did nothing. An unknown component
  name is now refused rather than silently accepted.

### Fixed

- **Android 10 and 11 can run a packaged game.** The manifest declared minSdk 26 while the
  NDK was told to build against 33. The NDK decides how to reference an API by comparing it
  with the build target, so a target above the declared floor compiles every
  `__builtin_available` in the host to dead code and turns each guarded symbol into a
  load-time requirement. ADPF is one of those. It is resolved through `dlsym` now, so a
  device that exports it gets a hint session and a device that does not gets none.
- **A game called "Save & Load" builds for iOS.** The app's title goes into `Info.plist`
  verbatim, so a title containing `&`, `<` or `>` wrote XML Xcode could not parse. The
  error named neither the character nor the name it came from. Two of this repo's own
  examples were unbuildable.
- **A tween starts where it says it starts.** `tween.to(...)` left the target at its
  destination until the tween system next ran, so a node created with an entrance showed
  up at its final place for a frame and then jumped off-stage to travel back. The start
  value is taken at creation and held through `delay` — a delay is "start later", not
  "start somewhere else".
- **The eye icon hides a skeleton.** A spine or DragonBones instance lives in a side
  module's table that the renderer submits from, so `SpineAnimation.enabled` was read by
  nobody: the Outliner, the component checkbox and gameplay were all writing into a hole.
- **A particle emitter in the UI tree draws where the tree puts it.** The UI render-order
  pass hands a `UIVisual` its `uiOrder` and a `Sprite` its layer; a `ParticleEmitter` got
  nothing and kept whatever layer it was authored with, landing under or over the whole
  panel instead of between the two elements it belongs between.
- **A text field you blurred by clicking away takes focus again.** Clicking beside a field
  and back into it left it focused with no caret, swallowing every keystroke; only clicking
  a different field first recovered it.
- **The editor keeps the game running when its window is behind another one.** Chromium
  counts "behind another window" as occluded, so clicking anything else dropped the play
  realm to 1-2 fps — indistinguishable from a frozen game, and worse for anything driving
  the editor, which then reads a stalled world. 60 fps unfocused now, the same as focused.
- **The gizmo moves things, not every pixel of the thing.** A press anywhere on a selected
  entity began a free two-axis transform from the first pixel of travel, so a click that
  wobbled slid, spun or resized what you were only trying to pick.
- **A locked entity has no handles.** `setEntityLocked` blocked viewport picking and
  nothing else, so an entity selected from the Outliner — the only way to select a skeleton,
  which has no renderable bounds — still dragged like any other.
- **A timeline previews the thing that plays it.** The Sequencer bound its preview root to
  whatever was selected when the file opened, and opening a clip from the Content Browser
  selects an *asset*, so the root was null: it played correctly and animated nothing.
- **A UI prefab opens in a canvas.** Prefab Mode built its document from the prefab's own
  entities only, and a UI node's box is authored relative to its parent — so every node
  landed at the origin with a degenerate box and nine-sliced art stopped drawing.
- **A missing remembered scene no longer bricks the project.** Deleting a scene file
  outside the editor made `lastOpenedScene` throw on open, leaving the launcher behind a
  toast and no way back in short of hand-editing `.esengine/workspace.json`.
- **A prefab template in an MCP op program makes an instance, not a copy.**
  `apply_scene_ops` created from the prefab's data without the ref that links the result to
  the asset, so the subtree landed as ordinary entities that no longer tracked it.
- **A project's tsconfig opens clean under TypeScript 6.** VSCode 1.130 bundles TS 6.0.3,
  where `baseUrl` is deprecated, so every project stamped from the blank template opened
  with a red TS5101. The `paths` values were already tsconfig-relative, so dropping it
  changes no resolution.
- **The release publish gate installs the tooling it runs.** It could not execute, which is
  why the smoke check has never actually gated a release before this one.

### Changed

- **Android's declared minimum is API 29 (Android 10), raised from 26.** The font path
  calls `AFontMatcher_create`, which is API 29, so 26 was a claim rather than a capability.
  Nothing that ran before stops running.

## [0.37.0] - 2026-07-29

Two things this release is mostly about: what a game does on hardware you do not own,
and text.

v0.36.0's Android template shipped without its precompiled bytecode, so every game
packaged from it opened on a black screen for about fourteen seconds while QuickJS
compiled the SDK bundle on the phone — a first launch a player reports as a crash.
That had two separate causes, a compiler asked for by a name Windows does not have and
an unlinked libm on Linux, and it reached players because the publish gate checked that
an archive was in the release rather than what was inside it. A packaged game now also
keeps a boot-and-crash record in a place its player can find and send, which is the
only way to learn anything about a failure that happens on their device and not yours.
Windows auto-update had been failing for the whole of 0.36.0 as well, on a certificate
the installer should never have been signed with.

And text draws what it has been claiming to. An outline moves the glyph's edge through
the distance field instead of stamping the glyph eight times around itself; `shadowBlur`
softens the shadow instead of being documented as reserved; a line's extra leading is
split above and below the text the way a line box always has, which moves every centred
label in every project down by the tenth of an em it had been floating; and glyphs are
rasterized for the pixels they land on rather than for the design box, which is why
editor text was soft at every zoom except "fit".

### Added

- **A scene can say that a node scrolls.** Scrolling was reachable only by *building* the
  ScrollView widget in code, so a scene could describe every part of a scroll area — the
  clipped box, the oversized child — without the one fact that made it a scroll area. Drop
  a ScrollView from the Create menu and it sat there: clipped, hittable, motionless.
  `UIScroll` is that fact. The behaviour plugin attaches a ScrollContainer to any entity
  carrying one, sized from the box the layout pass resolved rather than the authored
  fields, and moves the content by its insets — the same container and the same input path
  the widget has always used, so the two ways of building a scroll area now differ only in
  who writes the components.
- **An outline moves the glyph's edge instead of stamping the glyph.** Outlined text was
  eight offset copies of itself, which reads as an outline while it is a hairline and
  merges into a blob past a few pixels. The glyphs are already a distance field, so the
  outline is a threshold — the same quads draw the same shape, grown. Carrying the width
  needed a per-draw value the batch path has no seam for, so it rides per *vertex*:
  `BatchVertex` gains one float, which keeps every label in one batch regardless of its
  style. The value is in the atlas's own distance units, so it means the same thing at
  every font size and every zoom, and asking for more than the atlas spread degrades to
  the widest real outline rather than flooding the glyph's cell. Bitmap atlases have no
  distance to move and keep the stamp fan. WebGL2 and WebGPU agree to within a pixel.
- **`Text.shadowBlur` softens the shadow.** The field was in the component, the inspector,
  the scene file and the guide — as "reserved", because the renderer read the colour and
  the offset and nothing else, so a shadow was a second stamp of the text sitting slightly
  below the first. It is now nine taps spread around a ring, with each tap's alpha inverted
  out of the compositing equation rather than divided, so the layers land at the alpha that
  was asked for.
- **A packaged game leaves a record its player can send.** Everything the native host
  reported went to the platform log, which means logcat, which means a cable and a
  developer — so a failure on someone else's phone left its evidence on their phone. The
  host now writes the same lines to a file: the device, the GPU and its driver, which boot
  phase each line belongs to, where the SDK bundle came from, and how long the launch took,
  with the previous run kept alongside so a crash-and-retry does not overwrite the record
  of the crash. SIGSEGV / SIGABRT / SIGBUS / SIGFPE / SIGILL are caught, the signal and its
  phase and the return addresses go in, and then the default handler is restored and the
  signal re-raised so the OS still produces its tombstone. On the launch after a crash the
  record is copied somewhere a file manager will list it — since Android 11 an app's
  `Android/data` is closed to the Files app, so the thing built to make a failure
  reportable was reachable by everyone except the person reporting it.
- **New Script writes the module and the line that makes it run.** A project has exactly
  two script entries, and a module neither of them reaches is dead — never bundled, schema
  never extracted, component never in Add Component. Nobody can be expected to know that
  before they have seen a project laid out, so the editor writes both halves: a component
  is re-exported from the declaration entry, a system is imported by the startup entry, and
  the entries come from the manifest rather than a conventional pair. The dialog shows what
  will be written and which line the entry gains, and refreshes the schemas rather than
  waiting on the watcher, so a component is in Add Component the moment it closes.
- **MCP: name a scene, address one member, hand over a program too big to say.** A scene
  file could only be called `scene.esscene`, which is fine for the first one and collides
  on the second. A field path naming one member of a structural field was rejected —
  `"Transform.position.x"` appeared in the tool's own description while the surface threw
  on it — and now resolves to the field plus an index, reads the rest and writes it back.
  And an op program had to arrive inline: a panel of a few hundred entities is a few
  hundred KB of JSON, which does not belong in a message, so `apply_scene_ops` takes an
  `opsPath` to a project file instead.

### Fixed

- **A published template is checked for what is inside it.** The publish gate listed the
  release's asset *names*, and a zip missing half its contents passes that. v0.36.0's
  Android template shipped without its precompiled bytecode and nothing between the build
  and the store looked inside the archive. The reason it could go unnoticed is that one
  `optional` flag answered two different questions: a contributor's local build without the
  bytecode is fine, because the host compiles and caches instead, but a *published*
  template without it ships that first launch to every game made from it. Those audiences
  are now separate, and the check reads the archive's central directory against the drafted
  release before it is made public.
- **The Android template carries its bytecode.** Two causes, and the first hid the second.
  The precompile step shells out to a C compiler and asked for `gcc` on Windows — the one
  name a machine set up for this build is least likely to have — so it built through CMake
  instead, which the native build already requires and which finds whatever is installed.
  Then the step linked no libraries at all, and QuickJS needs libm: macOS carries the math
  functions in libSystem so a bare `cc` links there, Linux does not, and the Ubuntu runner
  is the one that builds the Android template each release publishes. Clean install to
  first frame on a Xiaomi 15 is now under four seconds.
- **A packaged game starts in the orientation it was authored in.** The headless export read
  orientation from a top-level key the project format does not have, so the fallback always
  won and a 600x1080 shmup shipped as a letterboxed landscape app. It calls the same
  `resolveOrientation` the editor's own export does; reading the manifest by hand is how the
  two drifted apart.
- **The Windows installer is no longer signed with the macOS certificate.** `CSC_LINK` is
  electron-builder's platform-*neutral* variable and the release workflow exported it to
  both legs of the matrix, so the NSIS installer was signed with the project's Apple
  Developer ID and that identity was stamped into `app-update.yml`. Windows cannot build a
  chain to a trusted root for an Apple-issued certificate, so every Windows auto-update
  failed — after downloading the whole installer. The secrets are scoped to the macOS leg
  now, and a guard after packaging fails the release on anything other than NotSigned or
  Valid. Installs already carrying that pin refuse every update they can never verify, so
  the editor settles it up front instead of at the end of a download.
- **A Spine sequence stops sampling empty atlas space.** A sequence swaps which atlas region
  an attachment points at, and with the region goes the page — spine-c does that swap inside
  `computeWorldVertices`, and this draw loop read the texture *before* that call and the uvs
  after. A sequence whose frames sit on one page was fine by luck; effect flipbooks are
  exactly the ones that span pages, so every glow, energy trail and ground pool drew the new
  frame's uvs against the previous frame's texture and simply was not there. The same file
  also gated the premultiplied *tint* on whether the blend code got a premultiplied twin, so
  a Multiply or Screen slot on a premultiplied page stopped fading correctly; both backends
  now key both decisions off the one fact.
- **A Spine skeleton exported as JSON is an asset.** Spine 2.1 has no binary export, so a
  project on that runtime ships a plain `.json` — and the `.meta` mint door typed files by
  extension and name suffix only, so the skeleton never entered the registry and the
  Skeleton Path picker was empty. Everything downstream already handled it. The file→type
  table gained a third criterion beside extension and suffix, a marker in the content: a
  JSON skeleton is claimed by the same `"skeleton":{..."spine":"<ver>"...}` header the
  runtime's version detection reads, so the editor and the runtime cannot disagree. Only the
  head is read, and only for extensions a name cannot type. The same table could not type a
  DragonBones pair either; added alongside.
- **The Create popover offers the project's components.** It read the engine's user-component
  registry, but the editor deliberately never executes project code, so that registry only
  ever held what the *editor* realm defined — empty for every project that has ever opened.
  It reads `schemas.json` now, the same source Add Component has always read. The Create
  catalog was also assembled inline in the popover, so `listEntityTemplates` had only the
  static half and `create_entity` could not spawn a project component or a prefab the
  popover was happy to show; one source now backs all three.
- **A lineHeight's extra space belongs half above the text, not all below.** The baseline was
  placed a flat 0.8em under the line's top, so everything a lineHeight adds beyond the em box
  landed below it and a centred block sat `(lineHeight - 1em)/2` too high — 0.1em at the 1.2
  default, which a real UI pack showed as a visible 6px on a 60px number. Every centred label
  in every project moves down by that half-leading, which is where they should have been.
- **Glyphs are rasterized for the pixels they land on, not the design box.** Bitmap text
  rasterizes per display size, but the size it asked for came from the box UI lays out in,
  and that box is deliberately pinned to the design size in the editor so UI does not reflow
  while the view zooms. The two agree in a shipped game and nowhere else, so editor text was
  rasterized for the design scale and then scaled by the camera. It also explains why SDF
  looked so much better in the editor: it was the only pipeline not being asked for the wrong
  size.
- **A scene batch that fails leaves the scene alone.** `apply_scene_ops` promises that a throw
  anywhere rolls the whole batch back, and it rolled back field writes — all a gesture knows
  how to undo. Every structural edit stayed: a program that spawned sixteen entities and then
  hit a bad field path left sixteen entities behind, under an error saying the batch had
  failed. The suite already claimed to cover this while faking the transaction with a rethrow,
  so the assertion could only ever pass.
- **Opening a scene stops throwing away the scene you just built.** A person who opens a scene
  over unsaved work gets asked about it; a driver got nothing, and the panel it had just
  authored was gone while the call returned ok. It refuses now, and names the two ways out —
  `discardChanges` is one of them, because throwing edits away is a legitimate thing to want
  and should be said out loud.

### Documentation

- **Where a device failure leaves its evidence, and who can actually fetch it.** What the boot
  record holds, what the phase lines mean, how a crash reads, and how to symbolize the
  addresses — plus the sentence to give a player who has no cable: open it once more, then
  send the newest `estella-crash-*.log`. The first-launch section also described a build
  machine with no compiler as producing "a working app that compiles on first run", which is
  true and reads as harmless; it costs that launch ten seconds on a screen a player reads as
  a hang, and v0.36.0 shipped exactly that way.

## [0.36.0] - 2026-07-29

A game is run at the screen it was authored for. The target device shaped the edit
overlay and nothing else, so a project made for a phone was only ever *played* at
whatever shape its panel happened to be dragged to. One selection now drives editing
and both play hosts, the device list is the project's own to extend, and each screen
carries the safe area it should be tested against.

The UI toolkit also gained the pieces a real UI package turns out to need — subtree
opacity, a pointer gate, masks that clip to what they draw, `object-fit`, and a font a
game ships itself — while 9-slice borders, which had been dropped everywhere outside
the edit viewport, now survive Play and a packaged build. Underneath, the source tree
was reorganised: the renderer separates the device from the frame that drives it, the
SDK's modules found shelves, eleven build trees became one, and the guards that police
those boundaries fail when the layout drifts instead of going quiet.

### Added

- **The target screen now governs the running game, not just the canvas you author
  against.** The device selection shaped the edit overlay and nothing else: a game played
  in the viewport or the Game panel filled whatever space the dock happened to have, so a
  project authored for a phone was only ever *run* at whatever aspect its panel was
  dragged to. One selection now drives all three views — editing previews it, and both
  play hosts letterbox to it. The Game panel gained an overlay bar carrying that control
  plus a readout of the simulated size. `Design` stays the "no simulation" choice, so a
  desktop project is unchanged. The letterbox is applied to the element hosting the realm
  rather than inside the engine, so the realm sees a canvas of the device's shape and its
  own `ScreenScaling` adapts exactly as it would on the hardware.
- **A project declares the screens it tests on.** The built-in device list is a guess, and
  a guess nobody can correct means everyone tests on approximately the wrong screen.
  `screenPresets` in `project.esproject` adds rows to the dropdown, editable in Project
  Settings → Display (id, name, portrait size, and safe-area insets behind a per-row
  expander). An entry reusing a built-in id **replaces** that built-in, so a studio can
  make "iPhone" mean the exact handset it ships to and every saved selection still
  resolves. Presets ride version control with the project.
- **UI: subtree opacity, a pointer gate, mask shapes, and `object-fit`.** `UINode.opacity`
  multiplies down the tree like CSS `opacity` (fading a panel no longer means touching
  every visual's alpha) and `UINode.pointerEvents = None` makes a node and its subtree
  transparent to the pointer, so a decorative overlay stops eating clicks. Both resolve in
  the same hierarchical pass that already resolves `display`. `UIMask.alphaCutoff` above 0
  clips to the shape the mask *draws* instead of its box, so a circular avatar frame stops
  cutting a square. `UIVisual.fit` is CSS `object-fit`: `Contain` letterboxes the image
  inside its box, `Cover` crops it — neither distorts art whose ratio differs from its slot.
- **A game can ship its own font.** `Text.font` is a real asset reference to an imported
  `.ttf`/`.otf`, so it rides the same machinery as every other asset slot (dependency
  tracking, cook inclusion, `@uuid:` refs, hot update, ref counting). Previously `Text`
  could only name a family the *host* already had, which on native meant there was no
  answer at all. Shipped fonts are not a second text path — the loader mints a family name
  and the pipeline still speaks one language for "which typeface".
- **Drag a 9-slice border on the texture instead of typing four numbers.** The asset
  inspector draws the four guides on the preview and they are draggable; the numeric
  fields stay in sync for exact nudges.
- **Ordering a group of systems, written once.** `defineSystemSet` puts systems under one
  name, so a run condition and the ordering edges are stated for the group instead of
  repeated per member — and anything ordered against that name waits for all of them.
  `App.addSystemSet` had been there for a while with no exported way to build its
  argument; `defineSystemSet` and its types are public now. Ordering also travels on the
  system definition itself, which is what finally gives the top-level `addSystem` — the
  path examples and game code actually use, and the one that takes no options — a way to
  say "after that one".
- **An agent can build a scene through MCP, not just poke at one.** The editor's MCP
  surface could observe anything and change one field at a time — fine for a tweak,
  hopeless for authoring. `apply_scene_ops` runs a program of create/parent/component/field
  ops as one undoable, atomic batch: if any op fails, the error names it and the whole
  batch rolls back rather than leaving a half-built subtree.

### Fixed

- **9-slice borders were dropped everywhere except the edit viewport.** A frame that
  sliced correctly while authoring stretched the moment you pressed Play, and would have
  stretched in every shipped build. Three separate breaks stacked: scene preloading asked
  the import-settings resolver with the *resolved* path while suppliers key by the
  authored ref; the editor keyed its Play payload by `@uuid:` alone, so a ported or
  hand-authored scene holding paths got nothing; and assembling the addressable manifest
  dropped the importer block entirely, so a packaged build had no channel for the `.meta`
  at all. Import settings now travel with the asset through one description that Play, a
  playable and a cooked build all read.
- **Orientation was a clickable no-op for the default screen.** Landscape/Portrait took
  clicks and changed nothing while `Design` was selected — there is no screen being held
  one way when none is simulated. The rows are disabled with a note saying what enables them.
- **Concurrent writes could corrupt `project.esproject`.** Every project-settings writer
  did an unserialized read-modify-write of the manifest, so two edits in flight both read
  the pre-edit file and the second landed on top of the first — losing it, or interleaving
  into JSON that no longer parses. Typing across the fields of one settings row produced
  exactly that. All manifest patches now queue on one chain.
- **A DragonBones armature ignored its Color.** The field was in the inspector and
  did nothing — the runtime's ABI had no tint entry point, so the value was
  authored, saved, and dropped. It tints now, and **multiplies** each slot's own
  colour rather than replacing it, so what an artist set in DragonBones Pro
  survives being tinted. Opaque white is the tint that changes nothing, which is
  what makes clearing the field restore the original instead of leaving the last
  colour stuck. Per entity, so one of two figures sharing a skeleton can be tinted
  alone.
- **Three engine systems declared an execution order that never reached the scheduler.**
  `defineSystem` accepted `runBefore` / `runAfter` and then discarded them, so the
  character controller was not in fact running before the physics step, and neither drag
  system was running after UI interaction — each landed wherever registration order
  happened to leave it. Edges now travel with the definition and combine with whatever the
  registration site or the enclosing set adds, rather than one silently replacing the
  other.

## [0.35.0] - 2026-07-28

A second skeletal runtime. Estella has animated Spine skeletons since 0.19.0;
DragonBones is the one most Chinese studios author in, and until now the only way
to use it was to export something else. It runs everywhere the engine does — the
editor viewport, Play, web, playable ads, mini-games, and compiled into the iOS
and Android hosts.

Also: the editor can now create a plugin rather than only load one, it updates
itself instead of handing you a link, and a game that you leave stops rendering.

### Added

- **DragonBones animation.** Drop a `_ske.json` (or `.dbbin`) and its `_tex.json`
  into a project and they import as one asset type, the way Spine's `.skel` and
  `.atlas` do. **Create → DragonBones** makes an entity; the Details panel picks
  the armature and the animation from dropdowns filled by reading the file the
  entity points at, so you choose from what is actually in it rather than typing a
  name and finding out at runtime. The armature poses in the viewport as you edit —
  changing the animation, the scale or the flip shows immediately, without pressing
  Play.

  Two things differ from Spine, and the editor says so rather than papering over
  them. A DragonBones file is a *project* holding several armatures, so choosing
  one is a real step; and blending happens when an animation starts, not from a mix
  table set on the skeleton, so a crossfade is `fadeIn(name, seconds)` and the
  component carries a **Fade In Time** used on the first play too.

  Entities pointing at the same pair share one parsed skeleton and one atlas — ten
  of a character parse the file once. A packaged game carries the runtime only if a
  scene actually uses it: nothing is fetched, inlined or copied for a project
  without an armature in it.

  The new `dragonbones-demo` example is the whole feature in one scene.

- **The editor creates plugins.** The plugin system could load and run one but
  never help you make one — the guide's first step was "create the folder". There
  is a scaffold now: the manifest, an entry, a tsconfig and the typings sidecar it
  points at, with the id validated by the same function the loader uses, so the
  dialog cannot accept a name that would later be rejected. What a loaded plugin
  contributes is listed, and a plugin ships as a single file.

- **Settings → External Tools.** The script editor, the image editor and the
  browser. The script row is not a blank field: the editors actually installed are
  detected and offered, and leaving it alone means *automatic* — which names the
  one it would pick, so the row answers "what happens if I do nothing?".
  A code editor is handed the PROJECT and then the file, because a `.ts` opened by
  itself has no tsconfig: the SDK types staged into the project resolve to nothing
  and correct code gets red squiggles. Which arguments a program wants is derived
  from what it IS — its executable's name — so a VS Code browsed to by hand, in a
  directory nobody would guess, still opens the project. Anything the catalogue
  does not recognise gets the file alone: a paint program handed a directory would
  open the project folder as an image. A slot is registered rather
  than hard-coded — an asset type declares which kind of program opens it, the way
  it already declares its icon — so a plugin's type can say "open me the way
  scripts are opened", or bring a slot of its own, and the settings page grows a
  row without knowing it exists. Paths are per-user: an absolute path to an
  executable is true of one machine, and in project settings it would be committed
  and then be wrong for everyone else who opened the project.

- **The editor updates itself.** Until now an update notification could only hand
  over a link: the build is unsigned, and silent auto-update needs a signature it
  did not have. The check, the download and the install are now the editor's own —
  progress reports into the toast that announced the update, and the button becomes
  Restart when the download lands. The download comes from whichever source
  answered the check, mirror before origin, so it is as fast as the check was.
- **The macOS build ships a zip alongside the dmg.** Not a second thing to
  download — it is what an in-place update installs from. Squirrel.Mac swaps in a
  whole signed `.app`, which a dmg is not.
- **Releases can be signed and notarized.** `release-desktop.yml` reads five
  optional secrets (`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). Unset — on a fork, or before a
  certificate exists — the build still produces installers, and the editor keeps
  handing macOS users a link, because it checks its own signature before offering
  to update in place rather than discovering the problem after a 200 MB download.
- **The mirror publishes the updater's feed, and proves it.** `latest.yml` and
  `latest-mac.yml` are copied beside the very files they name, under their real
  names, so nothing has to be rewritten and no url is composed. Every file the
  channel files name is then fetched over the public base, and the mirror job fails
  on a miss — a feed naming a file nobody can fetch is an update that dies at the
  download.

### Fixed

- **A game you left kept rendering, and the phone got hot.** The Android host's
  frame loop had no pacing of its own: it called the frame immediately, forever,
  and trusted the swapchain's vsync present to be the thing that slowed it down.
  When a present did not block — a surface being torn down returns instead — the
  only brake was gone. A backgrounded demo was found 11.5 million frames in,
  holding a quarter of a CPU core to draw about one frame a second. The display
  drives the frame now, through the Choreographer, which is what iOS already does
  with a CADisplayLink and the web does with `requestAnimationFrame`; and frames
  stop when the game is not the thing you are looking at. Backgrounded, it now uses
  no measurable CPU at all.
- **Animations ran fast on a high-refresh phone.** The host stepped the game at a
  fixed 1/60s while presenting at whatever the panel runs at, so a 120 Hz device
  played everything at 2.02× — which reads as "the animations are too quick"
  rather than as a clock bug, and is why it lasted. A frame now reports the time
  that actually passed, clamped the same way the web loop clamps it, so a game
  behaves the same after a stall wherever it runs. Fixes iOS and Android together.
- **Double-clicking a script did nothing.** The open table only knew about editors
  the editor ships, so every type without one — `.ts`, `.js`, `.esshader`, `.png` —
  fell off the end of it in silence. Opening now always resolves to something: the
  editor's own editor, then the program set for that kind of file, then whatever
  the OS opens it with. The Content Browser's **Open** entry appeared for folders,
  scenes and materials only, standing in for "is this openable at all?"; that
  stopped being a real question, so it is offered for everything.
- **Reordering in the Outliner did not change what you saw.** Scene order is paint
  order within a sorting layer, and the viewport kept drawing the old one until the
  scene was reopened — so a drag changed the saved file, Play and the exported game
  while the thing in front of you disagreed. Measured on three overlapping sprites:
  identical pixels after the drag, a different picture after reopening. Order is a
  projected change like every other one now.
- **A field driven by a controller ignored your edit.** Details showed the
  component's own value, took the change, and the gear overwrote it from the
  current page on the next frame — with nothing to say the field was driven,
  because the marker only appeared while the Controllers strip had a controller
  selected. Being driven is a fact about the scene, so all of it is read from the
  binding now: the field shows what applies, says it is driven, and an edit reaches
  the page it belongs to.
- **A clicked button stayed lit.** Pressing focuses it (so Enter and Space act on
  what you clicked), the driver ranked `focused` above `normal`, and the Button
  prefab painted `focused` the same grey as `hover` — so a mouse-clicked button
  wore the hover look until focus moved somewhere else. Reported by someone who
  recoloured `normal` and never saw that colour again. Focus now has a colour of
  its own.
- **The update toast's Download button 404'd.** It opened a directory url that
  object storage has never served — for anyone, on any release. It was composed in
  two places and verified in none; both now use the link the release job already
  publishes.

## [0.34.1] - 2026-07-27

0.34.0 made a game packageable for Android. This one makes the package
installable — it was refused by the phone, twice, for reasons no check we had
could see.

### Fixed

- **Android: the packaged APK would not install.** `android:configChanges` and
  `android:screenOrientation` are names for numbers. Shipped as the strings they
  look like, the platform runs `Integer.parseInt` over them and gives up on the
  whole package (`INSTALL_PARSE_FAILED_UNEXPECTED_EXCEPTION`, naming the flag
  list it could not read). Both encoders now resolve those through one table of
  AOSP's values, so the APK's manifest and the bundle's cannot disagree about
  what a word means. It then still would not install: an activity with an intent
  filter and no explicit `android:exported` is refused on Android 12+, and ours
  declares one — which the platform could not find, because it reads attributes
  by resource id with a search that assumes the array is sorted, and ours were in
  document order. They are sorted now. The regression tests read the compiled
  manifest the way the platform does, by resource id, rather than rendering it
  back as text — a decoder that prints the manifest shows the flags spelled out
  and looks correct, which is how this shipped.
- **Scrolling a dropdown's own list closed it.** The action name in an Events row
  is a suggestion list, and scrolling it dismissed it — so the only options
  reachable were the ones that happened to fit. Same for any Select with more
  options than its popover shows, and any long context menu. A popover is placed
  from a rect captured when it opened, so it has to close when the page moves
  under it; the listener that notices is on the window in the capture phase,
  because a scroll inside a panel reaches it no other way. What that caught as
  well was the list's *own* scrolling. It now ignores a scroll whose target is
  inside the popover — the one kind that means the list is being used rather than
  moved — and Menu shares the fix rather than getting its own.
- **A release publishes only once it carries everything.** 0.33.0 went public with
  no runtime templates, so every editor's Download button 404'd and nothing
  noticed; the job that uploads them then failed again while 0.34.0 was cut,
  because it runs the repo's own CLI without installing what that CLI imports. It
  now uses the shared toolchain setup like every other job, and the pipeline ends
  with a check that the draft carries both installers, both update manifests, the
  template index and a template per platform — naming whatever is missing — before
  flipping the release public.

## [0.34.0] - 2026-07-27

Shipping, continued. 0.33 made Android and iOS packageable; this release makes
what comes out of them **yours to finish** — Android exports an Android Studio
project beside the APK, so a game that has to add an SDK, a permission or an
Activity is no longer stopped by an assembled package it cannot open. The runtime
templates those targets need are published with the release for the first time,
and downloaded from a **mirror** that is asked before GitHub and proves itself
before being trusted.

Spine grew in both directions at once: **2.1 through 4.3**, which meant binding a
runtime that no longer exists as C and one that predates most of what the modern
one assumes. And the editor became extensible — plugins contribute inspectors,
overlays, tools, asset types and menus.

### Added

- **Spine, from a 2015 editor to the current one.** A project authored in Spine
  **2.1** or **4.3** used to open as nothing: the runtime reads the version out of
  the skeleton, and neither matched anything the engine vendored. Both now do, so
  the supported set is **2.1 / 3.8 / 4.1 / 4.2 / 4.3** — each a WebAssembly backend
  loaded only by a project that uses it. 4.3 could not simply be added: that
  release deleted the hand-written C runtime and regenerated it as a wrapper over
  the C++ one, so the module binds spine-cpp directly and renders through spine's
  own `SkeletonRenderer`. 2.1 is the opposite end — colour as loose floats,
  weighted meshes as their own attachment type, no clipping and no transform or
  path constraints — and its runtime shipped **no binary reader**, so a `.skel`
  from that era is refused by naming the export setting to change rather than
  failing as a corrupt file. Export 2.1 skeletons as JSON.
- **Android: export the project, not only the package.** *Package as* in the
  Android section now offers an **Android Studio project** beside the installable
  APK — the route for a game that has to add an SDK, a permission, a service or an
  Activity of its own, which an APK is a dead end for. It is an ordinary Gradle
  project: your content under `app/src/main/assets`, the engine's prebuilt
  libraries under `jniLibs`, the host's Java shim as source, and identity in
  `app/build.gradle.kts` where AGP reads it. Both outputs come from the same
  runtime template, so the choice costs nothing. **Re-exporting rewrites the game
  and leaves the build scripts alone** — a project that has grown an SDK survives
  its game being rebuilt.
- **Downloads come from a mirror, and prove themselves before being trusted.** The
  editor asks a Cloudflare copy of each release before GitHub — measured at **3.0
  MB/s against 2.0** from Shanghai — for both the runtime templates and the update
  check. Preferring a mirror is safe because trusting one never was: every archive
  is checked against the size and SHA-256 the release's index states, and a copy
  that is missing, stale, truncated or substituted fails that check and hands the
  download to the next source, ending at GitHub. `ESTELLA_RELEASE_MIRROR` points
  the editor at a company share, an offline copy, or nothing at all.

- **One package installs on a phone AND in an emulator.** A runtime template is
  now one artifact per PLATFORM rather than one per architecture — iOS already
  worked that way, with both slices inside one xcframework — so the Android
  template carries `arm64-v8a` and `x86_64` together and every package it
  assembles offers both. Nothing to choose, and no second template the editor
  would never ask for.
- **iOS: the first launch after an install is as fast as the rest.** The runtime
  template now carries the SDK's precompiled bytecode on iOS as it already did on
  Android, and the export ships it as a bundle resource — so the host reads the
  compile instead of parsing a ~700 KB bundle on first run. Measured in the
  simulator: **4.5 s → 9 ms**. And when bytecode is declined for any reason, the
  host now says which source it declined and why, rather than silently falling
  back to a parse that only shows up as a slow launch.
- **A packaged game carries its own icon.** *Project Settings → Packaging → App
  Icon* takes one square PNG (1024×1024 is ideal) and every installable target
  uses it: Android as the launcher mipmap, iOS as the asset catalog Xcode derives
  its sizes from. Nothing resizes it — both platforms scale, so one image is all a
  project keeps. Android needs a resource table for this (`android:icon` must be a
  reference, not a path), and that table is now written directly in both encodings
  — `resources.arsc` for the APK, `resources.pb` for the bundle — rather than
  bringing aapt2 back to build one. Projects that set no icon ship Estella's mark
  instead of the platform's placeholder.
- **Google Play: Package Project writes the App Bundle (`.aab`) too.** Play has
  required a bundle rather than an APK for new apps since 2021, so packaging for
  Android stopped at sideloading. Tick **Google Play App Bundle** in the Android
  section (or `cli native --package --aab`) and the export writes one beside the
  installable APK — the same content from the same template, with the manifest in
  aapt2's protobuf encoding and a JAR signature, which is what a bundle is. Still
  no JDK: the PKCS#7 block is written directly. The manifest is parsed once and
  written twice, so the bundle and the APK cannot describe different apps — a test
  decodes both and compares them, and CI validates the bundle with `bundletool`.
- **Runtime templates are published with the release, and the editor downloads
  them.** The Android and iOS rows offer **Download** (with progress) beside
  *Install from file…* for offline installs and mirrors. What is downloaded is
  checked against the digest in `native-templates.json`, which the release
  publishes beside the archives — a truncated download, a proxy's cached copy or a
  captive-portal login page fails by name instead of installing as a broken
  template. Dawn and QuickJS-ng are now **pinned** in `toolchain.manifest.json`
  and fetched by `cli native --fetch-deps`, which also removes the hand-run cmake
  recipes from `native/README.md`: the build produces Dawn for a target the first
  time it needs it, so CI and a contributor run the same two commands.
- **Android: Package Project hands back a signed APK, with no Android SDK.** With
  the Android runtime template installed, the editor compiles the manifest to
  binary XML, writes the aligned zip and signs it with **APK Signature Scheme v2**
  — so packaging needs no aapt2, no zipalign, no apksigner and no JDK, on whatever
  OS the editor is running on. Signing uses a development key generated on first
  use (an RSA key and a self-signed certificate in PEM, inspectable with
  `openssl`); `--key`/`--cert` sign with your own. Native libraries now ship
  **uncompressed and 16 KiB-aligned** (`extractNativeLibs=false`), which the OS
  maps straight out of the package — a smaller install, and the posture Android
  15's page size wants. Each of the three formats is verified against an
  implementation that is not ours: the signature by a from-spec Python verifier,
  the manifest by androguard and its resource ids by AOSP's own table, the archive
  by a real `unzip`.
- **iOS runtime templates — shipping to a phone no longer needs the engine
  sources.** A native app's compiled half (the engine, Dawn, QuickJS, the linked-in
  Box2D / Spine / video runtimes) carries no project data, so it is now built once
  per release and shipped as a **runtime template** you install into the editor,
  instead of every developer cloning the engine, building Dawn (multi-GB) and
  installing a CMake/Ninja/xcodegen toolchain to package a game. **Package Project
  → iOS** with one installed writes a complete, double-clickable Xcode project
  around the exported content — the only thing left is Xcode itself, which Apple
  requires. The iOS row says which template it wants and installs one from a file;
  a template is matched **exactly** against the editor's version, because the SDK
  bundle is compiled into the app binary. `cli native --target ios` emits the
  template for the machine it built on (`--template-out` writes the distributable
  archive), so an engine checkout is now only what *produces* a template, never
  what consumes one.

- **Editor plugins.** Extend the editor with your own TypeScript: commands (with
  keybindings, palette and menu entries), dock panels, Inspector sections,
  viewport gizmos and tools, asset types, entity templates, settings, and
  Outliner/Content-Browser context-menu rows. Plugins live in
  `.esengine/plugins/<id>/` (or per-user, across projects), need **no build
  step** — the editor compiles them and re-compiles on save, re-activating the
  plugin and reopening its panels — and get full typings with nothing to install:
  the editor writes `@estella/editor-api`'s declarations into the project so they
  always match the running editor. A plugin registers through the same registries
  the editor's own features use, so a contributed command *is* a command and a
  contributed panel *is* a dock panel; scene edits go through the editor's command
  layer, so they are undoable and survive Play → Stop. Errors are attributed in
  the Output Log, timed in the profiler, and a repeatedly-failing plugin is
  disabled rather than allowed to break a surface. See the
  [Editor Plugins](https://esengine.github.io/estella/guides/editor-plugins/) guide.

### Fixed

- **Spine: a mesh weighted to more than three bones corrupted the heap.** The
  vendored spine-c read a weighted mesh's vertices into a buffer sized for three
  bones per vertex, and a fourth wrote past the end — so a binary skeleton whose
  meshes bind more bones than that could take out whatever was next to it in
  memory. Upstream's fix grows both buffers; the 4.2 runtime is updated to it.

- **The iOS host did not compile.** A `__weak` reference had landed in
  `platform/ios.mm`, which builds under manual reference counting — so every iOS
  build had been failing since. Now `__unsafe_unretained`, which is what a
  non-owning reference means in that file.
- **`cli native --target ios` merged whatever slices it found.** Building the
  device slice and then running in the simulator quietly linked a months-old
  simulator slice, so the app under test was not the engine that had just been
  built. The framework step now names a slice that predates the SDK bundle
  compiled into it.

### Security

- **Project platform profiles now require approval.** A `.esengine/platforms/*.mjs`
  packaging profile is imported into the editor's main process with full system
  access, and used to be loaded with no prompt the moment anything asked what
  platforms a project could package for — while the *less* privileged renderer
  plugins were gated. Both now pass one trust prompt and appear in one list
  (Window ▸ Plugins). An unapproved profile is not imported at all, and says so in
  the Package dialog instead of showing an unexplained not-ready target. The file
  format is unchanged; existing projects need no migration, only a one-time
  approval.

## [0.33.0] - 2026-07-26

Shipping. Two targets stopped being foundations and became things you can
actually upload: 0.32's native mobile host became **Android** and **iOS** rows in
the Package dialog with no subsystem left un-ported, and the **playable** target
grew per-network profiles. Every ad network disagrees on three things — how big
the file may be, what must sit in `<head>`, and which function sends the player to
the store — so those three are now a per-network **profile**, and the networks the
editor ships are written against the same contract a project uses to add one we
don't. The rest came out of packaging all 41 examples for web and playable and
booting every single one, which is how the bugs below were found rather than
shipped. No project/asset format or WASM ABI break.

### Added

- **Android and iOS package from the editor.** 0.32 shipped the native platform
  seam; this release makes it a target you pick. Two rows, not one "Mobile": they
  package through different toolchains (aapt2 + apksigner vs Xcode), so a single
  row could not say what to run, whether this machine can run it, or where the
  package comes out. The export writes app **content** (the engine, SDK and game
  runtime live in the app binary) plus an `app.config.json` carrying the identity
  the OS needs; `cli native --package` assembles it, and an iOS export writes the
  **Xcode project** itself when the engine is built for iOS on that machine.
  A missing native toolchain is reported as a *different severity* from a missing
  engine runtime — the content is written either way, and assembly can run on
  another machine.
- **Every subsystem now runs on a device.** Physics, Spine, video, text (OS-font
  glyph rasterization), materials and `.esshader`, KTX2 with mip chains, audio
  (miniaudio), the platform soft keyboard, HTTP over the OS stack, app lifecycle
  and memory warnings. The three that ship as WebAssembly side modules on the web
  are compiled into the host binary instead, and `app.sideModules` still answers
  for them, so the runtime's feature gating is unchanged. The export names any
  subsystem a target cannot render, with the scenes that use it, rather than
  quietly shipping half a scene — no target currently has a gap.
- **`alwaysInclude` asset groups.** A build ships what it can *reach* from the
  entry scenes, which is blind to anything only code names: a texture in rich-text
  markup, a clip played by url, a prefab spawned by path. Those were culled, and
  the first anyone heard of it was on a device, because the editor serves the
  project straight off disk. A folder can now say `alwaysInclude`
  (**Content Browser → right-click → Delivery**), in the same `asset-groups.json`
  that already decides local / subpackage / remote. Off by default: reachability
  is what keeps a build from shipping everything.
- **Playable ad networks.** A network is a `PlayableAdProfile` — data plus two
  emit hooks — chosen in **Package Project → Playable → Ad network**, where the
  other per-build decisions already live (shipping the same game to several
  networks is an ordinary week, not a project property). Each network gets its own
  output folder, so packaging for one no longer overwrites the last. Ships Meta,
  Google App campaigns, Unity Ads, AppLovin and a generic MRAID profile, each
  written from that network's published spec with its size cap attributed to where
  the number came from — a stale figure is then checkable rather than folklore.
- **A network the editor doesn't ship.** Drop `kind: 'playable'` in
  `.esengine/platforms/<id>.mjs` (or scaffold it from the dialog) and it appears in
  the same dropdown, resolved by the same loader, packaged by the same pipeline —
  supporting a network is never a privileged path. The selected profile names the
  file that defines it with a reveal button, and one that fails to load reports why.
- **`playableCta()` / `hasPlayableCta()`.** The one call a game makes when the
  player takes the call to action. Game code never names a network: the export
  injects the bridge this dispatches through, and with no network selected it is a
  no-op, so the same scene still runs in the editor and on the web.
- **ZIP delivery.** A profile can declare `delivery: 'zip'` (Google accepts only an
  archive); the export writes `playable.zip` with `index.html` at the root and
  measures the LIMIT against the archive, since that is the file being uploaded.
  The writer is deterministic — a fixed timestamp, so the same input yields
  byte-identical output — and is tested against the system `unzip`.

### Changed

- **A playable no longer pins screen orientation.** Inside an ad SDK the container
  is the SDK's business, so `@media (orientation:portrait)` reports the container
  and turning the phone need not change it — the rotate-to-fit overlay could hide
  the canvas for good. Playables stay responsive (every network asks for that);
  the orientation is only *declared* where a platform wants it, e.g. Google's
  `ad.orientation` meta tag. The web export keeps the overlay, where a player
  opened the page themselves and the query really does track the device.
- **The `-t playable` engine target is retired.** It built `esengine.single.js` and
  an inline demo HTML template that nothing had read for a long time — the playable
  export inlines the WEB runtime (glue as a blob module, wasm as base64). Its sync
  mapping was also what `wasm.manifest.json` derived its variant list from, so the
  manifest now names the two variants that exist. The guides stop telling you to
  run it before a first playable export.
- The Package dialog no longer resizes under the cursor when you switch target: its
  height came from its content while the dialog is centred, so every switch jumped
  the window. Fixed height with a viewport cap, content column scrolls — the way
  the settings dialog already worked.

### Fixed

- **A playable's video played nothing.** The scene loader installed the realm's
  `resolveRef` as the video resolver, so a clip ref resolved only to a logical
  path. On the web that path IS the URL, so it played; a single-file playable has
  no such file, so every clip drew a blank white quad. Ref → path → the backend's
  URL for that path, which is the inlined data URL for an embedded realm.
- **A web build's own orientation-lock script was blocked by its CSP.** The policy
  listed the import map's hash only, so the browser refused the sibling inline
  script: every export logged a violation and shipped without the lock. Both hashes
  are now derived from the source that emits them, gated by a test that hashes
  whatever inline scripts the page actually has.
- **The installer carried local export output.** The examples/templates filters
  excluded `**/dist/**`, but an export writes `dist-<platform>` — so whatever a
  developer had exported rode along inside the example it came from (57MB of
  examples, 43MB of it stale packages). CI escaped it because those dirs are
  gitignored, which is why it went unnoticed.
- **`dist` claimed to build installers but skipped `bundle-mcp`**, so a locally
  built installer declared `dist-electron/mcp` in `asarUnpack` with nothing behind
  it. Both dist scripts now go through `build`, the single producer. (CI runs
  `build` separately, so published releases were intact.)
- A playable ad network created from the dialog is selectable immediately instead
  of only after reopening it, and stays findable afterwards.

### Performance

- **Fresh-install-to-first-frame on a device: 14.4s → 0.6s.** QuickJS is an
  interpreter and parsing the SDK bundle costs about fourteen seconds; the host
  cached that compile, but a cache does not exist until one launch has paid for it
  — and that launch is the one right after an install. The bytecode is now built
  with the app and rides along in its assets, each source carrying a hash of the
  bundle it came from so a stale one is skipped rather than trusted. Best effort:
  a build machine without a compiler still produces a working app.
- **Physics on a device solves across worker threads**, syncs transforms in bulk
  and interpolates in the module, and recomputes parented membership with the
  reconcile rather than per step. Android is told the frame loop has a deadline
  (ADPF).

## [0.32.0] - 2026-07-23

Reaching further. Where 0.31 was about authoring gameplay over your art, this
release extends **where an Estella game runs and how it ships its content**: a
foundation for a true native mobile host (embedded Dawn + a JS engine, not a
WebView), content-addressed hot-update with CDN / subpackage asset delivery,
custom GLSL shaders that now run on the WebGPU backend with zero author effort,
and a modern text-input stack (multiline, IME, rich text). Underneath is a pass
that single-sources a set of platform, asset and shader declarations. No
project/asset format or WASM ABI break — your projects open unchanged.

### Added

- **Native platform foundation** (pre-1.0; the host itself is unshipped). A
  DOM-free `PlatformAdapter` and an injected `NativeBridge` let the same engine
  wasm + TS SDK run on an embedded Dawn (WebGPU) + JS-engine host on iOS/Android
  — a real native app, not a WebView — through the new `esengine/native` entry.
  The C++ renderer gained a native window surface seam
  (`WebGPUDevice::configureSurface(NativeSurface)`) so a host can hand it a
  `CAMetalLayer` / `ANativeWindow`, the C++ counterpart of the TS
  `RenderSurfaceSource { kind: 'webgpu' }`. A headless no-JIT frame benchmark
  proxies the iOS interpreter constraint, so the form factor is measurable
  without a device.
- **Content-addressed hot-update + asset delivery.** A shipped game can update
  its assets without a rebuild: every asset URL is its content hash (immutable,
  cacheable), an update is a manifest diff, and applying one is atomic with
  download-integrity verification and rollback — scene `@uuid` refs to remote
  assets rebind transparently. Assets group by folder into **local / subpackage /
  remote (CDN)** delivery from one `.esengine/asset-groups.json`, authored in a
  new editor GUI with per-build CDN profiles and an offline on-disk content cache.
- **Custom shaders on WebGPU.** A `.esshader` authored in GLSL now runs on the
  WebGPU backend with no manual step: the editor generates its WGSL twin from the
  GLSL when the project opens (GLSL stays the single source; the WGSL twin is a
  generated derivative), regenerates it when the GLSL changes (a stored
  source-hash detects staleness), and CI enforces twin coverage and freshness.
- **Modern text input.** `TextInput` gains multiline caret / selection / click
  across `\n`-broken lines, live IME preedit with the candidate window anchored
  at the caret, and inline `<img>` runs in rich text — a hidden textarea is the
  single editing source of truth.

### Changed

- **Single-sourced platform, asset and shader declarations.** The platform
  adapters now share one primary-pointer synthesis (and the mini-game adapter
  finally releases the pointer on touch-cancel), one capability-surface shape
  (audio and video backends are optional and default to a silent Null;
  `unbindInputEvents` is declared rather than `as any`-reached) and one
  device-pixel-ratio facade; the asset delivery-mode vocabulary is exported once
  and the editor derives its menu and badges from it; remote-vs-local asset URL
  routing resolves one way; and the Tiled object shape→collider decision is one
  function shared by the runtime and scene paths.

### Fixed

- Render-texture minimap example rendered upside-down.

## [0.31.0] - 2026-07-22

Authoring a game on top of your art. Where 0.30 sharpened the editor itself,
this release is about **building playable levels over a single background image**
— paint collision, drop gameplay markers and trigger areas as real entities, and
edit every collider shape by hand, all without a tileset. The other half is a
pass over the **inspector and UI authoring**: progressive disclosure, a visual
flex-layout editor, an anchor grid, and shaders you can finally see, share and
switch. No project/asset format or WASM ABI break — your projects open unchanged.

### Added

- **Collision (obstacle) layers.** A tilemap layer that references the built-in
  `builtin:collision` palette instead of an `.estileset`: paint solid / slope /
  half / one-way / sensor cells straight over any background (e.g. one big
  image) and they spawn static colliders at Play, shown live by the tile-
  collision overlay. It renders nothing and reuses the whole tile→collision seam
  (chunk store, paint tools, greedy box merge, one-way/sensor). Each layer can
  carry its own **physics material**.
- **Markers + Trigger Areas — native object placement.** The modern "object
  layer": place gameplay objects as real ECS entities, not a parallel object-
  group structure. `Marker` is a named point (spawn / waypoint / location) you
  can `Query(Marker)` and filter by `type`, with a custom **key→value property
  map**; "Trigger Area" is a Create preset (Transform + static RigidBody + sensor
  BoxCollider + Marker) that reuses the unified collider gizmo for shaping. Both
  serialize, edit in the Inspector, and are query-able — no C++/ABI change.
- **`.tmj` object groups converge onto real entities.** Imported Tiled point
  objects become queryable Markers, shape objects become Trigger Areas, and every
  object-group shape now rides one edit-visible region path instead of a
  `.tmj`-only structure.
- **Hand-editable collider shapes.** Drag a circle's centre + radius, drag
  polygon vertices, pick the one-way direction (no longer always up), and set the
  per-tile collision material — all inside the shape editors. An always-on
  collision overlay and Marker pin gizmos keep it visible while you work.
- **Shareable shaders.** `.esshader` is now a first-class asset type (SHD badge),
  not an auto-spawned mystery file. The material inspector's Shader section picks
  from built-in templates + every project `.esshader`; switching re-reflects the
  parameter surface, and several materials can point at one shared shader.
- **A modernized inspector.** Progressive disclosure collapses noise by default;
  a visual flex-layout section with editable padding, a clickable 3×3 anchor grid
  (shared with the flex widget), and an inline Controllers strip bring UI
  authoring inline.
- **Multi-selection align + distribute tools**, **Tilemap in the Create-entity
  picker**, and **animation-frame reordering with a set-uniform-duration action.**

### Fixed

- **Render targets no longer trip a GL feedback loop.** A target's own texture
  could stay bound to a sampler while it was drawn into — undefined per the GL
  spec, and a per-frame `GL_INVALID_OPERATION` on some drivers (it fired every
  frame in the render-texture example). The device now detaches a target's
  attachments from every sampler slot when the target is bound.
- **A persistent entity that outlives a scene unload is promoted to global**
  instead of being dropped with the scene.
- **`Mut()` write-back records `Changed` for builtin components**, so change-
  detection queries see edits made through a mutable handle.

### Performance

- **Retained Yoga node tree.** The UI layout keeps its `YGNode`s across frames
  instead of rebuilding them, and skips the layout solve entirely on a fully
  static frame.

## [0.30.0] - 2026-07-21

The editor grows up. Where 0.29 was about the prefab system, this release is
about the **editor itself** — a top-to-bottom pass over how it feels to use.
Selection, transforms, play mode, the data panels, the asset editors and the
global chrome were all audited against Unity, Unreal and Godot and rebuilt for
correctness, consistency and keyboard/accessibility parity. Nothing here changes
the SDK API, the project/asset formats or the WASM ABI — your projects open
unchanged; the editor around them is sharper.

### Added

- **Maximize On Play + focus mode.** An opt-in "Maximize Viewport on Play" (in
  the play dropdown) hands the whole workspace to the running game, restored on
  Stop; **F11** toggles a focused viewport any time. The live canvas is only
  hidden behind the maximized group, never remounted, so the engine keeps
  running.
- **Content Browser multi-select + batch operations.** Ctrl/Shift-select ranges,
  Ctrl+A, batch delete behind one confirmation with a single undo, and
  multi-asset drag into folders. The Sources folder tree gains a right-click
  context menu and inline (F2) rename.
- **A viewport mode chip** you can click to open a mode's companion tools, and
  **sticky mode pins** — an explicit Scene/UI/Tilemap lock that ordinary clicks
  no longer clear, so you can paint tiles or lay out UI while selecting other
  things.
- **One shared empty state** across every panel (Outliner, Content Browser,
  Sequencer, the graph editors…), each with a real call-to-action.
- **Runtime `.esanimator` loading by path**, so animation controllers resolve at
  runtime the same way other assets do.

### Changed

- **Calmer play-mode chrome.** The centered "● PLAY" pill that covered the game
  is gone — running now reads as a soft accent ring around the viewport (amber +
  dimmed frame when paused, so a frozen frame never looks like a hang). The
  primary transport is a real **Play↔Stop** toggle (Restart moved to a side
  button), and Pause swaps to a resume glyph.
- **Selecting a node no longer restructures your workspace** — it switches the
  mode's tools/overlays but never flings docked panels open over what you were
  doing. Opening a mode's panels is now an explicit gesture.
- **Unified node-graph editors** (State Machine, Behavior Tree, Material,
  Animator) — shared framing/fit-to-content, Add affordance, and empty states.
- **Consistent inspector controls** — every dropdown runs on one
  keyboard-navigable, ARIA-correct listbox; vector fields show mixed values
  per-axis; number fields honor each field's step/range.
- **More actions reachable as commands** — Restart, the performance overlay,
  Reset Layout, and the Help menu items are now real, rebindable commands in the
  Command Palette; Build/Compile/Package are disambiguated.

### Fixed

- **Scale gizmo no longer explodes near the pivot.** Scaling is delta-based off
  the gizmo's on-screen size instead of a distance ratio, so grabbing the center
  box or an entity's body can't produce a runaway factor. Rotate and scale
  snapping now snap to an absolute grid (15°/30°, 0.1 increments), and Alt-drag
  clones only once you actually drag — a bare Alt-click no longer stacks a copy.
- **The zoom % readout is honest**, derived from the real view scale so it stays
  correct through Frame Selected, the minimap and device presets.
- **Several data-loss paths sealed.** Delete/Backspace can no longer fall through
  from the Tileset/Flipbook editors — or past an open context menu, popover or
  dialog — to silently delete the scene entity behind them. Destructive confirm
  dialogs focus Cancel, so a reflexive Enter can't discard or delete. Escape now
  truly cancels a mixed-selection field edit instead of overwriting other
  entities; multi-select Add Component unions correctly.
- **Rebinding a shortcut warns on conflicts** instead of silently shadowing
  another command; global shortcuts are suppressed while a modal or transient
  overlay owns the keyboard.
- **Broad keyboard / focus / ARIA repairs** across the Outliner, Content Browser
  and inspector; context-menu and popover focus returns to its opener; the
  Content Browser footer and the inspector's property filter now do what they
  say.
- **Prefab robustness.** Apply/flatten no longer leak dangling or external entity
  references, re-parenting is a first-class override, and flatten is
  order-independent; Play is disabled in Prefab Mode (a prefab has no scene to
  run).
- **Post-processing survives a warm re-play.** Stopping and playing a scene with
  a Post Process Volume no longer black-screens on the second run: the shutdown
  path kept the render pipeline's own post-process object registered so the lazy
  re-init reuses it, instead of orphaning it behind a duplicate the renderer
  never drew through (which dropped the mandatory linear→sRGB encode).

## [0.29.0] - 2026-07-21

Prefabs grow up. What was a flat, copy-on-instantiate mechanism becomes a real
**prefab system with a stable identity model and a full editor workflow**: every
node in a prefab carries a hierarchical address, so instances track their source
through renames and restructures, and the editor gains the whole round-trip —
Prefab Mode, variants, apply/revert with a change preview, unpack, and
per-instance reference binding. Two more pillars land alongside it: an
**animation-controller editor** (the new `.esanimator` asset) with shared-Inspector
clip tooling, and four **advanced particle modules** — noise, sub-emitters, trails
and force fields — all pure-CPU, so they run byte-identically everywhere, WeChat
included.

### Added

- **Prefab identity model.** Every entity in a prefab now carries a hierarchical
  stable address (`slot` / `localId`) instead of a positional index, so an
  instance tracks its source entity across renames, re-parenting and structural
  edits. Deleting a node in a prefab cascades to every instance; adding one
  projects into them. A single strict validator (`validatePrefab`) guards the
  format and is enforced in CI.
- **Prefab Mode.** Double-click a `.esprefab` to open and edit its *structure* in
  the editor — reusing the Outliner, Inspector and Viewport — and save it back in
  place. You can enter Prefab Mode from an instance in the scene, and the
  return-flow drops you back where you came from.
- **Prefab variants.** Create a variant from an instance, then edit the variant's
  own structure in Prefab Mode with base-tracked saves; variant and nested-prefab
  resolution share one code path.
- **Apply / revert with a change preview.** Applying an instance's overrides back
  to its prefab first shows a diff of exactly what will change. Instances that have
  drifted from their prefab (stale overrides) are surfaced with a one-click
  clean-up.
- **Unpack Prefab** detaches an instance from its prefab, baking its current state
  into plain scene entities.
- **Prefab instances in the Outliner.** Instances read with a warm tint and a
  right-click menu (Select source / Apply / Revert), so a prefab instance is
  visually and functionally distinct from a plain subtree.
- **ExposeRef — per-instance reference binding.** A prefab that references an entity
  *outside* itself now leaves that reference unbound; each instance binds it in the
  Inspector, where entity-reference fields (builtin **and** project-component
  fields) render as a scene-entity picker. An unbound slot reads muted.
- **Animation-controller editor** (the new **`.esanimator`** asset). An
  `AnimatorController` graph — states, transitions, conditions and parameters —
  authored in a dedicated editor that mirrors the FSM graph model; the payload is
  the runtime def, with no compile step.
- **Frame events in clips.** `.esanim` v1.3 persists an optional `events[]`
  (`{frame, name, data?}`), and the Flipbook editor gains an events bar and
  frame-strip markers to author them (backward-compatible — 1.2 clips still load).
- **Clip preview stage.** The Flipbook editor replaces its static thumbnail with a
  checkerboard preview: the current frame over onion-skin ghosts of its neighbours
  (toggle + depth in the transport), plus a Loop Mode dropdown.
- **Shared-Inspector inspection channel.** An editor can push a sub-object
  selection — a Sequencer keyframe's value + interpolation, or a timeline's
  duration/fps/wrap — into the one shared Details panel, so keyframe and clip
  properties edit through the same `ComponentSection` engine as entities and
  materials. A shared Transport + Save button unify the animation editors.
- **Advanced particle modules** — all pure-CPU, byte-identical on every platform
  (WeChat included) and free when unused:
  - **Noise / Turbulence** — a divergence-free curl-noise flow field advects each
    particle (`noiseStrength`, `noiseFrequency`, `noiseScrollSpeed`,
    `noiseOctaves`).
  - **Sub-emitter** — fire a referenced child emitter's burst at a particle's birth
    or death (shell explosions, trailing puffs).
  - **Trail** — a per-particle ribbon that follows a particle's motion.
  - **Force Field** — directional / radial forces that push particles through a
    region.
  - **Floor collision** (Collision phase 1) — particles bounce off a floor plane.

### Changed

- **`.esprefab` is now format v2** (hierarchical identity). Projects migrate forward
  automatically on open, and a repo-wide **Resave All Prefabs** command plus a
  format gate keep a project's prefabs on the current version. Within the `0.x`
  line older projects continue to open; forward compatibility (an older engine
  opening a v2 prefab) is not guaranteed.
- Creating a prefab from an entity that references outside itself now asks to
  **expose** those references — they are left unbound for instances to rebind —
  rather than simply clearing them. Same clearing behavior, framed for the new
  ExposeRef workflow.

### Fixed

- The `sprite-animation` example's spritesheet demo is corrected, and its textures
  reference through stable `@uuid` refs.

## [0.28.0] - 2026-07-19

A hardening pass. No new pillars this time — instead a systematic, subsystem-by-
subsystem audit files the sharp edges off the runtime: audio buses, Spine, the
timeline, physics, tilemaps, the ECS core and the editor each shed a cluster of
lifecycle, teardown and correctness bugs that had survived releases. The one new
capability is a rendering one — **tilesets with padded atlases now sample
cleanly** — and the docs, examples and guides are trued up to match the fixed
behavior.

### Added

- **Tileset margin & spacing are honored end to end.** The `.estileset` / Tiled
  importer already parsed a tileset's `margin` (border before the first tile)
  and `spacing` (gap between tiles), but the runtime UV path was pure grid math,
  so any atlas with padding sampled an offset region and bled toward the
  neighbouring tile. Both values now carry all the way through to the per-slot UV
  offset/step (and the `setTilesets` slot table gains optional `margin` /
  `spacing`), so each cell samples its own texels; a gapless atlas is unchanged.

### Fixed

- **Physics.** The character controller's `skinWidth`, `maxSlides`, `snapLength`
  and `slideOnCeiling` were dead at runtime — the native mover hardcoded its
  iteration and ignored them; all four are now wired through, so skin margin,
  slide count, stair/slope floor-snap and ceiling-stop behave as their inspector
  tooltips promise. Kinematic bodies now carry riders standing on them, disabled
  bodies and re-parented joints behave, and a parented body's transform sync
  preserves scale.
- **Audio.** Ducking and BGM crossfades tear down cleanly, pooled nodes no longer
  cross-route or NaN the panner, a volume blend fades to each param's neutral and
  honors the global weight, concurrent preloads of one URL decode exactly once,
  and WeChat `stop()` is idempotent.
- **Spine.** Re-loading a Spine entity frees the old instance and skeleton, the
  plugin submits meshes once even after a manager swap, tint resets when cleared
  (mix duration is per-asset), and listeners are cleaned by entity rather than
  instance id.
- **Timeline & animation.** A looping timeline no longer double-fires events at
  the loop seam, keyframes default missing tangents to `0`, and tween
  composition completes while sprite animation keeps pace.
- **Tilemap.** Tile-collision queries honor the cell's flip flags, the animation
  clock uses a double accumulator (no drift on long runs), a tileset swap clears
  stale animations and collision, visible-chunk culling is orientation-aware,
  isometric `worldToTile` rounds to the containing tile, and a destroyed layer
  stops ticking.
- **Rendering & particles.** A rounded-rect's corner radius scales with the
  transform, looping particle sheets cycle instead of freezing on the last
  frame, `play()` before an emitter's first update isn't dropped, and
  `maxParticles` is clamped so bad data can't OOM.
- **Scenes, assets & materials.** A load cancelled by a concurrent unload can't
  orphan entities (it rejects with the new `SceneLoadCancelled`), scene unload
  releases materials through Assets and a reload restores a slept scene,
  materials release their bound textures on unload, scene serialization detaches
  from live world storage, an alpha-less `{r,g,b}` material color survives,
  resource defaults stop aliasing across worlds, and texture metadata survives an
  evictable release.
- **Core, plugins & networking.** `world.set` adds a missing builtin through the
  full insert path, `Removed` fires on despawn and duplicate names can't corrupt
  the name index, plugins retire their `onDespawn` subscriptions on cleanup, the
  gesture detector releases per-touch state on touch end, `createPolygon` guards
  a degenerate axis span against NaN UVs, locale plural forms are validated as
  strings at load, `playOnAwake` stops re-warning an un-preloaded clip every
  frame, prefab diffs keep entity refs in prefab-local id space, and netcode
  interpolation is frame-rate independent (a replication client's disconnect
  retires its subscription and state).
- **Editor.** Material-graph node params edit by their own key instead of a
  hardcoded `value`, editor state resets on a project/scene switch, and
  multi-select edits keep per-entity data in a single undo step.

### Performance

- Render batches dedupe redundant program + blend binds on a pipeline switch and
  pin a draw's unused sampler slots to white.
- The editor gets O(1) entity lookup, a gated pivot and cached ref-counts, and
  on-canvas handle drags suspend re-render (cancelling cleanly).
- The volume post-process rebuilds only when its effect set changes, query
  iteration precomputes its dependency ids, and timeline activation writes a
  component only when it flips.

### Documentation

- The guides are trued up to the fixed behavior: the character-controller tuning
  fields, tileset margin/spacing on `setTilesets`, and `SceneLoadCancelled` are
  now documented (en + 简体中文).
- The Editor guide and quick-start onboarding are refreshed, every guide that
  lacked them gains "See also" cross-links, and the custom-bus audio example is
  corrected (`playSFX` takes no bus option).

## [0.27.0] - 2026-07-18

The manual catches up with the engine, and the API learns to read one way.
The docs site grows from per-subsystem overviews into a **fine-grained manual**:
new foundational chapters finally teach what nothing taught before — that one
world unit is one design pixel, that `Canvas.pixelsPerUnit` is the physics
meter scale, how quaternion rotation works in 2D — and the UI manual splits
into nine subchapters written from source, in both languages. Eight new
examples cover every previously example-less pillar, and chasing them through
live Play runs flushed out real engine bugs that had been hiding for releases:
within a layer, **z now actually orders sprites**, and a `RenderTexture` can
finally be shown by a Sprite.

### Added

- **Foundational documentation chapters** (en + 简体中文). Core Concepts gains
  "Transforms, Units & Coordinates" (the Transform component, Y-up, the
  world-units-are-design-pixels doctrine, quaternion rotation and its
  helpers, parenting), "Screen & Design Resolution" (Canvas, every scale
  mode's fit math, `ScreenScaling`, why UI px are design px, safe areas) and
  "App Setup & Lifecycle" (`createWebApp`/headless options, the plugin
  model, lifecycle events, subsystem health, side modules, hot reload);
  Utilities gains "Profiling & Diagnostics" (stats overlay, `Logger`, frame
  capture, texture budgets).
- **The UI manual, split into nine subchapters** — Overview / Layout / Text /
  Widgets / Lists & Scrolling / Interaction / Theming / Data Binding /
  Controllers — documenting the previously invisible surface: dimension
  semantics and anchor presets in code, the real rich-text tag set, the
  focus/drag pipelines, the ListView virtualization contract, all twelve
  theme color roles, and two-way widget binding.
- **Eight new examples**, all verified in live editor Play runs:
  `camera-follow` (FollowTarget damping/dead zone, screen shake, view-target
  blends), `save-load` (versioned SaveManager slots with a live v1→v2
  migration), `scene-flow` (menu → levels through SceneManager fades over a
  persistent shell), `input-actions` (rebindable InputMap actions +
  gestures), `timers-demo`, `trail-demo`, `render-texture` and
  `drawing-demo` (immediate Draw, retained Graphics, procedural Mesh2D).
  The catalog also lists the previously uncatalogued `chat` and
  `ui-controller`.
- **Play == ship scene registration.** Pressing Play now registers every
  project scene under its export name (siblings lazily by path), so
  `SceneManager.switchTo` behaves identically in the editor and in a
  shipped build.
- `RenderTextureHandle.texture` — a resource-table handle components can
  actually consume (`Sprite.texture`, `UIVisual.texture`), registered
  through the same external-texture channel video frames use.
- The `Mesh2D` component and the animator sub-machine helpers
  (`enterStatePath`, `leafStateOf`, `evaluateAnimatorPath`) join the main
  barrel; Spine's wiring surface (`SpinePlugin`/`SpineEvents`/`Spine`) is
  mirrored into the main barrel exactly like physics.

### Changed

- **The public API reads one way** (breaking, pre-1.0). The physics class is
  now `PhysicsAPI` and the resource token `Physics` — `Res(Physics)` like
  `Res(Audio)`/`Res(Tween)` everywhere else. Six `Api`-suffixed classes are
  now `API` (`CameraViewAPI`, `SpriteAnimationAPI`, `AnimatorControllerAPI`,
  `PostProcessAPI`, `LocalizationAPI`, `TimelineAPI`). The deprecated
  `getAllRegisteredComponents` alias is gone (use `getComponentRegistry`).
- **One plugin-construction shape.** A lowercase `xPlugin` export is always a
  ready-to-add `Plugin` value; configurable plugins expose a PascalCase
  class. `lifecyclePlugin` is now such a value (configure with
  `new LifecyclePlugin({ autoPause })` — previously a factory call).
- **Plugin wiring moved to one barrel.** `webAppFactory` now only ships the
  app factories; the UI pipeline plugins, the physics/spine wiring and
  `PostProcessPlugin` live in a dedicated `core-plugins` barrel, the
  Timeline surface joined `core-content`, and engine-internal
  `init*/shutdown*API` functions left the public surface.
- **Director and scene APIs are callable from systems.** `setViewTarget`,
  `shakeCamera` and `transitionTo` accept the `CameraDirector` /
  `SceneManager` resource state alongside the `App`, so gameplay systems no
  longer need an App handle they cannot get.
- `Canvas.pixelsPerUnit` is documented (tooltip included) as what it actually
  is — world pixels per physics meter — and the abandoned
  texture-px-per-unit helpers on the C++ component are gone.

### Fixed

- **z actually orders sprites within a layer.** The draw sort key assumed
  z ∈ [-1, 1] and truncated: any real-world z wrapped through the bit mask
  and sorted non-monotonically, and the blended stages had the painter's
  order inverted. Depth now maps through order-preserving float bits —
  transparent draws back-to-front, opaque front-to-back.
- **Runtime-loaded scenes unload cleanly.** Entities of a scene registered at
  runtime carried the `SceneOwner` tag but were never adopted into the scene
  instance's entity set, so `switchTo` away from such a scene leaked every
  entity it had spawned.
- **`RenderTexture` + `Sprite` no longer renders white.** Pointing
  `Sprite.texture` at the raw device `textureId` sampled the white fallback;
  the new `texture` handle goes through the resource table.
- **PreviewPlugin's fallback camera un-zoomed.** It still derived its ortho
  size from the abandoned px-per-unit doctrine — a 100× zoom-in whenever a
  scene had a Canvas but no active camera.
- The physics guide's joint samples used a `world.spawn(Component, …)`
  overload that does not exist; unit contracts (meters vs world pixels) are
  now stated on `PhysicsAPI` itself and in the guide.

## [0.26.0] - 2026-07-17

Tilemaps leave the square grid, and projects make the UI their own. The editor
now **authors** isometric, staggered, and hexagonal maps natively — orientation
is a first-class layer property with its own grid overlay, brush ghost, and
New-Tilemap picker, not a read-only Tiled import artifact — and terrain
painting gains the modern **corner-Wang** model, where one terrain set blends
many terrains (grass ↔ sand ↔ water) painted on a half-cell corner grid. On
the UI side, a project can now **re-skin the built-in widget palette per color
role** from Project Settings, shipped to every runtime, and the UI editor gets
design-tool reflexes: palette drops nest into the container under the pointer
(with a live outline of the would-be parent), and anchor edits are per-axis
and never move the widget.

### Added

- **Native isometric, staggered & hexagonal map authoring.** The runtime
  already rendered all four orientations, but the editor could only author
  orthogonal maps. Orientation (+ hex side length, stagger axis/index) is now a
  first-class `TilemapLayer` property end to end: the New-Tilemap dialog gains
  an orientation picker, the Inspector shows the fields (hiding them when
  inert), and a pure tile-geometry seam (`tileCellCenter` / `tileCellOutline`,
  mirroring the C++ placement math) drives an orientation-aware grid overlay,
  selection/hover cells, and the brush ghost. Merging the C++ placement
  branches also fixes imported staggered maps ignoring `staggeraxis` /
  `staggerindex`. Three painted showcase scenes — an iso island, a staggered
  river patchwork, a pointy-top hex strategy map — ship in `examples/` with
  two small CC0 tilesets.
- **Corner-Wang (multi-terrain) autotiling.** Alongside the existing
  edge/corner-blob peering, a terrain set can now carry **colors** with each
  tile assigning a color to its four corners — the "circle in the corners"
  technique — so one set blends many terrains and the terrain brush paints
  colors onto a half-cell corner grid, re-tiling affected cells by exact corner
  match with a nearest-mismatch fallback. The tileset editor grows the color
  palette (add/rename/recolor/remove) and per-tile corner dots; a
  procedurally-generated 45-tile grass/sand/water demo set and a blended-island
  scene show it off.
- **Project-level theme color overrides, end to end.** Beyond picking
  dark/light, a project can now override the widget palette per color role:
  `features.ui.colors` carries a role → hex map validated against the theme's
  color roles, every runtime boot (web, play realm, WeChat, playable) resolves
  base + overrides before re-theming, and the export chain now ships the theme
  at all — it previously dropped `features.ui` entirely, so light/overridden
  projects shipped dark. Project Settings → UI grows a **Theme Colors** group
  with a full color picker per role (unset rows show the inherited base), and
  the edit viewport previews changes live, so editing, Play, and shipped
  builds resolve identically.
- **Palette drops nest into the container under the pointer.** A widget
  dragged from the palette used to always land at the Canvas root; the drop now
  hit-tests the UI under the pointer and parents into the deepest plain layout
  container, so dropping onto a panel or row nests Figma-style — and while
  dragging, the would-be parent shows a live dashed outline, distinct from the
  selection outline and cleared on drop/leave.
- **Per-axis anchor edits that never move the widget.** The anchor picker used
  to write both axes on every change, resetting the other axis' margins — a
  hand-positioned widget jumped on any anchor edit. Anchors now classify and
  write per axis, and applying one bakes the node's live resolved box into the
  pinned insets, so Start/End/Stretch keep the widget exactly where it was and
  leaving a Stretch axis freezes the resolved size. Plus viewport polish: the
  design-resolution label clamps into view, device presets snap the preview
  orientation to the design's aspect, and Dialog/TextInput get proper palette
  icons.
- **Tilemap editor reflexes.** Layer rows reorder by drag (on top of the
  context-menu move up/down), the random-brush toggle gets the **D** key while
  painting, and the terrain tool's no-terrains empty state now carries an
  **Open Tileset Editor** button instead of a dead-end hint.

### Fixed

- **Change-detection queries type-check in systems.** `defineSystem` rejected
  `Query(Added(...))` / `Query(Changed(...))` params at the type level even
  though the runtime fully supports them; the canonical `QueryArg` is now
  shared so the types can never drift again. (#52)
- **The painter toolbar no longer clips at narrow panel widths.** The tools
  row wraps instead of clipping the terrain/flip/rotate/random tools off the
  right edge at the default dock width, and the active-brush preview moves to
  the palette bar where it is always visible.
- **Non-orthogonal grid overlays no longer vanish on the left.** The
  shaped-cell overlay culled canvas-relative coordinates against page-relative
  bounds, dropping the whole left band of iso/hex grid cells whenever docked
  panels inset the viewport canvas.
- **Chat example bubbles read like chat.** Bubble text is left-aligned
  regardless of side and bubbles size to their wrapped text instead of a fixed
  width.

## [0.25.0] - 2026-07-16

The UI system grows up, and the editor breaks out of a single window. Widgets
stop being closures full of hidden state and become **data**: every stateful
control — button, toggle, dropdown, slider, dialog — carries its behavior in a
component driven by a system, so a Toggle or Dropdown placed in the editor is
fully functional without a line of code, keyboard access is on by default, and
any widget value can be two-way bound to a signal. One state mechanism —
`UIController` + `UIGear` — replaces the old per-entity `StateMachine` /
`StateVisuals` pair across the whole engine, and it doubles as an authoring
surface: a Controllers panel, gear dots on Details fields, and a record mode
that keys edits into the active page, all previewing live in edit mode. On the
editor side, any dock panel — and now the Viewport itself, engine canvas and all
— can pop out into its own OS window and move to another monitor. Tilemaps gain
rich per-tile collision you can author and *see*: circle, one-way, sensor, and
material shapes, slope presets, Tiled parity, and runtime tile-collision
queries — with the entity collider gizmo generalized to draw and edit all six
shapes through the same geometry seam.

### Added

- **The editor pops out into multiple windows.** Any model/store-driven dock
  panel — Inspector, Outliner, Content Browser, Console, the graph editors — can
  now be moved into its own OS window and dragged to another monitor, and so can
  the **Viewport**: the single engine canvas rides the DOM into the popout with
  its live WebGL context intact (a same-origin move preserves the context — no
  engine multi-instancing), Play-in-viewport works there too, and gizmo drags,
  keyboard, and resize all resolve to whichever window hosts the panel. Popouts
  are same-origin `window.open`, so a popped-out panel shares live selection,
  stores, and edits with the main window with zero cross-window messaging, and
  dockview restores the popouts after a reload. Works in the packaged app as
  well (the packaged renderer is served over loopback http to satisfy the
  same-origin requirement).
- **UI Controllers & Gears.** A `UIController` is a named set of "pages" scoped
  to a UI root; a `UIGear` binds any component field to per-page values that snap
  or tween as the page changes. It generalizes the old per-entity state pair into
  one shared, multi-page, any-field mechanism — no new asset type, no C++ — and
  it is not play-gated, so the editor previews a page the instant it changes. The
  authoring surface ships with it: a dockable **Controllers** panel, a gear dot on
  each Details field that binds it to the active controller, and a **record mode**
  that captures subsequent edits into the current page. Data-driven bridges
  (`ui.setPage`, `bindControllerPage`) drive pages from game code, and a bilingual
  guide documents the whole flow.
- **Widgets as data — and two more of them.** Toggle, dropdown, slider, and
  dialog behavior now lives in components + behavior systems rather than factory
  closures, so an editor-placed control just works: a dropdown closes on an
  outside click, a slider drags and takes arrow/Home/End keys, a dialog dismisses
  on Escape or scrim click — no code. Two missing widgets close the set:
  **`TextInput`** (with an Auto / Bitmap / SDF render-mode selector, clipping, and
  horizontal scroll) and **`ScrollView`** (the non-virtualized sibling of
  `ListView`), and `ListView` gains measured **auto-height** rows via a public
  `measureText`. `bindWidgetValue` gives two-way binding between a signal and any
  widget value. Text, Image, and Container primitives join the editor's Create → UI
  palette, and a **chat demo** (a `ListView` log + a `TextInput` composer) shows
  them together.
- **Keyboard accessibility, on by default.** Widgets carry a `Focusable`;
  Enter/Space synthesize a click on the focused control (text fields keep those
  keys), Escape or a click on empty space clears focus, and the interaction driver
  gains a `focused` state (disabled > pressed > hover > focused > normal). Modals
  trap focus, dropdowns take open-state keyboard navigation, overlays get proper
  scrollbars, and rich text word-wraps.
- **Rich per-tile collision you can author and see.** Tile collision grows beyond
  box|polygon: **circle** shapes plus cross-cutting **one-way** (solid-side
  normal), **sensor**, and **material** (density/friction/restitution) modifiers,
  authored with a brush-bar in the tileset editor and with **one-click slope /
  half-tile presets**. The same collision is now **drawn in the scene viewport**,
  shapes authored in Tiled's own tile-collision editor parse into the identical
  model (finite and infinite layers alike), and the runtime answers
  `tileCollisionAt` / `isTileSolid` / `tileCollisionAtWorld` with no physics
  raycast. `.estileset` files round-trip byte-for-byte.
- **One collider gizmo for all six shapes, convertible in place.** The entity
  collider gizmo — previously box + circle only — is rebuilt on the shared
  `ColliderShape` projection, so a polygon, capsule, segment, or chain collider is
  visible and its vertices are draggable for the first time, through the same
  geometry seam that draws physics debug and the tile-collision overlay. A
  segmented control on the collider's Details card **converts** box ↔ circle ↔
  polygon in place, preserving material, sensor, filter, and where you drew it,
  as one undo step.
- **More tilemap authoring reflexes.** A **probability-weighted scatter** brush
  (per-tile weights authored in the tileset editor), **hollow** rect/ellipse tools
  (Alt for an outline / ring), a **floating-selection move** (drag inside the
  marquee to lift a region and land it as one undo step, Esc to restore), and
  editor-convention muscle memory — modifier keys, a layer menu, and tileset batch
  authoring.
- **A project-declared UI theme.** Project Settings gains a UI section: the
  built-in widget palette (`light`; dark is the default) rides the same
  project-config channel as physics/audio to every shipped runtime — web,
  playable, WeChat — and applies at boot, re-tinting prefab-instantiated widgets
  to the project's palette.
- **A unified viewport grid control.** The grid display toggle joins grid snap in
  one place instead of two.

### Changed

- **One state mechanism — `StateMachine` / `StateVisuals` retired.** Widget
  interaction states now build from the shared `UIController($interaction)` +
  `UIGear` layer, and with no consumers left the legacy trio retires end to end:
  the TS components, systems, and `StateChanged` event; the C++ `StateMachine` /
  `StateVisuals` structs and the `VisualState` EHT entry (wasm rebuilt, ABI hash
  rotated). Scenes still referencing the retired components **migrate forward
  automatically on load**. Semantics are preserved — custom pages like `'loading'`,
  `fadeDuration` as a linear gear tween, and live theme re-tint of the interaction
  colour gear.
- **Widget factories return handles, not bare entities.** Every factory now
  returns a `{ entity, dispose }` handle (`createButton` was the last holdout),
  assembles interaction through one `makeWidgetInteractable` helper, and
  `createListView` takes its host plugin explicitly. Toggle's `silent` transition
  parameter is retired — every widget reports its change identically. The
  composition sugar (`buildUINode` / `buildUIVisual` / `buildText` /
  `spawnUIEntity`) moves from `widgets/` to `core/compose`.
- **The Canvas2D-era rich-text image machinery is gone.** `DefaultImageResolver`,
  `setImageResolver`, `getImageResolver`, and `ResolvedImage` were built for the
  retired Canvas2D renderer, resolved to DOM bitmaps the pipeline cannot draw, and
  had zero product consumers. The `<img>` grammar still parses (it simply does not
  render yet), so a future engine-texture implementation starts from the grammar,
  not from DOM plumbing.
- **Dead UI surface swept.** A ~12-symbol dead helper cluster in `ui/util`, a
  zero-importer `controller/index.ts` barrel, tombstone comments, and an
  `ARCHITECTURE.md` still describing the retired FSM are all removed. `UIMask`
  drops its phantom `Alpha` / `maskTexture` / `inverted` fields (C++ only ever had
  `enabled` + scissor/stencil), and `TweenSystem` now owns the full
  `anim_override_` flag lifecycle — fixing a latent bug where a once-tweened UI
  entity permanently escaped layout control of that axis.

### Fixed

- **Playable exports resolve Spine textures.** A Spine atlas in a playable build
  now resolves its textures from the inlined asset map instead of failing to draw.
- **A wedged Play no longer hangs the editor.** A play-realm prepare that gets
  stuck now times out instead of hanging forever.
- **Number settings without a max no longer clamp to 100.** Unbounded number
  fields stop clamping to a phantom maximum of 100.
- **Paint preview matches what it paints.** The tilemap paint tools' preview is
  aligned with the tiles they actually place, and several multi-tileset bugs are
  fixed.
- **Theme roles survive into prefabs.** Theme role tags persist into
  prefab-instantiated widgets, settled gears re-arm correctly, and scroll/list
  behavior is corrected.
- **Truthful render-system timing.** The profiler attributes the render system's
  present/vsync wait to a distinct wait band instead of counting it as phantom CPU
  time, and the status bar / panel re-render less during a viewport transform drag.

## [0.24.0] - 2026-07-15

Video comes to Estella. A declarative Video component plays a stream on any
renderable — a sprite, a UI element, or a 2D mesh — uploaded straight to the
GPU with no CPU copy on WebGL2; and on WeChat, where the platform's own decoder
is absent on PC and unreliable on phones, the engine ships its own wasm MPEG-1
decoder so every device plays the same frames. The design resolution graduates
from a UI-Canvas detail to a project-level truth: gameplay can letterbox to a
reference resolution with no dummy Canvas, the device preview works on any
scene, and screen orientation is one project-wide setting that ships correctly
to web, desktop, playable, and WeChat alike. Under the hood, WeChat becomes the
first member of a mini-game platform family described as data, and the editor
opens and re-Plays noticeably faster.

### Added

- **Video playback.** A declarative `Video` component streams onto whichever
  renderable an entity has — `Sprite`, `UIVisual` (video in menus and loading
  screens), or `Mesh2D` — driving a live texture that updates every frame. On
  the web/desktop backend it plays through an `HTMLVideoElement` (any format the
  runtime decodes) and, on WebGL2, uploads each frame GPU→GPU with
  `texImage2D(video)` — no CPU readback; WebGPU keeps a correct readback
  fallback behind the same pump. The subsystem mirrors the audio architecture
  end to end — a `PlatformVideoBackend` chosen by the platform adapter, a
  `VideoPlayer` resource, a `VideoPlugin` — and both backends are pixel-verified
  headless on WebGL2 and WebGPU.
- **Video on WeChat, engine-owned.** `wx.createVideoDecoder` is absent on the PC
  client and unreliable on phones, so the WeChat video path is deterministic
  instead: a ~61 KB `videodec` wasm side module (pl_mpeg, MIT) decodes MPEG-1
  behind the same texture pump on every device class — phone, PC, devtools,
  headless. The cook transcodes each authored video into an MPEG-1 `.esv` plus
  an AAC `.esv.m4a` audio track that becomes the playback **clock** (the video
  decodes toward the track's playhead; loop-wraps and seeks exact-seek), shelling
  out to a bundled ffmpeg at cook time. Cook quality and audio bitrate are
  per-asset Import Settings.
- **Opt-in project camera fit.** A gameplay scene can now letterbox to a
  reference resolution without a dummy UI `Canvas`: a `ScreenScaling` resource
  (design width/height, scale mode, match axis) fits the main camera whenever a
  scale mode is set, while UI layout keeps scaling independently off its own
  Canvas. Off by default — an unconfigured game renders unchanged — and honored
  by every runtime: the editor Play realm, web, desktop, playable, and WeChat.
- **Device preview on any scene.** The design frame, letterbox, and safe-area
  overlay were a UI-layer feature that needed a `Canvas`; they now read the
  project design resolution and show in any editor mode once a device is picked,
  so a pure gameplay scene gets the same framing preview and quick device menu.
- **Faster editor open, with a loading screen.** Opening a project shows a
  loading screen while the Play-realm engine prewarms in the background, so the
  first click-to-Play is quick; re-Play keeps that realm engine alive across Stop
  for a warm restart; and the asset registry is now cache-first with a
  parallelized disk scan (~3.5× on a large project), so scanning no longer gates
  boot.

### Changed

- **One screen orientation, project-wide.** Orientation was a per-platform
  packaging field that only WeChat consumed (web/desktop had none; the playable's
  was an orphaned no-op). It collapses to a single `packaging.orientation`,
  defaulted from the design resolution's aspect so a landscape design ships
  landscape everywhere with zero config, and consumed by every target — WeChat
  `deviceOrientation`, a rotate-to-fit overlay on web and playable, and the
  Electron window size on desktop. Legacy per-platform fields migrate forward
  automatically on open, and Project Settings replaces the two old controls with
  one.
- **WeChat is now a mini-game platform family.** The WeChat integration is
  refactored into a normalized mini-game platform — a host-global surface, a data
  `MiniGameProfile`, and one adapter — with the shared filesystem/fetch/image/
  input/storage/canvas logic written once; WeChat becomes a profile that binds
  `wx`. The export pipeline likewise splits into a vendor-neutral `exportMiniGame`
  plus a WeChat profile. WeChat output is byte-identical and the public `wx*`
  helpers stay as thin back-compat wrappers — groundwork for additional mini-game
  vendors, with no behavior change today.

### Fixed

- **One bad value no longer bricks a scene.** Scene load now salvages invalid
  fields — an out-of-range or wrong-typed value is coerced or dropped with a
  diagnostic instead of failing the whole scene — and the MCP `set_field` door
  coerces and validates on the way in, so automation can't write a value that a
  later open chokes on.
- **A failed New Project says so.** Project creation that errors now surfaces a
  toast instead of leaving the dialog stuck on "Creating…".
- **WeChat real-device hardening.** The export bundle and emscripten glue
  down-level to ES2017 for the on-device JS engine, the replication codec creates
  its `TextEncoder`/`TextDecoder` lazily, and the `performance` polyfill is
  stabilized — the fixes that carried the video path from black frames to first
  live playback on a physical device.
- **Packaged editors ship the SDK types.** The desktop build now bundles the SDK
  `.d.ts`, so a packaged editor can stage a project's `esengine` types for the
  IDE even when the unpacked SDK copy isn't present.

## [0.23.0] - 2026-07-14

The editor opens its doors to AI agents, and the asset registry comes alive.
This release ships a built-in MCP server — any MCP-capable AI tool can connect
to the running editor and build a game through the same doors the UI uses:
create projects, edit scenes and components, import assets, read validation,
drive Play, and export. And the asset pipeline stops being a snapshot: files
dropped into a project register on sight, a texture assigned anywhere lights
up without reopening the project, and every failure that used to be a silent
white box is now a hard error or a queryable diagnostic.

### Added

- **MCP server, built in.** The editor ships an MCP (Model Context Protocol)
  server: launch with `--mcp` (or spawn the bundled `editor-mcp` entry from an
  installed app) and any MCP-capable AI tool gets 47 tools that operate the
  live editor — project create/open, scene and entity editing, component
  add/remove and field writes (undoable, through the same command path as the
  UI), asset import/create, viewport capture and window screenshots, Play
  control, log reading, and game export. The Windows quirk is solved for
  good: the protocol lives in a plain-node front (Electron main never
  receives piped stdin on Windows), talking to the editor over an
  authenticated loopback channel.
- **Eyes and hands inside the running game.** `play_probe` evaluates code in
  the isolated Play realm — read gameplay state via `window.__estellaPlay`,
  or inject input events to drive the game — so automation can verify actual
  gameplay, not just the edit-mode scene.
- **Queryable scene validation.** `getDiagnostics()` on the editor surface
  (and the `get_diagnostics` MCP tool) returns exactly what the Details panel
  flags — required fields left empty, inert-component notices, and now
  **unresolvable asset references** (a ref that names no registered asset, or
  whose load failed). An empty list is a machine-checkable "scene is clean".
- **Public FSM/BT loaders.** `Assets.loadStateMachine` / `loadBehaviorTree`
  load `.esfsm` / `.esbt` definitions into the AI store on demand, and
  `Assets.pathForHandle` resolves a live handle back to the asset it came
  from (the reverse of ref resolution).

### Changed

- **Assets register on sight.** The project scan now adopts orphans: any
  known-type content file without a `.meta` sidecar gets one minted and
  enters the registry — "drop an asset folder into the project and open it"
  just works, at open and on every filesystem refresh while the project is
  open. Importing a file that already lives inside the project registers it
  in place instead of spawning a renamed copy. The write doors (import and
  create, UI and MCP alike) guarantee the registry sees their output before
  they return.
- **Windows installer is a real wizard.** The one-click installer (which put
  the app under a package-derived folder name) is replaced by an assisted
  installer: pick the install directory, default `Programs\Estella Editor`.
- **SDK types staging is stamped and loud.** The `.esengine/sdk` types mirror
  (what makes `import from 'esengine'` resolve in your IDE) re-stages only
  when the editor or SDK actually changed, falls back to the in-archive SDK
  dist when the unpacked copy is missing, and reports failure in the Output
  Log and a toast instead of silently skipping.

### Fixed

- **The white-box family: cold asset references now converge.** Assigning a
  texture (or any handle-valued asset) that the scene-open preload never saw
  — via the Details picker popover, an MCP `set_field`, or a hot-created
  asset — left a dead handle rendering a white box until the project was
  reopened, with zero logs. The editor now loads cold references through the
  engine's own loaders and re-projects exactly the referencing components
  when the load lands; failures log loudly and surface in diagnostics.
- **Tilemaps follow their source, live.** Editing `Tilemap.source` re-derives
  the map immediately (no more reopen); a `.tmj` rewritten on disk
  invalidates stale caches and re-renders; and the "renders as fragments of
  the wrong texture after import" failure — along with the constant
  ~1s/frame grind that came with it — is gone with the registry staleness
  that caused it.
- **Invisible-but-solid maps fail loud.** A tilemap whose tileset textures
  all failed to load says so once, as an error naming the failing paths —
  collision-only ghost levels no longer cost a debugging session.
- **The Game inspector names live assets.** During Play, asset slots showed a
  red "required but empty" flag for perfectly loaded assets — the running
  world stores realm-local handles, which the inspector coerced to empty.
  Live handles now translate back to the assets they came from (name +
  thumbnail), and asset slots are read-only while playing.
- **sRGB uploads cover every texture path** under linear color — the last
  paths that uploaded color textures without the sRGB flag are aligned, so
  linear-light projects decode consistently no matter how a texture arrives.
- **`.esengine/sdk` missing in v0.22.0 installs** (#49). The packaged app
  shipped its SDK dist archive-only; the types mirror silently skipped and
  projects opened with no `esengine` types for the IDE. Now staged with a
  fallback source and loud failure (see *Changed*); reopening a project in
  the editor regenerates the folder.

## [0.22.0] - 2026-07-13

Light gets physical: an opt-in linear-light pipeline decodes sRGB in hardware,
runs the post-process chain on HDR float targets, and makes bright lights
actually bloom. Sprite animation becomes first-class authoring — slice a sheet
into a flipbook in the new Flipbook editor, drop it into the scene as a posed
animated sprite, and drive it from the FSM without a line of code. Audio grows
a real mixer (per-bus effect chains, sidechain ducking, a Mixer panel, MP3
cooks), and the physics editor catches up with its runtime: every joint draws
in the viewport, and anchors and slide axes edit by direct drag.

### Added

- **Linear-light rendering.** Set **Project Settings → Rendering → Color Space**
  to *Linear* and the whole frame computes in linear light: color textures
  upload as sRGB and decode in hardware (KTX2 compressed textures transcode to
  sRGB variants), tints and light colors linearize, post-process intermediates
  blend without shadow banding, and the final blit performs the one
  linear-to-sRGB encode. The setting persists in the project and boots every
  runtime the same way — the editor viewport, Play, web/desktop exports,
  playables, and WeChat. The default stays *Gamma*: existing projects render
  byte-identical until they opt in.
- **HDR post-processing.** Under linear color, the post-process chain upgrades
  its intermediate targets to 16-bit float wherever the device supports it
  (always on WebGPU; via `EXT_color_buffer_float` on WebGL2, with a graceful
  LDR fallback). Light accumulation past 1.0 survives into the effect chain:
  bloom's bright-pass sees real over-range energy, tonemap receives true HDR,
  and the bloom threshold now reaches 2 — set it above 1 and only over-range
  light blooms, the classic emissive-glow setup.
- **Flipbook editor.** Sprite-sheet animation gets its own asset type and a
  dedicated panel: a sheet canvas with a slicing grid (click or drag cells to
  append frames), a frame strip with per-frame durations and drag reordering,
  fps/loop controls, and a live looping preview. **Create Sprite Animation** on
  any texture guesses the grid from the image and produces a ready `.esanim`
  clip; sheet-cell frames re-slice consistently when the grid changes, and
  legacy per-texture clips stay valid.
- **Animated sprites in one step.** **Create Animated Sprite** on a `.esanim`
  (or dropping one into the viewport) spawns a complete entity — Transform,
  Sprite, SpriteAnimator — posed at frame 0, in one undoable step. Selected
  flipbooks loop live in the viewport without entering Play, and when the same
  clip is open in the Flipbook editor the preview follows your edits as you
  make them.
- **Code-free animation states.** FSM and behavior-tree actions now take an
  optional argument, and four `spriteAnim.*` built-ins mirror the `timeline.*`
  family: `spriteAnim.play` (the argument picks the clip), `.restart`, `.stop`,
  and a `spriteAnim.finished` condition with a formal replay contract.
  Idle/run/attack switching is now pure `.esfsm` data on the FSM canvas.
- **An audio mixer, end to end.** Buses gain a real DSP topology — declarative
  per-bus effect inserts (biquad filters, convolution reverb, compressor) and
  sidechain ducking (`duck music by voice`) that never fights the user's volume
  setting. The project mix persists in the manifest and boots identically in
  the editor, Play, and every export; the new **Audio Mixer** bottom-dock panel
  edits it live — one strip per bus with fader, mute, insert chain, duck rule,
  and custom bus management.
- **Audio import pipeline.** Selecting an audio asset shows a decoded waveform
  with play/pause and click-to-seek plus format details. A **Compress Audio**
  package option re-encodes `.wav` sources to MP3 at cook time (per-asset
  Import Settings override the global switch — seamless-loop clips can opt out
  of MP3's encoder-delay seam); already-compressed formats pass through.
- **Physics editing in the viewport.** The physics gizmo family fills out:
  one-way platforms draw their solid-side arrow, all six joint components draw
  anchor-to-anchor links with draggable anchor dots, motor joints show their
  target-velocity arrow, prismatic/wheel joints show the slide axis with a
  re-aim handle, and particle emitters preview their `angleSpread` aim wedge.
  Anchors and axes edit by direct drag in the owning body's frame; collider
  handles now measure from the offset shape center. The show flag is labeled
  **Physics**, and the physics showcase gains a spring piston (prismatic joint
  in action).
- **Smarter FSM/BT pickers.** Action and condition fields upgrade from bare
  text inputs to grouped suggestions: project names lead, built-ins group under
  their namespace with localized descriptions, and the keyboard drives the
  whole popover. Action nodes no longer suggest conditions (and vice versa).
- **Tilemap ellipse tool + saved stamps.** Ellipse (**O**) fills the inscribed
  ellipse of a dragged box in one undo step, with the classic pixel-circle
  shape correction. A saved-stamp strip bookmarks the current brush per
  project — auto-named chips with pattern previews, click to recall, identical
  patterns dedupe.

### Changed

- **`.esanim` and `.estimeline` part ways.** `.esanim` is now exclusively the
  flipbook format with its own editor; the Sequencer keeps `.estimeline`, and
  **New Animation** creates a `.estimeline` instead of disguising a multi-track
  timeline as a flipbook. Existing files of both types stay valid.
- The three audio extension lists (SDK registry, runtime loader, editor tiles)
  unify on one set: `mp3 / wav / ogg / aac / flac / m4a / webm`.

### Fixed

- **WebGPU bind groups could go stale.** The bind-group cache keyed entries by
  resource handles that emscripten reuses immediately after release, so
  create/destroy churn could make a draw read a *deleted* resource's bindings —
  post-process passes read other passes' parameters, which silently blanked the
  whole WGSL bloom chain. Deleting a buffer or texture now evicts every cached
  group that references it, and the four bloom scenes joined CI on both
  backends to keep it that way.
- **Editing a joint no longer corrupts its connected body.** The editor's
  reconciler copied entity-reference fields verbatim across two id domains, so
  the first edit of any joint silently re-pointed `connectedEntity` at an
  arbitrary entity. References now remap on both edit and respawn (undo of a
  delete restores joint wiring correctly).
- **Kawase blur is backend-identical.** Post-process chain targets switch to
  bilinear sampling: the blur's half-texel taps landed exactly on texel
  boundaries under nearest filtering, whose rounding is backend-dependent — GL
  and WebGPU visibly diverged. Bloom falloff now measures byte-identical across
  backends in both color spaces.
- **`.esanim` texture dependencies now enter the cook.** Clips' sheet textures
  were invisible to the build's dependency scan, and anim-clip/timeline
  component slots matched no editor asset type so their pickers offered
  nothing. Both fixed by the flipbook split.
- **Audio preview is audible again.** The editor's CSP never allowed
  `estella://` media, so every `<audio>` element — including the double-click
  preview — was silently blocked.

## [0.21.0] - 2026-07-13

Estella speaks your language: the editor UI ships in English and 简体中文, and game
text localizes itself through `.eslocale` string tables bound straight to Text
components — no code. Networking graduates from beta with client prediction,
reconciliation, and interest management; physics gains one-way platforms and new
joints; cutscenes run code-free off the FSM; and a broad performance pass trims
per-frame work across the SDK, renderer, and editor.

### Added

- **The editor speaks 简体中文.** Every panel, dialog, menu, and toast ships in
  English and Simplified Chinese — over a thousand strings across the whole editor.
  Pick the language in **Settings → Appearance → Language** (it follows your system
  language by default); the editor reloads to apply it everywhere at once.
- **Localized game text as data.** New `.eslocale` string tables (one locale per
  file, with CLDR plural forms) and a `Text.i18nKey` binding that resolves keys to
  words every frame — switching locale or late-loading a table re-flows every bound
  label with zero bookkeeping. Scenes that bind keys **localize themselves in every
  runtime**: the loader auto-installs localization, discovers the shipped tables,
  and follows the player's system language, so even pure scene-driven projects get
  working localization with zero game code. Builds always include locale tables.
- **A translator-shaped locale editor.** `.eslocale` is a first-class asset:
  create tables from the Content Browser, edit them in a Details-panel editor with
  a reference translation per key, a one-click missing-keys backfill, and plural
  sub-editing — and bind keys from a `Text.i18nKey` dropdown that previews each
  key's translation. The `ui-controls` example ships English + 中文.
- **Networking graduates from beta.** The replication layer's `@beta` tags are
  gone, closed out by three capstones:
  - **Client prediction + reconciliation.** `prediction.apply` is the same
    input-to-state function the server runs — inputs apply locally with zero
    perceived latency, the server acknowledges consumed inputs, and every fixed
    tick rebuilds owned state as authority ⊕ unacknowledged replay, so
    mispredictions structurally cannot accumulate.
  - **Correction smoothing.** `prediction.smoothing { halfLife, maxError }` eases
    corrections out instead of snapping — purely presentational, so simulation
    state cannot drift; oversized errors still teleport.
  - **Interest management.** An `InterestPolicy` (built-in `radiusInterest`)
    scopes each connection to the entities it can see — entering entities spawn
    with current state, leaving ones despawn, and each client's delta carries only
    its own view. Connections always see the entities they own.
  - The `multiplayer-arena` example now runs on prediction end to end.
- **One-way platforms and new joints.** `OneWayPlatform` lets bodies jump up
  through a platform and land on it; `MotorJoint` drives a body toward a target
  velocity or spring-held offset (conveyors, moving platforms); and a mouse-drag
  API grabs dynamic bodies with an auto-sized grip. Showcased in the rebuilt
  `physics-playground` example.
- **Code-free cutscenes.** The FSM and behavior trees pre-register
  `timeline.play` / `timeline.pause` actions and a `timeline.finished` condition,
  and `TimelinePlayer` gains a formal replay contract (a latched `finished` flag;
  raising `playing` on a finished clip replays from the top). The new `cutscene`
  example plays an intro timeline, hands over to gameplay on finish, and replays
  on demand — without registering a single action in code.
- **Preview FX in edit mode.** A viewport toggle (on by default) runs particles
  and trails live while you edit — no Play required. Toggling off clears the
  residue, and editing an emitter's timing fields (duration, looping, bursts)
  restarts it so the change is visible immediately.
- **Outline post-process.** Full-screen Sobel edge detection inks scene edges
  toward black — the classic 2D ink look, tunable via threshold, thickness, and
  intensity.
- **Tiled image-collection tilesets.** "Collection of images" tilesets (one loose
  image per tile) now load everywhere: the loose images fold into a single grid
  atlas at load time, so the renderer sees an ordinary tileset. Previously every
  collection tile rendered as a white block.

### Changed

- **A performance pass across the frame loop.** The SDK query cache no longer
  pays for unrelated structural changes; text tessellation is cached per entity;
  state-visual writes stop at rest; transform iteration and world-matrix composes
  skip work for static and childless entities; the GL backend caches texture and
  scissor state to cut per-draw FFI; and the editor reads engine telemetry only
  while the Profiler panel is open.

### Fixed

- **KTX2 textures on WeChat.** The WebGL2 capability check relied on a DOM global
  that WeChat MiniGames don't have, so real devices refused every compressed
  texture despite running WebGL2. The check is now capability-based and
  environment-independent.
- **`.tmx` maps fail loud.** The tilemap loader advertised `.tmx` but only parses
  JSON, so XML maps died with an inscrutable syntax error. XML content is now
  rejected with the fix: export as **JSON map files (`.tmj`)** from Tiled.

## [0.20.0] - 2026-07-12

A real UI editor: anchor-based layout with an on-canvas resize gizmo, a widget palette
you drag onto the Canvas, and a design-resolution viewport that frames your target
screen and previews how the UI adapts on any device — backed by a modernized UI runtime
(theme tokens, live theming, data binding) and new tilemap layer tooling.

### Added

- **Design-resolution viewport.** Author your UI against a fixed design resolution —
  landscape `1920 × 1080` or a portrait `750 × 1334`, your call. UI mode frames the
  design screen on entry and dims around it, and the editor is **WYSIWYG**: what you lay
  out inside the frame is exactly what ships at that resolution. Pick the resolution from
  the viewport's **Design** dropdown, and simulate a target screen (iPhone / iPad /
  1080p …) from the **Device** dropdown — the UI **relayouts to that device's aspect**
  (per the Canvas scale mode) with letterbox bars and safe-area insets.
- **UI authoring on the canvas.** A nine-slice **anchor grid**, a **Widget palette** you
  drag onto the Canvas, and an eight-handle, unit- and anchor-aware **resize gizmo** that
  edits UINodes directly in the viewport. The UINode inspector is rebuilt around
  dimension fields, box-model cards, and anchor pickers, with In-Layout vs Absolute
  positioning modes.
- **Editing modes.** The Activity Bar switches between **Scene**, **UI**, and **Tilemap**
  modes (and follows your selection), each revealing its companion panels and viewport
  aids.
- **Modern UI runtime.** Anchor presets, a theme-token system with live theme swapping
  across every built-in widget, and a push-model data-binding API (signals / derived /
  bind) that cleans up automatically on despawn.
- **Tilemap layer panel.** Add layers and set per-layer opacity, with collision /
  terrain / animation badges surfaced in the palette.

### Changed

- Editor UI consolidated onto shared primitives (Button / IconButton), with inline
  editable dimension fields and deduplicated tilemap controls.

### Fixed

- UINodes lay out and are positionable: the reconciler keeps parent `Children` in sync so
  newly created UI children get laid out, absolute nodes bake correctly, and dragging a
  centered node works.
- Editor UI now matches the design frame at the correct scale — the design frame and
  layout share the UI world scale (1 unit = 1 design px) instead of mixing in the physics
  `pixelsPerUnit`, which had made UI vanish when the design resolution changed.
- Edit-mode gizmos are hidden in Play.
- `.estileset` tilemaps render on scene load and keep their tile size in sync.
- Engine-computed transform fields are preserved, so moving an entity no longer snaps the
  gizmo to the origin; text alignment is unified across framed and unframed text.
- Asset-ref fields validate leniently (string ref vs numeric handle), loader-based asset
  slots resolve to project paths, and `ThemeStyle` fields validate so themed widgets pass.

## [0.19.0] - 2026-07-10

A create-anything entity workflow, an inspector that guards your data, a fully
keyboard-driven editor, and multi-scene builds — plus a broad theme and Spine polish
pass.

### Added

- **Create any entity from one place.** The **Create…** popover now spawns every
  component-anchored entity — Sprite, Camera, Particles, Light, Tilemap, Spine, Audio,
  Text, BitmapText, Shape, Mesh, Trail, and the UI widgets — alongside **your own
  project components** and any **project prefab** (`.esprefab`). A single create pipeline
  backs the menu, drag-and-drop, and the automation surface, so every path spawns the
  same way and as one undo step.
- **Inspector field constraints.** A field declared **required** is flagged when left
  empty, a numeric field is clamped to its declared range on write (out-of-range values
  can no longer slip in through play-mode or material edits), and dropping an asset onto
  a slot is rejected unless its type matches.
- **Multi-scene builds.** Every scene in the project ships as a switchable
  `SceneManager` target. Pick the **startup scene** from the Content Browser, review the
  **Scenes in build** list in the Package dialog, and **exclude** scenes you don't want
  to ship.
- **Spine skeleton & atlas as first-class asset slots.** Assign the skeleton and atlas
  from asset-picker slots in Details — portable UUID references that survive moves and
  renames — with a live skeleton preview and animation/skin dropdowns.
- **Tilemap painting upgrades.** A **random-scatter brush** for stamp variation,
  **animated tiles** in the tileset editor (frame sequences with per-frame durations and
  a live preview), diagonal-flip support for GID tile objects, and a keyboard-navigable
  tile palette.
- **A keyboard-driven editor.** Menus and context menus navigate with the arrow keys
  (type-ahead, Home/End, submenus), the Outliner jumps to entities as you type, the
  Content Browser folder tree and the tile palette walk with arrows, file operations
  post a **toast with Undo**, transient surfaces restore focus on close, **Esc** backs
  out everywhere, and a visible focus ring always shows where you are.
- **Preview exports locally.** Serve web and playable-ad exports over a loopback HTTP
  server straight from the editor.
- **Query filter DSL.** The SDK exports `With`, `Without`, `And`, `Or`, and `Not` for
  composing query filters.

### Changed

- **The editor UI is unified in English** and migrated onto a single design-token
  system, so accent color, spacing, and surfaces stay consistent across every panel,
  menu, and graph editor. The material graph joins the shared node canvas (pan/zoom,
  shared context menu).
- **Closing a dirty document guards asynchronously** instead of blocking on a native
  confirm dialog.

### Fixed

- **Spine properties apply live from the inspector.** Editing the tint color, time
  scale, or the playing toggle now takes effect immediately; `setSkeletonColor` degrades
  gracefully on an older WASM that lacks it.
- **Spine atlases are single-sourced.** Atlas pages resolve through the manifest, the
  cook embeds them, KTX2 pages transcode via Basis, and the exporter detects the runtime
  version again.
- **WeChat export hardening.** One SDK core per bundle (no `Res` identity split-brain),
  KTX2 ships as `.ktx2.bin` to satisfy the suffix whitelist with the Basis module, the
  runtime instantiates the staged WASM twins, and export fails fast without the
  `-t wechat` runtime.
- **The packaged editor is self-contained.** It ships the new-project templates and can
  play and export without bundling editor sources at runtime.
- **Tilemap creation is a single undo step** again — the reconciler projects the
  tilemap's tileset assets out-of-band, so undo/redo and reload restore them.
- Platform-specific shortcut mismatches, duplicate entries in Recents, and a TypeDoc
  build break (a duplicated Basis transcoder import) are fixed.

## [0.18.0] - 2026-07-09

Tilemap authoring, on-canvas gizmos, and a selectable WebGPU backend — plus a round
of export fixes that make single-file playables self-contained again.

### Added

- **Tilemap authoring in the editor.** Paint maps directly in the viewport: a
  first-class New Tilemap command with a tileset chooser, multi-tileset layers (a
  single layer paints from several tilesets), add/remove tilesets on a layer live,
  a live rect/line paint preview, a block eraser, and stroke rollback. Tiled tile
  (GID) objects render as positioned sprites and honour their Tiled object rotation.
- **On-canvas gizmos.** Particle emitters show and aim on the canvas with a
  draggable spawn radius; lights and colliders adopt that same radius drag handle;
  gizmo handles now cover size (vec2) and cone angle — shape edited on the canvas,
  not just in the inspector.
- **Selectable WebGPU backend.** Switch the viewport between WebGL2 and WebGPU in
  Settings → Renderer (with a prompt to apply), the status bar shows the active
  backend, and the profiler reads real GPU time via timestamp queries — parity with
  the GL path.
- **Motion trails.** A `TrailRenderer` draws a ribbon through the unified batch face.
- **Y-sort.** Check a layer under Project Settings → Rendering → "Y-sorted layers"
  and its sprites/shapes/text draw in world-Y order (lower on screen on top) —
  top-down occlusion with no manual layer/z juggling, across the edit viewport, play
  mode, and every export target; pixel-verified on both backends.
- **Editor resilience.** The editor survives its own crashes — local crash capture,
  main-process failsafes, and a startup update notification.
- **Packaging & launcher.** The Package dialog exposes texture compression and
  auto-atlas; the launcher can remove a project from recents.
- **API surface governance.** Every public SDK export is snapshotted with its
  signature and stability tag in `sdk/etc/*.api.md`, enforced by CI. Networking, the
  material graph, and the headless/node entry are tagged `@beta` (no compatibility
  promise yet); everything untagged is stable.

### Fixed

- **Single-file playables are self-contained again.** Typed text/binary assets
  (tilemaps, materials, tilesets) no longer 404 in a playable: the embedded asset
  backend accepts an already-resolved `data:` URL instead of re-looking it up as a
  key. A tilemap's tileset images are now discovered as dependencies and rewritten
  to logical refs at cook time, so the single-file build actually ships and resolves
  them.
- **API-surface guard is machine-independent.** The snapshot excludes ambient
  built-in members (which float with the installed `@types/node`) and pins its line
  endings, so the CI guard no longer drifts between machines.

### Changed

- WebGPU caches bind groups instead of rebuilding one per draw.

### Removed

- The `esengine` SDK is no longer published to npm (the editor is the single
  distribution channel). The npm publish workflow and the broken `./factory`
  package entry are gone.

## [0.17.0] - 2026-07-08

The multiplayer and WebGPU release. Estella gains a complete server-authoritative
networking stack — declare which fields replicate and entities sync across machines
with interpolation, input routing, and an in-editor multiplayer preview — and the
renderer boots on WebGPU with pixel parity against WebGL2, shaders emitted in both
languages from one source.

### Added

- **Server-authoritative multiplayer.** Mark an entity `Replicated` and it spawns on
  every client; fields declared `replicated` (C++ annotation or `defineComponent`
  metadata) stream as binary deltas with per-field dirty masks and snapshot
  interpolation on the remote side. A `Net` session resource gates roles
  (server/client/offline), `Replicated.owner` routes each connection's per-tick input
  commands to its entities, and the handshake refuses protocol/ABI/schema drift
  fail-loud. **SDK:** `Net`, `Replicated`, `NetGhost`, `MemoryTransport`,
  `MessagePortTransport`, binary frames on `NetChannel`, sockets behind
  `PlatformAdapter.createSocket`.
- **Editor multiplayer preview.** The Play-mode dropdown gains a player count (1–4):
  the primary realm boots as the listen server and each extra player gets its own
  `Game P#` tab — the exact shipping netcode running across editor realms with zero
  network setup.
- **Dedicated servers on Node.** The new `esengine/node` entry runs the same engine
  wasm + gameplay code headless: `loadEsengineModule`, `createHeadlessApp`,
  `runHeadless`, a Node platform adapter, and a silent audio backend. New
  **multiplayer-arena** example; the networking guide covers the whole stack.
- **WebGPU render backend.** The engine boots on WebGPU (`backend: 'webgpu'`) with
  full-scene pixel parity against WebGL2. Every built-in shader, filter, post-process
  effect and material-graph output emits in both GLSL and WGSL from one source, and
  user `.esshader` files get auto-generated WGSL twins through a vendored
  glslang + naga pipeline (no external toolchain). Dual-backend pixel verification
  runs on every push via SwiftShader.
- **Mesh2D.** A scene-level custom-mesh renderer on the unified batch face — sorting,
  culling, clipping, multi-texture merging and 2D lighting for free.
- **Tiled parity.** Object layers spawn real colliders and queryable object data,
  hexagonal maps, multi-tileset rendering, chunked/infinite maps and external
  tilesets — one `.tmj` parser for all of it.
- **Asset pipeline.** Texture and audio residency with unified refcounts and
  memory-pressure trim, `Assets.preload` for streaming, cook-time auto-atlas packing
  (`<name>.atlas` folders), and content-addressed cooked builds that resolve path
  references end-to-end across web, WeChat and playable exports.
- **Post-processing.** True-LUT color grading and per-pass texture parameters.

### Changed

- **One draw-command producer.** All renderers assemble commands through
  `BatchBuilder` (CI-guarded); clears became render-pass load-ops; loose uniforms ride
  a std140 `DrawParams` UBO; every raw pointer+length WASM entry validates through
  `boundarySpan`. Sync `readPixels` left the RHI for an async readback seam.
- **Push-gated CI.** Every push to master now runs the C++ harnesses, both test
  suites, example checks, boundary guards and headless pixel verification — on both
  render backends.
- **SDK 0.6.0** (from 0.5.0): the networking/replication surface above, plus
  `Time.fixedTick` and the `esengine/node` entry.

### Fixed

- **Prefabs in shipped builds** — `PrefabServer` captured a stale `Assets` instance at
  plugin build, breaking uuid-referenced prefab instantiation in play/cooked runtimes.
- **Legacy tilemap scenes rendered nothing** — `TilemapLayer` asset discovery listed
  only one of its two refs.
- **Client authority window** — a connecting client committed its role only after the
  handshake, letting authority-gated gameplay run locally for the first ticks and
  leave orphan state beside the replicated ghosts.
- **Editor** — moving a UINode edits its layout inputs instead of stomping Yoga;
  actionable hint when a side module 404s.

## [0.16.0] - 2026-07-06

A renderer and UI release building on 0.15.0. It lands a modern typed-handle RHI
beneath the renderer, built-in 2D lit rendering with a shader effect library, and a
sharper, more tactile UI runtime (kinetic scrolling, scale-perfect text, virtualized
lists), alongside broad editor performance and workflow polish.

### Added

- **Built-in 2D lit rendering.** A `Sprite.lit` toggle lights any sprite through the
  Lit-2D channel using fragment-only shaders and ready-made material templates — no
  hand-authored lit material required.
- **Shader effect shelf.** A browsable library of effect templates, material-graph
  nodes, and an in-editor shader manual, with engine `time` and `screenUV` exposed to
  shaders (the `es` builtin prefix dropped) and a runnable effects gallery.
- **`createListView`.** An ergonomic virtualized list/grid widget with a UIMask-clipped
  viewport and an editor prefab; new **ui-list** example.
- **Kinetic UI scrolling.** Drag and touch scrolling with momentum and fling for scroll
  containers.
- **`Text.renderMode`.** Glyphs auto-route between a hinted bitmap path at their final
  pixel size and 4×-supersampled SDF when magnified, staying crisp at every scale.
- **Radial & unified fills.** Progress bars and sliders now share one `UIVisual.Filled`
  primitive, with radial gauges (360° / 180° / 90°) for cooldown rings and arc meters.
- **Editor quality-of-life.** Asset-reference fields locate their target in the Content
  Browser; a project paints its own thumbnail from the viewport on save; light gizmos
  show on/off state and are click-to-select; and a "Use less CPU in background" frame
  cap throttles the engine when the window is unfocused.

### Changed

- **Renderer RHI modernized.** The renderer moves to typed GPU resource handles with
  descriptor-based creation, a vertex layout folded into the pipeline object (VAOs
  become a GL-backend detail), render passes expressed as a single target+clear
  begin/end boundary, and the removal of loose render-state setters from the device
  interface. A pure internal refactor — no change to the documented SDK surface.

### Fixed

- **Lighting** — occluders no longer shadow their own interior (a caster can be lit),
  and Light2D collection is type-aware.
- **Editor** — submenu flyouts measure and clamp to the viewport, gizmos anchor at the
  entity's world position, text and panels are click-selectable with correct
  click-through cycling, and plain-path asset references resolve on incremental
  re-projection. Faster Play (stamped host build, idle prewarm, V8 code cache) and
  lighter idle CPU.
- **Assets** — sprite-animation clips play outside the editor by resolving on reference
  identity rather than a fetch URL.

### SDK

- `esengine` SDK **0.5.0**.

## [0.15.0] - 2026-07-05

The first feature release since the 0.14.0 licensing change — a large one. It adds a
full gameplay AI layer, a rebuilt World Outliner, a complete tilemap painter, a
first-class material system, a Sequencer, and much more, alongside deep internal
re-architecture of the editor, renderer, and asset pipelines.

### Added

- **Gameplay AI layer.** Grid navigation with A\* pathfinding (`NavGrid`, `NavAgent`,
  the `Nav` resource), a perception system (`Perceiver` / `PerceptionTarget` /
  `Perception`), and two decision paradigms over one shared action/condition
  registry — **state machines** (`.esfsm`) and **behavior trees** (`.esbt`) — each
  with a visual node-graph editor. New guide: **Gameplay AI**.
- **World Outliner** rebuilt to a UE-style `SSceneOutliner`: virtualized tree,
  path-based first-class folders, real hidden/locked state (decoupled from component
  enabled), reveal-on-select, keyboard navigation, token search, drag-to-reorder,
  and a pluggable column registry.
- **Tilemap painter** — stamp brush with flip/rotate and footprint preview, bucket &
  line tools on a unified stroke driver, terrain/autotile, per-tile polygon collision
  end-to-end, and a marquee select with copy / cut / paste / delete.
- **Material system** — reflection-driven std140 UBO materials, Material Instances, a
  Material Editor, static shader switches compiled to variants, 2D lighting (`Light2D`
  directional/point/spot with normal maps), and a visual **Material Graph**.
- **2D lighting & shadows** — `Light2D` on a dedicated Lit-2D channel plus
  `ShadowCaster2D` for soft, directional 2D shadows; per-sprite parallax scrolling.
- **Sequencer** — a UE-style timeline panel with a curve editor and auto-key
  recording, backed by a pure-TypeScript timeline runtime.
- **Animator** upgrades — nested (sub-)state machines, 1D blend states, exit-time
  transitions, and Spine-driven animation (not just sprites).
- **Input** — `defineInputMap` with named actions, gamepad support, data-driven
  `.inputmap` assets, a visual input-map editor, and interactive rebinding.
- **Physics** — a kinematic move-and-slide `CharacterController`, a Unity/UE-style
  collision-layer matrix in Project Settings, full world/solver config threaded from
  Project Settings, and contact/hit events.
- **Editor viewport** — UE-style gizmo handles, any-entity picking, multi-select,
  marquee, group transforms, nudge/snap, collider-shape overlays, and click-to-select
  UI elements via the engine hit-test.
- **Export targets** — playable-ad (single-file HTML), WeChat MiniGame
  (`exportWeChat`), and a desktop (Electron) target.
- **Subsystem observability** — a live **Engine Modules** panel reporting which
  subsystems are loaded and stepping across both the edit and play realms.

### Changed

- Large internal re-architecture across the **editor** (model-as-truth state, a
  versioned editor↔runtime protocol), the **renderer** (unified submission path,
  device-owned pipeline state, single-source `.esshader` shaders), **serialization**,
  and the **asset pipeline**. These touch engine internals, not the documented SDK
  surface.
- **UI runtime** modernized to fully SDF text (fill / outline / shadow), flex layout,
  and theme tokens; the legacy Canvas2D text renderer was removed.
- The **Apache-2.0 relicense** from 0.14.0 is carried into this release.

### Fixed

- Editor stability: a per-panel render error boundary, state-preserving hot reload,
  and more robust asset-reference resolution — plus numerous tilemap, outliner,
  physics, and export fixes.

### SDK

- `esengine` SDK **0.4.0** on npm.

## [0.14.0] - 2026-06-26

### Changed
- **License: relicensed to the Apache License, Version 2.0.** Estella is now free
  for any use, including commercial use. This reverts the noncommercial restriction
  introduced in v0.13.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), and
  [BUSINESS_MODEL.md](BUSINESS_MODEL.md).
- Every first-party source file now carries `SPDX-License-Identifier: Apache-2.0`.
- Contributing terms simplified to the standard Apache-2.0 **inbound = outbound**
  model; the previous Contributor License Agreement and commercial-relicensing grant
  are removed (see [CONTRIBUTING.md](CONTRIBUTING.md)).

### Added
- This `CHANGELOG.md` and a published versioning policy ([VERSIONING.md](VERSIONING.md))
  with an explicit Semantic Versioning commitment.
- A public business-model statement ([BUSINESS_MODEL.md](BUSINESS_MODEL.md)).

### Notes
- No code behavior changed in this release — it is a licensing/governance release.
- The bundled Spine Runtimes remain proprietary and are unaffected by this
  relicense; shipping a game that uses Estella's Spine integration still requires a
  Spine license from Esoteric Software (see [NOTICE](NOTICE)).

## [0.13.0] - 2026-06-22

### Changed
- Relicensed to the PolyForm Noncommercial License 1.0.0 (noncommercial use only,
  with a paid commercial license). **Superseded by 0.14.0** — this window is closed
  and Estella is permissively licensed again.

## Earlier history

Releases up to and including **v0.12.3** were published under the **MIT License**;
that grant remains valid for those snapshots. A detailed per-version changelog was
not kept before this file was introduced — see the Git history at
`github.com/esengine/estella` for the full commit-level record since the first
commit on 2026-01-25.

[Unreleased]: https://github.com/esengine/estella/compare/v0.53.0...HEAD
[0.53.0]: https://github.com/esengine/estella/compare/v0.52.0...v0.53.0
[0.52.0]: https://github.com/esengine/estella/compare/v0.51.0...v0.52.0
[0.51.0]: https://github.com/esengine/estella/compare/v0.50.0...v0.51.0
[0.50.0]: https://github.com/esengine/estella/compare/v0.49.0...v0.50.0
[0.49.0]: https://github.com/esengine/estella/compare/v0.47.0...v0.49.0
[0.47.0]: https://github.com/esengine/estella/compare/v0.46.0...v0.47.0
[0.46.0]: https://github.com/esengine/estella/compare/v0.45.0...v0.46.0
[0.45.0]: https://github.com/esengine/estella/compare/v0.44.0...v0.45.0
[0.44.0]: https://github.com/esengine/estella/compare/v0.43.0...v0.44.0
[0.43.0]: https://github.com/esengine/estella/compare/v0.42.0...v0.43.0
[0.42.0]: https://github.com/esengine/estella/compare/v0.41.0...v0.42.0
[0.41.0]: https://github.com/esengine/estella/compare/v0.40.0...v0.41.0
[0.40.0]: https://github.com/esengine/estella/compare/v0.39.0...v0.40.0
[0.39.0]: https://github.com/esengine/estella/compare/v0.38.0...v0.39.0
[0.38.0]: https://github.com/esengine/estella/compare/v0.37.0...v0.38.0
[0.37.0]: https://github.com/esengine/estella/compare/v0.36.0...v0.37.0
[0.36.0]: https://github.com/esengine/estella/compare/v0.35.0...v0.36.0
[0.35.0]: https://github.com/esengine/estella/compare/v0.34.1...v0.35.0
[0.34.1]: https://github.com/esengine/estella/compare/v0.34.0...v0.34.1
[0.34.0]: https://github.com/esengine/estella/compare/v0.33.0...v0.34.0
[0.33.0]: https://github.com/esengine/estella/compare/v0.32.0...v0.33.0
[0.32.0]: https://github.com/esengine/estella/compare/v0.31.0...v0.32.0
[0.31.0]: https://github.com/esengine/estella/compare/v0.30.0...v0.31.0
[0.30.0]: https://github.com/esengine/estella/compare/v0.29.0...v0.30.0
[0.29.0]: https://github.com/esengine/estella/compare/v0.28.0...v0.29.0
[0.28.0]: https://github.com/esengine/estella/compare/v0.27.0...v0.28.0
[0.27.0]: https://github.com/esengine/estella/compare/v0.26.0...v0.27.0
[0.26.0]: https://github.com/esengine/estella/compare/v0.25.0...v0.26.0
[0.25.0]: https://github.com/esengine/estella/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/esengine/estella/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/esengine/estella/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/esengine/estella/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/esengine/estella/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/esengine/estella/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/esengine/estella/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/esengine/estella/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/esengine/estella/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/esengine/estella/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/esengine/estella/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/esengine/estella/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/esengine/estella/compare/v0.12.3...v0.13.0
