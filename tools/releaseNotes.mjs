// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Where every user-facing commit landed in the release notes.
 *
 * `check-release-metadata` reads the CHANGELOG's STRUCTURE — that a version has
 * a section, a compare link, a supported row. Nothing read its CONTENT, so a
 * feature could ship with no note and the release would still go out green. It
 * has happened in three releases running: v0.55 lost 31 commits across two
 * batches, 0.64 lost three, 0.66 lost the whole ECS speculation line plus the
 * editor crash fix — each found only by reading `git log` by hand.
 *
 * So say it once per commit instead. A commit that changes what a creator can
 * do names the note it landed under; one that does not says why. The gate holds
 * both directions: a missing commit fails, and so does a note title that no
 * longer exists in the CHANGELOG, which is what a rename would otherwise do
 * quietly.
 */

/** The release this reaches back to. Older ones are out of scope BY DECLARATION. */
export const NOTES_FLOOR = 'v0.65.0';

/**
 * Commit subject → where it landed. `note` is a CHANGELOG headline (a prefix of
 * one is enough); `internal` is the reason a creator could not observe it.
 *
 * Subjects, not hashes: a rebase changes the hash and the line it names is what
 * the reader recognises anyway.
 */
export const NOTED = {
  'feat(build): the size panel says which budget each byte is on':
    { note: "The build's size panel marks which files are in a subpackage." },

  'fix(size): a subpackage is off the main package, and a compressed engine is still the engine':
    { note: "The size report counts a mini-game's main package without its subpackages." },

  'fix(project): seven packaging settings a project could declare did nothing':
    { note: "A WeChat package can put its engine binary in a compressed subpackage." },

  'feat(play): a cold start that never says hello now says what its frame did':
    { note: 'A game that fails to start says what its frame actually did.' },

  'refactor(theme): a type scale with one job per step, and steps you can tell apart':
    { note: "The editor's smaller labels are readable — one body size instead of three within 2px." },

  'refactor(theme): one name per value — three alias vocabularies collapse into one':
    { internal: "Editor token names only; the editor looks pixel-identical and no creator writes them." },

  "fix(export): a web package no longer carries another host's SDK":
    { note: "A web build stops shipping the WeChat SDK entries next to the one its page loads." },

  'fix(pipeline): the esengine specifiers a game can write are the ones the SDK publishes':
    { note: 'A page no longer carries a module mapping that resolves to a file it does not have.' },

  'fix(sdk): a subsystem installs one plugin, however many callers registered it':
    { note: 'A build that ships Spine or DragonBones installs one of each again, not two.' },

  'fix(scale): the frame ceilings are set from both machines, not one':
    { internal: 'A repository perf budget; no creator runs it.' },

  'fix(scale): a wasm budget is denominated in wasm, not in a JS loop':
    { internal: 'A repository perf budget; no creator runs it.' },

  'docs(theme): the alias block says what it is, not what it was for':
    { internal: "A comment in the editor's token file; nothing a creator sees changes." },

  'fix(docs): the plugin manual named two CSS variables the editor does not have':
    { note: 'A plugin styled from the manual gets the editor\'s real colours instead of none.' },

  'fix(editor): six CSS variables that were never defined, so they drew nothing':
    { note: "The Inspector's effect stack draws its toggle, its rows and its Add button again." },

  'feat(gates): a CSS variable that nothing defines is refused':
    { internal: "A repository gate over the editor's own stylesheets; no creator runs it." },

  'fix(examples): the starfield tiles, as its texture was drawn to':
    { note: "space-shooter's background no longer stretches a 256px starfield over the whole screen." },

  'chore(gates): the reds behind the first one':
    { internal: 'Generated artifacts and gate bookkeeping; nothing a creator sees changes.' },

  'test(editor): a sprite tiles when its scene says to, and stops when told not to':
    { internal: 'A repository check over the editor; no creator runs it.' },

  "feat(editor): a whole screen's heading is a step of the scale, not a raw 25px":
    { internal: 'One heading moved onto an existing scale; nothing a creator sees changes size.' },

  'fix(api): a public field may not be typed by an unfrozen enum':
    { internal: 'A tier declaration on a generated enum; the type a creator sees is unchanged.' },

  'feat(gates): the editor counts the controls it rolled by hand':
    { internal: "A repository ratchet over the editor's own components; no creator runs it." },

  'test(sdk): the optional subsystems are asserted against what ships, not what compiles':
    { internal: 'A repository test over the built bundle; no creator runs it.' },

  'fix(sdk): a subsystem registers by being called, not by being imported':
    { note: 'An optional subsystem is installed again in builds where a bundler had dropped it.' },

  'fix(api): a new component field is optional, so a frozen promise holds':
    { note: 'Sprite.drawMode is optional, so existing SpriteData code still compiles.' },

  'feat(gates): a colour that names a thing only colours that thing':
    { internal: "A repository gate over the editor's own palette; no creator runs it." },

  'fix(editor): a viewport colour names a thing, and four panels borrowed one':
    { note: 'Record, mute, delete and unsaved read as what they are, not as viewport colours.' },

  'feat(editor): the build dialog offers Douyin, because the registry says it exists':
    { note: 'Douyin is selectable in the build dialog and has its own texture Import'
      + ' Settings tab.' },

  "feat(gates): the visual layer's drift is measured, not just its contrast":
    { internal: "A repository gate over the editor's own stylesheets and icons; no creator runs it." },

  "feat(runtime): a mini-game reports its boot through the host's indicator":
    { note: 'A mini-game says how far along its boot is, not just that it is loading.' },

  'fix(gates): the notes ledger parses again':
    { internal: 'Repairs this very file after a quote broke it; no creator reads it.' },

  'perf(sdk): a declaration list is an authority, not a build entry':
    { internal: 'Withdraws an unmeasured build entry from the commit before it; a package is 1,794 bytes lighter than that mistake, and unchanged otherwise.' },

  'fix(gates): the optional-subsystem ratchet counts what a package actually holds':
    { internal: "A repository gate over the SDK's own imports; no creator runs it." },

  'feat(export): a project can be packaged for Douyin':
    { note: 'A project can be exported as a Douyin (抖音) mini-game.' },

  'feat(render): a sprite says how it fills its box, instead of its texture saying':
    { note: 'A sprite can be drawn whole even when its texture carries a 9-slice border.' },

  'refactor(sdk): 2D physics declares where its declarations end':
    { internal: 'Where the same code lives; behaviour and the public surface are unchanged.' },

  'feat(export): a mini-game carries the optional subsystems its project uses':
    { note: 'A WeChat mini-game now carries only the optional subsystems its project uses.' },

  'refactor(sdk): the core runtime names no optional subsystem at all':
    { internal: 'Same subsystems, same behaviour; a lean build now says when it ships without one.' },

  'refactor(sdk): the scene loader asks for Spine and DragonBones, and does not name them':
    { internal: 'Same subsystems, same behaviour; only which file reaches them changed.' },

  'refactor(sdk): an entry point decides which optional subsystems it ships':
    { internal: 'The same plugins are installed; only which file names them changed.' },

  "feat(gates): the core runtime's pull on optional subsystems is a ratchet":
    { internal: 'A repository gate over the SDK\'s own imports; no creator runs it.' },

  'feat(export): a mini-game package says which subsystem each byte came from':
    { internal: 'A field on the export result; no panel shows it yet, so nothing a creator sees.' },

  'feat(export): a packaged game says it is loading':
    { note: 'A packaged game now says it is loading.' },

  'fix(checks): a play realm that never came up says what it did say':
    { internal: "What an editor check prints when it fails; no creator runs the checks." },

  'fix(gates): the exit criteria ask a host only what that host can answer':
    { internal: 'Which CI shard answers which release criterion; no creator runs the list.' },

  'feat(gates): spacing off the 4px grid is a ratchet, not a demand for zero':
    { internal: "A repository gate over the editor's stylesheets; no creator runs it." },

  'fix(export): a mini-game package carries only what its packer will upload':
    { note: 'A WeChat package no longer carries files the upload would refuse.' },

  'refactor(assets): what a restaged .bin really is, answered in one place':
    { internal: 'One reader for a packaging spelling; what resolves is unchanged.' },

  "fix(export): the shared mini-game entry names no vendor's API":
    { internal: 'Fixes an unreleased commit from this same cycle; the shipped behaviour never had it.' },

  'feat(theme): a dialog title reads as a title':
    { note: "A dialog's title now looks like one." },

  'feat(export): the engine binary can ship in a 分包 the host loads at startup':
    { note: "The engine can ship outside a WeChat mini-game's main package entirely." },

  'feat(build): the engine binary can ship in a subpackage':
    { note: "The engine can ship outside a WeChat mini-game's main package entirely." },

  'refactor(export): the entry asks for the runtime where the layout put it':
    { internal: 'One author for a path inside the package; what it answers is unchanged.' },

  'fix(assets): a load that failed is warned, not only recorded':
    { note: 'An asset that fails to load says so.' },

  'feat(export): the engine binary can ship as .wasm.br to a host that takes one':
    { note: 'A WeChat mini-game can ship its engine compressed, freeing a third of the main' },

  'feat(build): a mini-game can ship its engine binary compressed':
    { note: 'A WeChat mini-game can ship its engine compressed, freeing a third of the main' },

  'fix(gates): project-health tests a warning with a field that still is one':
    { internal: "The preflight check's own fixture; it follows the sprite-texture change and no creator runs it." },

  'fix(gates): the MCP end-to-end tests required-empty with a field that still is one':
    { internal: "The end-to-end gate's own fixture; it follows the sprite-texture change and no creator runs it." },

  'fix(gates): a gate that needs a required field asks which one is still required':
    { note: 'A sprite with no texture is no longer reported as unfinished.' },

  'fix(export): a Meta playable is judged against the 5MB Meta publishes':
    { note: 'A Meta playable can spend all 5MB Meta allows.' },

  'feat(build): a preflight refusal about the content can be answered':
    { note: 'A build the preflight objects to can be packaged anyway.' },

  'fix(gates): the build adjudicator gate reads both halves of the decision':
    { internal: 'A repository gate reading the editor source; no creator runs it.' },

  'feat(gates): the text ramp is held to 4.5:1 on the surfaces text sits on':
    { note: "The editor's faintest label colour is readable." },

  'feat(gates): check-theme holds the panel ramp quieter than the viewport':
    { note: "The build size chart's video slice stops shouting." },

  "fix(theme): the size chart's video series is a panel colour, not a viewport one":
    { note: "The build size chart's video slice stops shouting." },

  "fix(gates): the acknowledged build's cleanup retries, as every recursive delete must":
    { internal: "An editor check's own temp-directory cleanup; no creator runs it." },

  'feat(render): the WebGPU backend draws the scene and the backbuffer multisampled':
    { note: 'Geometry edges are anti-aliased on WebGPU, which is every native build.' },

  'feat(build): a limit that is over names the files filling it, and what to do':
    { note: 'The build size report says why a file is in your package, and what changed since the' },
  'fix(inspector): a Sprite with no texture is not an unfinished entity':
    { note: 'A sprite with no texture is no longer reported as unfinished.' },

  'feat(build): the size panel says why a file is in the package, and what moved':
    { note: 'The build size report says why a file is in your package, and what changed since the' },

  'feat(export): the size report says why a file is in the package, and what moved':
    { note: 'The build size report says why a file is in your package, and what changed since the' },

  'feat(render): a game is told the device came back, and which target it drew is blank':
    { note: 'The picture comes back after the GPU is lost.' },

  'fix(render): a video and a canvas come back after the GPU is lost':
    { note: 'The picture comes back after the GPU is lost.' },

  'feat(render): the device warns when what it keeps for a loss passes a budget':
    { note: '`getResourceStats()` reports the memory kept to survive a lost GPU.' },

  'perf(render): glyph and skeleton atlas pages come back from what made them':
    { note: 'The picture comes back after the GPU is lost.' },

  'feat(render): the device counts the memory it keeps to survive a loss':
    { note: '`getResourceStats()` reports the memory kept to survive a lost GPU.' },

  'fix(render): the device rebuilds every object it issued behind the same handle':
    { note: 'The picture comes back after the GPU is lost.' },

  'fix(render): a vertex stage names gl_InstanceID only after its attributes':
    { note: '3D meshes draw on Windows with WebGL2 again.' },

  'fix(render): the probe block stays a constant buffer under ANGLE on D3D11':
    { note: 'An imported model lit by an environment with a reflection draws on Windows.' },

  'fix(render): a uniform changed after its first upload reaches WebGPU draws':
    { note: 'A material parameter changed after its first frame takes effect on WebGPU.' },

  'fix(platform): a hot update on a native build is stored under a name the host accepts':
    { note: 'A hot update on iOS, Android and desktop builds is still there after a restart' },

  'fix(export): the WeChat total budget is the 30MB WeChat allows':
    { note: 'A WeChat mini-game is judged against WeChat\'s real 30MB total.' },

  'fix(gates): a package is judged at one frame of game time per rendered frame':
    { internal: 'The package launcher the verifiers share; no creator runs it.' },

  'fix(gates): third-person runs its package on one frame of game time per frame':
    { internal: 'A verifier and its launcher; no creator runs them.' },

  'fix(render): a mesh with no colour channel draws, as white vertices':
    { note: 'A baked decal draws on devices and under WebGPU.' },

  'fix(render): a material that writes only its fragment draws on a mesh under WebGPU':
    { note: 'A material that writes only its fragment stage draws on a mesh under WebGPU and on' },

  'fix(gates): an Electron download the host refuses is retried, and third-person says when no game ran':
    { internal: 'Verifier tooling; no creator runs it.' },

  'fix(editor): a project opened from inside the editor finishes loading':
    { note: 'Opening a project from inside the editor no longer leaves the loading screen up.' },

  'feat(editor): one ledger says when the editor has caught up, and every capture waits for it':
    { note: 'An agent\'s picture of the editor shows the edit it made.' },

  'fix(checks): captures wait for an idle editor, and the per-check waits go':
    { internal: 'The editor checks\' capture helper; the editor did not change.' },

  'fix(tests): the flipbook creation test stubs the create door the clip now goes through':
    { internal: 'A test stub; the editor did not change.' },

  'fix(assets): adopting a file never replaces the sidecar its creator wrote':
    { note: 'A new prefab, material, animation clip or graph keeps the id it was created' },

  'fix(assets): a new asset\'s sidecar lands before its content, through one door':
    { note: 'A new prefab, material, animation clip or graph keeps the id it was created' },

  'fix(checks): gizmo-near-clip reads the beam once the viewport has drawn it':
    { internal: 'An editor check; the editor did not change.' },

  'fix(play): a realm whose frame was not in the page says so':
    { note: 'A Play that never comes up says how far it got.' },

  'fix(play): automation waits for Play as long as the session may take, and says why it failed':
    { note: 'A Play that never comes up says how far it got.' },

  'fix(checks): captures wait for a viewport that has stopped changing':
    { internal: 'The editor checks\' capture helper; the editor did not change.' },

  'fix(gates): the release-notes ledger reads whole histories, and says so when it cannot':
    { internal: 'A repository gate; no creator runs it.' },

  'fix(checks): camera-frustum takes a capture once two in a row agree on the viewport':
    { internal: 'An editor check; the editor did not change.' },

  'fix(checks): dodge-graph reads the HUD a frame after the loss, and a restart\'s leftovers by identity':
    { internal: 'An editor check; the editor did not change.' },

  'fix(checks): sprite-frame judges the picture the sprite reaches, not the first still one':
    { internal: 'An editor check; the editor did not change.' },

  'fix(play): a project prepares one play realm at a time':
    { note: 'Play started while the editor was still preparing it gets a whole game.' },

  'fix(tilemap): a layer hidden in Tiled is hidden in the game':
    { note: 'A layer hidden in Tiled stays hidden.' },

  'fix(play): a realm that misses its deadline is asked where it is, and a replaced one is not heard':
    { note: 'A Play that never comes up says how far it got.' },

  'fix(play): a Play that never comes up says how far it got':
    { note: 'A Play that never comes up says how far it got.' },

  'fix(automation): an editor a program drives ends when the program does':
    { note: 'An editor an agent started closes when the agent does.' },

  'fix(golden): Electron is fetched once before editors launch side by side':
    { internal: 'The golden verifier launching its own editors; no creator runs it.' },

  'fix(golden): a retry is handed the attempt that failed':
    { internal: 'What the golden verifier prints about its own retries.' },

  'fix(golden): a missing frame says what the attempt printed, and blames the GPU only on evidence':
    { internal: 'What the golden verifier prints about its own retries.' },

  'fix(ci): the parity frames a golden failure keeps are actually uploaded':
    { internal: 'CI artifacts only.' },

  'fix(golden): lighting-3d\'s points follow the surface shading at its real place':
    { internal: 'The expected pixels moved to where the surface is; the engine did not change.' },

  'fix(checks): dodge-graph plays paused, so only a step moves the player':
    { internal: 'An editor check; the editor did not change.' },

  'fix(checks): scatter-scale measures the editor\'s half, out of the eye\'s view':
    { internal: 'An editor check; the editor did not change.' },

  'fix(checks): camera-frustum captures after the toggle is drawn, not after a sleep':
    { internal: 'An editor check; the editor did not change.' },

  'feat(render): what a shiny thing reflects indoors is the room, not the sky':
    { note: 'What a shiny thing reflects indoors is the room, not the sky.' },

  'fix(lightmap): the bake\'s ray tracer walked its own tree wrong':
    { note: "The bake's ray tracer walked its own tree wrong." },

  'fix(lightmap): a scene with nothing in it no longer walks one node forever':
    { note: "The bake's ray tracer walked its own tree wrong." },

  'feat(bake): the editor bakes reflections too, and says which column each probe got':
    { note: 'What a shiny thing reflects indoors is the room, not the sky.' },

  'fix(render): a material shades at the place its surface really is':
    { note: 'A material-shaded surface shaded itself at z = 0.' },

  'fix(texture): WebGPU stops dividing a texture by its alpha twice':
    { note: 'A half-transparent texture looks the same on WebGPU as on WebGL2.' },

  'fix(render): a mirror reads its reflection at level 0 on WebGL2 too':
    { note: 'A mirror has no seam across it on WebGL2.' },

  'fix(native): the host evaluates a script by its size, not by strlen':
    { note: 'A native build runs a script that holds a NUL character.' },

  'fix(export): a playable exports from the hosts an editor ships':
    { note: 'The editor packages playable ads again.' },

  'fix(export): the editor prebuilds every host an export asks for':
    { note: 'The editor packages playable ads again.' },

  'fix(verify): a pixel gate whose scene could not load an asset fails and names it':
    { internal: 'Only the render gates read it: a scene missing an asset now fails its own check.' },

  'fix(verify): a scene load says which assets it could not load':
    { internal: 'The automation door the render gates drive; no creator calls it.' },


  'feat(render): a wall stops the frame from drawing what stands behind it':
    { note: 'A wall can stop a frame from drawing what is behind it.' },

  'feat(editor): the box an occluder blocks sight with, drawn where you place it':
    { note: 'A wall can stop a frame from drawing what is behind it.' },

  'feat(corpus): the corridor walls say sight stops at them':
    { note: 'A wall can stop a frame from drawing what is behind it.' },

  'feat(decal): a projector you can place, and a bake that prints it':
    { note: 'Decals you can place.' },

  'feat(decal): the surface under a projector, cut to its box':
    { note: "A decal's geometry, cut." },

  'feat(render): a material can say its surface goes ON another one':
    { note: 'A surface can say it goes ON another one.' },

  'feat(editor): a scatter brush, and one stroke that undoes in one step':
    { note: 'A scatter brush.' },

  'feat(render): the per-object record leaves the vertex attributes':
    { note: 'A mesh has somewhere to put its own vertex attributes.' },

  'feat(render): indirect light per instance, so a probe stops refusing the merge':
    { note: 'A scene can hold a thousand of something again.' },

  'test(render): the instancing check asks a scene that has probes in it':
    { internal: 'The check moved with the fix; what a creator sees is the fix.' },

  'feat(editor): what a frame costs, and the first check to ask about scale':
    { note: 'Automation can read what a frame cost.' },

  'feat(logic): a graph can call another graph, and pay for it out of one budget':
    { note: 'A graph can call another graph.' },

  'feat(logic): a signature to declare and a graph to call, on the shared canvas':
    { note: 'A graph can call another graph.' },

  'feat(scene): a graph can change the scene, through the door every surface holds':
    { note: 'A graph can change the scene.' },

  'feat(scene): the scene verbs describe themselves in the palettes':
    { note: 'A graph can change the scene.' },

  'feat(audio): a sound anything authored can start':
    { note: 'A sound anything authored can start.' },

  'feat(audio): the audio verbs describe themselves in the palettes':
    { note: 'A sound anything authored can start.' },

  'feat(logic): a graph can spawn a prefab, and the node says which one':
    { note: 'Gameplay you can draw.' },

  'feat(prefab): a prefab you can spawn in one frame, because its loading is done':
    { note: 'Gameplay you can draw.' },

  'feat(logic): a graph can reach a keyboard, another entity, and who an event named':
    { note: 'Gameplay you can draw.' },

  'feat(logic): wires that clear the nodes, nodes that say which one they are':
    { note: 'Gameplay you can draw.' },

  'feat(logic): gameplay you can draw, and a corpus that draws some':
    { note: 'Gameplay you can draw.' },

  'fix(play): Run brings the realm up from wherever the author is standing':
    { note: 'Run works from wherever you are standing.' },

  'fix(logic): a node starved of its input does not run on an invented value':
    { internal: 'Inside the script graph, which no shipped corpus authors yet.' },

  'feat(logic): a script graph is something you can draw':
    { internal: 'The editor half of the script graph. The whole feature gets one note once a shipped example authors a graph.' },

  'feat(logic): the edits a script-graph editor makes, and the rules they obey':
    { internal: 'The graph ops the panel drives. No creator meets them except through that panel.' },

  'feat(assets): a script graph is a live asset like the other authored graphs':
    { internal: 'The .esgraph asset slot. Nothing authors one yet — no panel, no new-asset entry.' },

  'feat(assets): the Content Browser knows a .esgraph when it sees one':
    { internal: 'Badge and icon for an asset type nothing can create yet.' },

  'feat(logic): an entity can carry a graph, and the graph can reach the world':
    { internal: 'The engine binding and the built-in value vocabulary. Still nothing authors a graph — the asset has no editor yet.' },

  'feat(logic): a graph is nodes, wires, and one vocabulary it shares':
    { internal: 'The script-graph core and the registry half it needs. Nothing authors one yet — no asset type, no component, no panel.' },

  'fix(platform): a mini-game reads the file the package actually carries':
    { note: 'A mini-game package can read its own prefabs and materials.' },

  'fix(pipeline): a bake writes the ref a package can resolve':
    { note: 'A baked room is lit in the package too.' },

  'feat(lighting): a scene says how it is lit, and whether its light still describes it':
    { note: 'A scene says how it is lit, and whether its light still describes it.' },
  'feat(lighting): a Lighting panel, and a scene that says whether its light is stale':
    { note: 'A scene says how it is lit, and whether its light still describes it.' },

  'feat(render): a bake solves the probes in the light field it already has':
    { note: 'A bake now solves the probes too, and refuses to light what moves.' },
  'feat(lighting): Bake Lighting solves the probes, and refuses to light what moves':
    { note: 'A bake now solves the probes too, and refuses to light what moves.' },

  'feat(render): a thing that moves takes the light of the room it is in':
    { note: 'Light probes: what lights a thing a bake cannot hold still.' },
  'feat(lighting): a probe volume is a box a creator can see and place':
    { note: 'Light probes: what lights a thing a bake cannot hold still.' },

  'fix(sdk): a reloaded bundle addresses the world it is reloading into':
    { note: 'A hot reload no longer empties the running game of every resource' },
  'feat(sdk): an app says what its resources are called':
    { internal: 'the door it replaces was only ever wrong between two unreleased commits — a creator sees the same resource names either way' },
  'fix(editor): the resource door reads the declared name, and the live check asks about it':
    { internal: 'the same unreleased window — and the live check it extends is a criterion, which a creator never runs' },

  'feat(corpus): a room that is actually lit, and a gate that keeps it lit':
    { note: 'A room in the corpus is actually lit.' },
  'refactor(engine): the collector composes a transform through the SDK\'s own':
    { internal: 'where one expression lives — the matrix it produces is identical' },

  'feat(lighting): stock geometry takes a bake, and a refused one says why':
    { note: 'Stock geometry takes a bake, and the density suits this engine\'s units.' },
  'feat(render): a bake derives UVs for geometry that has no file':
    { note: 'Stock geometry takes a bake, and the density suits this engine\'s units.' },

  'feat(lighting): a bounce carries the colour of what it came off':
    { note: 'A bounce carries the colour of what it came off.' },
  'feat(render): a surface reflects the colour it actually has':
    { note: 'A bounce carries the colour of what it came off.' },

  'feat(lighting): Bake Lighting, and the atlas the scene reads it from':
    { note: 'Bake Lighting.' },
  'chore(editor): the bake reaches the menu':
    { note: 'Bake Lighting.' },

  'refactor(pipeline): the PNG encoder gets its own file':
    { internal: 'where one exported function lives — the bytes both imports write'
      + ' are identical before and after' },
  'feat(pipeline): a scene of placed surfaces becomes an atlas, and says what it skipped':
    { note: 'Bake Lighting.' },

  'feat(render): lights become an atlas a mesh can be read through':
    { note: 'The bake itself: lights become an atlas.' },

  'feat(render): a model can be unwrapped for the light that will be baked into it':
    { note: 'A model can be given somewhere to receive baked light.' },
  'feat(import): Generate Lightmap UVs reaches the mesh it decides':
    { note: 'A model can be given somewhere to receive baked light.' },

  'feat(render): a mesh can be read through the light baked into it':
    { note: 'A mesh can be read through the light that was baked into it.' },
  'fix(checks): the watcher check survives a loaded machine, and says what it saw':
    { internal: 'the same check\'s start-up race and its assertion — the watcher'
      + ' it questions behaved the same before and after' },
  'fix(checks): a watch that never fires says so':
    { internal: 'a check\'s own wait, which reported a timeout as a type error —'
      + ' the watcher it questions behaved the same before and after' },

  'feat(gates): the per-object mesh record is described in one shape':
    { internal: 'a gate over four declarations of one vertex layout — a game draws'
      + ' the same whether or not they can drift' },
  'perf(render): a model matrix travels as three rows, not four':
    { internal: '16 bytes an instance and one attribute slot, both spent on a row that'
      + ' is (0,0,0,1) on every transform — the frame is identical either way' },

  'fix(gates): the animator parameter census reads a blend over a plane':
    { internal: 'a gate reading a project\'s own animator files — a game plays the'
      + ' same whether or not the census can see a blend over a plane' },

  // — after 0.66.0 —
  'feat(gates): a feature that ships without a note fails the build':
    { internal: 'a gate over this repository\'s own release process — a creator'
      + ' downloads the engine, not the checks that decided it could ship' },

  // — 0.66.0, engine —
  'feat(assets): the shapes a model was authored to blend between arrive with it':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(render): a mesh is drawn in the shape its weights ask for':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(anim): a clip can say what shape a mesh is in':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(assets): an FBX brings its blend shapes':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(assets): a list field can say where its row names come from':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(anim): a controller is a STACK of machines, not one':
    { note: 'A controller is a stack of machines, not one.' },
  'feat(anim): the graph ops address a layer, without a second vocabulary':
    { note: 'A controller is a stack of machines, not one.' },
  'feat(anim): a layer writes the part of the rig it was given':
    { note: 'A layer writes the part of the rig it was given.' },
  'feat(anim): a silent layer says nothing, including with a sprite sheet':
    { note: 'A layer writes the part of the rig it was given.' },
  'feat(anim): a 1D blend mixes its neighbours instead of picking one':
    { note: 'A blend mixes its neighbours instead of picking one.' },
  'feat(anim): a blend over a plane, by the operation the line already used':
    { note: 'A blend over a plane.' },
  'feat(examples): the third-person rig runs and swings at the same time':
    { note: 'The third-person rig runs and swings at the same time.' },
  'feat(anim): a clip means the same thing on a rig bound differently':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'feat(anim): a retargeted step travels as far as the rig would':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'feat(anim): one clip drives rigs that do not share its bone names':
    { note: 'One clip drives rigs that do not share its bone names.' },
  'feat(anim): the posed skeleton can be made to reach something':
    { note: 'The posed skeleton can be made to reach something.' },
  'feat(anim): a constraint is an edit like any other':
    { note: 'The posed skeleton can be made to reach something.' },
  'feat(ecs): a step of gameplay nobody has seen yet, and can take back':
    { note: 'A step of gameplay nobody has seen yet, and can take it back.' },
  'feat(ecs): a system asks for a speculation the way it asks for anything else':
    { note: 'A step of gameplay nobody has seen yet, and can take it back.' },
  'feat(ecs): a step can be asked whether it is a function of the world':
    { note: 'A step can be asked whether it is a function of the world.' },
  'feat(net): the rule reconciliation replays can be asked whether it replays':
    { note: 'A step can be asked whether it is a function of the world.' },
  'refactor(anim): a state says what it plays one way, from the file in':
    { note: 'A state says what it plays one way, from the file in.' },
  'fix(anim): a layer\'s clips ship, and reach the game that plays them':
    { note: 'A layer\'s clips reach the game that plays them.' },
  'fix(anim): a blend weights its displacement the way it weights its pose':
    { note: 'A blend weights its displacement the way it weights its pose.' },
  'feat(anim): the blend twins are both on the public surface':
    { note: '`isBlend1D` was never on the public surface' },
  'fix(golden): the editor\'s frame shares the rasterizer too':
    { internal: 'a verifier reading the editor\'s own capture — no packaged game changes' },
  'fix(gates): the editor capture gets the settle window the package gets':
    { internal: 'a verifier\'s timing, not the engine\'s' },

  // — 0.66.0, editor —
  'feat(inspector): a mesh\'s shapes are editable, under their own names':
    { note: 'A model brings the shapes it can be blended towards.' },
  'feat(animator): the editor edits a layer, and says which one':
    { note: 'A controller is a stack of machines, not one.' },
  'feat(animator): a blend is something an author can make':
    { note: 'A blend is something an author can make.' },
  'refactor(animator): the panel asks one question about a motion, not four':
    { note: 'A state says what it plays one way, from the file in.' },
  'feat(animator): constraints are something an author can place':
    { note: 'The posed skeleton can be made to reach something.' },
  'feat(animator): an avatar can be described from the rig itself':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'feat(animator): an avatar measures the rig it describes':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'feat(project): an avatar is an asset the editor can make':
    { note: 'A clip means the same thing on a rig bound differently.' },
  'fix(editor): a crash dialog must not hold the process it warns about':
    { note: 'An unexpected error no longer takes the editor with it.' },
  'fix(play): step reports the frames that ran, and the checks start from a frozen world':
    { note: '`step` reports the frames that ran, not the number it was asked for.' },
  'fix(checks): ready is not the physics module having arrived':
    { internal: 'an editor check\'s own synchronisation' },
  'fix(checks): a four-minute step is a four-minute silence':
    { internal: 'an editor check\'s own synchronisation' },
  'fix(checks): a file on disk is not the registry having adopted it':
    { internal: 'an editor check\'s own synchronisation' },
  'fix(checks): let the 3D step finish, and say how long it took':
    { internal: 'an editor check\'s own budget' },
  'fix(checks): "before" is a state the world was in, not seven moments':
    { internal: 'an editor check\'s own reading' },
  'fix(checks): a name on the command line selects again':
    { internal: 'the check runner\'s argument parsing' },
  'fix(automation): a capture waits as long as the package it is compared to':
    { internal: 'a verifier\'s timing, not the engine\'s' },
  'fix(export): a web package ships the chunks its entries reach':
    { note: 'A web build no longer carries the mini-game and native SDKs.' },
  'refactor(sdk): four modules named support.ts, one flat chunk namespace':
    { internal: 'the names inside the SDK build\'s own chunk output' },
  'fix(size): the bundle report names subsystems, not the chunks they landed in':
    { note: 'The size report says which subsystem each byte of the scripts came from.' },
  'fix(gates): a start screen that faded is not one that never did':
    { internal: 'a verifier\'s reading of a boot it already watched finish' },
  'fix(wechat): an atlas page is one file however many sprites name it':
    { note: 'A mini-game export no longer fails on a project whose sprites are atlased.' },
  'fix(wechat): the package installs its platform by calling for it':
    { note: 'A WeChat mini-game boots again.' },
  'fix(sdk): the lean WeChat entry is an entry, so it declares its side effects':
    { internal: 'a declaration about the package, read by bundlers rather than people' },
  'fix(cli): an over-budget package says which settings would fit it':
    { internal: 'the wording of a message the export already printed' },
  'fix(details): the Inspector names the new reason a texture ships raw':
    { note: 'A texture that encodes larger than its source now ships as the source.' },
  'fix(native): a packaged game script gets the three new subpaths':
    { internal: 'what a native host publishes to the scripts it runs' },
  'fix(app): build order is declared, not the shape of an array':
    { internal: 'the order a stack of plugins is assembled in' },
  'docs(manual): the AI, tilemap and script-graph pages import from their subpaths':
    { internal: "a manual page's import line, following the move it documents" },
  'refactor(play): the play realm asks for the whole import map by name':
    { internal: "the editor's preview page names the same subpaths it always did" },
  'fix(settings): the module page reads the same asset table the build installs from':
    { note: 'The Engine Modules page no longer calls a module unused that the build then carries.' },
  'feat(export): the build says what the start screen\'s logo costs the page':
    { note: "The build says what the start screen's logo costs the page." },
  'feat(agent): a person can record which models their account has seen take an image':
    { note: 'You can tell the editor which models your account has seen take an image.' },
  'fix(play): a Play that lands inside the prewarm waits for it':
    { note: 'Pressing Play while the editor is still warming up no longer loses the engine.' },
  'fix(gates): the service-support check runs where its subject compiles':
    { internal: 'Moves a repository check between suites; the dialog it guards is unchanged.' },
  'feat(gates): a mini-game package is asked what it does when a 分包 is refused':
    { internal: 'A repository gate over the corpus; the package it judges is unchanged.' },
  'fix(play): a realm asked for a still world is handed one, not stopped later':
    { note: 'A game started paused is handed the scene already held.' },
  'fix(build): the service row uses the editor\'s own tooltip and spacing':
    { internal: 'The row from the commit before it, drawn with the editor\'s own tooltip and grid; nothing it says changes.' },
  'chore(gates): bank three reaches the gameplay subpath move removed':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'feat(gates): the start screen is judged over a link a phone actually has':
    { internal: 'A repository gate over the corpus; the package it measures is unchanged.' },
  'feat(runtime): the bar moves while the engine downloads, not only when it lands':
    { note: 'The loading bar moves while the engine downloads.' },
  'refactor(theme): the asset tints are tokens, under the same contract as --cat-*':
    { internal: "The content browser's colours move into the theme file; measured identical, so nothing a creator sees changes." },
  'feat(gates): the asset ramp answers to the panel\'s saturation ceiling':
    { internal: "A repository gate over the editor's own palette; no creator runs it." },
  'fix(agent): a refused picture is told apart from a refused request':
    { note: 'An agent told its screenshot was too big hears that, not "the request was refused".' },
  'refactor(profiler): a token has one author, not a copy beside every read':
    { internal: "The profiler's canvas reads the same tokens it always did; the duplicated fallbacks are gone and nothing it draws changes." },
  "refactor(theme): a graph port's colour is a token, in one family for both graphs":
    { internal: 'The two graph editors read their port colours from the theme; all eight resolve to the hex they replaced, so nothing drawn changes.' },
  "feat(gates): a file whose colours are not the palette's says so":
    { internal: "A repository ratchet over the editor's own source; no creator runs it." },
  'refactor(theme): twelve font sizes that were a scale step, written as a number':
    { internal: 'The editor reads its own type scale where it had restated it; every size resolves to the px it replaced.' },
  'chore(gates): bank the type-scale convergence':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(icons): two names for one stroke weight become one':
    { internal: 'Two icon stroke widths that render within 1.7% of each other become one; a whole-frame diff moves 131 pixels of 1.29M.' },
  'chore(gates): bank the stroke-width collapse':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(theme): 11-25px odd spacings step down to the grid':
    { internal: 'One-pixel tightening of editor chrome; measured on screen, no row height changes.' },
  'chore(gates): bank the larger odd spacing steps':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(theme): a 3px spacing is 2px':
    { internal: 'One-pixel tightening of editor chrome; measured on screen, no row height changes.' },
  'chore(gates): bank the 3px spacing step':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(theme): 7px and 9px spacings are 6px and 8px':
    { internal: 'One-pixel tightening of editor chrome; measured on screen, no row height changes.' },
  'chore(gates): bank the 7px and 9px spacing steps':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(theme): a 5px spacing is 4px':
    { internal: 'One-pixel tightening of editor chrome; measured on screen, no row height changes.' },
  'fix(gates): a fractional offset is not a spacing step':
    { internal: 'A repository gate and its baseline; no source changed.' },
  'refactor(theme): the spacing grid is 2px':
    { internal: 'A token nothing reads, and the gate rule derived from it; no pixel moves.' },
  'chore(gates): bank the 2px spacing grid':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'fix(agent): a screenshot weighs what the model is billed for it':
    { note: 'Looking at its work no longer makes the agent forget the conversation.' },
  'refactor(theme): the last type sizes between two steps take one':
    { note: "The Inspector's light and LOD explanations are readable." },
  'feat(gates): a glyph drawn as an icon says so, and raw font-size banks zero':
    { note: "The Inspector's light and LOD explanations are readable." },
  'fix(checks): the wheel check asks whether it turned, not where it stopped':
    { internal: 'A repository check over the editor; the wheel joint it judges is unchanged.' },
  'feat(export): what each packaging target can do, before a build exists':
    { note: 'The build dialog says which engine services a target can provide.' },
  'feat(build): the dialog says which engine services a target can provide':
    { note: 'The build dialog says which engine services a target can provide.' },
  'fix(gates): the on-device crash check builds for the ABI the device reports':
    { note: 'The on-device crash check runs on whatever Android you have.' },
  'fix(native): every App factory installs the optional subsystems from the registry':
    { note: 'A packaged native game gets the subsystems its project uses.' },
  'fix(agent): nothing claims a model cannot see when nobody has said so':
    { note: 'Nothing claims a model cannot see when nobody has said so.' },
  'fix(agent): what a model can see is resolved per model, in three states':
    { note: 'A model that can see is no longer told it cannot.' },
  'fix(runtime): a packaged host looks a resource up in the registry that holds it':
    { note: 'A packaged game answers "how do I get there?" again.' },
  'fix(play): a realm ignores a hand-over that lands during its own boot':
    { note: 'Pressing Play could kill the session it was starting.' },
  'fix(play): the scene is handed to the realm once per start, not once per door':
    { note: 'Pressing Play could kill the session it was starting.' },
  'fix(theme): the size bar reads as a measurement, not as a running state':
    { note: "The build's size bar stopped borrowing Play's green." },
  'refactor(theme): the spacing grid has one author, the token that declares it':
    { internal: 'the gate repeated the 4px grid the theme already declared; no visible change' },
  'fix(play): a realm says its page ran before it reads the engine':
    { note: 'A Play session that times out now says whether it ever started.' },
  'fix(export): a 分包 that did not load says which one and why':
    { note: 'When a 分包 will not come down, the package says which one and why.' },
  'fix(export): a progress notice is never what takes a mini-game boot down':
    { note: 'A package whose engine ships in a 分包 now starts.' },
  'fix(assets): a group load names what failed instead of returning an empty bundle':
    { note: 'A group that failed to load says so instead of handing back an empty bundle.' },
  'docs(settings): the wasm compression switch names what it now compresses':
    { internal: 'the switch now compresses the side modules too, which its own label did not say' },
  'feat(export): a mini-game compresses its side modules, not just its engine':
    { note: "A mini-game's side modules compress too, not just its engine." },
  'feat(export): a mini-game entry raises the host indicator on its first line':
    { note: 'A mini-game says it is starting before it parses the game.' },
  "feat(export): the start screen carries the project's logo, colour and hold":
    { note: 'The start screen is yours: a logo, a background and a minimum display time.' },
  'feat(build): a target states its size caps before you package':
    { note: "The build dialog states a platform's size caps before you package." },
  'fix(export): a mini-game takes the engine build a mini-game host can load':
    { note: 'A Douyin package could not start.' },
  'fix(export): every mini-game target gets the mini-game engine runtime':
    { note: 'A Douyin package could not start.' },
  'fix(export): a module the project forced in brings its binary too':
    { note: "Forcing a module in now ships its wasm binary too, not just its JavaScript." },
  'feat(project): a build target can answer differently about a module':
    { note: "A build target can include or exclude an engine module without changing the project's answer." },
  'feat(settings): each engine module says what this project does with it':
    { note: "The Engine Modules page says which of your documents put each module in use." },
  'feat(details): a component whose module the project refused cannot be added':
    { note: "A component whose module Project Settings excludes is greyed out in Add Component, not hidden." },
  'fix(project): every module a project can refuse is one a build can detect':
    { note: "Excluding 3D physics, DragonBones or script graphs is now enforced like every other module." },
  'feat(project): a project can force an engine module in, or refuse one':
    { note: "Project Settings has an Engine Modules page: force a module into the build, or refuse one." },
  'feat(settings): an Engine Modules page, one row per module':
    { note: "Project Settings has an Engine Modules page: force a module into the build, or refuse one." },
  'refactor(bundle): the published subpaths move to a module the renderer can read':
    { internal: "where one table lives; the list it holds is unchanged" },
  'fix(engine): two of the four subsystem switches did not build with them off':
    { internal: "CMake options no shipped build changes; every release has all four ON" },
  'fix(editor-checks): a realm that never came up is unanswered, not a verdict':
    { internal: "how CI classifies its own bad minute; no creator-facing behaviour" },
  'feat(minigame): the engine subpackage fetch says how far along it is':
    { note: "A mini-game that fetches its engine from a 分包 shows the download's progress." },
  'fix(theme): the colour-literal rule guards the code, not only the theme':
    { internal: "an editor gate's scope; no creator-facing behaviour" },
  'refactor(gameplay): the gameplay runtime moves to its own subpath':
    { note: "The gameplay runtime is a subpath: `import { Health } from 'esengine/gameplay'`." },
  'refactor(gameplay): the viewport imports MeleeAttack from its subpath':
    { note: "The gameplay runtime is a subpath: `import { Health } from 'esengine/gameplay'`." },
  'fix(douyin): the config file, the appid and a payment slot':
    { note: "A Douyin package carries Douyin's config file and Douyin's appid." },
  'fix(douyin): a Douyin package carries a Douyin appid':
    { note: "A Douyin package carries Douyin's config file and Douyin's appid." },
  'feat(size): the report says what the export\'s own packing bought':
    { note: "The build size report says what compressing the engine binary actually saved." },
  'fix(play): the realm trace keeps the evidence for the failure it explains':
    { note: "When the play realm never comes up, the editor says more about why." },
  'fix(export): a build comparison blames the setting that moved, not the content':
    { note: "The build size report no longer blames content for a packaging change." },
  'fix(agent): the tool catalog stops promising spineVersion decides a build':
    { note: "The built-in agent is no longer told that the Spine runtime setting decides what a build ships." },
  'feat(export): a web package ships the subsystems it uses':
    { note: "A web package ships only the subsystems its project uses." },
  'fix(sdk): a host entry keeps the platform when the web one loads too':
    { internal: 'which platform adapter wins inside one Node process; no creator-facing behaviour' },
  'fix(sdk): the headless entry joins the shared chunk graph':
    { note: "A dedicated server built on `esengine/node` replicates again." },
  'refactor(play): the play host installs replication from its subpath':
    { note: "Replication is a subpath: `import { Net, Replicated } from 'esengine/replication'`." },
  'refactor(net): replication moves to its own subpath':
    { note: "Replication is a subpath: `import { Net, Replicated } from 'esengine/replication'`." },
  'fix(app): an optional subsystem\'s plugin is built per app, not shared':
    { note: "Two games in one process no longer share an optional subsystem's plugin." },
  'refactor(ai): the AI runtimes move to their own subpath':
    { note: "The AI runtimes are a subpath: `import { NavAgent } from 'esengine/ai'`." },
  'refactor(ai): the editor imports the AI runtimes from their subpath':
    { note: "The AI runtimes are a subpath: `import { NavAgent } from 'esengine/ai'`." },
  'refactor(logic): the script-graph API moves to its own subpath':
    { note: "Script graphs are a subpath: `import { … } from 'esengine/logic'`." },
  'refactor(logic): the editor imports script graphs from their subpath':
    { note: "Script graphs are a subpath: `import { … } from 'esengine/logic'`." },
  'refactor(tilemap): the editor imports tilemaps from the subpath that owns them':
    { note: "Tilemaps are a subpath: `import { Tilemap } from 'esengine/tilemap'`." },
  'refactor(tilemap): the tilemap API moves to its own subpath':
    { note: "Tilemaps are a subpath: `import { Tilemap } from 'esengine/tilemap'`." },
  'fix(assets): compression that cannot pay for its decoder is skipped':
    { note: 'A project whose art weighs less than the transcoder no longer compresses any of it.' },
  'fix(assets): a texture ships in whichever form is smaller':
    { note: 'A texture that encodes larger than its source now ships as the source.' },
  'fix(cli): the temp build dir is swept however the run ends':
    { internal: 'a working directory of the repo\'s own tooling' },
  'feat(ui): a HUD can clear the host\'s own menu, not just the notch':
    { note: 'A UI node can keep clear of WeChat\'s capsule menu, which the safe area does not cover.' },
};
