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
  "feat(input): a project starts with multi-touch on or off, from Project Settings":
    { note: "Multi-touch can be turned off." },
  "feat(input): multi-touch can be turned off, one finger at a time reaching the UI and the game":
    { note: "Multi-touch can be turned off." },
  "feat(ui): a Spine skeleton in a Canvas paints by its place in the tree, with the UI's opacity, visibility and masks":
    { note: "A Spine skeleton can be part of a UI." },
  "fix(export): an Android package carries its Spine runtimes on every architecture, not the first only":
    {note: "An Android package built for the emulator carries its Spine runtimes on x86_64 too."},
  "fix(docs): a component summary with an apostrophe no longer breaks the docs build":
    {internal: "The docs site failed to build; no shipped game or editor behaviour changed."},
  "feat(export): one decision for which Spine runtimes a package carries, with Include and Exclude per runtime":
    { note: "Which Spine runtimes a package carries can be set per runtime." },
  "feat(native): every Spine release in one native host, each skeleton read by its own":
    { note: "A native app plays every Spine version." },
  "feat(native): a template says which Spine runtime it links, and an export names the skeletons it cannot play":
    { note: "A native app plays every Spine version." },
  "fix(ecs): the native registry answers every entity op the web one does, from one generated table":
    { note: "Physics no longer stops on Android and the desktop host." },
  "feat(mcp): open_settings opens any settings page, and run_editor_command refuses an id that does not exist":
    { note: "An agent can open any Settings page." },
  "feat(settings): a row per Spine runtime — Auto, Include or Exclude — with what the build detected":
    { note: "Which Spine runtimes a package carries can be set per runtime." },
  "feat(settings): native packages carry every Spine release, so the Spine row only speaks up for an old template":
    { note: "Which Spine runtimes a package carries can be set per runtime." },
  "feat(settings): the Spine row says which version each native template links":
    { note: "Which Spine runtimes a package carries can be set per runtime." },
  'feat(cyber-rooftop): add Tripo equipment sockets and native character assets':
    {"internal":"the heroine and projector assets it added were removed again before release, since the cyber-rooftop scene never used them"},
  'fix(project): discard stale document reloads':
    { note: 'Returning from Prefab Mode keeps the current scene intact.' },
  'fix(editor): keep stale file events out of the active document':
    { note: 'Returning from Prefab Mode keeps the current scene intact.' },
  'feat: bake material-aware static geometry proxies':
    { note: 'Static geometry can be baked into material-preserving proxies.' },
  'fix: preserve painted features during mesh simplification':
    { note: 'Simplifying a mesh preserves painted features.' },
  'fix: drain streamed worlds before teardown and replacement':
    { note: 'A streamed world finishes retiring before it is replaced.' },
  'fix: preserve shadow participation when batching meshes':
    { note: 'Batched and instanced meshes keep their visibility and shadows.' },
  'fix: fit shadow maps to placed and deformed geometry':
    { note: 'Batched and instanced meshes keep their visibility and shadows.' },
  'fix: preserve and tightly cull native mesh placements':
    { note: 'Batched and instanced meshes keep their visibility and shadows.' },
  'fix: synchronize rendering with scaled game time':
    { note: "Rendering follows the game's clock." },
  'fix: key WebGPU bind groups by their full layout':
    { note: 'WebGPU keeps incompatible binding layouts separate.' },
  'fix: preserve tiled lights in planar reflections':
    { note: "Planar reflections keep the scene's tiled lights." },
  'perf: reuse depth prepass for planar reflections':
    { note: 'Shadow storage and planar reflections avoid unused work.' },
  'fix: skip unused DragonBones runtime in render host':
    { internal: 'Only the verification render host stops loading an unused runtime; shipped games and the editor are unchanged.' },
  'fix: prepare paused scenes without advancing simulation':
    { note: 'A paused scene can prepare its presentation without advancing gameplay.' },
  'perf: size shadow atlas storage to occupied tiles':
    { note: 'Shadow storage and planar reflections avoid unused work.' },
  'perf(ecs): reuse named child lookups for animation tracks':
    { note: 'Animation tracks reuse named-child lookups.' },
  'fix(import): normalize skin weights across gltf attribute sets':
    { note: 'Imported skin weights include every glTF attribute set.' },
  'feat(cyber-rooftop): rebuild the anchored native HUD from editable assets':
    { note: 'The cyber-rooftop example has an editable, anchored HUD.' },
  'fix(textures): a pending reply overtaken by its settle notice no longer leaves the texture counted as editor work':
    {"note":"The editor stops reporting texture work that has finished."},
  'refactor(sdk): node visibility and particle model units ship in esengine/imported-scene, installed only where the content uses them':
    {"note":"An imported scene keeps its materials, animation, particles and colliders."},
  'fix(cyber-rooftop): restore wetness masks and fit fixture shadows':
    {"internal":"the cyber-rooftop example's own scene and texture settings; the engine and editor are unchanged"},
  'fix(render): allocate complete point shadows and report new denials':
    {"note":"A point light's shadow is whole or absent."},
  'fix(assets): release runtime entity replacements on despawn':
    {"note":"An asset swapped onto a runtime entity is released when the entity goes."},
  'feat(settings): Packaging has a Minify scripts row':
    {"note":"An exported game's scripts are minified"},
  'feat(export): scripts are minified on export unless the project turns it off':
    {"note":"An exported game's scripts are minified"},
  'feat(cocos): a document the creator edited moves from the layer Cocos.Widget to the engine RectAnchors on re-import':
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  'feat(ui): RectAnchors pins world content to its parent rectangle or the screen in the engine, and the Cocos Widget is a view on it':
    {"note":"RectAnchors: world content that follows its parent."},
  'feat(cocos): a converted project keeps the Cocos fit width of its design, and cc.profiler exists in the compatibility layer':
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  'fix(cocos): a renderer is put in the layer of its Cocos node, so a UI camera that culls by layer draws it':
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  'feat(cocos): a converted project starts at the game launch scene and runs its global-defining scripts first, reads the editor built-in assets, and the layer components survive a replay':
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  'feat(cocos): the colour a script sets on a material instance is the renderer tint':
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  'feat(cocos): MeshRenderer, UIMeshRenderer, material properties and cc.geometry in the compatibility layer':
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  'feat(cocos): cc.js, ccenum and NodePool exist in the compatibility layer':
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  'feat(bundle): the project script bundle is built again only when a file it read changed, and Cocos scripts that write the same class name each get a component of their own':
    {"note":"The script bundle is not rebuilt for nothing."},
  'fix(editor): opening a large project no longer spends seconds on strings that cannot be paths, a model texture the project lacks is left off instead of dangling, and an unlit mesh variant with tangents links':
    {"note":"Large projects open faster."},
  'feat(cocos): one script that fails to load no longer takes the others with it, a part of cc the layer lacks is a stand-in that survives use, and Director, AssetManager.Cache and the input dispatcher hook exist':
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  'feat(cocos): a converted project links its source images instead of copying them, so conversion does not store a multi-gigabyte art folder twice':
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  'feat(cocos): the importer reports its progress by stage, so a long conversion can show a bar':
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  'feat(particle): an emitter can release bursts on a schedule (bursts), and the Cocos burst list, repeat count and burst times map onto it':
    {"note":"Bursts on a schedule."},
  'feat(physics3d): a box, sphere or capsule collider can sit off its entity origin (center), and the Cocos BoxCollider centre maps onto it':
    {"note":"A 3D collider can sit off its entity."},
  'feat(text): Text can underline its lines and grow its box to its text (ResizeHeight), and the Cocos Label maps onto both':
    {"note":"Text can underline, and a box can grow to its text."},
  'feat(cocos): a project effect is judged by its fragment stage and the features a material switches on, and a sprite-stencil mask maps to the engine stencil mask':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(particle): an emitter has its own simulation speed, and the Cocos simulation speed, noise, trail and burst time map onto the emitter':
    {"note":"An emitter runs on its own clock."},
  'feat(cocos): PageView, PageViewIndicator, ScrollBar, SafeArea and WebView components, and the importer maps SpriteRenderer, Spine skeletons, ParticleSystem2D, Terrain and the players and animators whose clip or graph is missing':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): BoxCollider maps to the engine box collider with a static body, Line is a component over the engine vector path, Graphics builds its mesh with it (polygon fills, joins and caps), and a sprite whose frame is missing stays, switched off':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): EditBox is a component over the platform text editor (mode and length rules, hint, password bullets, the four editing events), and the importer maps it':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): Graphics is a component over the engine Draw (rect, circle and stroked paths kept until clear), UIMeshRenderer folds into its host, and a Node has worldScale and worldRotation':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(animation): an animator state can play at the speed of a float parameter (speedParameter), and the Cocos animation graph is converted to an animator controller':
    {"note":"An animator state can play at the speed of a parameter."},
  'feat(cocos): the importer converts Animation clips (.anim) to timelines: position, scale, rotation, sprite and label colour, opacity and active tracks, and plays model-file clips on the node':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): a MeshRenderer wears the Cocos material it was given (image, tint, blending, culling, lighting), and a mesh is found by its place in the model when its name is not readable':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): the importer binds SkinnedMeshRenderer to the model skin and plays SkeletalAnimation clips on the skeleton they are put on, cut to the span and wrap mode Cocos names':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): the importer brings in the models a project draws with the engine model import, maps MeshRenderer and the built-in shapes onto it, and the editor and the importer share one model import':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; the shared model import is a refactor with no change a creator sees."},
  'feat(particle): an emitter can carry an added velocity per particle and limit particle speed with a dampening, and the Cocos velocity, force and limit modules map onto them':
    {"note":"Particles can carry an added velocity and be held to a speed limit."},
  'feat(particle): an emitter can wait startDelay seconds before it emits, with the duration counted from the end of the delay, and the Cocos start delay maps onto it':
    {"note":"An emitter can start late."},
  'feat(particle): a stretched render mode lays a particle along its velocity and lengthens it with speed, and the Cocos stretched billboard maps onto it':
    {"note":"Particles can be stretched along their velocity."},
  'feat(cocos): a particle system colour gradient and size curve become the emitter colorGradient and sizeCurve instead of their two ends':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): the importer maps ParticleSystem onto ParticleEmitter, and counts what the emitter has no field for':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(2d): GroupOpacity fades an entity and everything under it; sprites, text, shapes, trails and tilemap layers multiply the opacities of the groups above them into their own alpha, and the Cocos UIOpacity is a view on it':
    {"note":"Fade a whole group of world content with one value: `GroupOpacity`."},
  'feat(cocos): the importer maps DirectionalLight, Sorting and Canvas':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(editor): Re-import Cocos Project brings the Cocos side\'s changes into the converted project and keeps the documents edited here; a conversion says which components did not come across':
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  'feat(editor): opening a Cocos Creator folder converts it into an Estella project beside it and opens that':
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  'feat(ui): a held pointer reports its moves (pointer_move) and a given-up hold (press_cancel), every pointer event says where the pointer is, and a ContentRect-only entity can be pressed; the Cocos touches translate the engine\'s pointer events instead of dispatching on their own':
    {"note":"A held pointer reports where it goes, and a hold can be given up."},
  'feat(ui): ContentRect, the rectangle world content occupies — Sprite and Text follow it, a UIMask on the entity clips to it, a world point can be tested against it; the Cocos UITransform and Mask are views on it, and the importer writes it':
    {"note":"World content has a rectangle: `ContentRect`."},
  'feat(text): the engine\'s rich-text parser reads Cocos\'s tags (size, color names, br; underline/outline/click kept as plain text); Cocos Camera and RichText are views on the engine\'s Camera and Text; a touch has a screen point (getLocation) and a canvas point (getUILocation)':
    {"note":"Rich text reads the tags other engines write."},
  'feat(animation): sine, quart, quint, expo, circ, bounce in/in-out, smoothstep and smootherstep easing curves in the engine (C++ and TypeScript, parity-tested); the Cocos tween\'s easing names map onto the engine\'s curves instead of carrying their own':
    {"note":"More easing curves."},
  'feat(ui): scroll areas can be pulled past an end and spring back (ScrollContainer overscroll, ScrollMotion for the gesture); ScrollMovement.Elastic now does what its comment said. The Cocos ScrollView drives the engine\'s scroll model instead of carrying its own':
    {"note":"Scroll areas can be pulled past an end and spring back."},
  'feat(cocos): Toggle, ToggleContainer, ProgressBar, Slider, BlockInputEvents and ScrollView, Vec4 and Mat4, a capture phase for touches; the drag/inertia/elastic physics is an engine module (ui/collection/scroll-physics) the compatibility layer adapts':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): sys, view/screen, macro, Layers, game, the global input with KeyCode and keyboard/mouse/touch events, and resources/assetManager/Bundle over a manifest the importer writes for resources and bundle folders':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): instantiate (prepared prefab or node copy, held out of the scene until parented) and tween (to/by/set/delay/call/then/union/sequence/parallel/repeat, easing, Tween.stopAll*); the importer numbers scene entities from 1 so a reference to the first one is not read as none':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): esengine/cocos as a published subpath, cc and cc/env resolved to it in every script bundle with legacy decorators, and an entry the importer writes that brings the Cocos scripts into the bundle':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos-import): emit the compatibility layer\'s components — UITransform, Widget, Layout, Button and the project\'s own scripts as Cocos.<Class>, with node references resolved to the entities those nodes became':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): Widget and Layout — edge/centre/stretch alignment against the parent or the visible area, and row, column and grid layouts with Cocos\'s arithmetic, run in an end-of-frame pass':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): UI component adapters, touch events on nodes, and Button — Label/Sprite/UIOpacity/UITransform as views on the engine\'s components, the topmost listener claiming a touch and bubbling it up, clicks that end inside':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},
  'feat(cocos): the cc compatibility core — Node as a handle on an entity, Component with Cocos\'s lifecycle on the engine\'s frame loop, @ccclass/@property as Estella components, and the value types':
    {"internal":"The Cocos Creator compatibility layer and importer have not shipped; nothing a creator reaches without opting in."},


  'feat(openpaas): build and verify native SUD test packages': { note: 'SUD OpenPaaS development export.' },
  'fix(openpaas): align directory manifest with official web2sp': { note: 'SUD OpenPaaS development export.' },
  'feat(openpaas): integrate SUD runtime and PinK directory export': { note: 'SUD OpenPaaS development export.' },
  'feat(editor): complete scoped plugin filesystem operations': { note: 'Plugin filesystem operations.' },
  'feat: add binary and asset-safe plugin filesystem APIs': { note: 'Plugin filesystem operations.' },
  'fix(editor): reuse mesh selection geometry and index multi-inspection': { note: 'Faster 3D multi-selection.' },
  'fix: restore gizmo hover CI and optimize 3d multi-selection': { note: 'Faster 3D multi-selection.' },
  'feat: add shared web runtime support for LAN device preview': { note: 'One-click LAN device preview.' },
  'feat(editor): add quick QR device preview beside Play': { note: 'One-click LAN device preview.' },
  'feat(pipeline): a hair material\'s flow map, shift map and tip softness are read from the model\'s material extras':
    {"note":"A hair material's strand-direction map, highlight-shift map and tip softness are now imported from the model: a glTF has no slot for them, so a material names them in its extras (flow_map, shift_map, suggested_tipSoftness) and the importer binds them to the Hair shader instead of leaving the highlight to be worked out from the surface."},
  'fix(render): a mesh with tangents and a normal map links its shadow program when the sun casts shadows':
    {"note":"A model with tangents and a normal map no longer stops its shadow program from linking when the sun casts shadows. The depth pass wrote no tangent varying while the fragment stage still read one, so the shader failed on WebGL2 and the logged error named no material; the depth variant now leaves the tangent frame out."},
  'fix(editor): the spring-bone note uses the inset token, and a model import passes the Spring Bones setting through': { internal: 'A theme token for a line of Details and the import setting passed through to the importer, both inside the spring-bone work that has its own notes.' },
  'fix(pipeline): a fully opaque texture keeps its alpha through the mip chain, so a cutout material on it no longer vanishes at a distance':
    {"note":"A texture whose alpha is fully opaque, used by a cutout material (a hair material or any alpha-cutoff one), no longer vanishes once it is minified. Coverage-preserving mip levels were scaling its alpha down onto the cutoff, so every level past the first was discarded; a level that already reaches the share it must keep is now left alone."},
  'feat(postprocess): an agx effect applies the AgX view transform Blender uses, from the table Blender ships':
    {"note":"A new post-process effect, agx, applies the AgX view transform Blender renders with, taken from the data Blender ships: scene-linear colour goes in and display-linear comes out, so put it last and leave the project's output transform at none. Its contrast setting is the look (1 is AgX Base, 1.2 is Medium High Contrast), it carries its own table, and against Blender's own render of the same frame the colours of a character come out within about two percent."},
  'feat(pipeline): imported skin and hair carry no scattering or second highlight a glTF does not state':
    {"note":"A model imported with Character Materials now shades like the Principled shader it was authored against: a glTF carries no subsurface scattering and no second strand highlight, so the Skin shader's scattering, wrap and fuzz and the Hair shader's second highlight, translucency and root darkening are written as off, and a hair material's specular factor is scaled to the strand highlight's own units. Measured against Blender's render of the same frame, a character's hair comes out about 15 percent brighter than the reference where it was two to three times too bright, and the skin no longer glows in the shadows."},
  'fix(render): directional shadow cascades are spread over the geometry in the scene, not over the whole view':
    {"note":"A directional light's shadow cascades are now spread over the geometry that is in the scene instead of over the whole view. A close shot of a character in a view that reaches fifty metres used to spend its first cascade on three metres and drew blocky, misplaced shadow edges; the cascades now end where the scene's geometry ends (rounded in quarter octaves, so the split does not swim as the camera moves), and the shadow lands where it should."},
  'fix(pipeline): an imported skin no longer blurs its diffuse light per colour channel':
    {"note":"An imported skin no longer blurs its diffuse light separately per colour channel, which put a red and cyan fringe along the edge of every shadow on it; like the rest of the scattering, it is written as off unless the source says otherwise."},
  'fix(render): the lite engine builds compile again, with the layered water pass behind the post-process guard':
    {"note":"The lite WeChat and mini-game engine builds compile again: the pass that puts the opaque scene back after water and glass named the post-process pipeline outside the guard that leaves it out of those builds, so every package without post-processing failed to build."},
  'fix(postprocess): voxelGI and ssgi take voxel sizes, radii and thicknesses down to a centimetre':
    {"note":"The global-illumination effects accept lengths down to a centimetre: the voxel size of voxelGI, and the radius and thickness of ssgi, used to stop at four, ten and one world units, so a 3D scene measured in metres could not set them small enough to do anything. Against Blender's render of the same frame, a character lit by one sun gets its soft bounce light in the shadows once they are set to metre-scale values."},
  'fix(render): the high quality profile\'s shadow cascades are 1024 texels, so a face is no longer speckled with dirt':
    {"note":"The high quality profile's shadow cascades are now 1024 texels on a 4096 atlas (they were 512 on 2048). At 512 a cascade's texel is several millimetres across a close character, so a brow, a hairline or a lash card sitting a fraction of a millimetre above the skin fell inside one texel of it and the shadow speckled the face with dirt; at 1024 the face is clean. Medium and low are unchanged."},
  'fix(postprocess): ssao and gtao take a radius down to a centimetre':
    {"note":"The ambient-occlusion effects, ssao and gtao, accept a radius down to a centimetre (they stopped at one world unit), so a 3D scene measured in metres can use them on hair and faces. A radius of 0.05 separates the cards of a hair mesh without the black speckle a larger one leaves on their edges."},
  'feat(character): hair has a lobe gain, and an imported hair material sets it from what the source states':
    {"note":"The Hair shader has a lobe gain, u_lobeGain, for how much of the strand highlight a lamp draws apart from the reflection of the environment, and an imported hair material now sets it with the rest from what the source states: the specular factor as the environment's Fresnel, the roughness factor, a quarter of the lamp highlight, and a third of the shader's own strand shift and second highlight so the cards read as locks of hair and not plates. Against Blender's render of the same frame the hair comes out with a sheen on each lock and dark gaps between them, where it was a flat red plate."},
  'feat(character): hair shader draws a card as locks, with a tone, a highlight break and a seam for each':
    {"note":"The Hair shader can draw a card's strands as locks: u_clumpCount sets how many across its width, u_clumpTone how much lighter or darker one is than the next, u_clumpShift how far each lock's highlight is pushed along the strand so it breaks from lock to lock, and u_clumpGap how dark the seam between locks is; 0 leaves the card as authored. A hair material imported from a glTF is set to seven locks, so cards cut from one strand texture no longer read as a combed plate. Against Blender's render of the same frame the top of the hair comes out within about ten percent in every channel, where it was half again as bright."},
  'feat(render): hair casts and receives its own shadow, with a cascade fitted to it and a density along the light':
    {"note":"A hair material draws the sun's shadow of hair as hair. The Hair shader gains u_hairShadow, how much light a layer of strands takes per world unit along it (declared with the new `#pragma hairshadow`), and while it is above zero the frame adds a cascade fitted to the hair alone as the first in the sun's list: cards a few millimetres apart fell inside one texel of a cascade spread over the view, so the layers could not shadow each other, and the face under a fringe is now shadowed at the hair's resolution too. The light left after a depth of hair falls off with that depth, from the nearest card to this one, as a deep shadow map reads it, with a card's own surface left out so it does not shadow itself. A hair material imported from a glTF is set to a density of 400. The Hair shader has u_strandDiffuse, how much of the diffuse is the strand's own Kajiya-Kay term against a surface's N dot L, and a hair material imported from a glTF sets it to 0. At the old 0.6 a card turned edge-on to the light still took a third of it, so every lock was lit to one tone and the gaps between locks never went dark; with the Principled shader's diffuse they do. With the lamp highlight at a tenth and the tinted second lobe at half what they were, the top of the hair comes out within about six percent of Blender's render of the same frame on both backends, where it was half again as bright."},
  'fix(webgpu): meshes, sprites and particles sample through their mip chain, and a compressed texture keeps every level':
    {"note":"On the WebGPU backend, a mesh without a material, a sprite and a particle are sampled through their texture's mip chain, as they always were on WebGL2: their WGSL read level 0 alone, so anything drawn smaller than its texture shimmered into stripes and moire there and not on the other backend. A compressed (KTX2) texture also keeps every level of its chain on WebGPU: the upload stopped at the first level whose side is not a multiple of four, which left a 1240x1268 hair atlas with level 0 alone. In the render lab a card of fine strands seen small now reads the same on both backends."},
  'fix(render): a cut-out seen small lets through as much as its texture covers, instead of closing into a sheet':
    {"note": "Cut-outs are glTF's MASK at every distance."},
  'fix(render): lit materials keep the energy a rough surface reflects, and a sun with a size casts a penumbra as wide as it throws':
    {"note":"Lit materials keep the light a rough surface reflects and pass on what it does not. The environment's specular came from Karis' analytic fit, 21% low for a metal at roughness 0.5 and up to 80% off at a grazing view; it is now a fit to the integral itself (tools/gen-dfg-fit.py, worst 3%). The light a rough metal loses to bounces between its microfacets is returned (Fdez-Aguera's multiple-scattering term, and the same ratio on a lamp's highlight), where a metal at roughness 0.9 under a white sky came out at half of Blender's brightness. The diffuse under a dielectric's specular is reduced by what the specular reflects, as in the Principled shader. And a lamp's highlight takes Smith's height-correlated masking at alpha = roughness squared in place of the Schlick k = (r + 1)^2 / 8 remap, which left a rough metal's rim a quarter dark. In the render lab six spheres under a white sky now match Blender within 0.5% at every roughness, and flat cards of five albedos within 0.002, on both backends. A sun with a size casts a penumbra as wide as Blender's. The disc a penumbra was averaged over stopped at 8 texels of the map, which held a sun's soft edge to sixteen texels: with a fine cascade that is less than the sun throws, and the render lab measured an edge 60% as wide as Blender's. The disc now reaches 24 texels, its spiral of taps is turned point by point so the wider disc grains rather than bands, and each blocker tap forgives only as far as it stands from the point, so a box standing on a floor stays shadowed to its foot."},
  'feat(character): hair takes the Principled highlight when it has an anisotropy, and an imported card with one is set to it':
    {"note":"The Hair shader takes the Principled shader's highlight when u_anisotropy is above zero: GGX stretched along the strand as Blender stretches it, with u_specular as the specular factor. A hair card imported with an anisotropy (KHR_materials_anisotropy, which Blender exports from its Principled anisotropy) is set to it, so the broad sheen across a fringe that Blender draws is drawn in the same place."},
  'fix(pipeline): a cut-out chain holds the share its cut keeps, and a cut-out takes its colour into its clear texels':
    {"note": "Cut-out colour in its clear texels."},
  'fix(render): a cut-out shadow keeps the share of light it lets through, the same on both backends':
    {"note": "Cut-out shadows."},
  'fix(pipeline): an imported eye shades as the Principled shader it was authored against':
    {"note":"An imported eye shades as the Principled shader it was authored against: the Eye shader's tinted white, its warm wrap of light past the terminator (which reddened a painted iris) and its lid darkening are written as off, and both its glossy layers take the source's roughness instead of a near-mirror cornea."},
  "fix(render): the lit WGSL header splits under MSVC's literal cap again, and the six stale shader twins are regenerated":
    {"internal": "The WGSL is byte for byte what it was, split into two literals so a Windows build compiles it; the regenerated twins are test fixtures and one example material, drawn as before."},
  "fix(editor): the spring-bone label takes a step of the type scale, and the component link table names the spring bones":
    {"note": "Spring-bone collider handles."},
  "fix(webgpu): a normal map keeps its frame along a triangle's edge":
    {"note": "Normal maps along a triangle's edge on WebGPU."},
  "fix(render): a cut-out is glTF's MASK at every distance, its mips keeping their coverage both ways":
    {"note": "Cut-outs are glTF's MASK at every distance."},
  "fix(examples): Dusk Fort's scene carries its .meta, so its package reaches the fort instead of booting to asset not found":
    {"note": "Dusk Fort exports."},
  "fix(sdk): terrain, timeline, the fx modules, foliage and wechat ship their type declarations":
    {"note": "Types for every SDK subpath."},
  "fix(examples): Neon Ascension's camera drops a backgroundColor it never had, which every boot warned about":
    {"internal": "Camera has no backgroundColor; the field was never read, so the frame is unchanged and only the boot warning goes."},
  'fix: serialize binaryen optimization on windows': { internal: 'Uses one optimizer worker after wider builds reproduced heap corruption with four; release optimization flags stay unchanged.' },
  'feat: add budgeted 2d and 3d particle scene collisions': { note: 'Budgeted particle scene collisions.' },
  'feat(editor): add particle collision authoring and diagnostics': { note: 'Budgeted particle scene collisions.' },
  'fix: bound binaryen workers on windows': { internal: 'Bounds Windows build-time optimizer workers without changing shipped optimization flags or runtime behavior.' },
  'fix(editor): align tree and color inspectors with shared Details controls': { note: 'Reusable UI trees and color pickers.' },
  'fix(editor): adopt consistent tree and color Details': { note: 'Reusable UI trees and color pickers.' },
  'refactor(ui): distinguish mutation drafts from borrowed reads': { internal: 'Names observed World.update drafts distinctly from borrowed snapshots; runtime behavior and public APIs are unchanged.' },
  'feat: add reusable TreeView and ColorPicker UI controls': { note: 'Reusable UI trees and color pickers.' },
  'fix(ui): align tree labels with hierarchy indentation': { note: 'Reusable UI trees and color pickers.' },
  'fix(ui): keep tree selection when toggling disclosure': { note: 'Reusable UI trees and color pickers.' },
  'feat(editor): add TreeView and ColorPicker authoring': { note: 'Reusable UI trees and color pickers.' },
  'feat: add TabView and Tooltip UI controls': { note: 'UI tabs and tooltips.' },
  'fix(ui): use hover state and sustained captures for tooltips': { note: 'UI tabs and tooltips.' },
  'fix(ui): render tooltips in the screen paint order': { note: 'UI tabs and tooltips.' },
  'feat(editor): add TabView and Tooltip authoring and previews': { note: 'UI tabs and tooltips.' },
  'fix(editor): keep advanced joint property searches scoped to matching fields': { note: '3D swing/twist and six-axis joints.' },
  'feat: add SwingTwist and SixDOF 3D joints': { note: '3D swing/twist and six-axis joints.' },
  'feat: add advanced 3D joint inspector and limit gizmos': { note: '3D swing/twist and six-axis joints.' },
  "fix(examples): the Scene Report plugin example claims editors from 0.33 on instead of only 0.33.x, so it loads": {"note":"Editor polish and plugin compatibility."},
  "fix(editor): the UI debugger's focus summary keeps its spacing": {"note":"Editor polish and plugin compatibility."},
  "fix(editor): a controller binding in the Controllers panel is two lines, so a long field name is read whole": {"note":"Editor polish and plugin compatibility."},
  "fix(editor): warnings in the World, Plugins, Inspector and Build panels are plain lines rather than tinted cards": {"note":"Editor polish and plugin compatibility."},
  "fix(editor): the lighting panel's warnings are a line with an amber dot, not a card": {"note":"Editor polish and plugin compatibility."},
  "fix(editor): the lighting panel's bake counts say less so the pinned footer stays short": {"note":"Editor polish and plugin compatibility."},
  "feat(editor): the material graph editor shows the Tiling & Offset node": {"note":"Material graphs have a Tiling & Offset node."},
  "fix(editor): a subgraph node wires in the type it returns and a multi-selection drags as one": {"note":"Material graph editor polish."},
  "feat(editor): the material graph editor previews the graph live, has a Switch node and extracts a selection into a subgraph": {"note":"Material graphs have switches, a live preview and extract-to-subgraph."},
  "feat(editor): the material graph output node shows the vertex offset port and its bounds field": {"note":"Material graphs can bend a mesh and its shadow."},
  "fix(editor): the collision layer's material fields take the board's heading, flat inputs and hint": {"note":"Editor polish and plugin compatibility."},
  'feat(editor): a string table imports and exports as an Excel or CSV sheet, merged by key, with the problems checked before it leaves':
    { note: 'Strings go to and from Excel.' },
  'feat(editor): the input map editor captures the next key, shows key caps and flags inputs shared between actions':
    { note: 'The input map editor captures keys.' },
  'feat(editor): an input shared between actions is a quiet note beside the key, not a warning':
    { internal: 'Restyles a note the input map editor already shows.' },
  'feat(editor): the outliner selects with a soft tint, draws indent guides, tints icons by kind and shows lock and visibility only when they matter':
    { internal: 'Reverted before release.' },
  'Revert "feat(editor): the outliner selects with a soft tint, draws indent guides, tints icons by kind and shows lock and visibility only when they matter"':
    { internal: 'Undoes an outliner restyle that left the design board.' },
  'feat(editor): the outliner follows the board — 26px rows, a 40px header with a tinted Add, and rounded inset rows':
    { internal: 'Restores the outliner to its design board; the earlier restyle was reverted.' },
  'feat(editor): selected outliner rows are a soft tint, and a run of them reads as one rounded block':
    { note: 'Outliner selection is quieter.' },
  'feat(editor): a texture is set up by what it is for, and its preview shows one thing at a time':
    { internal: 'Reverted before release: purposes were not how Unity or Unreal present a texture.' },
  "feat(assets): a texture's importer carries a Mip Maps switch that the loader and the cook honour":
    { note: 'Textures can turn mip maps off' },
  'feat(editor): a texture has a Mip Maps switch honoured by the editor, the cook and the build, and a preview that zooms':
    { note: 'Textures can turn mip maps off, and the preview zooms.' },
  'feat(editor): the Events and Controllers strips are sections like the components around them':
    { internal: 'Restyles two inspector strips to the component section look.' },
  'feat(editor): the utility panels share one look — quiet chips and buttons, ruled sections, and a Scatter panel that is a form':
    { note: 'The utility panels share one look.' },
  'feat(editor): a string table editor shows every language side by side with the untranslated cells marked':
    { note: 'A string table editor.' },
  'feat(editor): toasts name their kind with an icon, and warnings and notices are tinted blocks instead of side-striped cards':
    { note: 'Toasts show their kind.' },
  'feat(editor): the Build dialog reads like the settings window, and an empty panel scrolls instead of clipping':
    { internal: 'Restyles the Build dialog and fixes empty-state clipping in short docks.' },
  'feat(editor): the Agent decision passages and setting status lines drop their side stripes':
    { internal: 'Restyles two stripes; the tone stays on the icon.' },
  'feat(launcher): recent projects are a table with a row menu, templates are icon tiles, and the empty state says what to do':
    { note: 'A tidier launcher.' },
  'feat(editor): a dock tab shows its pop-out button only on hover':
    { internal: 'Hides a tab button until hover.' },
  'feat(editor): the viewport tab names the scene, the outliner opens with a scene row, the entity header has an enable box, and the status bar shows save state and the latest log line':
    { note: 'The main window names the scene.' },
  'feat(editor): the scene tab carries an icon and the entity name is a visible field':
    { internal: 'Finishes the scene identity restyle noted above.' },
  'fix(editor): the scene tab icon uses an existing icon size':
    { internal: 'Keeps the icon ramp to its existing sizes.' },
  'feat(editor): the status bar reads frame rate, entities, video memory and backend as one quiet line':
    { internal: 'Restyles the status readouts; the same figures, one line.' },
  'fix(editor): after a failed start the run button is the ordinary Run again, not a red one that looks like Stop':
    { note: 'Run after a failed start.' },
  "fix(launcher): a project row shows the project's own thumbnail when it has one":
    { internal: 'Completes the launcher table noted above.' },
  "fix(editor): vector fields stay on one row beside a scrollbar, a live entity's name is plain text, the scene tab shows when the game runs, and the status bar's log is warnings and errors only":
    { note: 'Running-game polish.' },
  'fix(editor): a saved layout of empty groups is not restored or saved, so a project can no longer open with no panels':
    { note: 'A project can no longer open with no panels.' },
  "feat(editor): the viewport's scene minimap is removed; the camera preview is the only corner overlay":
    { note: "The viewport's minimap is gone." },
  'feat(editor): every dock tab carries its panel icon, and the Content Browser has a regrouped toolbar, filter chips and plainer asset items':
    { note: 'Tabs with icons, and a calmer Content Browser.' },
  'feat(editor): dock tabs and groups get a context menu, floating panels are themed cards, and a popped-out window uses its tab strip as the title bar':
    { note: 'Floating panels and pop-out windows are designed.' },
  'feat(editor): the viewport toolbar groups modes, snap and menus by kind, and the right button plus W A S D Q E flies the eye':
    { note: 'A redrawn viewport toolbar, and flying the eye.' },
  'feat(editor): tile painting moves into the viewport toolbar, the palette docks wide under the viewport, and the tileset editor takes an inspector':
    { note: 'Tilemap editing is redrawn around the viewport.' },
  'feat(editor): collision layers line up with the art, show each kind plainly, pick brushes by digit, and tilemap layers get their own icons':
    { note: 'Collision layers are easier to paint.' },
  "fix(editor): the tile palette, layer menu and tileset inspector take the board's surfaces, selection frame, switches and slider":
    { note: 'The tile editor matches its design.' },
  'feat(editor): the sprite animation editor merges playback and timeline with an event track, and the animator controller gets state cards, parallel wires and a sectioned inspector':
    { note: 'The 2D animation editors are redrawn.' },
  "feat(editor): a material's preview is a real sphere, cube or plane with a background and sample image, and its header, shader section and thumbnails follow":
    { note: "A material's preview is a real shape." },
  'feat(editor): transform handles show what a drag will move, with a readout, wedge and start ghost, and the entity under the cursor is outlined':
    { note: 'Gizmos are redrawn.' },
  'feat(editor): a selected mesh shows its bounds with sizes, optional wireframe and normals and its triangle count, and a skinned mesh shows its skeleton':
    { note: 'Gizmos are redrawn.' },
  'feat(editor): a decal projector shows its box, a probe volume its probe grid, a LOD group the level it is showing, and the Gizmo menu sets the handle size':
    { note: 'Gizmos are redrawn.' },
  "feat(editor): a selected UI node shows its margin, padding, pinned insets and a flex container's axis and gaps":
    { note: 'Gizmos are redrawn.' },
  'feat(editor): the faces of a probe volume, reflection probe and decal projector are handles that resize the box':
    { note: 'Gizmos are redrawn.' },
  'feat(editor): a selected mesh is outlined along its own silhouette instead of a box':
    { note: 'Gizmos are redrawn.' },
  "feat(editor): the Show menu draws wireframe on every mesh, a chosen bone's skin weights as coloured dots, and convex colliders are listed with the other 3D colliders":
    { note: 'Gizmos are redrawn.' },
  "feat(render): a view can shade its meshes as clay or albedo, and the viewport's Show menu offers both":
    { note: 'Gizmos are redrawn.' },
  'feat(render): a view can draw meshes as a wireframe, with hidden edges hidden, through a line topology in the pipeline and an edge buffer on each mesh':
    { note: 'Gizmos are redrawn.' },
  "feat(render): the viewport colours a chosen joint's skin weights on the surface of its mesh":
    { note: 'Gizmos are redrawn.' },
  "feat(editor): a hunter's attack range, a perceiver's sight cone and a third-person camera's boom and probe are drawn in the viewport":
    { note: 'Gizmos are redrawn.' },
  'feat(editor): a UI element with a 9-slice visual drags its own border on the picture, unless its texture already carries one':
    { note: 'Gizmos are redrawn.' },
  "feat(editor): a selected Spine or DragonBones entity shows its bones over the artwork, read from the runtime's posed skeleton":
    { note: 'Gizmos are redrawn.' },
  'feat(editor): a selected tilemap layer shows how many tiles it holds and the cell area they cover, and outlines that area on a square grid':
    { note: 'Gizmos are redrawn.' },
  'feat(editor): the profiler is a module rail beside a timeline of CPU busy time and a cost table, and the frame debugger names its columns, passes and break reasons':
    { note: 'The profiler and the frame debugger are redrawn.' },
  "feat(editor): the sequencer's keys take the shape of their interpolation and its tracks show their value, and the sound event editor shows each variant's waveform and share and draws its attenuation":
    { note: 'The sequencer and the sound event editor are redrawn.' },
  'feat(editor): script, material and behavior-tree graphs share one node look, and a script graph keeps its variables in a searchable panel beside the canvas':
    { note: 'The script, material and behavior-tree graph editors are redrawn.' },
  'feat(editor): the lighting panel folds and pins its bake, history marks the present, the scatter brush previews itself, plugins are a list beside the picked one, and the string table numbers its rows':
    { note: 'The lighting, history, scatter, plugins and string table panels are redrawn.' },
  'feat(editor): the Spine preview uses the editor controls and names its bounds, running-game inspection takes the viewport handles, and the Game panel shows idle, starting and failed states':
    { note: 'The Spine preview, running-game inspection and the Game panel states are redrawn.' },
  'feat(editor): the World panel is a table of cells with the runtime totals on its toolbar, and picking a cell frames it in the viewport':
    { note: 'The World panel is a table of cells beside the Content Browser.' },
  'feat(editor): the UI Widgets palette is a searchable list in groups':
    { note: 'The UI Widgets palette is a searchable, grouped list.' },
  "feat(editor): the UI debugger's views share one layout, with tables for text and focus order and the event path drawn as a chain":
    { note: 'The UI debugger is redrawn.' },
  'feat(editor): Project Health filters by severity, groups its findings, and lists the checks that could not run':
    { note: 'The Project Health panel is redrawn.' },
  'feat(editor): the Agent panel shows how each run came out, hangs its steps on a rail and rules off its acceptance line':
    { note: 'The Agent panel is redrawn.' },
  'feat(editor): the Plugins panel shows id conflicts, filters by phase, previews what disabling removes and drops the built-ins trust withdrawal':
    { note: 'The Plugins panel shows conflicts and what disabling removes.' },
  'feat(render): material subgraphs — a graph used as one node of another, inlined at compile time':
    { note: 'Material graphs can use other graphs as nodes.' },
  'feat(render): material graphs gain the standard material surface — normal, metallic, roughness, occlusion, emission and alpha ports':
    { note: 'Material graphs can output a standard PBR surface.' },
  'feat(render): material graphs gain a vertex offset output that bends the mesh and the shadow it casts':
    { note: 'Material graphs can bend a mesh and its shadow.' },
  'feat(render): material graph switches for variants, a live preview in the graph editor, and extracting a selection into a subgraph':
    { note: 'Material graphs have switches, a live preview and extract-to-subgraph.' },
  'fix(editor): a subgraph node wires in the type it returns, a multi-selection drags as one, and depth-only mesh programs stop warning about a texture they lack':
    { note: 'Material graph editor polish.' },
  'fix(size): a mini-game package for a vendor other than WeChat carries only the subsystems its project uses':
    { note: 'Douyin and the other mini-game vendors ship a lean engine entry.' },
  'fix(render): a planar reflection capture falls back to 8 bits when the driver refuses a float target':
    { note: 'Planar reflections fall back to an 8-bit capture on drivers that refuse a float one.' },
  'fix(editor): the planar reflection inspector reads the capture of the editor view':
    { note: 'The planar reflection diagnostics read the editor view.' },
  'feat(editor): the string table exchanges XLIFF 1.2 with translators and the viewport previews the scene in any language':
    { note: 'The string table exports and imports XLIFF 1.2.' },
  "fix(editor): the preview language menu appears once the project's string tables are indexed":
    { note: 'The preview language menu appears once the string tables are indexed.' },
  'fix(editor): Play starts in the preview language even where the runtime picked the system language':
    { note: 'Play starts in the preview language.' },
  'feat(audio): the audio import settings have a Load Type, and the profiler reports decoded audio and what streaming saved':
    { note: 'Long clips on the Web play from their compressed file instead of being decoded to memory.' },
  'feat(audio): long clips on the Web play from their compressed file instead of decoding to memory':
    { note: 'Long clips on the Web play from their compressed file instead of being decoded to memory.' },
  'feat(render): a Tiling & Offset node for material graphs':
    { note: 'Material graphs have a Tiling & Offset node.' },
  'feat(editor): an asset header names its kind and size, and a segmented switch is used only when its words fit':
    { note: "An asset's header names its kind and size." },
  "feat(editor): asset inspectors take the board's finish — a card preview, ruled key-value rows, tinted actions, a kind icon in the header":
    { note: 'Asset inspectors are redrawn.' },
  "feat(editor): Details banners, add button, segmented switches and component icons follow the board's finish":
    { note: 'Details and segmented switches get the finer finish.' },
  "feat(editor): Details takes the board's style — flat sections, coloured axis letters, segmented switches for short choices":
    { note: 'Details is redrawn in a flatter style.' },
  "feat(editor): wide Details values take the row's width, rects and sides sit two by two, and a curve key's interpolation uses the themed select":
    { note: 'Details fields fit better.' },
  'feat(editor): design tokens v2 and a tidier main interface — selection readout in the viewport, a shorter status bar':
    { note: 'The editor has a new set of design tokens and a tidier main window.' },
  'feat(editor): the interface font is a setting — rounded by default, sans, serif, or any installed family':
    { note: 'The interface font is a setting.' },
  'feat(editor): the outliner shows lock and visibility in labelled columns, and the Details header keeps help and menu in view':
    { note: 'The Outliner and Details match their new design.' },
  'feat(editor): docked panels are rounded cards with rounded tabs, and the viewport hint line is off by default':
    { note: 'Docked panels are rounded cards.' },
  'feat(editor): the content browser list tints its type column by asset type':
    { note: 'Content Browser tiles and the Details header are redrawn.' },
  'feat(editor): content browser tiles and the inspector header follow the new design':
    { note: 'Content Browser tiles and the Details header are redrawn.' },
  'fix(editor): animated sprites play in the viewport whether or not they are selected':
    { note: 'Animated sprites play in the viewport whether or not they are selected.' },
  "fix(editor): the outliner's Add label stays on one line, and the content browser keeps its breadcrumbs when the bar is crowded":
    { internal: 'Corrects layout of controls added earlier in the same unreleased work.' },
  'fix(editor): the title row no longer hides menus under open drawers, and the content browser bar fits a narrow dock':
    { internal: 'Corrects layout of controls added earlier in the same unreleased work.' },
  'feat(editor): the outliner has one Add menu and a live pill, and the launcher keeps New project in one place':
    { note: 'The Outliner and the launcher lose their duplicate controls.' },
  'feat(editor): every document editor wears one header — file name, a stat, Save, tools on a second row':
    { note: 'Every document editor and every Details view has one header.' },
  'feat(editor): one inspector header for entities, assets, folders and the live game':
    { note: 'Every document editor and every Details view has one header.' },
  'feat(editor): one title row, a Panels flyout, a Show menu, a quieter content browser and status bar':
    { note: "The editor's chrome is tidier." },
  'fix(editor): retry the template directory removal in the APK test, as the others do':
    { internal: 'A test cleanup now retries a directory removal on Windows; no creator project is affected.' },
  'feat(editor): a settings window of ten pages, one line a row, advanced settings folded':
    { note: 'The settings window is ten pages, not sixteen.' },
  'fix(editor): use the shared Button, Segmented and grid tokens in the lighting controls':
    { internal: 'The lighting controls moved onto the shared Button and Segmented components and the spacing and colour tokens; their behaviour and appearance are those of the notes they belong to.' },
  'perf(android): a package carries the phone ABI, and the template strips libc++':
    { note: 'An Android package carries the phone ABI only.' },
  'feat(editor): include the emulator ABI as an Android packaging setting':
    { note: 'An Android package carries the phone ABI only.' },
  'feat(render): editor-view studio preview lighting and preview exposure':
    { note: 'The viewport can light the scene with a studio preview, and expose it.' },
  'feat(editor): studio preview lighting and preview exposure for the viewport':
    { note: 'The viewport can light the scene with a studio preview, and expose it.' },
  'feat(environment): read OpenEXR panoramas, and low-dynamic-range pictures as a source':
    { note: 'OpenEXR panoramas import as environments.' },
  'feat(editor): OpenEXR and low-dynamic-range panorama pictures as environment sources':
    { note: 'A low-dynamic-range panorama picture can be the source.' },
  'feat(environment): environment presets in the project file, and the sky and spheres of an environment':
    { note: 'Saved environment looks.' },
  'feat(environment): one rule for the scene\'s environment light, six-image sources, and an import report':
    { note: 'One rule picks the environment light.' },
  'feat(environment): six cube faces import as an environment, and an import reports what it clipped':
    { note: 'An environment import reports what it clipped, and the sky has a width setting.' },
  'perf(assets): UASTC textures ship under zstd supercompression':
    { note: 'UASTC textures ship under zstd.' },
  'fix(ci): index neon-ascension assets and classify sound event releases':
    { note: 'The Neon Ascension example exports and boots.' },
  'feat(editor): assign six images to an environment\'s faces, and create one from the Content Browser':
    { note: 'An environment can be made from six images.' },
  'feat(editor): bind, preview and preset an environment from the Lighting panel':
    { note: 'The Lighting panel names the scene\'s environment and binds it.' },
  'feat(editor): an environment section, per-object lighting source, and six-image panorama sources':
    { note: 'The Lighting panel explains the selected object\'s light.' },
  'fix(editor-checks): settle the sound event create write before editing':
    { internal: 'An editor check waited on a file watcher event it started itself; no creator project is affected.' },
  'fix(editor): integrate Play realm network permissions for issue #97':
    { note: 'Editor Play can connect to game servers.' },
  'fix(editor): allow game networking in the Play realm':
    { note: 'Editor Play can connect to game servers.' },
  'feat(examples): exercise sound event sources in audio demo':
    { note: 'Audio demo exercises authored sound events.' },
  'perf(editor): reuse bounded audio waveform peaks':
    { note: 'Sound events have a dedicated authoring panel.' },
  'feat(editor): author and preview sound event variants':
    { note: 'Sound events have a dedicated authoring panel.' },
  'feat(editor): integrate sound event authoring':
    { note: 'Sound events have a dedicated authoring panel.' },
  'feat(audio): connect sound event sources and graph triggers':
    { note: 'Sound event sources share code and graph triggers.' },
  'feat(editor): integrate sound event source references':
    { note: 'Sound event sources share code and graph triggers.' },
  'refactor(audio): expose shared playback ownership':
    { internal: 'Provides canonical voice-state lookup, stop generations and complete cleanup for leased consumers without adding another global voice pool.' },
  'feat(audio): manage sound event playback lifetimes':
    { note: 'Sound event playback owns pending and paused voices.' },
  'feat(audio): add deterministic sound event definitions':
    { note: 'Sound event definitions share deterministic selection.' },
  'feat(editor): recognize sound event definitions':
    { note: 'Sound event definitions share deterministic selection.' },
  'fix(editor): retain audio settings when editing mixer buses':
    { note: "Mixer bus edits retain the project's voice budget." },
  'fix(physics): preserve unchanged joint projections':
    { note: 'Unchanged 2D joints retain their solver state.' },
  'fix(ecs): scope native mutations to world ownership':
    { note: 'Physics reconciliation follows component mutation cursors.' },
  'perf(physics): reuse mutation checkpoints after pause':
    { note: 'Physics reconciliation follows component mutation cursors.' },
  'fix(ecs): invalidate projections when the core changes':
    { note: 'Physics reconciliation follows component mutation cursors.' },
  'perf(physics): reconcile only changed body definitions':
    { note: 'Physics reconciliation follows component mutation cursors.' },
  'refactor(ecs): unify SDK and native mutation cursors':
    { internal: 'Provides same-tick SDK mutation cursors, generated host component IDs, native reset epochs and owned core-disconnect leases for shared sparse runtime synchronization.' },
  'refactor(ecs): expose bounded native entity change history':
    { internal: 'Adds opt-in native entity and component mutation history as infrastructure for sparse synchronization, with independent cursors, bounded storage, hierarchy roots and overflow/reset signals; no user-facing synchronization policy changes in this commit.' },
  'perf(tilemap): synchronize collision by changed chunk':
    { note: 'Tile edits preserve unaffected collision chunks and contacts.' },
  'refactor(editor): use shared tile collision chunk readback':
    { note: 'Tile edits preserve unaffected collision chunks and contacts.' },
  'perf(physics): batch composed static body poses across hosts':
    { note: 'Moving static collision uses a shared batch pose channel.' },
  'fix(physics): release static pose history while time is frozen':
    { note: 'Static physics synchronization skips unchanged body groups.' },
  'perf(physics): synchronize only changed static body groups':
    { note: 'Static physics synchronization skips unchanged body groups.' },
  'perf(editor): project visible tile collision chunks':
    { note: 'Tile collision overlays project only visible local chunks.' },
  'perf(editor): synchronize local tile collision frames':
    { note: 'Tile collision overlays project only visible local chunks.' },
  'fix(tilemap): derive collision from each layer grid':
    { note: 'Tile collision follows painted and imported layer layouts.' },
  'fix(tilemap): share exact staggered and hex grid geometry':
    { note: 'Staggered and hexagonal picking follows cell polygons.' },
  'test(editor): cover staggered polygon picking through transforms':
    { internal: 'Exercises the real editor cursor-to-cell path over native diamond and hexagonal picking, including parent rotation, negative cells and both stagger axes and indices.' },
  'test(physics): keep lifecycle fixtures on the current module contract':
    { internal: 'Updates lifecycle and shutdown module doubles to provide the new body-local one-way normal entry point while preserving native contract rejection tests.' },
  'test(editor): verify rotated tile layers through play':
    { internal: 'Extends the existing CI tilemap layout check with layer and parent rotation pixels, comparing cached draws with an explicitly rebuilt reference.' },
  'test(editor): synchronize rotated tile play checks':
    { internal: 'Pins the CI-only editor rotation acceptance cases; local verification remains headless and creates no scene or material assets in commits.' },
  'fix(tilemap): align rotated layers and collision normals':
    { note: 'Rotated tile layers share one frame for drawing, picking and collision previews.' },
  'fix(editor): align rotated tile tools and collision previews':
    { note: 'Rotated tile layers share one frame for drawing, picking and collision previews.' },
  'chore(release): classify 0.88.0 feature coverage':
    { internal: 'Registers the new release features in the certification census and records the missing packaged-pixel coverage for volume color overrides without claiming acceptance.' },
  'chore(release): prepare 0.88.0':
    { internal: 'Prepares the release version and consolidates verified tile preview caching, post-process color blending and example changes without modifying showcase assets.' },
  'feat(examples): neon-ascension rain streaks and vent steam':
    { note: 'Neon Ascension adds a night-city grey-box example.' },
  'feat(postprocess): a volume can name an effect\'s colour params, so fog takes a night colour':
    { note: 'Post-process volumes blend effect colors.' },
  'feat(examples): neon-ascension grey-box, a night city to test reflections and bloom':
    { note: 'Neon Ascension adds a night-city grey-box example.' },
  'perf(editor): reuse local tile collision geometry while moving layers':
    { note: 'Moving tile collision previews reuses local geometry.' },
  'perf(editor): synchronize tile collision placement caching':
    { internal: 'Pins local tile collision geometry caching and movement regressions, and records the existing upstream night-city example in the changelog.' },
  'perf(editor): read only changed collision chunks':
    { note: 'Tile collision edits read only changed native chunks.' },
  'perf(tilemap): read collision chunks incrementally':
    { note: 'Tile collision edits read only changed native chunks.' },
  'perf(editor): reuse unchanged tile collision preview snapshots':
    { note: 'Stable tile collision previews reuse their native content and geometry.' },
  'perf(editor): synchronize tile collision preview snapshots':
    { internal: 'Pins the editor snapshot cache and its native invalidation regressions; stable preview refreshes skip full-map export and decoding without changing release versions or scene assets.' },
  'chore(release): prepare 0.87.2':
    { internal: 'Prepares the patch version and consolidates input cadence, virtual controls, editor list and live tile preview fixes without changing showcase assets.' },
  'test(poki): sample button focus and retain failed gameplay state':
    { internal: 'Poki acceptance holds pointer presses across animation frames, acknowledges each actual hit and preserves failed gameplay state and hashed screenshots. Existing phase and hit deadlines remain enforced; the old CI export fails this stronger focus regression control.' },
  'fix(example): return training keyboard focus when play resumes':
    { note: 'Training resumes with gameplay keyboard focus.' },
  'fix(editor): refresh tile collision previews from live metadata':
    { note: 'Tile collision previews follow unsaved tileset edits and undo.' },
  'fix(editor): synchronize live tile collision preview metadata':
    { internal: 'Pins the editor live-metadata preview fix and its verification coverage, without changing scene assets or release versions.' },
  'fix(editor): attach virtual windows after ancestor refs mount':
    { note: 'Windowed editor lists attach to the scroller that actually mounted.' },
  'fix(editor): finish virtual row reveals after measurement':
    { note: 'Editor row reveals finish after real grid measurements arrive.' },
  'fix(editor): synchronize windowed list attachment and navigation':
    { internal: 'Pins the editor commits that restore virtual-list attachment and measured row navigation, with matching release notes.' },
  'fix(ui): invert rendered transforms for virtual joysticks':
    { note: 'Virtual joysticks follow the rendered transform through sheared UI hierarchies.' },
  'perf(ui): share virtual control pointer groups per sample':
    { note: 'Virtual controls share each sample\'s pointer projection.' },
  'fix(ui): release hidden virtual controls before layout':
    { note: 'Virtual controls stop when their authored UI is hidden.' },
  'fix(input): sample named actions independently for fixed steps':
    { note: 'Named actions reach fixed simulation steps independently of render frames.' },
  'test(youtube): acknowledge each hit and retain failure state':
    { internal: 'Headless YouTube acceptance acknowledges each actual training hit and retains live gameplay state and screenshots before closing a failed browser session; missing attacks still fail.' },
  'chore(release): prepare 0.87.1':
    { internal: 'Prepares the patch version and consolidates verified input, UI and change-query fixes in the release notes without changing showcase assets.' },
  'fix(input): preserve complete button taps between samples':
    { note: 'Button actions retain complete keyboard and mouse taps between samples.' },
  'fix(ui): scope screen-domain lookup to its registry':
    { note: 'Screen-domain queries reject another world\'s cached entities.' },
  'fix(ui): cancel drag captures from authored visibility changes':
    { note: 'Authored UI hiding cancels dragging before another layout pass.' },
  'fix(test): present golden browser packages on a shared display':
    { internal: 'CI presents ordinary Web and playable packages without taking focus and owns one virtual display for the controller and workers, preventing hidden-page frame throttling while preserving settle deadlines, per-worker timeout shares, minigame launch paths and failure verdicts.' },
  'perf(ecs): bind live change matchers before entity iteration':
    { note: 'Dense change queries bind their live sequence index once.' },
  'fix(ecs): track system change queries across same-frame writes':
    { note: 'System change queries see additions and writes after earlier runs in the same frame.' },
  'fix(ecs): retain same-frame removals with sequence cursors':
    { note: 'Removal queries retain events across system runs in the same frame.' },
  'fix(test): classify versioned navigation in the release corpus':
    { internal: 'Connects the finalized navigation replacement feature note to the existing navigation certification capability and its courtyard project; no new acceptance claim is made.' },
  'fix(ui): reset visibility baselines for recreated components':
    { note: 'Recreated UI components start a fresh visibility baseline.' },
  'chore(release): finalize 0.87.0 release notes':
    { internal: 'Consolidates verified changes into the prepared 0.87.0 release section without changing product code or showcase assets.' },
  'test(lifecycle): renew foreground input in suspend comparisons':
    { internal: 'Suspend acceptance releases keyboard intent before hiding and sends a new key press after showing, preserving the engine cancellation contract and comparing actual movement with uninterrupted and held-background controls.' },
  'feat(nav): explain pending navigation surface replacements':
    { note: 'Navigation replacements commit only from the latest request.' },
  'feat(nav): stage cancellable surface replacements and explain pending routes':
    { note: 'Navigation replacements commit only from the latest request.' },
  'fix(test): present settings frames on one shared virtual display':
    { internal: 'The shared Electron owner can host a controller and all restart processes on one virtual display. CI presents package windows without taking focus, avoiding hidden-window frame throttling while preserving deadlines and full failure evidence.' },
  'fix(test): replay settings transactions after confirmed GPU loss':
    { internal: 'Settings acceptance applies the shared bounded GPU failure policy to whole fresh-profile transactions, preserving each failed attempt and screenshot while refusing retries for ordinary process or settings failures.' },
  'test(nav): yield fixed-step capture work to the compositor':
    { internal: 'Headless workshop acceptance yields between fixed simulation batches so software rendering can drain before screenshots, and persists sampled facts before capture failures.' },
  'test(settings): retain restart diagnostics and focused CI evidence':
    { internal: 'Settings acceptance preserves every restart process result and screenshot in existing CI artifacts, reports explicit exit status and signal, and has a focused workflow that verifies matching runtime sources before reusing Web artifacts.' },
  'fix(test): wait for package boot before settling input':
    { internal: 'Export acceptance counts settling frames only after the startup overlay releases input and uses a wall-clock watchdog independent of animation frames. Delayed real Web startup demonstrates that early clicks were previously lost.' },
  'fix(nav): apply grid obstacle changes without bake throttling':
    { note: '2D navigation doors close without the mesh bake delay.' },
  'fix(nav): pass occupied intermediate grid waypoints safely':
    { note: 'Couriers can pass occupied intermediate grid waypoints.' },
  'fix(nav): honor final arrival radius while steering bodies':
    { note: 'Crowd followers honor the configured final arrival radius.' },
  'test(nav): sample trusted keys before paused frame cleanup':
    { internal: 'Workshop acceptance steps trusted keyboard input in its event task so paused animation frames cannot erase it before sampling; movement traces retain final agent positions for failure diagnosis.' },
  'test(nav): cover authored workshop obstacle layouts':
    { internal: 'Headless exported-workshop acceptance also loads a scene with authored obstacles enabled and verifies retained state and delivery after reopening.' },
  'fix(audio): release runtime references from finished web voices':
    { note: 'Finished Web audio handles release their runtime references.' },
  'chore(release): classify v0.87 feature verification':
    { internal: 'The shipped capability census maps v0.87 navigation features to the navigation corpus and names focused editor acceptance for viewport and inspector features.' },
  'ci(editor): install workshop acceptance browser':
    { internal: 'Navigation workshop acceptance installs the Playwright headless browser required by its verifier on clean CI hosts.' },
  'fix(example): honor authored workshop obstacle state':
    { note: 'Build and reroute deliveries in a textured 2D courtyard.' },
  'fix(audio): share decoded ownership across source aliases':
    { note: 'Audio aliases share decoded buffer ownership.' },
  'fix(audio): preserve controls on loading effect handles':
    { note: 'Loading sound-effect handles preserve playback controls.' },
  'fix(audio): stop all owned voices and pending starts':
    { note: 'Stop All stops every owned audio voice and pending start.' },
  'fix(audio): preserve latest BGM intent across loading':
    { note: 'BGM playback follows the latest request instead of load completion order.' },
  'fix(audio): reject loads from retired context generations':
    { note: 'Web audio loads cannot cross disposed or replaced contexts.' },
  'fix(audio): retire source records with owned buffers':
    { note: 'Web audio source records follow live buffer ownership.' },
  'perf(ui): use generated web pointers for live focus checks':
    { note: 'Web UI getters can reach their generated pointer accessors.' },
  'fix(ui): retire text sessions when focus eligibility changes':
    { note: 'Ineligible text fields reject late editing callbacks immediately.' },
  'fix(ui): resolve live display ancestry for keyboard focus':
    { note: 'Keyboard focus observes authored visibility between layout passes.' },
  'feat(nav): add the courtyard building navigation workshop':
    { note: 'Build and reroute deliveries in a textured 2D courtyard.' },
  'fix(ui): preserve surrogate pairs when clamping host input':
    { note: 'Text-input length limits preserve complete supplementary characters.' },
  'fix(ui): bind field rendering to the active editing owner':
    { note: 'Text fields read only the editing surface they actually own.' },
  'feat(nav): budget agent replans fairly across frames':
    { note: 'Agent replans share a fair per-frame budget.' },
  'feat(inspector): show sampled navigation planning queues':
    { note: 'Agent replans share a fair per-frame budget.' },
  'feat(editor): inspect live agent route failures on demand':
    { note: "Inspect a live agent's current route on demand." },
  'feat(inspector): inspect live agent route failures on demand':
    { note: "Inspect a live agent's current route on demand." },
  'fix(inspector): use shared controls for navigation diagnostics':
    { note: "Inspect a live agent's current route on demand." },
  'perf(nav): reuse grid search workspaces across queries':
    { note: 'Grid path searches reuse their working memory.' },
  'feat(nav): diagnose partial routes and reuse disconnected grid topology':
    { note: 'Navigation queries distinguish complete routes from best-effort paths.' },
  'perf(text): wrap native measurements with ordered advances':
    { note: 'Native text measurement wraps without rescanning growing prefixes.' },
  'fix(text): bound native measurement advance history':
    { note: 'Public native text measurement retains a bounded advance cache.' },
  'feat(viewport): fade occluded transform handles without writing scene depth':
    { note: 'Spatial transform handles fade behind scene geometry.' },
  'feat(viewport): add configurable occluded handle fading':
    { note: 'Spatial transform handles fade behind scene geometry.' },
  'fix(text): isolate font reload ownership and glyph caches':
    { note: 'Font reloads retain independent handles and glyph caches.' },
  'fix(text): encode font paths without identity collisions':
    { note: 'Project font identities preserve complete asset paths.' },
  'fix(text): retire missing-glyph warnings with cached entries':
    { note: 'Missing-glyph warning history follows the bounded cache.' },
  'test(editor): verify projection resets to 2D after gestures':
    { note: 'Automation projection settings persist across editor state changes.' },
  'test(native): retain first launch evidence before retry':
    { internal: 'Native smoke retains the rejected launch screenshot, boot log and verdict before retry output reuses the normal filenames; startup verdicts and retry policy are unchanged.' },
  'test(editor): preserve authored camera during projection changes':
    { note: 'Automation projection settings persist across editor state changes.' },
  'fix(editor): retain programmatic projection across state updates':
    { note: 'Automation projection settings persist across editor state changes.' },
  'test(viewport): preserve spatial view through tool selection':
    { internal: 'Spatial acceptance uses the actual editor projection command so selecting a tool retains the store-owned view; a focused CI workflow can reuse a proven identical runtime.' },
  'test(viewport): retain spatial drag startup diagnostics':
    { internal: 'CI spatial gesture acceptance preserves process output and reports startup failures before a trusted drag observation is available.' },
  'chore(release): classify editor capabilities for v0.86.0':
    { internal: 'Release capability census records the editor-only features and their existing unit and CI acceptance paths.' },
  'test(viewport): distinguish plane handles in axis acceptance':
    { internal: 'Pixel acceptance masks the blue XY plane using rendered axis reach so it measures the projected Z arm independently.' },
  'fix(ui): transform drag deltas through full parent matrices':
    { note: 'Pointer dragging follows sheared parent transforms.' },
  'fix(audio): release failed starts and preserve paused retries':
    { note: 'Web audio startup failures release pooled nodes and keep resumes retryable.' },
  'fix(tilemap): clip fills and preserve signed coordinate edges':
    { note: 'Tilemap rectangle fills clip safely across integer coordinate bounds.' },
  'feat(viewport): rotate around the view-axis outer ring':
    { note: 'Spatial rotation adds a view-axis outer ring.' },
  'fix(animation): keep paused sprite motions out of exit transitions':
    { note: 'Paused sprite motions wait for actual completion before exit transitions.' },
  'feat(viewport): add spatial plane and center handles':
    { note: 'Spatial transform handles expose all three planes and distinct centers.' },
  'perf(ui): search measured list bounds and retry failed syncs':
    { note: 'Measured lists locate visible items without scanning every preceding row.' },
  'feat(viewport): combine transform handles in a universal tool':
    { note: 'Universal Transform combines move, rotate and scale handles.' },
  'perf(text): wrap plain text with incremental glyph advances':
    { note: 'Plain-text wrapping avoids repeated whole-line glyph measurements.' },
  'perf(text): trim overflowing plain text with prefix advances':
    { note: 'Long plain-text overflow trims with linear glyph measurement work.' },
  'feat(viewport): transform selections around individual origins':
    { note: 'Multi-selection transforms support Individual Origins.' },
  'perf(text): bound page-free glyph caches':
    { note: 'Page-free text glyph caches stay bounded.' },
  'feat(viewport): configure transform handle size':
    { note: 'Transform handle size is configurable.' },
  'feat(viewport): highlight transform handles under the pointer':
    { note: "Transform handles preview the pointer's target before a drag." },
  'fix(checks): report non-TypeScript example failures':
    { internal: 'Example validation reports filesystem and process failures instead of dropping all non-TS diagnostics.' },
  'perf(templates): minify the WeChat publishing profile':
    { note: "The WeChat starter's publishing profile minifies its game bundle." },
  'fix(ui): refresh inherited state outside Canvas layout trees':
    { note: 'UI inheritance stays current after leaving a Canvas.' },
  'feat(templates): add WeChat gameplay and host-service starter':
    { note: 'The WeChat Mini Game starter combines gameplay and host-service examples.' },
  'feat(templates): ship a complete playable ad starter':
    { note: 'The Playable Ad starter includes a complete editable game.' },
  'test(launcher): preserve complete playable starter on creation':
    { note: 'The Playable Ad starter includes a complete editable game.' },
  'test(youtube): verify hosting CSP and negative control':
    { note: 'YouTube headless checks enforce the documented hosting policy.' },
  'fix(text): refresh bitmap glyph density when device pixel ratio changes':
    { note: 'Bitmap text follows device pixel ratio changes during an App.' },
  'feat(youtube): validate export bundle constraints':
    { note: 'YouTube exports check stored bundle constraints.' },
  'feat(youtube): connect Playables readiness pause and cloud saves':
    { note: 'YouTube Playables Web exports honor host readiness and persistence.' },
  'feat(settings): add YouTube Playables Web channel':
    { note: 'YouTube Playables Web exports honor host readiness and persistence.' },

  'fix(ui): intersect nested stencil masks and restore parent clipping':
    { note: 'Nested UI stencil masks intersect their parents and restore clipping.' },
  'perf(text): reclaim unused glyph pages at frame boundaries':
    { note: 'Unused text atlas pages retire at frame boundaries.' },
  'feat(app): hold execution across frames input and media':
    { note: 'App execution holds stop owned frames, input and media.' },
  'feat(storage): await asynchronous host persistence':
    { note: 'Storage exposes asynchronous write acknowledgment.' },
  'fix(text): rasterize enlarged bitmap glyphs within atlas limits':
    { note: 'Bitmap glyphs survive enlarged text and camera zoom.' },
  'feat(crazygames): add score submissions and saved training credits':
    { note: 'CrazyGames scores and saved training credits follow platform contracts.' },
  'feat(settings): configure CrazyGames client score encryption key':
    { note: 'CrazyGames scores and saved training credits follow platform contracts.' },
  'perf(text): cull cached glyph geometry per draw projection':
    { note: 'SDK text uploads only glyphs visible to the current draw pass.' },
  'perf(ui): keep text measurement atlases off GPU':
    { note: 'Text measurement avoids GPU glyph pages.' },
  'feat(crazygames): connect Web ads storage and host audio policy':
    { note: 'CrazyGames Web exports connect the official v3 SDK.' },
  'feat(settings): add CrazyGames Web channel selection':
    { note: 'CrazyGames Web exports connect the official v3 SDK.' },
  'fix(ui): scope inline text cleanup and release measurement pages':
    { note: 'Inline rich text releases its own measurement atlas.' },
  'docs(poki): document official Inspector URL validation':
    { note: 'Poki training documents the official Inspector URL workflow.' },
  'fix(ui): release text input measurement atlases on exit':
    { note: 'Input fields release their measurement glyph pages on exit.' },
  'chore(release): classify 0.83 host verification coverage':
    { internal: 'classifies release evidence scope without changing shipped runtime behavior' },
  'fix(text): isolate App glyph caches and release owned pages':
    { note: 'Text atlases belong to each App and release their pages on exit.' },
  'fix(audio): preserve latest Web device suspension intent':
    { note: 'Web audio preserves the latest device pause intent.' },
  'feat(poki): add authored training gameplay flow':
    { note: 'Poki training reports authored gameplay and ad outcomes.' },
  'feat(editor): point Poki settings to the training example':
    { note: 'Poki training reports authored gameplay and ad outcomes.' },
  'fix(text): preserve full transforms in SDK label rendering':
    { note: 'SDK text follows the full parent transform and skips collapsed labels.' },
  'feat(web): connect Poki channel exports to ads services':
    { note: 'Web exports can select the Poki channel.' },
  'feat(editor): expose Poki Web distribution channel':
    { note: 'Web exports can select the Poki channel.' },
  'fix(renderer): skip collapsed flat hierarchies without epsilon culling':
    { note: 'Collapsed 2D hierarchies skip geometry and recover reliably.' },
  'fix(ads): reject overlapping advertising requests':
    { note: 'Advertising requests preserve a single active break.' },

  'fix(ui): align affine visuals with picking and mask bounds':
    { note: 'UI geometry, picking and scissors retain parent-induced shear.' },
  'fix(sprite): enforce tile budgets before integer conversion':
    { note: 'Extreme sprite tile counts reach the bounded fallback on native hosts.' },
  'fix(sprite): preserve affine geometry and mirrored tile grids':
    { note: 'Sprites retain parent-induced shear in every draw mode.' },
  'fix(text): preserve long bitmap strings and cull hidden glyphs':
    { note: 'Long native bitmap text preserves UTF-8 content without uploading hidden glyphs.' },
  'feat(playable): verify scenarios in headless Chromium':
    { note: 'Playable scenarios run in headless Chromium and save bound evidence.' },

  'feat(playable): adapt asset quality to measured delivery budgets':
    { note: 'Playable asset quality adapts to the measured delivery budget.' },
  'feat(editor): show playable asset optimization decisions':
    { note: 'Playable asset quality adapts to the measured delivery budget.' },


  'fix(text): transform native bitmap glyphs and ink bounds':
    { note: 'Native bitmap text follows its complete world transform.' },
  'fix(playable): honor authored texture and audio optimization':
    { note: 'Playable exports honor authored image and audio optimization.' },

  'fix(playable): bind preview records to delivery hashes':
    { note: 'Playable preview records identify the delivered archive.' },


  'fix(ui): bound mask traversal and skip empty viewport geometry':
    { note: 'UI masks handle deep hierarchies and empty viewports.' },
  'fix(transform): preserve reflected world transforms and UI bounds':
    { note: 'World transforms preserve mirrored axes.' },

  'fix(playable): verify required SDK script presence and order':
    { note: 'Playable checks verify mandatory SDK scripts and placement.' },
  'feat(editor): label required host SDK export checks':
    { note: 'Playable checks verify mandatory SDK scripts and placement.' },

  'fix(renderer): mirror nine-slice cells and texture borders':
    { note: 'Nine-slice texture flips preserve asymmetric borders.' },
  'fix(renderer): fit nine-slice borders inside small boxes':
    { note: 'Small nine-slice visuals keep borders inside their box.' },
  'fix(docs): escape playable size limits in MDX':
    { internal: 'escapes a less-than sign in both translations so the existing size-limit text compiles as MDX and the release website can deploy' },
  'feat(playable): preview creatives in local mock containers':
    { note: 'Playable creatives have a local container preview.' },
  'feat(playable): report export checks and pending acceptance':
    { note: 'Playable exports report static checks and pending acceptance.' },
  'feat(editor): show playable export checks in package results':
    { note: 'Playable exports report static checks and pending acceptance.' },

  'perf(ui): skip fully transparent visual geometry':
    { note: 'Fully transparent UI visuals skip geometry uploads.' },
  'fix(playable): pass store destinations through the CTA bridge':
    { note: 'MRAID store clicks carry their destination.' },
  'fix(playable): observe MRAID readiness and viewability':
    { note: 'MRAID playables wait for ready and viewable hosts.' },
  'fix(ui): split long text before glyph indices wrap':
    { note: 'Long text preserves glyphs beyond the 16-bit index limit.' },
  'feat(playable): package TikTok and overseas Pangle creatives':
    { note: 'TikTok and overseas Pangle package the same playable project.' },
  'perf(ui): reuse text geometry during inherited opacity fades':
    { note: 'UI text fades reuse cached geometry.' },
  'fix(ui): keep pointer carets outside surrogate pairs':
    { note: 'Pointer carets keep supplementary characters intact.' },
  'fix(ui): deliver native text input events within the UI frame':
    { note: 'Native text-input notifications survive frame boundaries.' },
  'fix(ui): preserve rich text shadow and outline colors':
    { note: 'Rich-text colors no longer recolor shadows and outlines.' },
  'fix(ui): apply inherited opacity to all text passes':
    { note: 'UI text effects follow inherited opacity.' },
  'test(renderer): cover clip recovery between camera passes':
    { internal: 'adds cross-camera regression coverage for empty text and skeletal clips and their recovery; no runtime behavior changes' },
  'fix(release): deploy website after mirrored metadata is ready':
    { note: 'Release websites wait for mirrored download metadata.' },
  'perf(renderer): skip hidden text and skeletal vertex conversion':
    { note: 'Hidden text and skeletal batches skip vertex conversion.' },
  'perf(renderer): cull bulk draws before staging geometry':
    { note: 'Camera-excluded bulk draws skip transient geometry.' },
  'feat(playable): add Mintegral container lifecycle':
    { note: 'Playable exports handle Mintegral start, completion and retry.' },
  'perf(renderer): reject full texture runs before copying indices':
    { note: 'Full texture batches avoid unused index copies.' },
  'fix(examples): distinguish motion requests from sensor samples':
    { note: 'Mobile controls share InputMap and device capability results.' },
  'feat(examples): refresh sprite rendering with CC0 space art':
    { note: 'Sprite rendering has a complete space art example.' },
  'fix(renderer): preserve depth bias and buffer identity in batch merges':
    { note: 'Batch merging preserves depth bias and geometry bindings.' },
  'perf(renderer): coalesce sorted 2d batch index gaps':
    { note: 'Sorted 2D batches join across emission index gaps.' },
  'fix(inspector): read current native parent membership in runtime snapshots':
    { note: 'Runtime hierarchy inspection follows native parent additions and removals.' },
  'perf(inspector): index script names once per runtime tree snapshot':
    { note: 'Runtime tree inspection indexes script component names once per snapshot.' },
  'perf(inspector): reuse hierarchy links for selected runtime details':
    { note: 'Selected runtime details reuse maintained hierarchy links.' },
  'feat(input): add mobile controls and device services':
    { note: 'Mobile controls share InputMap and device capability results.' },
  'feat(editor): author and verify mobile controls in Play':
    { note: 'Mobile controls share InputMap and device capability results.' },
  'fix(inspector): clear destroyed runtime entity selections':
    { note: 'Runtime inspectors clear destroyed entity selections.' },
  'perf(inspector): reuse membership and readers for snapshot visibility':
    { note: 'Runtime snapshots reuse visibility membership and direct readers.' },
  'perf(ecs): batch builtin component inspection through the core':
    { note: 'Runtime inspection batches builtin membership across the core boundary.' },
  'perf(ecs): avoid duplicate component checks during inspection':
    { note: 'Runtime inspection avoids duplicate builtin component checks.' },
  'perf(renderer): allocate transient stream storage on first use':
    { note: 'Unused transient streams no longer reserve GPU buffers.' },
  'fix(profiler): label live gpu storage estimates':
    { note: 'GPU memory estimates include buffers and render targets.' },
  'fix(profiler): account for live gpu resource storage':
    { note: 'GPU memory estimates include buffers and render targets.' },
  'fix(profiler): capture every frame from the play realm':
    { note: 'Play-mode performance captures include every recorded frame.' },
  'fix(physics): retain edits made to inactive 2d bodies':
    { note: 'Inactive 2D bodies retain pending collider and body edits.' },
  'fix(animation): refresh replaced clips on paused sprites':
    { note: 'Paused sprites refresh replaced animation clips.' },
  'fix(ui): bound scrollbar geometry for empty viewports':
    { note: 'Empty and collapsed scroll views keep finite scrollbar geometry.' },
  'perf(ui): avoid geometry writes for idle scrollbar thumbs':
    { note: 'Idle scrollbars stop forcing UI layout work.' },
  'fix(tilemap): refresh layers after tileset publication changes':
    { note: 'Running tilemaps follow published tileset updates.' },
  'fix(tilemap): own lazy tileset loads and retry failures':
    { note: 'Lazy tilemaps acquire and release tileset slots correctly.' },
  'fix(tilemap): compare cell dimensions independently':
    { note: 'Fractional tile cell edits refresh the drawn and hit grids.' },
  'fix(scene): reject mutations from unloaded contexts':
    { note: 'Unloaded scene contexts reject late mutations.' },
  'fix(scene): transfer ownership when adopting live entities':
    { note: 'Scene adoption transfers existing entity ownership.' },
  'fix(scene): retire ownership records on world despawn':
    { note: 'Scenes forget runtime entities when the World destroys them.' },
  'fix(audio): bind asset releases to retained buffer generations':
    { note: 'Old audio asset leases do not release replacement clips.' },
  'fix(audio): retire pending loads when clip sources change':
    { note: 'Audio source updates retire pending decodes.' },
  'fix(audio): release decodes that finish after disposal':
    { note: 'Late audio decodes do not repopulate closed devices.' },
  'fix(editor): preserve skeletal dependencies across failed reloads':
    { note: 'Missing skeletal sources keep their recovery paths.' },
  'fix(editor): refresh skeletal previews after directory changes':
    { note: 'Skeletal previews reload after directory changes.' },
  'fix(asset): refresh deleted and restored sprite images':
    { note: 'Deleted sprite images clear and restored images reload.' },
  'fix(editor): release obsolete bindings after skeletal loads':
    { note: 'Late skeletal loads release obsolete viewport bindings.' },
  'fix(editor): refresh open skeletal scenes after source edits':
    { note: 'Open skeletal scenes refresh after source edits.' },
  'fix(asset): invalidate resident skeletal atlas images':
    { note: 'Skeletal atlas edits invalidate resident textures.' },
  'fix(dragonbones): release atlas pages with their skeleton owners':
    { note: 'DragonBones atlas textures follow skeleton ownership.' },
  'fix(scene): roll back entities after publication failures':
    { note: 'Late scene-load errors roll back the new entities.' },
  'fix(prefab): roll back prepared spawns on parent rejection':
    { note: 'Prepared prefab spawns reject failed parent attachments.' },
  'fix(asset): transfer standalone spawn resources to entity owners':
    { note: 'Standalone scene and prefab spawns release their resources.' },
  'fix(prefab): roll back spawns when parent attachment fails':
    { note: 'Prefab spawns roll back when their parent disappears.' },
  'fix(scene): reject transitions when completion callbacks fail':
    { note: 'Scene completion errors settle the transition promise.' },
  'feat(examples): demonstrate independent sprite playback controls':
    { note: 'Sprite playback can be tried independently of its state machine.' },
  'fix(ui): stop released scroll flings on input cancellation':
    { note: 'Input cancellation stops released scroll flings.' },
  'fix(input): reset native input when the host hides':
    { note: 'Native input resets when the host hides.' },
  'fix(input): preserve gestures when touch IDs are reused':
    { note: 'Reused touch IDs preserve both gestures.' },
  'fix(input): cancel touch state when mini-games hide':
    { note: 'Cancelled touch input no longer becomes a click.' },
  'fix(storage): preserve empty mini-game values':
    { note: 'Mini-game storage preserves empty strings.' },
  'fix(examples): restore audio preferences across game restarts':
    { note: 'Audio preferences survive game restart.' },
  'fix(test): await atomic scale-report persistence':
    { internal: 'Scale measurements await their ordered report writes; budgets and measured operations are unchanged.' },
  'feat(cache): protect offline versions during budget cleanup':
    { note: 'Disk cache budgets preserve offline content versions.' },
  'feat(profiler): manage connected-device disk caches':
    { note: 'Disk cache budgets preserve offline content versions.' },
  'fix(cache): repair legacy entries and verify release artifacts':
    { note: 'Release optimization commits valid WASM artifacts atomically.' },
  'fix(ci): keep cache verifier comments within source gates':
    { internal: 'Verification fixture comments and generated-output exclusion do not change a shipped game or editor.' },
  'perf(editor): reuse lightmap workers for relighting':
    { note: 'Lightmap bounces reuse exact gather visibility.' },
  'fix(lightmap): align CLI poses with runtime precision':
    { note: "Command-line baking uses the editor's transform precision." },
  'perf(lightmap): reuse exact gather visibility across bounces':
    { note: 'Lightmap bounces reuse exact gather visibility.' },
  'test(audio): certify authored source playback after packaging':
    { note: 'Authored sound is verified in a packaged game.' },
  'fix(test): resolve golden output paths before spawning tools':
    { note: 'Package verification resolves output folders consistently.' },
  'fix(animation): hand off completed native tween loops':
    { note: 'Finite native tween loops hand off their sequences.' },
  'fix(animation): preserve looping tween phase across long frames':
    { note: 'Looping tweens preserve long-frame remainder.' },
  'fix(animation): complete immediate value tweens safely':
    { note: 'Immediate value tweens produce their endpoint.' },
  'fix(animation): preserve value tween callback control':
    { note: 'Value tween callbacks preserve playback control.' },
  'fix(animation): honor activity changes during frame callbacks':
    { note: 'Animation callbacks respect entity activity immediately.' },
  'fix(ui): preserve focus selected by text submit handlers':
    { note: 'Text submission preserves callback-selected focus.' },
  'fix(ui): bind text input events to the active session':
    { note: 'Text input events stay with the active editing session.' },
  'perf(ui): measure text caret prefixes in one pass':
    { note: 'Text caret picking measures long strings once.' },
  'fix(ui): reject input on disabled text fields':
    { note: 'Disabled text fields reject queued input.' },
  'fix(ui): blur removed text input surfaces':
    { note: 'Removed text fields release OS input focus.' },
  'fix(ui): isolate text input cleanup per app':
    { note: 'Text input surfaces stay with their own apps.' },
  'fix(render): refresh tilemap meshes after layout changes':
    { note: 'Tilemap atlas and grid edits refresh cached meshes.' },
  'perf(physics): reuse static parent transform snapshots':
    { note: 'Static siblings reuse their parent transform snapshot.' },
  'fix(ecs): compose transforms through transformless groups':
    { note: 'Transformless hierarchy groups preserve child world poses.' },
  'fix(tilemap): preserve inactive layers and own runtime colliders':
    { note: 'Tilemap activity preserves painted data and owns generated collision.' },
  'fix(physics): synchronize static body transforms in place':
    { note: 'Static 2D bodies follow authored transforms and parent movement.' },
  'fix(tilemap): invalidate caches when a layer is recreated':
    { note: 'Recreated tilemap layers discard old geometry and collision.' },
  'fix(tilemap): isolate runtime tools and scene codecs per world':
    { note: 'Tilemap runtimes and saved chunks stay with their own worlds.' },
  'fix(tilemap): rebuild native collision after live map edits':
    { note: 'Native tilemap collisions follow live edits.' },
  'perf(tilemap): skip unchanged tile writes and empty chunk allocation':
    { note: 'Unchanged tile writes preserve chunk caches.' },
  'fix(audio): distinguish source completion from interrupted voices':
    { note: 'Audio sources distinguish interrupted voices from completed clips.' },
  'fix(editor): refresh camera previews against the live CPU budget':
    { note: 'Camera preview scheduling follows its current CPU budget.' },
  'fix(test): unregister mini-game host keyboard subscribers':
    { note: 'Mini-game verification unregisters keyboard callbacks.' },
  'fix(test): forward mini-game touch gestures in package verification':
    { note: 'Mini-game verification forwards touch gestures.' },
  'fix(ui): integrate inertial scroll distance across frame rates':
    { note: 'Inertial scrolling travels consistently across frame rates.' },
  'fix(video): synchronize the decoded endpoint before playback ends':
    { note: 'WASM video progress reaches the decoded endpoint.' },
  'fix(video): support duration and seeking for single-timestamp streams':
    { note: 'Single-timestamp MPEG videos report duration and support seeking.' },
  'fix(video): synchronize live component playback settings':
    { note: 'Video component playback settings update live streams.' },
  'fix(video): isolate plugin cleanup and stream ownership per app':
    { note: 'Video plugin cleanup releases only the selected App.' },
  'fix(video): replace live streams when component sources change':
    { note: 'Video components switch streams when their source changes.' },
  'fix(export): reject failed video transcoding for wasm targets':
    { note: 'WASM video exports fail when required transcoding fails.' },
  'fix(export): prune obsolete cooked assets and packs':
    { note: 'Repeated exports remove obsolete cooked assets and packs.' },
  'fix(export): remove obsolete web runtime files on rebuild':
    { note: 'Repeated Web exports drop obsolete runtime files.' },
  'fix(editor): report failed exports accurately':
    { note: 'Editor export results report failed builds accurately.' },
  'fix(assets): release app-owned loaders during plugin cleanup':
    { note: "Asset loaders release their App's resources on shutdown." },
  'fix(particles): refresh LUT heap views after allocation':
    { note: 'Particle gradient uploads survive WASM memory growth.' },
  'fix(input): cancel held web input on focus loss':
    { note: 'Web focus loss cancels held pointer input and pending edges.' },
  'fix(audio): retain mini-game playback intent during device suspension':
    { note: 'Mini-game audio keeps playback ownership through device suspension.' },
  'fix(profiling): attribute async Box2D systems to physics':
    { note: 'Async Box2D systems retain their physics performance category.' },
  'fix(physics): isolate async Box2D module ownership by app':
    { note: 'Box2D initialization and shutdown belong to their App.' },
  'perf(render): skip geometry outside UI scissor viewports':
    { note: 'Screen-excluded UI scissor regions no longer submit draws.' },
  'fix(animation): isolate despawn subscriptions by app':
    { note: 'Animation despawn subscriptions belong to their App.' },
  'perf(animation): apply sprite frames through direct storage accessors':
    { note: 'Sprite animation applies frames through direct component accessors.' },
  'fix(audio): share native completion events across backend subscribers':
    { note: 'Native audio completion subscriptions are independent.' },
  'fix(audio): retire platform handles before completion callbacks':
    { note: 'Mini-game and native audio completion retires ownership before callbacks.' },
  'fix(audio): freeze fade clocks during device suspension':
    { note: 'Audio device suspension freezes volume fades.' },
  'fix(audio): preserve manual minigame pauses on device resume':
    { note: 'Mini-game device resume preserves manual audio pauses.' },
  'fix(audio): isolate plugin cleanup by app':
    { note: 'Audio plugin cleanup belongs to each App.' },
  'fix(audio): guard reused pool nodes from retired handles':
    { note: 'Retired WebAudio handles cannot modify reused pool nodes.' },
  'fix(audio): retain paused voice ownership and tracked base gains':
    { note: 'Paused voices remain owned by the audio API.' },
  'fix(audio): preserve playback position across rate changes':
    { note: 'WebAudio position stays continuous across playback-rate changes.' },
  'fix(audio): apply live source parameters without restarting voices':
    { note: 'Playing audio sources follow live parameter edits.' },
  'fix(ui): bound ancestor traversal across cyclic hierarchy adapters':
    { note: 'UI ancestor walks terminate on malformed hierarchy adapters.' },
  'fix(ui): retire unavailable dropdown popups before selection':
    { note: 'Unavailable dropdowns retire their open lists.' },
  'fix(ui): reconcile dropdown options and guard popup teardown':
    { note: 'Dropdown labels and open rows follow live option edits.' },
  'fix(ui): reconcile toggle indicator targets and callback removals':
    { note: 'Toggle indicators follow target replacements safely.' },
  'fix(ui): cancel unavailable slider capture and use local track dimensions':
    { note: 'Slider capture expires with input and target availability.' },
  'fix(ui): reconcile slider visuals after range and target edits':
    { note: 'Slider visuals follow range and target edits.' },
  'fix(ui): retire object drag capture before cancelled movement':
    { note: 'Object drags stop when their input or target becomes unavailable.' },
  'fix(ui): cancel scroll capture and motion when input ownership changes':
    { note: 'Cancelled scroll gestures stop without flinging.' },
  'fix(ui): apply live scroll settings and isolate replaced motion':
    { note: 'Scene scroll settings update while the game is running.' },
  'fix(ui): follow scroll content hierarchy and reference changes':
    { note: 'Scroll views follow content hierarchy edits.' },
  'fix(ui): resize scroll extents together and retire missing content':
    { note: 'Scroll views retain valid offsets across simultaneous resizes.' },
  'fix(ui): keep hit testing from bypassing interaction membership':
    { note: 'Scene-authored scroll views receive hover and wheel input.' },
  'fix(input): retire held state when release events are consumed':
    { note: 'Claimed input releases cannot leave gameplay controls held.' },
  'fix(ui): release gesture bindings and expire cancelled click markers':
    { note: 'UI gesture bindings expire with their targets and App.' },
  'fix(ui): scope safe-area resize subscriptions to their apps':
    { note: 'Safe-area resize listeners belong to their App.' },
  'fix(camera): align canvas fitting with hierarchy and scene filters':
    { note: 'Camera fitting and editor previews use outer canvases consistently.' },
  'fix(editor): use outer canvases for previews and UI hosting':
    { note: 'Camera fitting and editor previews use outer canvases consistently.' },
  'fix(ui): traverse nested canvases once and inherit their layers':
    { note: 'Nested canvases keep their parent layout and authored draw order.' },
  'fix(ui): bound hierarchy walks and preserve sibling order':
    { note: 'UI hierarchy walks tolerate deep scene groups and broken child links.' },
  'fix(ui): preserve traversal spans for large subtrees':
    { note: 'Large UI subtrees keep their full traversal span.' },
  'perf(ui): preserve transform composition across clean layout passes':
    { note: 'Static UI layout preserves composed world transforms.' },
  'fix(ui): bound hit caches to live pointer frames':
    { note: 'Touch hit caches release ended pointer IDs.' },
  'fix(ui): cancel pointer events invalidated by callbacks':
    { note: 'Pointer callbacks cancel invalid UI interactions immediately.' },
  'fix(ui): revalidate focus targets after synchronous callbacks':
    { note: 'UI focus transitions recheck callback changes.' },
  'fix(animation): guard reentrant updates and frame-list changes':
    { note: 'Sprite callbacks cannot recursively advance the same animation update.' },
  'fix(build): link context tests with WebGL 2 symbols':
    { internal: 'The context regression harness pulls in the WebGL overload even with a mock backend; its normal and sanitizer links require the same WebGL 2 symbols as the engine. Shipping engine behavior is unchanged.' },
  'fix(animation): preserve elapsed phase and coalesce crossed events':
    { note: 'Sprite playback catches up without replaying a time backlog.' },
  'fix(animation): preserve listener snapshots and callback ownership':
    { note: 'Sprite animation events tolerate listener and entity changes.' },
  'fix(tilemap): scope paint strokes and respect layer locks':
    { note: 'Tilemap edits respect layer locks and stroke ownership.' },
  'fix(editor): sync tilemap stroke ownership checks':
    { note: 'Tilemap edits respect layer locks and stroke ownership.' },
  'fix(engine): register tilemap data before renderer initialization':
    { note: 'Tilemap data is available before renderer initialization.' },
  'fix(tilemap): complete bounded fills and avoid repeated boundary reads':
    { note: 'Tilemap bucket fills finish every discovered cell within the safety limit.' },
  'fix(editor): sync bounded tilemap fill corrections':
    { note: 'Tilemap bucket fills finish every discovered cell within the safety limit.' },
  'fix(tilemap): discard obsolete layer palette reads':
    { note: 'Switching tilemap layers clears the previous palette before drawing.' },
  'fix(editor): sync tilemap layer loading cancellation':
    { note: 'Switching tilemap layers clears the previous palette before drawing.' },
  'fix(tilemap): keep palette selection and reuse loaded assets':
    { note: 'Tilemap palette refresh keeps the selected tileset.' },
  'fix(editor): sync tilemap palette refresh changes':
    { note: 'Tilemap palette refresh keeps the selected tileset.' },
  'fix(docs): restore the original README showcase':
    { note: 'The website keeps its original editor showcase.' },
  'fix(site): restore the original editor showcase':
    { note: 'The website keeps its original editor showcase.' },
  'fix(site): serve download metadata from the website origin':
    { note: 'Website download details load from the same origin.' },
  'test(ui): type the required layout measurement in the WASM regression':
    { internal: 'The real-WASM viewport regression requires the measured-height export; its non-null type assertion matches the verified test precondition without changing runtime code.' },
  'fix(ui): synchronize virtualized lists with resolved viewport bounds':
    { note: 'Virtualized lists follow their resolved UI viewport.' },
  'fix(samples): keep virtualized UI inside device safe areas':
    { note: 'Native UI follows the device safe area.' },
  'fix(verification): read renderer counters after a completed frame':
    { internal: 'Packaged-game acceptance waits for actual render frames before reading counters and separates Windows Electron app arguments; shipping engine and editor behavior are unchanged.' },
  'fix(native): keep authored UI inside live device safe areas':
    { note: 'Native UI follows the device safe area.' },
  'chore(release): isolate compositor capture and preserve GPU diagnostics':
    { internal: 'Release-only capture separates the virtual-display compositor from software WebGL, retains game-canvas/window images and logs, and continues to fail on any game error; runtime behavior is unchanged.' },
  'fix(editor): resolve the installed macOS executable from its bundle metadata':
    { note: 'The installed macOS MCP entry launches the bundled editor.' },
  'fix(editor): preserve prefab painter order when saving scenes':
    { note: 'Saving Prefab instances preserves authored draw order.' },
  'chore(release): verify installed editor upgrades before publishing':
    { internal: 'Release acceptance installs the previous and candidate packages on clean CI hosts and verifies saved project continuity before publication; editor and runtime behavior are unchanged.' },
  'fix(editor): keep camera preview refresh within its CPU budget':
    { note: 'Camera previews keep a conservative CPU budget.' },
  'fix(release): publish a verified frame of the exported sample':
    { note: 'The website preview comes from the exported game.' },
  'fix(render): preserve sprites with incompatible WebGL S3TC dimensions':
    { note: 'Compressed sprites keep their authored dimensions on WebGL.' },
  'fix(sdk): keep indexed access valid for strict consumers':
    { internal: 'Preserves supported pool and cleanup behavior while satisfying strict compiler consumer type checks.' },
  'fix(sdk): resolve spawned entities before tracking scene ownership':
    { note: 'Scene assets have scoped ownership.' },
  'Fix engine activity, asset ownership and material rendering':
    { note: 'Entity activity follows the hierarchy.' },
  'Strengthen import and native release verification':
    { note: 'Imported material textures resolve correctly.' },
  'Own live material texture bindings and preserve asset identities':
    { note: 'Material state can be applied as one complete snapshot.' },
  'Skip stale queued material previews after disposal or reconnect':
    { note: 'Asset previews release obsolete work.' },
  'Fix editor document lifecycle and runtime integration':
    { note: 'Scene assets have scoped ownership.' },
  'Fix asset preview ownership and material editing':
    { note: 'Asset previews release obsolete work.' },
  'Apply material texture edits with scoped async ownership':
    { note: 'Live material texture edits match saved Play.' },
  'Cancel queued asset previews when the scene lifetime ends':
    { note: 'Asset previews release obsolete work.' },
  'Keep scene bindings coherent when resource cleanup fails':
    { note: 'Asset previews release obsolete work.' },
  'Isolate audio preview failures and stop previews on project replacement':
    { note: 'Audio preview failures stay with their own clip.' },
  'Make audio waveform previews cancellable and preserve every channel':
    { note: 'Waveforms preserve every audio channel.' },
  'fix(audio): stop all tracked voices during device disposal':
    { note: 'Stopping editor Play stops game audio.' },
  'fix(editor): release game audio on warm Play stop':
    { note: 'Stopping editor Play stops game audio.' },
  'perf(i18n): cache bounded plain translations with invalidation':
    { note: 'Unchanged plain translations use a bounded cache.' },
  'fix(editor): stabilize camera previews and hidden authoring checks':
    { note: 'A selected camera has a preview without advancing gameplay.' },
  'fix(release): prepare v0.77.0 candidate and portable validation':
    { note: 'Release checks compare the content that ships.' },
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
  'refactor(ui): the node-graph editors\' buttons are IconButton and Button':
    { internal: 'Editor chrome: node-graph toolbar and side buttons take the shared components; no behaviour changes.' },
  'chore(gates): bank the node-graph button migration':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(ui): the agent drawer\'s, code block\'s and asset field\'s icon buttons are IconButton':
    { internal: 'Editor chrome: icon buttons take the shared component; the agent history toggle shows open in the accent fill.' },
  'feat(gates): an icon-only button is an IconButton, or says why not':
    { internal: 'A repository gate and its baseline; no source changed.' },
  'refactor(theme): every colour the editor draws comes from the palette':
    { internal: 'Editor colours move onto tokens; on the default layout no pixel moves by more than 24.' },
  'feat(gates): colour literals are counted as colours, and bank zero':
    { internal: 'A repository gate and its baseline; no source changed.' },
  'fix(i18n): the agent\'s strings go back to the agent module':
    { internal: 'Strings moved between source modules; every one resolved before and after.' },
  'feat(agent): Settings can ask an endpoint whether a model reads pictures':
    { note: 'Settings can find out whether a model reads pictures, instead of asking you to know.' },
  'feat(agent): a capture can be the overview or the close-up':
    { note: 'The agent can take an overview and a close-up instead of one full-size picture.' },
  'fix(ui): an IconButton\'s icon is centred':
    { internal: 'Editor chrome: small icon buttons move their icon 1-3px to centre; no behaviour changes.' },
  'refactor(ui): the event, tileset, flipbook, localisation, tilemap and controller icon buttons are IconButton':
    { internal: 'Editor chrome: panel buttons take the shared component; no behaviour changes.' },
  'feat(gates): an aria-* or data-* written on Button / IconButton is a finding':
    { internal: 'A repository gate and its baseline; no source changed.' },
  'refactor(ui): nine more icon buttons are IconButton':
    { internal: 'Editor chrome: nine buttons take the shared component; no behaviour changes.' },
  'chore(gates): bank the nine-button migration':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(theme): the play colour means the game is running, and nothing else':
    { internal: 'Editor colours: success states take --ok and the Y axis its own colour; no behaviour changes.' },
  'feat(gates): the play overlay may draw the axis colours':
    { internal: 'A repository gate; no source changed.' },
  'refactor(inspector): effect-order, gradient-stop and component-options buttons are IconButton':
    { internal: 'Editor chrome: Inspector buttons take the shared component at the same sizes; no behaviour changes.' },
  'chore(gates): bank the inspector button migration':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(ui): a row\'s remove button is one IconButton':
    { internal: 'Editor chrome: nine remove buttons take one look and one hover colour; no behaviour changes.' },
  'chore(gates): bank the remove-button migration':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(content): the back / forward / up buttons are IconButton':
    { internal: 'Editor chrome: three content-browser buttons take the shared component; 2px larger.' },
  'fix(theme): colours named from a vocabulary the editor does not have':
    { internal: 'Hover and border colours move from stray literals onto the palette; no behaviour changes.' },
  'fix(gates): in the editor, a var() whose name nothing defines is a finding even with a fallback':
    { internal: 'A repository gate; no source changed.' },
  'fix(a11y): pickers are listboxes and the Sequencer\'s views are tabs':
    { internal: 'Accessibility roles only; nothing renders or behaves differently for a mouse or keyboard user.' },
  'chore(gates): bank the picker and tab roles':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'feat(gates): an item or a shared control\'s own button is not hand-rolled':
    { internal: 'A repository gate and its baseline; no source changed.' },
  'refactor(sequencer): its keyframe and add-track menus are ContextMenus':
    { internal: 'Two Sequencer popovers move onto the shared menu; same entries, gains keyboard navigation and roles.' },
  'chore(gates): bank the Sequencer menus':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(log): the category filter is a ContextMenu':
    { internal: 'The Output Log filter moves onto the shared menu; it gains keyboard navigation and item roles, same entries.' },
  'chore(gates): bank the log category menu':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'feat(ui): the editor draws its own tips':
    { note: "The editor's tooltips are its own." },
  'feat(gates): a tip is data-tip, never the operating system\'s title':
    { internal: 'A repository gate and its baseline; no source changed.' },
  'refactor(plugins): the panel\'s buttons are Button':
    { internal: 'The same markup through the shared component; nothing renders differently.' },
  'chore(gates): bank the Plugins panel buttons':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(theme): colours that name one thing stop colouring others':
    { internal: 'Editor chrome colours: Outliner folders match the content browser, a lock is amber; no behaviour changes.' },
  'feat(gates): each identity colour says what it names and where that is drawn':
    { internal: 'A repository gate; no source changed.' },
  'refactor(icons): 15 and 17px icons are 16px, 19px are 18px':
    { internal: 'Editor icons move one pixel onto sizes that render crisper at 2x.' },
  'chore(gates): bank the 16px and 18px icon collapse':
    { internal: 'A repository ratchet baseline; no source changed.' },
  'refactor(icons): 11px and 13px icons are 12px':
    { internal: 'Editor icons move one pixel onto the size that renders crisp at 2x.' },
  'chore(gates): bank the 12px icon collapse':
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
  'feat(agent): a screenshot says whether it was sent, withheld, or taken':
    { note: "Every screenshot in the agent's transcript says where it went." },
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
  'feat(services): a game can record a run and share the clip':
    { note: 'A game can record a run and share the clip.' },
  'feat(pipeline): every bundle of a project\'s scripts resolves the official packages':
    { note: 'Sharing, in-game purchase, the friends leaderboard and the recorder can be used at all.' },
  'feat(editor): a project resolves and type-checks the official packages the editor ships':
    { note: 'Sharing, in-game purchase, the friends leaderboard and the recorder can be used at all.' },
  'feat(examples): record a run and share the clip':
    { note: 'The `record-share` example.' },
  'feat(editor): a project carries the official packages for tsc and an outside editor':
    { note: '`tsc` and an outside editor type-check the official packages too.' },
  'feat(tooling): the examples type-check the official packages the way a project does':
    { note: '`tsc` and an outside editor type-check the official packages too.' },
  'feat(render): a frame capture spans every pass, names each draw\'s entities, and replays after the pass that drew it':
    { note: 'A frame can be captured draw call by draw call, and replayed up to any one of them.' },
  'feat(editor): capture a frame draw by draw and replay it, in the viewport and the running game':
    { note: 'A frame can be captured draw call by draw call, and replayed up to any one of them.' },
  'feat(editor): the Frame Debugger panel lists a frame\'s draws, why each started, and replays up to one':
    { note: 'A frame can be captured draw call by draw call, and replayed up to any one of them.' },
  'feat(editor): the Frame Debugger names each draw\'s material and every texture it bound':
    { note: 'A frame can be captured draw call by draw call, and replayed up to any one of them.' },
  'feat(render): a frame capture lists every texture a draw bound':
    { note: 'A frame can be captured draw call by draw call, and replayed up to any one of them.' },
  'fix(animation): a controller loads the avatar its clips were authored on, and retargets through each rig\'s space':
    { note: 'Retargeting works: one character\'s clips play on another\'s skeleton.' },
  'fix(prefab): an override that names no entity of its prefab is reported':
    { note: 'A prefab instance\'s override that names no entity of its prefab is reported.' },
  'fix(examples): the character-rig hero and knight stand where the scene puts them':
    { note: 'The `character-rig` example shows what it is for.' },
  'feat(render): a directional light\'s source is the sun\'s size by default':
    { note: 'A Directional light\'s source is the sun\'s size by default, so its shadows have a penumbra.' },
  'fix(render): a hard shadow\'s edge is filtered, not stepped along the shadow map\'s grid':
    { note: 'A hard shadow\'s edge is a clean line, not a row of stair-steps.' },
  'feat(render): the sky is drawn from the panorama it was imported from':
    { note: 'A drawn sky is the panorama you imported, not a blur of it.' },
  'feat(editor): importing a panorama writes the sky it is drawn from':
    { note: 'A drawn sky is the panorama you imported, not a blur of it.' },
  'fix(render): a drawn sky fills the frame from every angle':
    { note: 'A drawn sky no longer vanishes, or half-vanishes, as the view turns.' },
  'fix(render): the profiler and the draw-call count cover every camera of the frame':
    { note: 'With more than one camera, the profiler and the draw-call count cover the whole frame.' },
  'fix(play): a Play pressed while the engine warms up starts the game once, not again ten seconds later':
    { note: 'A game started right after the project opened no longer restarts itself about ten seconds in.' },
  'fix(play): the game starts once when Play is pressed during the warm-up':
    { note: 'A game started right after the project opened no longer restarts itself about ten seconds in.' },
  'feat(editor): the Frame Debugger panel ships with the editor':
    { note: 'A frame can be captured draw call by draw call, and replayed up to any one of them.' },
  'fix(viewport): a paused game is not covered or dimmed; the ring says paused':
    { note: 'A paused game is no longer covered or dimmed.' },
  'feat(project): opening a project gives its tsconfig the official-packages mapping':
    { note: '`tsc` and an outside editor type-check the official packages too.' },
  'feat(project): every template and example maps estella-plugin-* to the mirrored packages':
    { note: '`tsc` and an outside editor type-check the official packages too.' },
  'feat(export): a project can be packaged for Kuaishou':
    { note: 'A project can be packaged for Kuaishou (快手).' },
  'feat(editor): Kuaishou is a build target':
    { note: 'A project can be packaged for Kuaishou (快手).' },
  'fix(runtime): a mini-game host with only WebGL1 is told the game cannot start':
    { note: 'A mini-game host that offers only WebGL1 is told the game cannot start there' },
  'feat(export): a project can be packaged for Bilibili':
    { note: 'A project can be packaged for Bilibili (B 站).' },
  'feat(editor): Bilibili is a build target, and a cap can be per subpackage':
    { note: 'A project can be packaged for Bilibili (B 站).' },
  'feat(runtime): a mini-game host that asks to hear the first frame is told':
    { note: 'A mini-game host that asks to hear when the first screen has rendered is told' },
  'fix(runtime): a mini-game host other than WeChat keeps its lifecycle':
    { note: 'A mini-game on any host but WeChat no longer throws at boot.' },
  'fix(export): a mini-game that fails to start says why':
    { note: 'A mini-game that fails to start says why.' },
  'fix(cli): a project platform exports headless, and an unknown id is refused':
    { note: '`estella export --platform <id>` packages a platform the project defines' },
  'feat(export): a project can be packaged as a quick game':
    { note: 'A project can be packaged as a quick game' },
  'feat(editor): the quick game is a build target, with its package name, version code and release key':
    { note: 'A project can be packaged as a quick game' },
  'fix(runtime): a WebGL2 context does not offer the WebGL1 extensions it made core':
    { note: 'A mini-game whose host\'s WebGL2 context also offers `OES_vertex_array_object` renders instead of hanging' },
  'feat(export): a project can be packaged for Alipay':
    { note: 'A project can be packaged for Alipay (支付宝小游戏).' },
  'feat(editor): Alipay is a build target':
    { note: 'A project can be packaged for Alipay (支付宝小游戏).' },
  'feat(export): a project can be packaged as a Huawei quick game':
    { note: 'A project can be packaged as a Huawei quick game (华为快游戏).' },
  'feat(editor): the Huawei quick game is a build target':
    { note: 'A project can be packaged as a Huawei quick game (华为快游戏).' },
  'fix(agent): the history toggle presses grey again, not the accent':
    { note: "The agent drawer's History button shows it is open with a grey press again, not the accent colour 0.71 gave it." },
  'fix(bench): a locked screen is a question this machine cannot take':
    { internal: 'a release criterion\'s own measuring conditions; the engine is unchanged' },
  'fix(recorder): a Douyin recording the host ends on its own keeps its video':
    { note: 'A Douyin recording the host ends on its own keeps its video, and an interruption is not counted as recorded time.' },
  'feat(frame-debugger): a development build can be captured from the editor over the network':
    { note: 'The Frame Debugger can capture and replay a frame of a development build running outside the editor.' },
  'feat(frame-debugger): capture a frame from a development build running elsewhere':
    { note: 'The Frame Debugger can capture and replay a frame of a development build running outside the editor.' },
  'fix(hot-update): an update says which stages it reached, and the next launch starts on a whole version':
    { note: 'A hot update reports how far it got — verified, applied, stored for the next launch, cached for offline — instead of one `ok`; two updates at once no longer both commit or lose the newer one; and an update stored by an older build no longer covers a newer one the player installed.' },
  'fix(minigame): a hot update reaches a mini-game, and survives its next launch offline':
    { note: 'A hot update on a mini-game is stored for the next launch and its assets are cached on the device, so the updated game starts offline; before, a mini-game went back to what shipped.' },
  'feat(debug): a development build\'s log, frame stats and controls reach the editor':
    { note: 'A development build connected to the editor can be watched and driven from it.' },
  'feat(profiler): a development build\'s frames, log and clock, read and driven from the editor':
    { note: 'A development build connected to the editor can be watched and driven from it.' },
  'fix(app): a frame-rate cap keeps a cadence, so 30 on a 60 Hz display is 30':
    { note: 'A frame-rate cap now holds: `setTargetFrameRate(30)` on a 60 Hz display runs at 30, not 24.' },
  'feat(debug): a device answers with its world, and a question asked while it boots waits':
    { note: 'The Outliner can show a connected development build\'s world.' },
  'feat(outliner): a connected build\'s world, shown read-only beside this editor\'s':
    { note: 'The Outliner can show a connected development build\'s world.' },
  'feat(debug): the debug channel reports what it costs the game it watches':
    { internal: 'a number the channel reports for its own budget check; the profiler does not show it yet' },
  'fix(minigame): a WeChat development build reaches the editor, and its replays come back':
    { note: 'A WeChat development build connects to the editor from WeChat DevTools (the domain check is turned off for that build only), and frame replays come back from a mini-game.' },
  'fix(hot-update): a mini-game fetches its update from the CDN, and shows it offline':
    { note: 'Hot update works on mini-games: the update is fetched from the CDN, verified, applied and cached, and after a restart without a network the game starts on it with its updated art.' },
  'fix(native): a CDN texture loads on a native build, and from the cache when offline':
    { note: 'A native build loads a remote group\'s textures from the CDN — they never loaded before — and after a hot update, from its disk cache when offline.' },
  'fix(app): the frame loop runs on vivo\'s quick game, not just its first frame':
    { note: 'Games on vivo\'s quick game run past their first frame: the frame loop now hands requestAnimationFrame a handler the runtime accepts.' },
  'fix(debug): the debug channel holds up on a slow host with a noisy console':
    { note: 'The debug channel works on vivo\'s quick game: logs arrive in batches, and a replay is sent at the size the Frame Debugger shows instead of the whole screen.' },
  'fix(frame-debugger): a device\'s replay is asked for at the size the panel shows':
    { note: 'The debug channel works on vivo\'s quick game: logs arrive in batches, and a replay is sent at the size the Frame Debugger shows instead of the whole screen.' },
  'fix(minigame): a tap on vivo\'s quick game lands where the finger is':
    { note: 'A tap on vivo\'s quick game lands where the finger is: the host reports touches in physical pixels, and every tap landed off the screen.' },
  'fix(ui): a quick tap on a slow frame still clicks':
    { note: 'A quick tap on a slow frame still clicks a button: a finger that landed and lifted between two frames was seen only lifting, so the button never saw a press.' },
  'fix(minigame): the loading notice comes down on vivo\'s quick game':
    { note: 'On vivo\'s quick game the loading notice comes down once the game starts; it could stay over the running game.' },
  'fix(examples): the hot-update demo says when it could not reach the update endpoint':
    { note: 'The hot-update demo no longer says the remote manifest matches when it could not reach one; offline it says it keeps the local content.' },
  'fix(lifecycle): a page opened in a background tab knows it is in the background':
    { note: 'A web game opened in a background tab starts paused and reports itself hidden until it is shown; before, it counted as visible.' },
  'fix(debug): a device in the background refuses a capture at once':
    { note: 'Capturing a development build whose tab is in the background says so at once, instead of waiting 30 seconds for a frame the browser will not draw.' },
  'feat(profiler): the Profiler shows what a connected device spends on its debug channel':
    { note: 'The Profiler shows what the debug channel costs a connected build per frame.' },
  'feat(profiler): a device\'s frame shows what its debug channel costs':
    { note: 'The Profiler shows what the debug channel costs a connected build per frame.' },
  'feat(debug): a connected build says what device it runs on':
    { note: 'Connected development builds are named by the device they run on.' },
  'feat(debug): connected builds are named by the device they run on':
    { note: 'Connected development builds are named by the device they run on.' },
  'fix(debug): a shipping package no longer carries the debug channel':
    { note: 'A shipping package no longer carries the development debug channel\'s code (13 KB on a WeChat package): only a development export that names an editor imports it, as `esengine/debug-channel`.' },
  'fix(net): a mini-game socket whose dial is refused on a phone redials':
    { note: 'On a WeChat phone, a socket whose connection is refused now reports that it closed, so a development build keeps redialing the editor (and a game\'s socket reconnects) instead of giving up after the first refusal.' },
  'fix(export): a mini-game\'s assets are named by their content, so an update gets new URLs':
    { note: 'Mini-game exports name assets by their content, as web exports already did: a hot update to a remote texture now shows on a phone (it kept the old picture under the same URL), and a CDN can hold two versions without v1 players getting v2 files.' },
  'fix(ui): a button can act inside the player\'s tap, where WeChat requires a share':
    { note: '`createButton({ userGesture: true })` runs its click inside the host\'s own release event: on a WeChat phone, sharing a recording from a button was refused ("require user interaction (only in touchend event)"), because a click ran on the frame after the tap.' },
  'fix(minigame): the pixel ratio is read once, not on every frame':
    { note: 'A mini-game reads the host\'s pixel ratio once and again after a resize, instead of calling getSystemInfoSync several times a frame (on vivo, a synchronous call across its bridge each time).' },
  'feat(export): the size report says what the start screen weighs':
    { note: 'The build\'s size report shows the start screen on its own line.' },
  'feat(build): the size panel names what the start screen weighs':
    { note: 'The build\'s size report shows the start screen on its own line.' },
  'feat(debug): a connected build reports its hot-update status to the editor':
    { note: 'The Profiler shows which content revision a connected build runs.' },
  'feat(profiler): a connected build says which content it runs and what update waits':
    { note: 'The Profiler shows which content revision a connected build runs.' },
  'feat(native): a native build can connect to the editor over the debug channel':
    { note: 'A native development build connects to the editor.' },
  'feat(build): a desktop development build can dial the editor':
    { note: 'A native development build connects to the editor.' },
  'fix(android): a native Android app can reach the network':
    { note: 'A native Android app can reach the network: its manifest never asked for it, so a remote group\'s assets, hot updates and the debug channel all failed on Android. A development build also allows plain http (a LAN CDN); a shipping build is held to https, and the export warns when its CDN is http.' },
  'feat(native): a native build names its device when it connects':
    { note: 'A native development build names its device to the editor.' },
  'feat(build): an Android development build can dial the editor':
    { note: 'A native Android app can reach the network: its manifest never asked for it, so a remote group\'s assets, hot updates and the debug channel all failed on Android. A development build also allows plain http (a LAN CDN); a shipping build is held to https, and the export warns when its CDN is http.' },
  'test(android): a Studio project\'s manifest has every placeholder filled':
    { internal: 'A test of the generated Android Studio project; nothing a creator sees changes.' },
  'fix(android): every Android package fills its manifest from one list':
    { note: 'A native Android app can reach the network: its manifest never asked for it, so a remote group\'s assets, hot updates and the debug channel all failed on Android. A development build also allows plain http (a LAN CDN); a shipping build is held to https, and the export warns when its CDN is http.' },
  'feat(native): a native build\'s frame can be captured and replayed':
    { note: 'A connected native build\'s frame can be captured and replayed.' },
  'fix(native): a native build reports its draws, and what the debug channel costs it':
    { note: 'A native development build\'s Profiler shows its draw calls, triangles, sprites and VRAM, and what the debug channel costs it: all read 0 on a native build.' },
  'fix(android): the Gradle project and App Bundle settings reach the export':
    { note: 'Android\'s "Android Studio project" and "App Bundle (.aab)" settings take effect: the project file never read them back, so every Android export wrote an APK and nothing else.' },
  'fix(export): the Build dialog\'s export reads the project the way the command line does':
    { note: 'An export from the Build dialog and one from `estella export` now read the project the same way. The dialog\'s builds keep the engine modules a project includes or excludes, which they ignored; the command line\'s carry the project\'s app id (a native package was always `com.estella.game`, so two games replaced each other on a phone), its script entry and scenes folder, its desktop channel and Steam app, and a playable\'s ad network.' },
  'fix(export): the editor and the command line export a project from one reading of it':
    { note: 'An export from the Build dialog and one from `estella export` now read the project the same way. The dialog\'s builds keep the engine modules a project includes or excludes, which they ignored; the command line\'s carry the project\'s app id (a native package was always `com.estella.game`, so two games replaced each other on a phone), its script entry and scenes folder, its desktop channel and Steam app, and a playable\'s ad network.' },
  'feat(export): a project names its exports as profiles, and the command line builds one':
    { note: '**Export profiles.** A project can name several exports of one target in `packaging.profiles` — a test and a production WeChat build, each with its own AppID, CDN root and development or shipping configuration, writing only what differs from the project\'s settings. The Build dialog creates, edits and deletes them per target, marking each setting a profile overrides with a reset that hands it back to the project; `estella export --profile <name>` and the agent\'s `export_game` build the same one, and the size history records which profile a build used.' },
  'feat(build): the Build dialog packages with a project\'s export profile':
    { note: '**Export profiles.** A project can name several exports of one target in `packaging.profiles` — a test and a production WeChat build, each with its own AppID, CDN root and development or shipping configuration, writing only what differs from the project\'s settings. The Build dialog creates, edits and deletes them per target, marking each setting a profile overrides with a reset that hands it back to the project; `estella export --profile <name>` and the agent\'s `export_game` build the same one, and the size history records which profile a build used.' },
  'feat(build): the Build dialog and the agent package with an export profile':
    { note: '**Export profiles.** A project can name several exports of one target in `packaging.profiles` — a test and a production WeChat build, each with its own AppID, CDN root and development or shipping configuration, writing only what differs from the project\'s settings. The Build dialog creates, edits and deletes them per target, marking each setting a profile overrides with a reset that hands it back to the project; `estella export --profile <name>` and the agent\'s `export_game` build the same one, and the size history records which profile a build used.' },
  'fix(play): opening a project no longer waits ten seconds for the play realm':
    { note: 'Opening a project no longer holds the editor behind "Preparing play realm…" for about ten seconds: the play realm\'s warm-up was being cut off and the editor waited out its deadline. A project now opens in under a second, and the first Play is still warm.' },
  'feat(build): export profiles are created, edited and deleted in the Build dialog':
    { note: '**Export profiles.** A project can name several exports of one target in `packaging.profiles` — a test and a production WeChat build, each with its own AppID, CDN root and development or shipping configuration, writing only what differs from the project\'s settings. The Build dialog creates, edits and deletes them per target, marking each setting a profile overrides with a reset that hands it back to the project; `estella export --profile <name>` and the agent\'s `export_game` build the same one, and the size history records which profile a build used.' },
  'feat(export): a shipping Android build is signed with the project\'s release key':
    { note: '**Android release signing.** A Shipping APK (and App Bundle) is signed with the release key the project names under Project Settings → Android → Signing — two PEM paths, the passphrase kept in this machine\'s keychain (the command line reads `ESTELLA_ANDROID_KEY_PASSPHRASE`); Development builds keep the development key. A Shipping build without one says it will be refused by Google Play.' },
  'feat(settings): Android release signing is set in Project Settings':
    { note: '**Android release signing.** A Shipping APK (and App Bundle) is signed with the release key the project names under Project Settings → Android → Signing — two PEM paths, the passphrase kept in this machine\'s keychain (the command line reads `ESTELLA_ANDROID_KEY_PASSPHRASE`); Development builds keep the development key. A Shipping build without one says it will be refused by Google Play.' },
  'fix(export): an Android release key may be named under the home directory':
    { note: '**Android release signing.** A Shipping APK (and App Bundle) is signed with the release key the project names under Project Settings → Android → Signing — two PEM paths, the passphrase kept in this machine\'s keychain (the command line reads `ESTELLA_ANDROID_KEY_PASSPHRASE`); Development builds keep the development key. A Shipping build without one says it will be refused by Google Play.' },
  'fix(debug): a device reports the step of its clock with what the channel costs it':
    { note: 'The Profiler no longer reports a connected build\'s debug-channel cost as 0 ms when the device\'s clock is too coarse to measure it — a browser that is not cross-origin isolated steps by 0.1 ms. The device reports its clock\'s step, the row reads "< 0.100 ms", and `profile_frames` returns it as `channelClockMs`.' },
  'fix(profiler): a channel cost below the device clock reads as below it, not as 0':
    { note: 'The Profiler no longer reports a connected build\'s debug-channel cost as 0 ms when the device\'s clock is too coarse to measure it — a browser that is not cross-origin isolated steps by 0.1 ms. The device reports its clock\'s step, the row reads "< 0.100 ms", and `profile_frames` returns it as `channelClockMs`.' },
  'feat(export): the CDN root is the project\'s packaging setting, and export profiles override it':
    { note: 'The CDN root remote asset groups and hot updates use is a packaging setting of the project (`packaging.remoteRoot`, the Package dialog\'s CDN root field), and export profiles override it — a production profile carries the real CDN while the project stays same-origin. `.esengine/asset-groups.json`\'s `activeProfile` / `profiles` are still read for a project that sets no root of its own; hot-update-demo and the hot-update docs use the new shape.' },
  'feat(build): the CDN root field writes the project\'s setting':
    { note: 'The CDN root remote asset groups and hot updates use is a packaging setting of the project (`packaging.remoteRoot`, the Package dialog\'s CDN root field), and export profiles override it — a production profile carries the real CDN while the project stays same-origin. `.esengine/asset-groups.json`\'s `activeProfile` / `profiles` are still read for a project that sets no root of its own; hot-update-demo and the hot-update docs use the new shape.' },
  'fix(export): a compressing host no longer runs the boot bar to the end of the engine download early':
    { note: 'On a host that compresses the engine binary (most CDNs and static hosts), the web boot bar no longer runs to the end of the engine download a third of the way through and stands there for the rest of it: the page divided decompressed bytes by the compressed Content-Length. The export now records the binary\'s own size (`engineBytes` in `game.config.json`) and the bar measures against that.' },
  'fix(settings): the start screen\'s logo says it is for web exports':
    { note: 'Project Settings says the start screen\'s logo is for web exports; a mini-game shows its host\'s own start screen and loading text.' },
  'feat(export): the start screen shows the game\'s code downloading':
    { internal: 'Reverted before release: golden web packages stalled after 29 frames on the CI runners; see the revert.' },
  'feat(export): a WeChat project can render through EmscriptenGLX':
    { note: '**EmscriptenGLX on WeChat.** A WeChat project can ship the engine linked with WeChat\'s EmscriptenGLX (Project Settings → WeChat → Render through EmscriptenGLX, off by default), which issues the engine\'s GL calls natively instead of through JavaScript: a draw-heavy scene spent about 12% less time rendering on an Android phone. It adds about 310KB of wasm and needs base library 3.8.12 on Android, or iOS in 高性能+ mode; any other host renders through WebGL2 as before, and the log says which. The engine is built once with `node build-tools/cli.js build -t wechat-glx`, which fetches WeChat\'s library at a pinned version and hash, and emsdk 4.0.10 beside the main one; an export that asks for it without it says so.' },
  'feat(settings): WeChat\'s EmscriptenGLX is a project setting':
    { note: '**EmscriptenGLX on WeChat.** A WeChat project can ship the engine linked with WeChat\'s EmscriptenGLX (Project Settings → WeChat → Render through EmscriptenGLX, off by default), which issues the engine\'s GL calls natively instead of through JavaScript: a draw-heavy scene spent about 12% less time rendering on an Android phone. It adds about 310KB of wasm and needs base library 3.8.12 on Android, or iOS in 高性能+ mode; any other host renders through WebGL2 as before, and the log says which. The engine is built once with `node build-tools/cli.js build -t wechat-glx`, which fetches WeChat\'s library at a pinned version and hash, and emsdk 4.0.10 beside the main one; an export that asks for it without it says so.' },
  'feat(debug): a connected build says which graphics API it draws through':
    { note: 'A connected development build says which graphics API it draws through' },
  'feat(profiler): the Profiler shows which graphics API a device draws through':
    { note: 'A connected development build says which graphics API it draws through' },
  'fix(export): a mini-game package draws each atlas sprite as its own frame':
    { note: 'A WeChat or other mini-game package draws each sprite from a packed atlas as its own frame again, not as the whole atlas page shrunk into the sprite. The package\'s scenes now keep their `@uuid:` references as the web package does, and a reference by bare uuid finds its atlas frame too.' },
  'fix(minigame): sprite masks draw in a mini-game package':
    { note: 'Sprite masks work in WeChat and other mini-game packages: the game\'s WebGL context was created without a stencil buffer, so every mask drew as if it were not there (space-shooter\'s hull bar read as empty). The web, playable and mini-game hosts now create the context with the same attributes.' },
  'test(golden): space-shooter is certified on WeChat by the pixels it claims':
    { internal: 'A repository golden check; no creator runs it.' },
  'feat(debug): a connected build answers with the whole frame it composited':
    { note: 'A connected development build can be asked for the whole frame it composited' },
  'feat(agent): device_screenshot shows what a connected build shows its player':
    { note: 'A connected development build can be asked for the whole frame it composited' },
  'fix(wechat): a WeChat package registers the engine components and AI names again':
    { note: 'A WeChat package registers every engine component and the built-in AI names again. The WeChat entries lost their start-up calls to the bundler, so a scene using a component with no typed definition — a rigged model\'s MeshSkin among them — loaded without it ("Unknown component type") and its character was never skinned.' },
  'fix(ecs): a list field reads back as an array on every read path':
    { note: 'Reading a component whose field is a list of entities — a node\'s Children, a skin\'s joints — returns an array from every read path and frees the engine\'s copy. `world.tryGet` and query iteration handed back the engine\'s vector: an animated rig leaked one per joint per frame, and on the WeChat EmscriptenGLX engine, whose vectors cannot be iterated, the animator threw every frame.' },
  'fix(import): import-model registers the images a model names on disk':
    { note: '`estella import-model` registers the images a model references on disk, so an export ships them. It wrote the materials and prefab that name them and left the images themselves unregistered, and a package built from the command line carried none of its textures.' },
  'feat(render): KTX2 textures under zstd supercompression decode on web and mini-games':
    { note: 'Web and mini-game packages decode Zstandard-supercompressed KTX2' },
  'refactor(build): the GLX engine adds its exports to the WeChat lists':
    { internal: 'The WeChat GLX engine exports the same functions as before; its link flags now extend the WeChat lists instead of restating them.' },
  'fix(export): the size report reads a Windows path as it reads any other':
    { note: 'The package size report on Windows attributes the SDK\'s bytes to the directories they come from again: every module read as "project", since the source map\'s paths were spelled with backslashes.' },
  'test(launch): the launchers print every warning and error, and count a logged error':
    { internal: 'Repository launchers; no creator runs them.' },
  'fix(render): a compressed texture is sampled with the mip chain it carries':
    { note: 'Compressed (KTX2) textures on web and mini-games are sampled with their mip chain. The cook has always written one into every texture it compresses, and only level 0 reached the GPU: a compressed texture shimmered as it shrank into the distance, and the rest of its bytes shipped for nothing. A texture decoded to RGBA on a device with no compressed format gets its chain generated.' },
  'feat(export): an authored single-level KTX2 ships with a mip chain':
    { note: 'A single-level KTX2 made outside Estella ships with a mip chain' },
  'perf(export): the cook reads back a texture encode it already did':
    { note: 'Exporting again is fast when the art has not changed' },
  'feat(asset): a scene preload reports what each asset type cost':
    { note: 'A scene\'s preload says what each asset type cost it' },
  'perf(asset): KTX2 textures transcode on worker threads':
    { note: 'KTX2 textures transcode on worker threads' },
  'fix(asset): a preload times itself without a platform':
    { internal: 'The per-type preload timings landed one commit earlier and never shipped; they read the platform clock, which a realm without a platform (the SDK tests) does not have.' },
  'feat(asset): the runtime reads an asset out of the pack its export put it in':
    { note: 'Web exports pack their small assets into a few files' },
  'feat(export): a web export packs its small local assets into a few files':
    { note: 'Web exports pack their small assets into a few files' },
  'fix(render): a two-channel normal map lights its surface':
    { note: 'Normal maps stored in two channels light correctly. The shader rebuilds Z from X and Y instead of reading blue, so a BC5 map, or one a converter wrote with blue at 0 — every normal map of Bistro\'s glTF conversion — no longer points its surface\'s normals inward, which left normal-mapped surfaces unlit by their sun.' },
  'feat(import): a model brings its DDS maps as PNG and reads a packed specular map':
    { note: 'Importing a model converts its DDS textures to PNG' },
  'feat(import): a model\'s specular map is read as its import settings say':
    { note: 'An FBX model\'s specular map can be read as packed ORM' },
  'feat(cook): textures encode on every core':
    { note: 'Exporting compresses textures on every core' },
  'fix(render): a double-sided mesh is lit on the side the camera sees':
    { note: 'A double-sided mesh is lit on the side the camera sees' },
  'fix(postprocess): an effect before bloom or SSAO takes effect':
    { note: 'A post-process effect placed before bloom or SSAO takes effect' },
  'feat(import): an FBX material takes its alpha from its base colour, and .DoubleSided draws both sides':
    { note: 'An FBX material takes its alpha from its base colour image' },
  'fix(texture): data maps are sampled as data under the linear pipeline':
    { note: 'Normal, roughness/metalness and occlusion maps are sampled as data' },
  'fix(import): a model\'s data maps reach their .meta as not sRGB':
    { note: 'Normal, roughness/metalness and occlusion maps are sampled as data' },
  'feat(project): a project file\'s settings that nothing reads are named':
    { note: 'A project file\'s settings that nothing reads are named instead of dropped' },
  'feat(project): opening a project names the settings its file carries that nothing reads':
    { note: 'A project file\'s settings that nothing reads are named instead of dropped' },
  'feat(health): a shader declares which textures it reads as data':
    { note: 'Project Health names the textures a material reads as data while they are still decoded as colour' },
  'feat(health): the preflight names data maps decoded as colour, and fixes them':
    { note: 'Project Health names the textures a material reads as data while they are still decoded as colour' },
  'feat(render): a cutout\'s edge is antialiased':
    { note: 'A cutout\'s edge is antialiased' },
  'feat(import): a model brings its lights and cameras':
    { note: 'Importing a model brings its lights and cameras' },
  'feat(assets): a cutout\'s mips keep its coverage':
    { note: 'A cutout\'s mip levels keep its coverage' },
  'feat(import): images several materials share get every setting they ask for':
    { note: 'A cutout\'s mip levels keep its coverage' },
  'fix(render): textures are mipmapped on WebGPU':
    { note: 'Textures are sampled through mip levels on WebGPU' },
  'fix(render): WebGPU post-processing keeps the picture the right way up':
    { note: 'WebGPU post-processing keeps the picture the right way up' },
  'fix(render): ambient occlusion works behind another effect':
    { note: 'Ambient occlusion works behind another post-process effect' },
  'fix(render): a shipped game\'s textures are mipmapped':
    { note: 'A shipped game\'s textures are sampled through mip levels' },
  'fix(render): a shipped game samples data textures as data':
    { note: 'A shipped game samples normal maps and roughness maps as data' },
  'fix(render): normal maps stay on up close':
    { note: 'Normal maps stay on up close' },
  'feat(bake): the editor bakes a lit surface\'s indirect light off the main thread':
    { note: 'The editor stays responsive while it bakes' },
  'feat(bake): baked light is a lit surface\'s indirect light':
    { note: 'Baked light is a lit surface\'s indirect light' },
  'perf(bake): a bake uses every core':
    { note: 'A bake uses every core, in C++' },
  'perf(bake): the editor bakes on every core':
    { note: 'A bake uses every core, in C++' },
  'perf(bake): the rays of a bake run in a C++ kernel on every core':
    { note: 'A bake uses every core, in C++' },
  'perf(bake): the editor bakes through the C++ kernel':
    { note: 'A bake uses every core, in C++' },
  'perf(bake): a texture\'s average reads sRGB through a table':
    { note: 'A bake uses every core, in C++' },
  'perf(bake): the kernel averages a bake\'s textures on every core':
    { note: 'A bake uses every core, in C++' },
  'fix(bake): a baked atlas is read the way up it was baked':
    { note: 'Baked light lands where it was baked' },
  'fix(bake): a baked atlas ships at the size it was baked':
    { note: 'A baked atlas ships at the size it was baked' },
  'fix(bake): the editor\'s atlas takes the import settings a bake owns':
    { note: 'A baked atlas ships at the size it was baked' },
  'fix(environment): a panorama is read as it was shot, not mirrored':
    { note: 'An environment is no longer mirrored' },
  'feat(environment): a directional light can be the environment\'s sun':
    { note: 'A directional light can be the environment\'s sun' },
  'feat(editor): a light following the environment\'s sun is drawn along it':
    { note: 'A directional light can be the environment\'s sun' },
  'fix(bake-scene): a scene of prefab instances is refused, not crashed on':
    { note: '`bake-scene` refuses a scene made of prefab instances instead of crashing on it' },
  'fix(editor): the viewport draws textures compressed, as a build ships them':
    { note: 'A large project opens in minutes, not half an hour' },
  'refactor(assets): one texture cook for a build and the editor':
    { note: 'A large project opens in minutes, not half an hour' },
  'fix(gates): texture-format reads the cook where the texture decision now lives':
    { internal: 'a static gate reading moved source; nothing a creator runs changes' },
  'fix(bake): an atlas\'s import settings are the bake\'s, and --check holds them':
    { note: 'physics-3d\'s lightmap is read as the light it is' },
  'feat(assets): a texture\'s Compression is Auto, GPU compressed or Original image':
    { note: 'A texture\'s Compression is Auto, GPU compressed or Original image, and a build does what it says' },
  'feat(editor): a texture\'s Compression is Auto, GPU compressed or Original image':
    { note: 'A texture\'s Compression is Auto, GPU compressed or Original image, and a build does what it says' },
  'fix(bake): a coloured light bakes the colour it lights with':
    { note: 'A coloured light bakes the colour it lights with' },
  'fix(bake): the collector reads the colour space from the engine host':
    { internal: 'Moves where an unreleased change reads a value from; it only mattered to tests that could not load.' },
  'fix(bake): the collector bakes lights in the project\'s colour space':
    { note: 'A coloured light bakes the colour it lights with' },
  'fix(bake): texels on an edge two triangles share are not an overlap':
    { note: 'A model whose second UV set cannot be baked into' },
  'perf(renderer): a draw\'s uniform blocks are ranges of shared pages, uploaded once per pass':
    { note: 'A scene of thousands of meshes draws its first frame in seconds' },
  'perf(editor): a texture unchanged since the last open is answered from its cache file':
    { note: 'A large project opens in minutes, not half an hour' },
  'refactor(assets): the texture cook reports the cache file it used':
    { note: 'A large project opens in minutes, not half an hour' },
  'fix(editor): a texture\'s remembered cache entry is relative to the project':
    { note: 'A project that moves keeps answering its textures from its own cache' },
  'fix(eht): the generator writes LF on every platform':
    { internal: 'The engine header tool is a repository generator; on Windows it rewrote every generated file with CRLF, which only a contributor there ever saw.' },

  // v0.77.0: audited engine and editor changes.
  "fix(tools): load production hierarchy button styles (#87)":
    {"internal":"Loads shipped styles in a repository measurement harness; no production behavior changes."},
  "fix(ui): escape text cache parameter boundaries (#86)":
    {"note":"Text cache entries respect overflow and parameter boundaries."},
  "fix(ui): invalidate text cache when overflow changes (#85)":
    {"note":"Text cache entries respect overflow and parameter boundaries."},
  "fix(ui): restrict nested dialog focus to inner modal (#84)":
    {"note":"Keyboard and pointer focus stay with eligible UI controls."},
  "fix(ui): retain quick-click edges for pointer focus (#81)":
    {"note":"Keyboard and pointer focus stay with eligible UI controls."},
  "fix(ui): exclude hierarchically hidden dialogs from focus scope (#80)":
    {"note":"Keyboard and pointer focus stay with eligible UI controls."},
  "fix(ui): clear focus when live navigation eligibility changes (#79)":
    {"note":"Keyboard and pointer focus stay with eligible UI controls."},
  "fix(ui): keep Web keyboard traversal in the game (#78)":
    {"note":"Keyboard and pointer focus stay with eligible UI controls."},
  "feat(events): expose immutable dispatch observations for UI debugger (#75)":
    {"note":"The UI Debugger follows the live game."},
  "fix: integrate less intrusive 2D gizmo interaction":
    {"note":"Gizmo controls keep a 2D scene easier to edit."},
  "feat: publish screen UI projection helpers for debugger picking":
    {"note":"The UI Debugger follows the live game."},
  "feat(ui): export mask mode and verify nested mask inspection":
    {"note":"The UI Debugger follows the live game."},
  "feat(ui): verify layout and input inspection in Web fixture (#73)":
    {"note":"The UI Debugger follows the live game."},
  "feat(ui): add pseudolocalization and text layout diagnostics":
    {"note":"UI text inspection and pseudolocalization previews."},
  "feat: render camera previews without advancing gameplay":
    {"note":"A selected camera has a preview without advancing gameplay."},
  "fix(editor): integrate selected-only gizmos and 2D priorities":
    {"note":"Gizmo controls keep a 2D scene easier to edit."},
  "fix: publish Android frame reports without source hooks":
    {"note":"Device reports can inspect prebuilt native apps."},
  "fix: verify prebuilt native apps without packaging templates":
    {"note":"Device reports can inspect prebuilt native apps."},
  "feat: add device quality policy and lighting validation":
    {"note":"Device quality profiles can be previewed in the editor."},
  "fix(editor): align UI debugger hierarchy rows (#17)":
    {"note":"The UI Debugger follows the live game."},
  "fix(editor): preserve event recording across debugger tabs (#16)":
    {"note":"The UI Debugger follows the live game."},
  "fix(editor): inspect text input and dialog components (#15)":
    {"note":"The UI Debugger follows the live game."},
  "feat(editor): inspect live runtime focus and Tab traversal (#14)":
    {"note":"The UI Debugger follows the live game."},
  "fix(editor): clarify event paths and filtered empty state (#13)":
    {"note":"The UI Debugger follows the live game."},
  "feat(editor): record actual entity event dispatch in UI debugger (#12)":
    {"note":"The UI Debugger follows the live game."},
  "fix: reduce gizmo clutter and inactive handle interception":
    {"note":"Gizmo controls keep a 2D scene easier to edit."},
  "feat: add UI debugger element picking and live inspection":
    {"note":"The UI Debugger follows the live game."},
  "feat(ui): diagnose ancestor masks and rectangular clipping":
    {"note":"The UI Debugger follows the live game."},
  "feat(ui): inspect layout bounds and input configuration (#10)":
    {"note":"The UI Debugger follows the live game."},
  "feat(ui): add localization preview and text overflow inspector":
    {"note":"UI text inspection and pseudolocalization previews."},
  "feat: add selected camera preview and editor acceptance checks":
    {"note":"A selected camera has a preview without advancing gameplay."},
  "fix(viewport): show detailed gizmos for selected entities":
    {"note":"Gizmo controls keep a 2D scene easier to edit."},
  "fix: test paired engine changes in editor CI":
    {"internal":"Chooses the matching engine branch in editor CI; changes only contributor verification."},
  "feat: preview device quality and stabilize lighting workflows":
    {"note":"Device quality profiles can be previewed in the editor."},
  "fix(editor): opening a timeline opens the Sequencer":
    {"note":"Opening a timeline opens the Sequencer."},
  "fix(editor): the Static batch section is in the profiler's Render module, and the clip checks find the buttons the theme gate asked for":
    {"internal":"Places the unreleased Static batch section in the profiler's Render module and adjusts the editor acceptance checks; no released behaviour changed."},
  "feat(render): static batching reports what became of each mesh and why":
    {"note":"Static meshes that share a material can be drawn as one."},
  "feat(editor): the outliner marks static batches and the profiler lists what merged":
    {"note":"Static meshes that share a material can be drawn as one."},
  "feat(render): static batching draws marked meshes that share a material as one mesh":
    {"note":"Static meshes that share a material can be drawn as one."},
  "feat(timeline): camera and sequence tracks play shots and nested timelines":
    {"note":"Timelines have camera and sequence tracks."},
  "feat(editor): the Sequencer edits camera shots and sequence clips":
    {"note":"Timelines have camera and sequence tracks."},
  "feat(render): a Neutral output transform keeps hue and saturation where ACES walks a lit red to cream":
    {"note":"The output transform has a Neutral option that keeps hue and saturation."},
  "feat(editor): the project's Output transform offers Neutral":
    {"note":"The output transform has a Neutral option that keeps hue and saturation."},
  "feat(render): model highlights widen with how fast the vertex normal turns, so they stop sparkling":
    {"note":"Lit models no longer sparkle on rails, bevels and rounded trim."},
  "feat(import): the editor's model import writes generated levels of detail":
    {"internal":"The editor-side half of the generated-LOD import: the same setting and the same products as the pipeline's, which carries the note."},
  "feat(import): a model import can write simplified levels of detail and a LODGroup that swaps them in":
    {"note":"Imported models can generate cheaper levels of detail automatically."},
  "feat(assets): meshes with fewer than 65536 vertices are written with 16-bit indices":
    {"note":"Newly imported meshes are about 9% smaller on disk."},
  "feat(render): a Temporal Anti-Aliasing effect accumulates frames, with the camera shifted a sub-pixel amount each one":
    {"note":"A Temporal Anti-Aliasing post-process effect smooths edges across frames."},
  "feat(render): a Screen Space Reflections effect mirrors the scene in the surfaces that face up":
    {"note":"A Screen Space Reflections post-process effect mirrors props in floors."},
  "feat(render): Height Fog and Light Shafts effects give a hazy horizon, the sun's glow and rays through what stands in front of it":
    {"note":"Height Fog and Light Shafts post-process effects add atmosphere."},
  "feat(render): Auto Exposure and Depth of Field effects, and a pass that remembers its last output without shifting the picture":
    {"note":"Auto Exposure and Depth of Field post-process effects are available."},
  "feat(render): a Rain effect with wet ground, puddles, ripples and splashes, and reflections that treat puddles as mirrors":
    {"note":"A Rain post-process effect adds falling rain, wet ground, puddles and ripples."},
  "feat(editor): Settings edits the three quality levels, one at a time, effect by effect, and the device rules Auto chooses by":
    {"note":"Settings → Project → Rendering edits each quality level, including which effects it runs."},
  "feat(render): the scene can draw a G-buffer beside its colour, and reflections read each surface's normal, roughness and metalness from it":
    {"note":"Reflections now know how rough and how metal each surface is, from a G-buffer the frame draws on request."},
  "feat(render): Temporal Anti-Aliasing follows meshes that move by themselves, from a motion pass that draws only what moved":
    {"note":"Temporal Anti-Aliasing now follows meshes that move by themselves, from a motion pass that draws only what moved, so a thin fast object keeps its contrast."},
  "feat(render): the motion pass follows skinned meshes by the palette their bones were last drawn with":
    {"note":"Skinned meshes are followed by their bones, from the palette they were last drawn with."},
  "feat(render): fog follows the scene's sun and can walk the air against its shadow map":
    {"note":"Height Fog and Light Shafts follow the scene's own sun, and Height Fog can carry the sun's shadows as volumetric light."},
  "feat(editor): Time Of Day and Weather panels, a grouped effect stack and material layer switches":
    {"internal":"the desktop half of the Details panels entry just below, which carries the note"},
  "feat(examples): add cyberpunk rooftop scene and building HUD":
    {"note":"Cyber Rooftop adds a rooftop survival-base example with a 2D HUD and a first-person build tool."},
  "feat(render): Voxel GI runs on WebGL2 with fragment passes":
    {"note":"Voxel GI now runs on WebGL2: the world-space bounce light is built with fragment passes where there is no compute stage."},
  "chore(editor-checks): Voxel GI is checked on WebGL2 as well":
    {"internal":"the editor check for the WebGL2 Voxel GI entry above"},
  "feat(render): the sky's clouds cast shadows on the scene":
    {"note":"The Sky Atmosphere's clouds can now cast shadows on the scene."},
  "chore(editor-checks): a cloud-shadow check":
    {"internal":"the editor check for the cloud shadows entry above"},
  "feat(render): a Water material with waves, refraction, depth absorption and foam":
    {"note":"A Water material: waves that travel, the scene seen through it bent and tinted by how deep the water is, reflections, and foam at the shore and on the crests."},
  "chore(editor-checks): a water-look check":
    {"internal":"the editor check for the Water material entry above"},
  "feat(render): Terrain and Foliage components with heightmaps, painted layers, wind and level of detail":
    {"note":"A Terrain component makes ground from a heightmap or noise, paints it with grass, dirt, snow and rock layers and draws it in chunks that coarsen with distance; a Foliage component scatters grass or a mesh over it, swaying in the wind and thinning out with distance."},
  "chore(editor-checks): terrain and foliage checks, and the inspector's buttons on the shared components":
    {"internal":"the editor checks for the Terrain and Foliage entry above, and the effect stack and weather panels moved onto the shared Button and IconButton"},
  "feat(examples): add the Wilds example, a lake under mountains with terrain, water, foliage and cloud shadows":
    {"note":"Wilds is a new 3D example: a lake under mountains at dusk, made from a generated heightmap with the Terrain, Water and Foliage features and the sky's cloud shadows."},
  "chore(tools): the corpus now authors Terrain and Foliage":
    {"internal":"the corpus-authoring list after the Wilds example authors both components"},
  "feat(render): Skin and Hair shaders, and normal maps keep their shape on stretched UVs":
    {"note":"Two new shaders for characters: Skin softens diffuse light by colour, warms the terminator and lets light through thin places without blurring the picture, and Hair lights strands along a flow map with two shifted highlights. Normal maps on stretched UVs (a face unwrapped into an atlas) now keep their shape, and mipmapped textures are sampled with anisotropic filtering where the device has it."},
  "chore(editor-checks): hair-look and skin-look checks":
    {"internal":"the editor checks for the Skin and Hair entry above"},
  "feat(import): separate metalness, roughness and occlusion maps are packed the way glTF packs them":
    {"note":"Importing an FBX with separate metalness, roughness and occlusion images now packs them into the one map the Model shader samples, instead of dropping them."},
  "feat(particles): emitters can simulate on the GPU":
    {"note":"Particle emitters can now simulate on the GPU: turn on gpuSimulation and a compute kernel advances every particle, so an emitter of a hundred thousand or a million particles costs a dispatch instead of a loop."},
  "feat(star-neighbors): add modular art and construction study":
    {"internal":"art source and review images of an in-development game under games/, which no creator using the engine or editor can observe"},
  "feat(sdk): terrain and foliage are optional modules, so a package carries them only when its content does":
    {"note":"Terrain and Foliage are now optional modules, esengine/terrain and esengine/foliage: a package carries them when a scene has a Terrain or Foliage component or a script imports the subpath, and a game with neither ships none of them (about 33 KB less in a UI-only mini-game)."},
  "feat(sdk): timelines are an optional module, installed by a TimelinePlayer or an .estimeline":
    {"note":"Timelines are now an optional module, esengine/timeline: a package carries the timeline runtime and its loader when a scene has a TimelinePlayer, the content has an .estimeline, or a script imports the subpath, and a game with none of them ships neither."},
  "feat(sdk): post-process effect shaders come in three optional groups, so a package carries only the effects its content uses":
    {"note":"The post-process effects' shaders are now three optional groups, esengine/fx-basic, esengine/fx-atmosphere and esengine/fx-lighting: a package carries a group when a PostProcessVolume names one of its effects (or a Weather or TimeOfDay component is in the content), and a game with no volumes ships none of them (about 180 KB less in a UI-only mini-game)."},
  "feat(export): a mini-game package whose content uses no particles, post-processing or tilemaps ships a lite engine":
    {"note":"A WeChat or Douyin package whose scenes and scripts use no particle emitter, post-process volume or tilemap now ships a lite engine, the same engine without those three subsystems and about 200 KB smaller, so a UI-only game has room under the 4 MB main-package limit."},
  "fix(launcher): switching template renames the suggested project name, unless the user typed one":
    {"note":"The New Project page no longer keeps the previous template's name when you pick another: the suggested name follows the template, and a name you typed stays."},
  "feat(render): imported meshes carry a tangent frame, so a normal map is read against the frame it was baked in":
    {"note":"Imported meshes now carry a tangent at each vertex (a glTF's own direction, or one made from the UVs), and normal maps on them are read against that frame instead of one derived per pixel, which was wrong at UV seams and on stretched textures. Re-import a model to get them; one imported before keeps its old shading."},
  "feat(render): an Eye shader draws the iris behind a refracting cornea, with a pupil, a limbal ring and a catchlight":
    {"note":"A new Eye shader (`builtin:eye`) draws an eye from a mask and a dome normal map: the iris sits behind a refracting cornea so it moves as the eye turns, with a pupil, fibres and a limbal ring, a white lit with wrapped light, and a near-mirror cornea that shows every light as a catchlight."},
  "feat(render): a cutout material casts its cut-out shape into shadow maps, and Hair cards cut out by alpha":
    {"note":"A material whose alpha is coverage (`u_alphaCutoff` above 0, now also on the Hair shader) casts its cut-out shape into shadow maps instead of the rectangle it is drawn on, and Hair cards feather their edges with alpha-to-coverage."},
  "fix(editor): a selected plane seen from close by no longer draws its diagonal as an outline":
    {"note":"The selection outline of a mesh no longer draws a stray line across a large plane seen from close by: a triangle with a corner behind the camera was judged by a different rule than its neighbour, so their shared diagonal showed as an edge."},
  "feat(render): the Skin shader takes a tiled detail normal map for pores and creases":
    {"note":"The Skin shader has a detail normal layer: `u_detailMap` is a fine normal map tiled over the surface (`u_detailTile`) for pores and creases, laid on the sharp normal the shine reads by `u_detailStrength` (0 leaves it out) and not on the soft diffuse normals."},
  "feat(render): the Skin shader shapes its scattering per colour and by curvature":
    {"note":"The Skin shader can take its wrap past the terminator per colour and shape it by curvature: `u_preIntegrate` (red travels furthest, every colour further where the surface turns sharply) and `u_curvature`, so a nose or an ear glows at its edge while a flat cheek stays crisp. Off by default."},
  "feat(render): the Eye shader takes a lid shadow, authored or from the surface facing up":
    {"note":"The Eye shader shades the eye the lids sit on: `u_lidMap` is an authored occlusion map, and `u_lidShadow` darkens, and fades the cornea's reflections, where the surface faces up from `u_lidStart`, which is the upper lid on an upright head."},
  "feat(import): a model can give its skin, hair and eye materials the character shaders":
    {"note":"Importing a model can now give its character materials the right shader: turn on Character Materials in the model's import settings and a material whose name says skin, face, head, hair or eye gets the Skin, Hair or Eye shader with its normal and occlusion/roughness maps bound, and hair is cut out by its alpha and feathered by coverage. Off by default."},
  "feat(render): Hair cards draw a soft blended tip pass below their cutoff":
    {"note":"The Hair shader can draw the soft outer band of its cards: `u_tipSoftness` is how far below the cutoff alpha a second, blended pass draws each strand's tip fading out, sorted with the other blended draws, so tips are not stair-stepped by coverage. A model imported with Character Materials also has its hair triangles put in the order that pass wants, the cards nearest the middle of the hair first. Off by default."},
  "feat(examples): Cyber Rooftop gets a wet roof, a rain sky and a fuller HUD":
    {"note":"Cyber Rooftop gets a rebuilt rooftop model and textures, a wet roof material with a planar reflection under a rain sky, rain, fog and bloom in the scene, a larger set of HUD icons and inventory art, and a wider build footprint."},
  "feat(water): a WaterBody builds an ocean or a lake whose waves lift the geometry and can be read from code":
    {"note":"Water gets a component and a chapter of its own. A WaterBody builds an ocean (without an edge, following the camera, in rings that coarsen with distance) or a rectangular lake, lifts its geometry with the waves, follows its own up when it is tilted, and answers for its surface from code (`Waters.sample`) with the same formula the shader draws. Water is an optional module (`esengine/water`): a 2D game carries none of it."},
  "feat(water): a lake takes an outline of its own and calms its waves toward the shore":
    {"note":"A lake can have an outline of its own and knows its shore. `boundary` cuts it to a polygon on its plane (crisp at the pixel, not at the grid's cells), `shoreWidth` calms its waves toward the edge and where it is shallow over a Terrain, and the shore foams along the outline. `Waters.sample` answers with the same calmed waves and says a point in the notch of a concave lake is not inside."},
  "feat(water): a river follows a Spline and runs with a current the surface and the code can both read":
    {"note":"A WaterBody can be a river: put a Spline on its entity and it lays a ribbon along the curve, as wide as the curve says at each point and at its height, with a current (`flowSpeed`, faster where it narrows) that the shader carries the waves and ripples along and that `Waters.sample` reports as `flow`. Splines are a new optional module (`esengine/spline`): a curve through points with a width each, measured by the distance along it."},
  "feat(water): a Floating component holds a rigid body up in water and carries it with the current":
    {"note":"Water holds things up. A Floating component on an entity with a RigidBody3D floats it: a buoyant force against gravity (`buoyancy` is the water's density against the body's, so 2 floats it half under) and a drag against its velocity relative to the water, which brings it to rest in a lake and carries it with a river's current, applied at a few points of the body so waves tip it. It works from the CPU's own water surface, so it needs no renderer, and it needs the 3D physics module, which gains force and mass queries."},
  "feat(water): a camera under the surface sees through the water, fogged and tinted by what it has crossed":
    {"note":"A camera under water sees through it. Whenever the active camera is below a water body's surface an Underwater effect is added to the post-process volumes: the light of each pixel is taken out colour by colour (red first) by the distance it crossed, with the same absorption and density the surface's material draws with, and the water gives back its own colour, dimmer the deeper the camera is. The surface seen from below turns over and, past the critical angle, reflects whole (Snell's window)."},
  "feat(pipeline): spring-bone import reads VRM spring bones and node properties before it looks at names":
    {"note":"The Spring Bones import setting now reads what a model states before it looks at names: the VRM spring-bone extension (VRMC_springBone, with its stiffness and gravity converted to units the engine uses) and a node's own extras.estella.springBone and springCollider properties, which carry exact sizes from a Blender custom property. Names fill in whatever those leave out, a chain with no collider list is kept out of every collider in the model, and springs that cannot be used are reported in the import warnings."},
  "feat(editor): a selected spring-bone collider has six handles in the viewport that drag its radius and height":
    {"note":"A selected spring-bone collider carries six square handles in the viewport: on a sphere any of them sets the radius, on a capsule the four round its middle set the radius and the two on its ends set the height. The ones on the far side of the shape are faded, the value shows beside the pointer while one is dragged, a drag is one undo step, and with Preview FX on the strands follow it live."},
  "feat(pipeline): a model's Spring Bones import setting builds hair chains and colliders from bone names":
    {"note":"A model's new Spring Bones import setting (By Bone Name) builds hair motion from names the file already carries: a bone called Hair_<region>_<chain>_00 becomes a SpringBone with the bones below it as the strand, and an empty called SBC_Sphere_<name>_r<cm> or SBC_Capsule_<name>_r<cm>_h<cm> becomes a collider every chain is kept out of. The region sets a starting stiffness and drag, sizes follow the model's metres and the import scale, and the result is ordinary components to adjust in Details."},
  "feat(animation): a spring-bone chain takes a wind, with gusts that ripple down the strand":
    {"note":"A spring-bone chain takes a wind: `wind` is a steady acceleration on the chain, `windGust` swings its strength from calm to twice as strong, and `windFrequency` sets how often. Each bone meets a gust a moment after the one above, so a strand ripples rather than swaying as one, and a chain's gusts depend only on its own clock, so the same scene moves the same way twice. The wind is a field on each chain; there is no scene-wide wind source yet."},
  "feat(editor): a selected spring-bone chain and its colliders are drawn in the viewport, Details groups and counts them, and Preview FX simulates the chain":
    {"note":"Spring bones can be authored in the editor: Details groups a chain's fields into Motion, Chain and Collision and counts the bones below it (or warns that there are none), the viewport draws a selected chain (the bones as posed, a ring at each joint, the tips) with the colliders it keeps out of, or a selected collider on its own, behind a Spring bones entry in the Gizmo menu, and View · Preview FX simulates the chain in the edit viewport, drawn solid over its dashed pose. Ending the preview gives the bones back as the scene has them."},
  "feat(animation): spring bones give a chain of bones secondary motion in the engine, with colliders to keep it out of the body":
    {"note":"Spring bones give a skeleton secondary motion: a `SpringBone` on the root of a chain of bones (hair, a tail, a cord) makes everything below it a spring that lags the animation, falls with gravity, is pulled back to its animated pose, never stretches, and is kept out of `SpringBoneCollider` spheres and capsules. It runs in C++ in the engine, so it costs the same on every target: 300 chains of six bones step in 0.28 ms. Only the bones' rotations are written, and switching it off gives the animation's own back."},
  "feat(editor): the quality settings page has a Level · Water group for waves, ripple cells, displacement, mirror and caustics":
    {"note":"Project Settings → Rendering has a Level · Water group for the five water quality fields (waves, ripple cells, displacement, mirror, caustics) of the level chosen under Editing level. Each is saved as a difference to that level only, and the group is hidden while quality is off or the project excludes the water module."},
  "feat(sdk): the Water, Terrain, Foliage, Hair, Skin and Eye shaders ship with their modules, and a material that names one brings its module into an export":
    {"note":"The Water, Terrain, Foliage, Hair, Skin and Eye built-in shaders now ship with their modules instead of the core: a package that installs none of them no longer carries about 80 KB of shader source (a blank web package is 80 KB smaller, a blank WeChat bundle 7% smaller). A material that names one of them is what brings its module into an export, with no component in a scene needed; the three character shaders are a new `esengine/character-shaders` module."},
  "fix(render): opaque draws are told from blended ones by their stage, so a lit model no longer vanishes in a frame with glass":
    {"note":"Opaque draws are told from blended ones by the stage they are sorted in, not by their blend mode, when a frame has both a refracting surface and blended draws; before, a lit material whose blend mode was not None (the Model material) was treated as blended and could vanish from such a frame."},
  "feat(water): quality levels set the waves, ripples, mirror and caustics water spends, and the low level is a lite water with flat geometry":
    {"note":"Water spends what the quality level allows. Each level's profile has `waterWaves` (waves summed, 2 / 3 / 4), `waterRippleCells` (the ripple grid's side, 32 / 64 / 128), `waterDisplacement` (off is the lite water: flat geometry with the waves in the shading only), `waterMirror` and `waterCaustics`. What `Waters.sample` answers follows what is drawn, and a minigame with no quality policy gets the Low level's water."},
  "fix(editor): the move gizmo's plane handles sit closer to its centre":
    {"note":"The three plane handles of the move gizmo sit closer to its centre, on the inside corner between each pair of axes, instead of out at a third of the way along them."},
  "feat(editor): the points of a lake and a river are edited with handles in the viewport, and Details shows only what the form uses":
    {"note":"Select a lake or a river and its points are handles in the viewport: drag a point to move it on the body's own plane, drag the circle on an edge to insert one, press and release a point to delete it (a lake keeps three, a river two), and drag the handle beside a river's point to set its width there. Each gesture is one undo step. Details shows a water body only the fields its form uses, with a Boundary row for a lake's outline and the point count and the pressed point's width under a Spline. Also: the move gizmo now travels with the entity while an axis is dragged, instead of staying where the grab began."},
  "fix(render): a blended surface is ordered against water and glass by the pixel, so a pane in front of water is no longer covered by it":
    {"note":"A blended surface (a pane, a particle, a leaf card) is now ordered against water and glass by the pixel and not by when it was drawn: one under the surface is seen through the water, one in front of it lies on the water instead of being covered, and where there is no water it is blended once. The frame is drawn in layers only when it holds both a refracting surface and a blended draw."},
  "feat(water): water keeps ripples and foam, a disturbance spreads as a ring, and what moves in it makes a wake":
    {"note":"A body of water keeps what disturbs it. With `ripples` above 0 the water steps a window of its surface (that follows the camera) with the wave equation: `Waters.disturb(x, y, z, radius, strength)` and a `Floating` body's wake (`wake`) put in bumps that spread as rings, fade, and bend the shading and the reflection, and leave foam that lingers and thins (`rippleSpeed`, `rippleDamping`, `foamFade`). `Waters.sample` carries the ripples, and `Waters.rippleAt` gives them alone."},
  "feat(water): a waterline across the lens, caustics, light shafts, and a mirror under the surface":
    {"note":"Under water the picture is lit and bounded like water. A camera with its lens half in the water has a waterline across it, soft and sliding as it dips; what it sees is lit by the web of caustics the waves focus the sun into (the Water material's `u_causticStrength`, `u_causticScale` and `u_causticSpeed`, also drawn on what lies under the water seen from above); the water along each ray scatters the sun into shafts (`u_shaftStrength`); and the surface seen from below, past the critical angle, mirrors the world beneath it."},
  "chore(tools): the gates run in parallel with --jobs, and the reds a full run gathered are cleared":
    {"internal":"tooling for the static gates, and fixes to checks that had drifted from the code they guard"},
  "fix(render): a wire narrower than a pixel is no longer painted over by the sky in dashes":
    {"note":"A wire or railing thinner than a pixel stays one line against the sky instead of breaking into dashes."},
  "fix(render): contact shadows no longer speckle a surface the sun does not reach, and a temporal pass placed before a noisy effect is flagged":
    {"note":"Contact shadows are soft and keep off surfaces facing away from the sun, so a wall no longer carries a speckle a temporal pass could not average, and the effect stack flags a Temporal Anti-Aliasing that sits before a noisy effect."},
  "feat(editor): Time Of Day and Weather have Details panels of their own, the effect stack is grouped, and a material's surface layers are switches":
    {"note":"Time Of Day shows the day as a curve with a hand for the hour, Weather as preset buttons with a live readout, a volume's effects are grouped and tagged, and a Model material's surface layers are sections with switches."},
  "feat(render): screen-space subsurface scattering blurs the lit colour of surfaces a material marks":
    {"note":"A Subsurface Scattering effect blurs the lit colour of the surfaces a material marks as scattering, red furthest, without bleeding across a depth edge."},
  "feat(render): a transmissive material refracts the opaque scene behind it":
    {"note":"Glass and water refract: a material with transmission bends and tints the opaque scene behind it, softened by its roughness."},
  "feat(render): ground-truth ambient occlusion joins the post-process effects":
    {"note":"Ground-truth ambient occlusion (GTAO) is a post-process effect beside SSAO: a crease darkens by how closed it really is and a flat floor stays white, with no bias to tune."},
  "feat(render): a scene drawn below the screen's size is stretched back with a sharper resampler":
    {"note":"A scene drawn at a render scale below 1 is stretched back to the screen with a resampler that keeps edges steeper than a bilinear copy."},
  "feat(render): motion blur, film grain and lens flare join the post-process effects":
    {"note":"Motion blur, film grain and lens flare are post-process effects, and a moving mesh's motion now reaches effects on WebGPU too."},
  "feat(render): materials carry a clear coat, sheen, anisotropy, translucency, thin film, index of refraction and transmission":
    {"note":"The Model material has shading layers — clear coat, sheen, anisotropy, translucency, thin film, index of refraction and transmission — and a glTF with the matching extensions arrives using them."},
  "feat(render): a frame carries 112 lights, the lights past the sixteenth lighting their pixels through screen tiles":
    {"note":"A frame now carries up to 112 lights: sixteen are read for every pixel and the rest are tiled, so a street of lamps lights what each one reaches."},
  "feat(editor): Play runs on the graphics backend the project asks for":
    {"note":"Play runs the game on the graphics backend the project asks for, so a WebGPU project is played on WebGPU and its compute effects and Voxel GI are seen in the editor."},
  "feat(render): Voxel GI lights from a world-space cache of what the camera has seen, run as compute passes":
    {"note":"Voxel GI adds diffuse bounce light from a world-space voxel cache the camera remembers, on WebGPU."},
  "feat(render): post-process effects can be compute shaders, and Sharpen is one":
    {"note":"A post-process effect can be a WGSL compute shader over the picture, run on WebGPU and left out on WebGL2, and Sharpen is the first."},
  "feat(render): the WebGPU device runs compute shaders, and the render graph has compute passes":
    {"internal":"Renderer plumbing with no creator-facing surface yet: no effect or component asks for compute until the first consumer lands."},
  "feat(render): the sky scatters light like an atmosphere and carries volumetric clouds the sun lights":
    {"note":"The Sky Atmosphere effect scatters the sun's light through an atmosphere and draws volumetric clouds that the sun lights and the wind moves."},
  "feat(runtime): a TimeOfDay component moves the sun and the moon across the sky and draws the day, the dusk and the night":
    {"note":"A TimeOfDay component moves the sun and the moon across the sky, and a Sky Atmosphere effect draws the day, the dusk and the night."},
  "fix(render): the dusk sky is dimmer and warmer, the moon is a disc, and an overcast sky hides the moon and stars":
    {"internal":"Tunes the look of a sky effect added in the same unreleased change, so no creator has seen it before."},
  "fix(docs): the Time of Day page links under the site's /docs base":
    {"internal":"A link on a documentation page that had not been published yet."},
  "feat(runtime): a Weather component puts a scene under a preset, turns between presets and cycles through a sequence":
    {"note":"A Weather component puts a scene under clear, mist, overcast, rain or storm, turns between them and cycles by itself."},
  "feat(render): baked reflection probes follow the weather through the ambient light's reflection scale and saturation":
    {"note":"Reflection probes follow the weather: the ambient light scales what baked probes show and how much colour they keep."},
  "feat(render): puddles gather in the low places of the ground and thin on its rises":
    {"note":"Puddles gather in the low places of the ground and thin on its rises, read from the depth buffer."},
  "feat(render): auto exposure meters a spot, and depth of field auto-focuses and shapes its bokeh by the aperture":
    {"note":"Auto Exposure can meter the middle of the picture or a spot, and Depth of Field focuses by itself and blurs a light into the shape of its aperture."},
  "feat(runtime): rain stays off what is under a roof, and the weather turns a rain track up and down":
    {"note":"Rain stays off what stands under a roof, and the Weather component turns a looping rain track up and down."},
  "feat(render): Contact Shadows and Screen Space GI effects, and the weather softens the sun's shadows":
    {"note":"Contact Shadows and Screen Space GI effects add small sharp shadows at contacts and one bounce of colour between surfaces, and the weather softens the sun's shadows."},
  "feat(render): reflections no longer guess a surface, plain meshes record themselves, and what the ray never finds is the sky":
    {"note":"Screen-space reflections leave a surface that recorded nothing alone, plain meshes now record a rough dielectric, and a puddle reflects the sky and what lies off screen."},
  "fix(render): an opaque mesh on a material records its surface, and water and glass own theirs":
    {"note":"A mesh on a material records its surface."},
  "fix(terrain): a splatmap's fourth layer no longer erases the other three":
    {"note":"A terrain's splatmap keeps all four layers."},
  "feat(weather): the wind raises the waves and bends the plants, and rain falls on the water":
    {"note":"Wind and rain on the water."},
  "feat(water): every body of water is baked into a zone and drawn as one surface":
    {"note":"Water zones."},
  "fix(examples): the Wilds ground textures repeat instead of smearing at their edges":
    {"internal":"An example's texture import settings; the engine is unchanged."},
  "feat(editor): a new Weather drives the wind too":
    {"internal":"The editor half of the wind note: a Weather added in Details drives the wind with the rest."},
  "feat(editor): the viewport outlines a WaterZone, and the water checks author their water in one":
    {"internal":"The editor half of Water zones, which carries the note."},
  "feat(water): surf runs in toward the shore, breaks white and runs up the ground":
    {"note":"Surf on the shore."},
  "feat(terrain): rain erodes the ground and its noise is warped, baked over frames with their progress":
    {"note":"Eroded and warped terrain."},
  "feat(terrain): the Terrain shader meets its layers by relief, hides their tiling and wets the waterline":
    {"note":"A richer Terrain shader."},
  "feat(water): the surface mirrors the world, and ripples, surf and foam behave on calm water":
    {"note":"Water mirrors the world."},
  "feat(foliage): plants keep out of the water and grass thins toward its far cells":
    {"note":"Plants keep out of the water."},
  "feat(examples): Terrain & Water has a HUD, a beach view and quality levels":
    {"internal":"An example's own script, scene and textures; what it shows is in the engine notes."},
  "feat(editor): the status bar shows what the engine is baking, with its progress":
    {"note":"Bakes run over frames, with progress."},
  "fix(editor): Play fetches the open data context only when the project has one, and the frame debugger lists each entity once":
    {"internal":"Console noise in the editor (a 404 and a duplicate-key warning); nothing a game does changes."},
  "fix(render): buffers growing to fit a frame log at debug, and a pass seats an input only where it reads one":
    {"internal":"Log levels and a guarded uniform write: the console no longer warns about normal buffer growth or a sky pass with no input texture; nothing drawn changes."},
  "perf(terrain): the Terrain shader reads only the layers the ground has, and the turned second reading only near the eye":
    {"note":"A richer Terrain shader."},
  "perf(examples): Terrain & Water grows its plants in fewer, larger cells and draws its ground at a lower detail":
    {"internal":"An example's own settings."},
  "feat(water): the water thins out at its edge into the ground behind, and its shore foam is broken up":
    {"note":"Soft water edges."},
  "fix(terrain): a chunk's skirt draws without the ground's relief, and the surf over dry ground stays a film":
    {"note":"Terrain skirts and surf films no longer show as streaks."},
  "fix(examples): Terrain & Water's viewpoints look at the lake, the river mouths and the river in the hills":
    {"internal":"An example's own camera poses."},
  "feat(render): a material's vertex hook hands the fragment the colour it leaves":
    {"note":"A vertex hook can hand the fragment a colour."},
  "feat(terrain): the ground is a CDLOD quadtree of one instanced patch read from height pages, and can go on for ever":
    {"note":"Terrain without cracks, and without end."},
  "test(editor): the terrain, foliage and water checks cut the ground by its cell size":
    {"internal":"Editor checks follow the Terrain fields that replaced chunks; they draw nothing new."},
  "feat(terrain): layers are read with hex tiling and a wide far reading, and their weights wander, so ground shows no repeat or ruled edge":
    {"note":"Terrain layers without repeat, and with natural edges."},
  "docs(terrain): the terrain pages describe the CDLOD ground, its pages, infinite extent and erosion":
    {"internal":"Documentation of features with their own notes."},
  "build(render): the embedded mesh shader carries the vertex-hook colour":
    {"internal":"The generated embed of a shader change that has its own note."},
  "docs: the procedural world plan records what the engine owes, where each part stands and how it is accepted":
    {"internal":"A planning document; nothing a creator can use yet."},
  "feat(terrain): ground without end comes from a versioned provider the game names, and a terrain that cannot get its ground fails":
    {"note":"Terrain from a generator the game names, versioned."},
  "feat(terrain): bodies collide with the ground drawn near the eye, built in tiles round what moves, and queries answer from the same triangles":
    {"note":"Terrain collision, the same ground that is drawn."},
  "fix(editor): the running game has a resolution picker you can actually reach":
    {"note":"The running game's resolution can be chosen."},
  "feat(residency): procedural chunks have one owner and the frame one budget; terrain collision and foliage cells are chunk layers":
    {"note":"Procedural chunks, with one owner and one budget."},
  "fix(terrain): a ridge's crest is rounded, so ridged ground worn by its noise is continuous":
    {"note":"Ridged ground without end has no steps."},
  "build(sdk): a shared declaration chunk named after an index module carries its hash":
    {"internal":"Declaration bundling: a second shared chunk named index was written as index.d2.ts, which TypeScript does not read as declarations."},
  "feat(worldgen): biomes, zones and layered recipes lay a world out as it is explored, with stable ids and kept changes":
    {"note":"Generated worlds."},
  "feat(editor): a WorldZone's circle or turned box is drawn on the ground":
    {"note":"Generated worlds."},
  "feat(water): the sea fills only what joins it, a body is water only over its ground, bodies carry stable ids, and basins show where water gathers":
    {"note":"Which water a place is."},
  "fix(render): a shadow is cast by what the camera's level of detail draws, and the terrain slides its vertices by the eye in every pass":
    {"note":"Shadows follow what the camera draws."},
  "feat(terrain): an area without a heightmap is a window on its provider's ground, and ground read from a provider stays the world's when its terrain moves":
    {"note":"An area without a heightmap is a window on its provider's ground."},
  "fix(water): rain rings out on the surface instead of denting the ripples, wind ripples are waves not noise, and storms raise sheltered water less":
    {"note":"Rain and storms on water."},
  "fix(water): water casts no shadow, a lake holds a river that runs into it, and the surf's slope fades on the ridge between shores":
    {"note":"A river runs into a lake cleanly, and water casts no shadow."},
  "feat(terrain): a ray meets the ground's triangles anywhere, with no physics and no collision tile there":
    {"note":"Rays against the terrain, anywhere."},
  "feat(worldgen): decoration has a far version past its layer's lodDistance, and leans with the ground when it is aligned":
    {"note":"Far versions for generated decoration."},
  "feat(terrain): modifiers change the ground for every reader and remake only what they reach, and a zone can level its plot":
    {"note":"Terrain modifiers, and zones that level their ground."},
  "feat(water): how far a dry place is from the water's edge, as a query and a field generated worlds read":
    {"note":"How far a place is from the water."},
  "feat(worldgen): world rules as a .esworld asset, checked on load, shipped with what they name and rebuilt on edit":
    {"note":"World rules as a file, with an editor."},
  "feat(editor): world rules editor for .esworld files":
    {"note":"World rules as a file, with an editor."},
  "fix(editor): world rules list selects like the folder tree":
    {"note":"World rules as a file, with an editor."},
  "feat(terrain): findPath asks whether a place can be walked to under a slope limit":
    {"note":"Whether a place can be walked to."},
  "feat(water): rivers cut their beds into the terrain":
    {"note":"Rivers cut their beds."},
  "feat(terrain): heightmaps name their format, and 16-bit grey PNGs are read at full depth":
    {"note":"Heightmaps say how they hold their heights."},
  "fix(water): the shore distance near the edge is a distance across the ground, not the water's depth":
    {"note":"The distance to the shore is a distance."},
  "fix(water): water meets the shore along a smooth line, not the zone's texel steps":
    {"note":"Water meets the shore along a smooth line."},
  "fix(water): a river fades into the sea or lake it runs into, so the surf is not cut along its sides":
    {"note":"A river gives way where it runs into the sea or a lake."},
  "fix(water): surf crests come in from open water as lines instead of tracing every turn of the shore":
    {"note":"Surf comes in from open water as lines."},
  "docs(water): surfHeight's comment within the prose limit":
    {"internal":"Comment length only."},
  "feat(water): foam bursts on steep shores and washes thinly up beaches, by how steep the shore is and how exposed the water":
    {"note":"Foam is where waves burst, not along every shore."},
  "fix(water): a gentle beach keeps less of the breakers' white than rock does":
    {"note":"Foam is where waves burst, not along every shore."},
  "feat(examples): Terrain & Water takes the lakewood detail set: denser crowns, conifers, ferns, bank grass, reed thickets, shoals and a sparkling lake":
    {"note":"A generated world's plants."},
  "feat(worldgen): a plant's far version may be its cheaper mesh, thinned by farKeep, so ground cover has a far level of detail":
    {"note":"A generated world's plants."},
  "feat(examples): Terrain & Water gets a flower sea, volumetric light and far ground cover":
    {"note":"A generated world's plants."},
  "feat(export): a packaged game reports what it is still baking, and the capture launcher can wait for it":
    {"internal":"An observation seam for capture tooling; no game behaves differently."},
  "feat(worldgen): the far versions of a world's plants are laid out in cells as wide as their shortest span allows, so ground cover far off costs far fewer draws":
    {"note":"A generated world's plants."},
  "feat(worldgen): a plant of a generated world leans with the ground where its member says attach: align":
    {"note":"A generated world's plants."},
  "feat(examples): Terrain & Water stones sit on the slope they stand on":
    {"note":"A generated world's plants."},
  "fix(cook): a cutout texture has its colour carried into its clear texels, so a leaf has no pale edge":
    {"note":"A leaf or a blade of grass no longer has a pale edge."},
  "feat(fog): the fog's beams follow the clouds of the sky, so a gap in them is a shaft":
    {"note":"Light beams that follow the clouds."},
  "feat(inspector): an effect's internal uniforms are not listed":
    {"internal":"Hides parameters the engine writes itself."},
  "feat(examples): Terrain & Water has a thin high haze whose beams follow the clouds":
    {"note":"Light beams that follow the clouds."},
  "feat(postprocess): a display LUT in the last pass grades the picture as the display shows it, after the output transform":
    {"note":"A Display LUT."},
  "feat(examples): Terrain & Water is graded warm by a display LUT":
    {"note":"A Display LUT."},
  "feat(worldgen): a part's soft turns the normals of a card that stands for a crown toward up":
    {"note":"A generated world's plants."},
  "feat(examples): Terrain & Water draws its trees as models out to 380 metres, and their cards are lit as crowns":
    {"note":"A generated world's plants."},
  "feat(examples): Terrain & Water takes the compact grass and the groundcover cards":
    {"note":"A generated world's plants."},
  "feat(sky): clouds may be drawn from a tileable coverage mask, and the shadows and beams read it too":
    {"note":"Clouds drawn from a coverage picture."},
  "feat(examples): Terrain & Water draws its clouds from the art's coverage masks":
    {"note":"Clouds drawn from a coverage picture."},
  "feat(inspector): an effect's internal textures are not listed either":
    {"internal":"Hides parameters the engine writes itself."},
  "fix(sky): a cloud mask's clouds are domes, and no longer smear into streaks seen low":
    {"note":"Clouds drawn from a coverage picture."},
  "fix(examples): Terrain & Water has a thin cloud layer, so its masked clouds do not streak":
    {"note":"Clouds drawn from a coverage picture."},
  "fix(examples): Terrain & Water takes the compact grass with its leaf colour from the art":
    {"note":"A generated world's plants."},
  "fix(lod): a skinned group whose stand-in the skeleton cannot pose is refused whole, a cull size or not":
    {"internal":"Restores the refusal a cull-only group had lost; nothing a creator could use changed."},
  "fix(editor-checks): the texture handle sample is taken again until its frame is drawn":
    {"internal":"A test race."},
  "feat(pipeline): a project can be made from a template on the command line, by the same code as the editor's New project":
    {"note":"Start a project from the command line."},
  "refactor(launcher): a new project is made by the pipeline's template code, shared with the command line":
    {"note":"Start a project from the command line."},
  "feat(templates): an Online 3D starter, a networked 3D game with a dedicated server that runs the same project":
    {"note":"An Online 3D starter."},
  "fix(postprocess): the last pass's header names the standard headers it uses, so it builds on Linux":
    {"internal":"A build fix for a header; nothing a creator could observe changed."},
  "fix(ci): the continuity gate and the effect-kind test follow the shared scaffold and the display stage":
    {"internal":"Gate and test follow the code they check."},
  "feat(editor): Create offers an Outdoor Environment, the sky, haze, clock and weather already pointing at one another":
    {"note":"An Outdoor Environment to create."},
  "feat(assets): an image shaped like a colour lookup table is adopted as data, uncompressed, unmipped and not sRGB":
    {"note":"A lookup table is adopted as data."},
  "test: regenerate the compiler's AOT fixtures the contract hash moved":
    {"internal":"Test fixtures follow the component layout."},
  "feat(tools): the arena server check takes a project of any width, a terrain provider and a TypeScript extension":
    {"internal":"A check script, not a creator-facing change."},
  "feat(editor): a project plugin may import the engine subpaths the editor is built on, so a game's generated ground shows in the viewport":
    {"note":"A game's generated ground shows in the editor."},
  "fix(scaffold): a new project's gitignore keeps its plugins and platform profiles versioned, and ignores only what the editor generates":
    {"note":"A game's generated ground shows in the editor."},
  "feat(render): a MeshInstances component draws one mesh at many places, and plants are grown as instances of it":
    {"note":"Plants are instances of one mesh."},
  "fix(ci): the static gates earlier reds hid pass again":
    {"internal":"Gate baselines and a module split; nothing a creator sees."},
  "fix(render): the per-object record texture is created from storage as tall as the texture, and a world that has aborted reports its despawns once":
    {"note":"Many placed objects no longer crash the renderer."},
  "fix(terrain): the paint weights stay exported from the terrain plugin module":
    {"internal":"A re-export the module split dropped."},
  "fix(render): resizing a viewport no longer piles up a set of render targets for every size it passes through":
    {"note":"Resizing a viewport no longer piles up render targets."},
  "feat(editor): the edit world lets go of a generated world while the game plays":
    {"note":"The editor lets go of a generated world while the game plays."},
  "fix(ci): the component reference lists MeshInstances and PlacedFoliage":
    {"internal":"Reference snapshot and doc links."},
  "feat(render): placed plants cast shadows only as far as twice their detailed distance":
    {"note":"Placed plants cast shadows only as far as twice their detailed distance."},
  "feat(render): a quality level sets how far plants keep their detail":
    {"note":"A quality level sets how far plants keep their detail."},
  "feat(worldgen): a layer plans the far versions of its plants sparsely, and a failed asset load is tried again":
    {"note":"A far world is planned sparsely, and a failed asset load is tried again."},
  "fix(editor): the editor's own eye shows the scene's post-processing, so the sky is in the viewport":
    {"note":"The editor's own eye shows the scene's post-processing."},
  "feat(terrain): the maths of ground on a cube sphere and the nodes drawn round an eye":
    {"internal":"The first layer of spherical terrain: pure maths and node selection, not yet drawn."},
  "fix(chunks): an answer from a worker is put in the world when it arrives, with no queue and no per-frame limit":
    {"internal":"The worker threads of this release, with no frame slicing."},
  "feat(worldgen): a planet's world and pages are worked out on worker threads":
    {"note":"A generated world on worker threads."},
  "feat(worldgen): a flat world over a terrain and its water is worked out on worker threads":
    {"note":"A flat world's generation on worker threads too."},
  "perf(chunks): the chunk and plant growth steps are measured as scopes, and the plan to move generation to worker threads":
    {"internal":"Profiler scopes and a design note."},
  "feat(terrain): a planet has a sea and a sky that follows the ground the camera stands on":
    {"note":"A planet's sea and sky."},
  "feat(worldgen): a generated world lays out over a planet's six faces":
    {"note":"A generated world on a planet."},
  "feat(terrain): a planet pulls bodies toward its centre and answers up, altitude and ground height":
    {"note":"A planet pulls and answers."},
  "feat(render): temporal history follows the render origin when it steps":
    {"internal":"The render origin of this release, extended."},
  "feat(render): the render origin covers every renderer and the terrain, water and sky shaders":
    {"internal":"The render origin of this release, extended."},
  "feat(render): a render origin keeps a large world's meshes, lights and probes precise":
    {"note":"A render origin for large worlds."},
  "feat(terrain): a planet's ground is drawn with the layers' textures":
    {"note":"A planet's ground has the layers' textures."},
  "feat(terrain): a planet's ground collides":
    {"note":"A planet's ground collides."},
  "fix(terrain): a planet's ground is one-sided and its fog is the ground's under it":
    {"internal":"A fix to the Planet and height fog of this release."},
  "feat(postprocess): height fog by height above a planet's sphere":
    {"note":"Height Fog by height above a planet."},
  "feat(terrain): a Planet component draws ground on a sphere from a provider that answers by direction":
    {"note":"A `Planet`: ground on a sphere."},
  "fix(terrain): a planet away from the origin is drawn where it stands and culled by the box it is drawn in":
    {"internal":"A fix to the Planet shader of this release."},
  "feat(assets): a project names folders its asset database leaves alone":
    {"note":"A project can keep folders out of its asset database."},
  "feat(worldgen): a plant part may cast no shadow, and far cells are capped at two cells wide":
    {"note":"Small plants need not cast a shadow."},
  "feat(editor): a project plugin that needs trust says so with a notice":
    {"note":"A project plugin that needs trust says so."},
  "test: the SDK test corpus type-checks again":
    {"internal":"Test typings."},
  "feat(water): two tiled, scrolling detail normal maps give the surface its sparkle":
    {"note":"Sparkle on the water."},
  "fix(lod): a LODGroup with only a cull size is no longer ignored":
    {"note":"A level-of-detail group with only a cull size is no longer ignored."},
  "feat(terrain): each terrain layer says how it meets the others, and the terrain's paint and bounds can be asked":
    {"note":"Each terrain layer says how it meets the others."},
  "feat(editor): a terrain layer's height blend, and a recipe member's plant":
    {"note":"Each terrain layer says how it meets the others."},
  "feat(foliage): PlacedFoliage keeps hand-placed plants as data in one entity, grown a cell at a time":
    {"note":"Placed plants."},
  "feat(worldgen): recipes place plants, grown a cell at a time with far versions, and a world on an area ends where the terrain does":
    {"note":"A generated world's plants."},
  "feat(examples): Terrain & Water grows its plants from world rules and the lakewood art":
    {"note":"A generated world's plants."},
  "feat(terrain): up to eight terrain layers with normal and mask maps, from .esterrainlayer files, blended by height":
    {"note":"Terrain layers: up to eight kinds of ground, each with its normal and mask maps."},
  "feat(editor): terrain layer editor and a Terrain's list of layers":
    {"note":"Terrain layers: up to eight kinds of ground, each with its normal and mask maps."},
  "feat(render): 2D texture arrays, created from layers and sampled by textureArray material params":
    {"internal":"Groundwork for the terrain's layer arrays: a game has no public call that makes an array yet, so the terrain change that uses it carries the note."},
  "feat(foliage): a plant can have a third mesh, and the trees of Terrain & Water do":
    {"note":"A third mesh for a plant."},
  "perf(render): a lit surface takes its shadow in fewer operations":
    {"note":"A lit surface takes its shadow in fewer operations."},
  "feat(render): the opaque scene can be drawn twice, depth alone first, so a pixel is shaded for the surface in front of it":
    {"note":"A depth prepass for the opaque scene."},
  "fix(render): a depth program seeds the samplers a vertex hook reads, so the terrain takes part in the depth prepass with its own heights":
    {"note":"A material's vertex hook reads its own textures when it casts a shadow."},
  "perf(water): the surface asks whether it is water before it works out the waves and the light":
    {"note":"The water surface leaves early where it is not water."},
  "perf(postprocess): the sky's clouds and the fog's shafts are worked out at half size and read back by depth":
    {"note":"The sky's clouds and the fog's light shafts cost a third of what they did."},
  "perf(render): a lit surface skips the light slots nothing shines from":
    {"note":"A lit surface no longer works out the light slots nothing shines from."},
  "perf(water): the sea reads the sun's shadow as one hard edge, not as a penumbra":
    {"note":"The sea takes the sun's shadow as one hard edge."},
  "perf(shadow): a sun's map leaves out the casters whose shadow cannot reach what the camera sees":
    {"note":"A sun's shadow map leaves out the casters that shade nothing the camera sees."},
  "fix(shadow): a caster narrower than the blocker search's gaps no longer vanishes from a wide shadow map":
    {"note":"A small caster no longer drops out of a wide shadow map."},
  "feat(render): shaders can compile without stopping the frame, and a tile-based GPU is told what a pass does not keep":
    {"note":"Shaders that compile without stopping the frame."},
  "feat(render): a loading screen can wait for the shaders, and the lit programs link a quarter faster":
    {"note":"Shaders that compile without stopping the frame."},
  "feat(render): a game can draw only the frames that can look different":
    {"note":"Drawing only the frames that can look different."},
  "feat(render): toon and matcap materials":
    {"note":"Toon and Matcap materials."},
  "feat(render): filled polygons and joined strokes as a path on a mesh":
    {"note":"Filled polygons and joined strokes."},
  "feat(render): an edge outline effect with a colour and creases":
    {"note":"Edge Outline, a coloured line at silhouettes and creases."},
  "feat(render): blob shadows, a soft disc on the ground under a thing":
    {"note":"Blob shadows."},
  "feat(render): sharpen works without a compute stage":
    {"note":"Sharpen on WebGL2."},
  'feat(math): a seeded random generator that gives the same numbers on every host':
    {"note":"A random generator that gives the same numbers on every host."},
  'feat(net): a session layer for online games that do not share a tick':
    {"note":"A session layer for online games that do not share a tick."},
  'feat(net): a session can be told to redial now and says why its link ended':
    {"note":"A session can be told to redial now, and says why its link ended."},
  'feat(export): a web build lists the origins its game connects to':
    {"note":"A web build can say which servers its game connects to."},
  'feat(ui): a text field can accept only digits':
    {"note":"A text field can accept only digits."},
  'feat(tools): optional third-party tools, pinned and fetched from the release mirror':
    {"note":"Optional tools a project switches on, fetched and checked by the engine."},
  'feat(tools): Protobuf, with .proto files turned into TypeScript types and a binary codec':
    {"note":"Protobuf as a second optional tool: .proto files become TypeScript types and a binary codec."},
  'feat(net): a session can speak protobuf, with the JSON wire kept for debugging':
    {"note":"A session can speak protobuf, with the JSON wire kept for debugging."},
  'feat(net): a protobuf message can be the wire form of a type the game already has':
    {"internal":"A follow-up inside the session protobuf feature, which has not shipped yet."},
  'feat(net): esengine/session exports the seeded generator':
    {"internal":"A follow-up inside the session protobuf feature, which has not shipped yet."},
  'fix(tools): a host that cannot read the engine version says so instead of asking the mirror for v0.0.0':
    {"internal":"A fix inside the optional tools feature, which has not shipped yet."},
  "perf(sdk): a blank mini-game package no longer carries terrain and water":
    {"note":"A blank mini-game package no longer carries terrain, water and timelines."},
  "perf(sdk): a blank mini-game package no longer carries timelines":
    {"note":"A blank mini-game package no longer carries terrain, water and timelines."},
  'fix(text): a Text spawned in Update is ordered in the frame it appears, not drawn under its panels for one frame':
    {"note":"A Text spawned in Update is ordered in the frame it appears."},
  'perf(render): the profiler can split the scene pass into a segment per shader, and the cost doc says what is in it':
    {"note":"Every render-graph pass has its own GPU time in the profiler"},
  'perf(render): each render-graph pass has its own GPU time, on WebGL2 and WebGPU, read through the profiler':
    {"note":"Every render-graph pass has its own GPU time in the profiler"},
  "fix(inspector): Transform stays on top when a component's section order does not list it":
    {"note":"Transform stays on top of the inspector."},
  'feat(inspector): an Offset side the layout drops is dimmed, with the reason in its tooltip':
    {"note":"An Offset side the layout drops is dimmed, with the reason in its tooltip."},
  "perf(ecs): one stable sort for every component type, 239KB off the engine wasm":
    {"note":"The engine's wasm is 239KB smaller, with no change to what it does."},
  "perf(render): a mesh draw finds its cached program without searching shader source":
    {"note":"A mesh draw no longer searches its shader's source or rebuilds a feature list"},
  "perf(render): writing one material uniform sends one value, and the float-target check is asked once":
    {"note":"Writing one material uniform sends that one value"},
  "perf(render): the GL device skips state sets and uniform-buffer binds the context already holds":
    {"note":"The GL device no longer sets state the context already holds"},
  "perf(render): instanced meshes that share a material draw together and merge":
    {"note":"Instanced meshes that share a material now draw together"},
  "perf(wasm): the module no longer carries a C++ stream library":
    {"note":"The web module is 144 KB smaller"},
  "feat(tools): a Configuration tables page to switch Luban on, install it with consent, and keep the generated files current":
    {"note":"Optional tools a project switches on, fetched and checked by the engine."},
  "feat(tools): a Protobuf block beside Luban on the Configuration tables page":
    {"note":"Protobuf as a second optional tool: .proto files become TypeScript types and a binary codec."},
  "fix(export): an export of a project that uses Luban builds its tables first":
    {"internal":"A fix inside the optional tools feature, which has not shipped yet."},
  "fix(tests): the Offset test types its unit as a number, and a temp-dir delete retries on Windows":
    {"internal":"A type annotation and a retry in tests; nothing a creator can observe."},
  "perf(tools): the engine's own shaders derive their WebGPU twin when read instead of committing it":
    {"note":"The engine's own examples and fixtures no longer commit a generated WebGPU shader twin"},
  "perf(tools): the engine's own examples and fixtures keep only the GLSL of a shader":
    {"note":"The engine's own examples and fixtures no longer commit a generated WebGPU shader twin"},
  "feat(editor): a project of the engine repo gets its shader twin derived as the file is served":
    {"note":"The engine's own examples and fixtures no longer commit a generated WebGPU shader twin"},
  "perf(render): the lens flare is worked out at half size and laid over the full-size picture":
    {"note":"Lens flare costs a third of what it did"},
  "perf(render): the sky's clouds are worked out at a quarter of the size":
    {"internal":"Taken back by the next change: the clouds are half size again, as before."},
  "perf(render): a frame of 2D sprites is not sorted again when its draw keys are the last frame's":
    {"note":"A frame of sprites is not sorted again when its draw keys have not changed"},
  "perf(ui): UI text is laid out when it changes and submitted by the engine every frame":
    {"note":"UI text costs less: labels are laid out when they change and submitted by the engine"},
  "perf(ui): the engine watches the world scale an automatic label picks its glyph pipeline from":
    {"note":"UI text costs a third less again"},
  "perf(tilemap): a tilemap that has not changed uploads nothing and copies no vertex":
    {"note":"Tilemaps that have not changed cost almost nothing per frame"},
  "perf(render): a draw that changes buffer no longer re-points its vertex attributes":
    {"note":"Fewer GL calls when a draw changes buffer"},
  "fix(render): the sky's clouds are worked out at half size again":
    {"internal":"Undoes the quarter-size clouds, which showed a coarse checkerboard in the cloud and streaks near the horizon."},
  "feat(render): a quality level can smooth edges temporally, and the temporal pass keeps more detail":
    {"note":"A quality level can smooth edges temporally."},
  "fix(ci): the changelog names the performance work and the notes name the commits that landed it":
    {"internal":"Repairs the release-notes ledger; no creator can observe it."},
  "fix(ci): world-streaming-3d is given the settle window its frame rate needs":
    {"internal":"A golden package's launch window; no creator can observe it."},
  "fix(ci): a golden package launch waits for its settle frames, and only gives up on a package that hangs":
    {"internal":"A golden package's launch window; no creator can observe it."},
  "feat(editor): the profiler's tables sort by the column header, and the systems list names a dozen":
    {"note":"The profiler's tables sort by their column header."},
  "fix(editor): the profiler's sort header keeps to the theme's grid and icon sizes":
    {"internal":"Spacing and icon size of the sort header added in the same release."},
  "fix(native): a terrain and a streamed world run on a device with no wasm heap and no AbortController":
    {"note":"A terrain and a streamed world run on the Android and iOS templates."},
  "fix(ci): the ledger names its own repair":
    {"internal":"Repairs the release-notes ledger; no creator can observe it."},
  "feat(render): the medium quality level smooths edges temporally by default":
    {"note":"The medium level uses it"},
  "fix(ci): the net modules build no TextEncoder at load, the API snapshots take the new surface, the retained-text harness reads its cases under node":
    {"internal":"Repairs the build: a module made a TextEncoder when the SDK loaded, which a native host does not have, and the API snapshots and one C++ harness's data path were out of date."},
  "feat(runtime): a project declares runtime tuning, and a build ships background shader compilation and on-demand drawing with the quality level off":
    {"note":"The engine's runtime tuning is a project setting."},
  "feat(editor): rows for background shader compilation, on-demand drawing, a level's smoothing, render resolution and server origins":
    {"note":"Rows for the choices that could only be written into the project file."},
  "fix(ci): the export result names the playable's html size the test reads":
    {"internal":"A type the playable size test needed; the value was already returned."},
  "fix(ci): the theme ratchet banks the inspector's new virtual-instance button":
    {"internal":"Moves a baseline count; no creator can observe it."},
  "feat(cocos): director.loadScene runs a project scene through the engine's scene manager (scenes are in the manifest, persistent roots are SceneOwner.persistent); components start in one phase before the frame's updates; Camera.screenPointToRay":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): getComponent finds a component by a base class it derives from, so a handler bound through the Button of a Toggle's node reaches it":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(ui): TextInput stands on a world rectangle as well as a UI node, and a Cocos EditBox becomes it: the importer folds the two labels into the field and the layer's EditBox is a view on it":
    {"note":"A text field can stand in the world."},
  "fix(ui): a pointer lands on what is drawn last by its place in the hierarchy, not on what was made last; a Toggle belongs to the container its parent holds and assigning isChecked switches its group's others off":
    {"note":"A pointer lands on what is drawn on top."},
  "fix(cocos): a Label takes a game's replaced string setter (the engine's _string and friends land on the Text), and an EditBox shows its text label while it holds text":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a play session that follows another in the same script runtime gets the layer's systems again and none of what the last one loaded":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a Label with no overflow rule does not wrap and is laid out from its anchor, as the node grows to the text in Cocos":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(render): layers painted in hierarchy order, so a panel covers the text of the panel under it; the Cocos UI layer uses it. Text takes an underline field; resources.load finds an image's spriteFrame and texture by path suffix":
    {"note":"A layer can be painted in hierarchy order."},
  "fix(cocos): a node's scripts load and enable as it joins an active parent or is switched, not a frame later; a converted script component's dropped fields are ignored quietly":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): resources.load gives images, sprite frames and audio by path, Sprite takes a spriteFrame, Node has getParent; the script entry leaves out the editor's own scripts":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): the generated script entry loads every component class of the project, since a game opens its views by class name":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): the session check also runs when a prefab is asked for":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): the layer drops what it kept of a session when the asset loader gives everything back":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a loaded asset is named for its file, and what the layer kept of a play session is dropped when the next begins":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a directory load leaves out what the layer cannot load instead of failing, and Component.EventHandler exists":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(assets): a scan reports how many documents it has read of how many":
    {"note":"The loading screens say how far they are."},
  "perf(assets): a scan keeps what each document refers to by what the file was, so a second scan of a large project reads nothing it has read; fix(cocos): a component is found by its cc. name and can be named by a script":
    {"note":"A second scan of a large project reads nothing it has already read."},
  "feat(shaders): the canonical vertex stage hands a mesh second uv set to a material, and a converted effect is one shader per macro combination, compiled and given its WGSL twin before it is written":
    {"note":"A material can read a mesh's second uv set."},
  "feat(shaders): a material vertex hook gets a derived WGSL twin, and an effect that displaces its vertices is converted with the displacement as that hook":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): a particle effect is converted on the engine particle stage, and a particle takes the converted material":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): the sprite texture is no parameter of a converted material, and a material blend state it does not set is the effect's":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): an effect includes its chunks and its vertex program is carried into the fragment, so the project materials convert for meshes as well as sprites":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): a project's own effect is converted to an Estella shader and material, so a sprite or mesh that wore it keeps its look":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): a sprite, a label and a graphics are UIRenderers, which accept the rebuild requests scripts send":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): the importer records its revision, so a project it wrote earlier is re-imported on open":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): director has a scheduler and fires its frame events, setSiblingIndex reorders through the engine entity order, loadAny takes a uuid, and an asset counts its holders":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): a root pinned to the screen is stored where the engine places it in the design box, so the document and the viewport agree":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "refactor(ui): the engine anchors run in two ordered passes and the Cocos Layout is a system between them, so alignment has one owner instead of a second hand-called copy":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): the project design resolution is known to scripts before they run, assetManager has a downloader and factory, and a node made between frames joins the running world":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): a converted project declares its script components for the editor and starts from the scripts, and the Cocos scripts bundle past the gaps Cocos tolerates (missing cc names, reassigned const, package files outside exports, preview-only imports)":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(release): escape the apostrophe in the Cocos re-import release-note key":
    {"internal":"Repairs a key of the release-notes ledger; no creator can observe it."},
  "feat(art): preserve Qinglan native sculpt revision and comparison":
    {"internal":"Source art studies kept in the repository's art/ folder; no part of the engine, the editor or a build reads or ships them."},
  "feat(gameplay): grid snapping and a placement check, and the entities nearest a point":
    {"note":"Grid placement, and what stands nearest."},
  "feat(art): add reversible Qinglan face candidate and review evidence":
    {"internal":"Source art studies kept in the repository's art/ folder; no part of the engine, the editor or a build reads or ships them."},
  "feat(engine): the device's battery and heat lower the frame cap and the quality level, by a policy the project names":
    {"note":"Save power when the battery is low or the device is hot."},
  "fix(text): a bitmap font's baseline comes from the font's own base over its size, not a 0.8em guess that put a 0.88 font four pixels high at 48px":
    {"note":"Bitmap fonts."},
  "feat(text): a glyph page is read by a mode — plain, distance field, mask, fill — so a bitmap font with its outline baked into the page draws in two passes with the ring in any colour; the Cocos import declares such fonts":
    {"note":"Bitmap fonts."},
  "feat(2d): a palette effect holds the whole picture to one set of colours, dithered":
    {"note":"A palette effect."},
  "fix(import): a Cocos bitmap font's page keeps its full size, not the 2048 default cap that halved a 4096 page and softened every glyph":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(2d): what walks leaves rings on water and prints on soft ground":
    {"note":"Footprints and ripples."},
  "feat(text): Text draws a bitmap font (.fnt) from its page texture, through the same layout as any font; widget prefabs regenerated for the Text box defaults":
    {"note":"Bitmap fonts."},
  "feat(text): TextOverflow.Shrink sets type smaller, a whole pixel at a time, until it fits its box; the Cocos import maps its Shrink labels to it":
    {"note":"Text can shrink to fit its box."},
  "feat(text): a world Text can lay out in its own box — width, height and an anchor pivot — so labels wrap, align and clip without joining a Canvas; the Cocos import uses it":
    {"note":"World content has a rectangle: `ContentRect`."},
  "feat(2d): plants of a sway material lean away from a body walking through them":
    {"note":"Mist, wind in the grass, and roofs that fade over the player."},
  "fix(import): a Cocos inactive node becomes the Disabled tag, so its subtree goes with it, instead of a dropped entity that strands its children":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(2d): a generated world on the screen plane, laid out by the worldgen rules and published in chunks":
    {"note":"A generated 2D world."},
  "fix(art): reject Qinglan face study after visual review":
    {"internal":"Source art studies kept in the repository's art/ folder; no part of the engine, the editor or a build reads or ships them."},
  "fix(import): Cocos enums as the engine's numbers, bitmapfont meta so the page ships, and the engine's own component validation in the test":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(2d): 2D shadows have eight channels and reach the tiled lights past the loop's sixteen":
    {"note":"More 2D lights cast shadows at once."},
  "feat(art): add editable Qinglan face cage study":
    {"internal":"Source art studies kept in the repository's art/ folder; no part of the engine, the editor or a build reads or ships them."},
  "feat(pipeline): import a Cocos Creator 3.x project as Estella prefabs and scenes, without touching the source":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(2d): a fog of war remembers what a viewer has seen, and a save can keep it":
    {"note":"What the player can see, and what they have seen."},
  "feat(2d): a viewer and the walls it cannot see through hide what is not lit":
    {"note":"What the player can see, and what they have seen."},
  "feat(mcp): a connect dialog for AI tools, with the permission decided by the editor (desktop ac014832)":
    {"note":"Connect AI tools to the editor from one dialog."},
  "feat(mcp): one-click add of the editor to Claude Code, Cursor and Claude Desktop (desktop b2cb78f3)":
    {"note":"Connect AI tools to the editor from one dialog."},
  "feat(art): add Qinglan xianxia character and human face studies":
    {"internal":"Source art studies kept in the repository's art/ folder; no part of the engine, the editor or a build reads or ships them."},
  "feat(2d): a cooked streamed world can be cut on x and y, so a 2D scene is a grid and not one row":
    {"note":"A 2D world streams on x and y."},
  "feat(2d): a streamed world is cut on x and y, and an infinite tile layer can let a chunk go":
    {"note":"A 2D world streams on x and y."},
  "feat(2d): a sprite that stands on the ground keeps the rain's rings and wet darkening off it":
    {"note":"Rain for a 2D scene."},
  "feat(2d): the samples across a soft shadow's light source are a quality setting":
    {"note":"A soft 2D shadow's smoothness is a quality setting."},
  "feat(2d): the rain shelter mask size is the effect's own field, and a quality level holds it lower":
    {"note":"Rain for a 2D scene."},
  "feat(2d): the rain's shelters are painted into a mask, so a scene has as many as it has roofs":
    {"note":"Rain for a 2D scene."},
  "feat(2d): lights that cannot meet share a channel of the 2D shadow mask, so a camp of torches all cast":
    {"note":"More 2D lights cast shadows at once."},
  "feat(2d): a light reaches a range of sprite layers, so a lamp in a hut does not light the roof over it":
    {"note":"A 2D light can keep to a range of sprite layers."},
  "feat(2d): rain that reads no depth, with rings and puddles on the ground and dry ground under a roof":
    {"note":"Rain for a 2D scene."},
  "feat(2d): mist, sprite wind and cover fade, so a top-down scene can have the weather a forest needs":
    {"note":"Mist, wind in the grass, and roofs that fade over the player."},
  "feat(prefab): ?expand-virtual leaves out an instance marked as another layout":
    {"note":"Virtual prefab instances."},
  "feat(ui): export deferredEntities and deferredRecord, for a game that keeps two layouts as virtual instances":
    {"note":"Virtual prefab instances."},
  "feat(prefab): ?expand-virtual makes virtual instances whole, for a harness that expects every node at boot":
    {"note":"Virtual prefab instances."},
  "feat(prefab): virtual instances, seen when authoring and made when they are used":
    {"note":"Virtual prefab instances."},
  "feat(ui): UIPages, pages of a UI that exist only while they are wanted":
    {"note":"UI pages that exist only while they are wanted: `UIPages`."},
  "perf(ui): GearApplySystem does not run in a frame where nothing it reads changed":
    {"note":"UI gears cost nothing on a frame where nothing they read changed."},
  "fix(export): a playable that is far over its cap is built at once and reports its size":
    {"note":"A playable far over its size cap is built at once and says its size."},
  "fix(editor): the project watch is quiet while a Cocos re-import writes, and the project is refreshed once at the end":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(editor): a selection draws nothing over the running game unless Inspect is on; a new one shows where it is for a moment":
    {"note":"A selection stays off the running game unless Inspect is on."},
  "feat(editor): the engine step of the loading screen shows which step of the boot it is in":
    {"note":"The loading screens say how far they are."},
  "feat(editor): the loading screens say how far they are: one bar, a line per step with its count and time, and the time so far":
    {"note":"The loading screens say how far they are."},
  "feat(cocos): the import progress has a stage for checking the converted effects":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(editor): the status strip keeps each readout on one line and drops the long message and the least useful readouts when it is short of room":
    {"note":"The status strip fits a narrow window."},
  "feat(cocos): a project converted by an older importer is brought up to date when it is opened":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(test): the MCP client adapter checks run under the throwaway home, so they no longer touch the real VS Code config on Windows":
    {"internal":"Points the MCP client adapter tests at a throwaway home directory; no creator can observe it."},
  "refactor(editor): the edit world reads the screen fit from the one runtime config derivation instead of deriving it a second time":
    {"internal":"The edit world reads the screen fit from the one runtime config derivation; the fit it lays out in is the next fix's, and this changes nothing on its own."},
  "fix(editor): the edit world lays UI out in the project fit, so a root pinned to the screen takes the design box instead of the viewport pixels":
    {"note":"The edit viewport frames and lays out the scene as the game does."},
  "fix(viewport): the design and device frame is drawn round the camera that shows the scene, so a project whose camera is off the origin sees the frame where the camera looks":
    {"note":"The edit viewport frames and lays out the scene as the game does."},
  "fix(play): a project script bundle that throws while it loads is logged instead of looking like no bundle":
    {"note":"A project script bundle that throws while it loads is reported."},
  "fix(cocos): the schema extractor resolves cc, so a converted project's components reach the inspector":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): the conversion progress window carries the editor icon, has no scrollbar, and speaks the editor language":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): converting a Cocos project runs on a thread of its own with a progress bar, so the editor no longer looks hung":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(editor): settings rows for the power-saving policy":
    {"note":"Save power when the battery is low or the device is hot."},
  "fix(editor): the connect dialog and its status-bar mark use the editor's own components and tokens":
    {"note":"Connect AI tools to the editor from one dialog."},
  "fix(editor): the status bar's AI agent mark waits for the bridge it reads from":
    {"note":"Connect AI tools to the editor from one dialog."},
  "feat(editor): one dialog connects AI tools, and the editor grants what an agent may do live":
    {"note":"Connect AI tools to the editor from one dialog."},
  "feat(editor): the editor adds itself to the AI tools on the machine, one switch each":
    {"note":"Connect AI tools to the editor from one dialog."},
  "feat(editor): the streamed-world grid follows the plane a world is cut on":
    {"note":"A 2D world streams on x and y."},
  "feat(editor): the quality page sets how many samples a soft 2D shadow is drawn with":
    {"note":"A soft 2D shadow's smoothness is a quality setting."},
  "feat(editor): the quality page sets the largest 2D rain shelter mask a level allows":
    {"note":"Rain for a 2D scene."},
  "feat(editor): make a prefab instance virtual from the inspector or the outliner":
    {"note":"Virtual prefab instances."},
  "fix(shaders): an #if or #elif condition resolves in WGSL assembly and in the twin generator, so a lit material's WebGPU program no longer carries a directive into the source":
    {"note":"Lit materials draw on WebGPU again."},
  "fix(preview): a LAN preview may connect to any server, as Play may":
    {"note":"A scanned preview reaches the game's own server."},
  "fix(bundle): the official-package and Cocos resolvers step aside for one shared marker, so a subpath of an official package no longer resolves forever":
    {"note":"A subpath of an official package resolves."},
  "refactor(ui): the anchoring arithmetic is a module of its own, so the Cocos importer uses it without compiling the engine into the pipeline's typecheck":
    {"internal":"a module split; the arithmetic and the component behave as before"},
  "fix(cocos): a launched scene has its scripts loaded and enabled before its callback, and the scene before it goes; an instance's mounted components land on the prefab it names; Node.forward/up/right/worldMatrix and the rest of Vec2/Vec3/Quat/Color/Vec4/Mat4 a game calls":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(render): a material mesh reads its own tangents on WebGL again":
    {"internal":"undoes a regression from after 0.96.0 that no release carried"},
  "fix(editor): the loading screens take the type scale and the shadow token, and the play overlay's stop is a Button":
    {"note":"The loading screens say how far they are."},
  "fix(render): a fragment-only material's vertex stage declares its position invariant, so its colour lands on its prepass depth on Metal":
    {"note":"The ground has no dark patches on a Mac."},
  "fix(render): seeding a material's samplers skips the ones a program optimized out, instead of warning of a typo for each":
    {"note":"No \"uniform not found\" warnings for a texture a program does not read."},
  "fix(terrain): the layer arrays are composed again after a device loss instead of kept as a CPU copy":
    {"note":"A terrain with texture layers no longer keeps a second copy of them in memory."},
  "fix(build-tools): --debug builds a debug engine; --release, always on, overrode it":
    {"internal":"the build command's debug switch; no engine change"},
  "fix(editor): the content browser grid reads a scroller the dock has not attached yet as having no padding, not a NaN width":
    {"note":"No \"NaN is an invalid value for height\" error when a project opens."},
  "fix(render): a frame refused for a lost device starts empty and collects nothing, so its staging no longer grows until an allocation stops the module":
    {"note":"A web game comes back after the GPU goes away."},
  "fix(render): a restored WebGL context is given its extensions again before the device probes what it can do":
    {"note":"A web game comes back after the GPU goes away."},
  "fix(terrain): the page atlases are owed after a device loss, so their refill runs and the ground comes back":
    {"note":"A web game comes back after the GPU goes away."},
  "fix(postprocess): rain darkens a slope and a leaf as it does the flat, so a hillside in the rain is not cut into pale wedges":
    {"note":"Rain wets hillsides and plants, not only flat ground."},
  "feat(render): TextureAtlas packs several textures onto one canvas at run time, and RectAnchors, AnchorFlag and AnchorMode are exported from the package root":
    {"note":"Pack several textures onto one canvas at run time: `TextureAtlas.pack`."},
  "fix(physics3d): a contact point is given in the units of Transform, as a ray hit is, so the debug draw crosses land where the bodies met":
    {"note":"A 3D contact point is in the units of `Transform`."},
  "fix(cocos): a converted effect reads the tangent varying the engine fragment prelude declares, instead of declaring it again":
    {"internal":"corrects a converted Cocos effect that no release has shipped yet"},
  "fix(cocos): macros the code only reads are baked into a converted shader, and effects written as GLSL main() programs convert: 17 of the 22 effects that were not converted now are":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): a mesh of several primitives is drawn whole with the material of each slot, an effect's outline pass is drawn as a second renderer, skinned parts take their material override, and a macro that defines functions is no longer cut up by the pruning":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): a converted effect's ambient parameters start at what most of the project's game scenes set, so a fake-lit material is not brighter than the game draws it":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a converted effect encodes its output for the display in the gamma colour space, and a converted material is not tinted twice by the renderer":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): a material put on a part of a model instance reaches that part: the part is told by the id of its renderer, read from the editor library":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(assets): a model texture named by a path on the artist machine is found by its name beside the model, instead of left as a path that is not there":
    {"note":"A model texture the project does not have is left off."},
  "feat(render): TextureCanvas — a blank texture textures are pasted into at pixel positions, then shown on a Sprite; with an example and docs":
    {"note":"Paste textures onto a blank texture: `TextureCanvas`."},
  "fix(cocos): a node answers _components with its script instances, so a project that prepares a new instance's nodes before parenting it reaches them":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): a scene's linear fog becomes a global distance-fog volume, and the scene settings report counts only those that are switched on":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): recompileShaders makes the material take the permutation of its shader that has the macros applied, now, instead of only recording them":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(assets): shrinking a texture to its Max Size keeps the colour of a footprint that is clear all through, instead of black: a weight map holds its numbers under a clear alpha":
    {"note":"A texture keeps the colour under its clear texels when it is made smaller or read back."},
  "fix(cocos): only a map-sized texture that is clear and coloured is kept as data, and the meta an earlier import wrote for one that is not is taken away":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): only a texture a material samples, whose clear texels hold several colours, is kept as data: a sprite's white or black bleed is not numbers":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a texture that keeps its colour under a clear alpha holds numbers, and is imported uncompressed and not as sRGB, so a terrain's weight map reaches its shader as it was painted":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(assets): a texture made smaller to fit its budget keeps the colour under its clear texels: the resize was left to premultiply, which turned a terrain's weight map black":
    {"note":"A texture keeps the colour under its clear texels when it is made smaller or read back."},
  "fix(assets): a decoded bitmap is read back through a texture instead of a 2D canvas, so the colour of a texel whose alpha is clear survives: a terrain's weight map came out black everywhere it was clear":
    {"note":"A texture keeps the colour under its clear texels when it is made smaller or read back."},
  "fix(cocos): a mesh whose converted material blends is imported as not opaque, so the engine draws it with blending: a fog that fades out was drawn black where it should have been clear":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(assets): the plane of Cocos imports as builtin:cocos-plane, 10 across like the one effects were written against, so what an effect reads of its position in the mesh's own space has the scale it expects":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a material's property that is a lane of a vec4 uniform (fogLayerBlend is fogParams.x) is written under the uniform, so the values an artist set reach the shader instead of the effect's defaults":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(assets): builtin:map-plane is the plane with its texture's v running along +z, and a Cocos plane imports as it, so a map laid over one lands where it was drawn":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(shaders): a mesh shader that declares MESH_LOCAL_POSITION is handed the mesh's own position by the canonical vertex stage, and a converted effect that reads its vertex position in model space asks for it":
    {"internal":"a vertex-stage input only the Cocos importer's converted effects ask for; the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a vertex program that reads light-probe data only under the probe macro converts, since a material is given none: the terrain effect that draws the ground was refused for it":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a converted shader that has been given its derived WGSL twin is still the importer's own, so a re-import updates it instead of keeping it as the creator's edit":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a converted effect's uniform that properties are lanes of starts as those lanes put together, so a fragment that scales by it no longer draws black":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): a scene's ambient light becomes an Ambient light entity, so a lit mesh is no longer black":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a converted effect declares the tangent varying it reads again: without it every effect failed its glslang check (294 not converted in the Cocos client) and its materials came out empty":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): Material.setProperty takes a texture a script hands it by name, from an image or the frame that holds one, so the fog's region mask reaches its shader":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): renderer.scene.CameraProjection has Cocos's numbers, so a script that tells an orthographic camera from a perspective one by it gets the right answer":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(camera): a full-frame camera that clears no colour is drawn over the main view instead of competing to be it, so a UI camera no longer hides the world camera's picture":
    {"note":"A camera that clears no colour is drawn over the main view."},
  "fix(cocos): a camera keeps what it clears: the UI camera clears depth only, so the world camera's picture is no longer wiped by it":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): onLoad waits for the node to be active in the hierarchy, a base of the built-in views (UIRenderer) is found through the one the node holds, and Node.insertChild":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): Node.setWorldRotation, setWorldRotationFromEuler, setWorldScale, rotate, translate, lookAt, inverseTransformPoint, walk and NodeSpace, as a script calls them":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a prefab is handed over with the prefabs its scripts hold in Prefab fields, and Material.recompileShaders sets the shader's switches":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(cocos): a @ccclass class that is not a component is not driven as a script, so the frame loop no longer calls timers it does not have":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): PhysicsSystem.instance.raycast and raycastClosest cross the world's box colliders as oriented boxes, nearest first, with the point and face met":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "feat(cocos): BoxCollider and Collider are views on the engine's BoxCollider3D, in the node's units, with the static body a collider without a rigid body is":
    {"internal":"the Cocos importer and compatibility layer are held on the cocos-import branch and are not in this release"},
  "fix(play): the connections a play session opened are closed when it ends, so the next session does not log in as an account that is still connected":
    {"note":"Stopping Play closes the connections the game opened."},
  "fix(editor): a drop on an Outliner row lands even when it beats the hover's render; it asks for its own answer when the stored one is for another row":
    {"note":"A drop on an Outliner row lands."},
  "fix(editor): a play that cannot start prints every compile error to the output log, and the status line carries the reason, not only that it failed":
    {"note":"A play that cannot start says why."},
  "fix(api): a released const that gained readonly properties keeps its promise":
    {"internal":"the API baseline check reads an additive const as additive; nothing a creator uses changed"},
  "fix(assets): a core with no resource manager does not load authored asset paths":
    {"internal":"a headless core used by the engine tests; a game always has a resource manager"},
  "fix(ci): the API snapshots carry PhysX and the JS engine; Linux fetches no Windows V8":
    {"internal":"CI snapshots and the Linux build fetch; nothing that ships changed"},
  "fix(ecs): world.set reads a vector written before it grew an axis":
    {"note":"Commands inside a query."},
  "feat(android): PhysX is its own library, packed only for a PhysX project":
    {"note":"PhysX as a second 3D solver."},
  "feat(native): PhysX runs on Windows, Linux and Android hosts, beside Jolt":
    {"note":"PhysX as a second 3D solver."},
  "feat(physics3d): PhysX as a second 3D backend, chosen per project, set up like Unity":
    {"note":"PhysX as a second 3D solver."},
  "feat(web): the JavaScript engine is opt-in — Project Settings → Web → Run without WebAssembly":
    {"note":"A web game can run in a browser without WebAssembly."},
  "feat(web): a browser without WebAssembly runs the game — the engine also ships as JavaScript":
    {"note":"A web game can run in a browser without WebAssembly."},
  "fix(export): an exported web game's long music plays — its CSP allows blob: media":
    {"note":"Long music plays in an exported web game and in Play."},
  "feat(android): an APK deflates its native libraries — an empty project is 20 MB, not 54":
    {"note":"An Android APK is less than half the size."},
  "fix(native): a phone runs the scripts a browser runs — V8 with Intl, and TextEncoder":
    {"note":"The Windows and Android hosts run the game"},
  "fix(android): the 60 fps frame-rate hint reaches the system on current Android":
    {"note":"A native game runs at the frame rate it asks for."},
  "fix(android): the V8 host boots on a phone, and compiled systems install there":
    {"note":"The Windows and Android hosts run the game"},
  "fix(text): a bitmap glyph's outline is the glyph grown, not eight stamped copies of it":
    {"note":"A bitmap glyph's outline is the glyph grown,"},
  "feat(native): the Windows and Android hosts run the game's JS on V8, with its JIT":
    {"note":"The Windows and Android hosts run the game"},
  "fix(native): an embedded shader is cut into literals MSVC can hold, and the check sees delimited ones":
    {"internal":"lets the Windows host compile; a shipped host behaves the same"},
  "feat(ui): pointerEvents Receive takes the pointer back under a None ancestor":
    {"note":"`pointerEvents: Receive` under a `None` ancestor."},
  "perf(app): a single system can sit out the frames it has nothing to do in":
    {"note":"Systems and plugins with nothing to do cost nothing."},
  "feat(aot): an Android package runs its @compiled systems as machine code":
    {"note":"An Android package runs its `@compiled` systems as machine code."},
  "feat(history): Undo run takes back a whole agent run in one click":
    {"note":"History shows where an agent run began"},
  "feat(history): agent runs are marked in History, file undo is kept by space, captures stop at 1568 px":
    {"note":"History shows where an agent run began"},
  "perf(app): seven more subsystems sit out the frames a scene gives them nothing to do":
    {"note":"Systems and plugins with nothing to do cost nothing."},
  "fix(mcp): the connection survives an editor that fails to start, and tells the agent how to work":
    {"note":"The MCP connection survives an editor that fails to start"},
  "feat(app): Plugin.activeWhen — a plugin whose components no entity has costs nothing per frame":
    {"note":"Systems and plugins with nothing to do cost nothing."},
  "feat(mcp): a local log of which tools fail; the guide says how undo, permissions and progress work":
    {"note":"An agent call over MCP is one undo step, files included."},
  "feat(mcp): agent calls are undo steps with their files, tools carry annotations, long calls send progress":
    {"note":"An agent call over MCP is one undo step, files included."},
  "feat(shaders): the cook derives every shader's WGSL twin where the host ships the converters":
    {"note":"Every shader's WGSL twin is derived as it is read."},
  "feat(scene): sceneOutOfBandFields names what a component carries beside its fields":
    {"note":"`sceneOutOfBandFields`."},
  "fix(textures): atlas pages fill their clear texels too, and solid art is not taken for premultiplied":
    {"note":"A transparent edge shows no dark fringe."},
  "fix(textures): a transparent edge no longer shows a dark fringe":
    {"note":"A transparent edge shows no dark fringe."},
  "feat(assets): a package carries the assets its scripts name, and says which file it lacks":
    {"note":"An asset path written into a component while the game runs is loaded."},
  "feat(editor)!: remove the built-in agent; plugin agent tools reach MCP clients":
    {"note":"The editor no longer has an agent of its own."},
  "feat(camera): orthoSize stays the zoom under a design-resolution fit":
    {"note":"`orthoSize` stays the zoom under a design-resolution fit."},
  "feat(input): MouseButton.Left / Middle / Right":
    {"note":"`MouseButton.Left`, `Middle` and `Right`."},
  "fix(sdk): the shipped .d.ts files keep real names between their chunks":
    {"note":"The shipped `.d.ts` files keep real names between their chunks."},
  "feat(scene): SceneManager.getLoading and whenLoadsSettle":
    {"note":"`SceneManager.getLoading` and `whenLoadsSettle`."},
  "fix(text): a label's shadow and outline fade with its own colour alpha":
    {"note":"A bitmap glyph's outline is the glyph grown,"},
  "fix(ui): every Interactable carries its UIInteraction from the frame it appears; one exported game hit test":
    {"note":"A UI press lands on the frame a control appears."},
  "feat(assets): an asset path written into an engine component at run time is loaded into its handle":
    {"note":"An asset path written into a component while the game runs is loaded."},
  "fix(ecs): a Mut row kept past the loop stays live until the system returns":
    {"note":"Commands inside a query."},
  "fix(ecs): cmds.spawn(...).id() inside a query reserves the id instead of throwing":
    {"note":"Commands inside a query."},
  "fix(shader): a reserved #pragma param says how to read the uniform it shadows":
    {"note":"A reserved `#pragma param` says how to read the uniform it shadows."},
  "feat(mcp): frame stats carry what texture streaming holds; the MCP docs say when the editor starts":
    {"note":"Mesh textures stream to the size their views need."},
  "feat(app): App.setRunInBackground keeps the loop going while the page is hidden":
    {"note":"`App.setRunInBackground`."},
  "fix(debug): device_screenshot reads a native build's frame back":
    {"note":"More of the editor answers over MCP."},
  "feat(export): a web build ships a small copy of each texture a mesh draws, and streaming fetches the file only once a view needs more":
    {"note":"Mesh textures stream to the size their views need."},
  "fix(assets): a cooked MP3 starts with its first frame, not the encoder's flush bytes":
    {"note":"A cooked MP3 starts with its first frame,"},
  "feat(render): uvRectFromPixels, the one pixel-rect to UV conversion, and docs for y-up UV space":
    {"note":"`uvRectFromPixels`."},
  "fix(render): a material's sprites no longer merge across textures":
    {"note":"A material's sprites no longer merge across textures."},
  "fix(ui): nine-slice borders reach the native core, and a short box keeps its corners round":
    {"note":"Nine-slice borders reach the native core,"},
  "feat(camera): CameraView.pointerToWorld / pointerRay take the pointer as Input reports it":
    {"note":"`CameraView.pointerToWorld` and `pointerRay`."},
  "fix(camera): CameraView and PresentedCameraView are published on the native core too":
    {"note":"`CameraView.pointerToWorld` and `pointerRay`."},
  "feat(assets): a texture a mesh draws starts small while texture streaming is on, and grows to what its views need":
    {"note":"Mesh textures stream to the size their views need."},
  "feat(render): texture streaming holds each mesh texture at the size its views need, measured per draw from the mesh's UV density, and moves it behind the same handle":
    {"note":"Mesh textures stream to the size their views need."},
  "feat(render): an Impostor stands a picture of its mesh in once it is small, taken from many directions by the engine's own cameras and drawn as one batched card per view":
    {"note":"Impostors."},
  "feat(render): Billboard turns a mesh to each view that draws it, flat in the view plane or upright about world up, without writing its Transform":
    {"note":"Billboards."},
  "feat(render): the device counts every draw a frame asks of the GPU, every pass included, and a quality level holds a draw call budget against it":
    {"note":"A draw call budget per quality level."},
  "feat(gameplay): FirstPersonController looks, walks, jumps and crouches in a CharacterController3D; FirstPersonViewModel draws a held thing with a second camera so it does not go through walls":
    {"note":"A first-person controller."},
  "feat(physics3d): RagdollJoint gives a bone no body or limits of its own; the ragdoll plan is shared with the editor, which draws it":
    {"note":"Ragdolls."},
  "feat(spline): a terrain band's lip can be drawn with an image repeating along the surface; PathFollower is shown to answer a timeline track or graph node by property path":
    {"note":"Move along a spline, and a 2D ground along one."},
  "feat(physics3d): a ragdoll's knees and elbows are one-way hinges, folding back and forward from the pose they start in":
    {"note":"Ragdolls."},
  "feat(physics3d): a ragdoll's joints are limited by their part of the body (spine stiff, shoulder loose, shin almost a hinge), read from bone names":
    {"note":"Ragdolls."},
  "feat(import): far LOD levels may collapse across borders and seams and shed specks, so they reach their budget":
    {"note":"Far LOD levels reach their budget."},
  "fix(physics3d): a ragdoll keeps the animation running and puts the bodies' pose over it, finds a skin below its entity, and defaults to looser limits":
    {"note":"Ragdolls."},
  "feat(physics3d): Ragdoll turns a skinned character's bones into jointed bodies and blends back to the animation":
    {"note":"Ragdolls."},
  "fix(spline): TerrainBand2D and PathFollower pull the spline module into a build; a band rebuilds a mesh the editor cleared":
    {"note":"Move along a spline, and a 2D ground along one."},
  "feat(spline): TerrainBand2D draws a 2D ground along a Spline, with a surface lip and an optional chain collider":
    {"note":"Move along a spline, and a 2D ground along one."},
  "feat(spline): PathFollower moves an entity along a Spline at a steady speed (once, loop, ping-pong)":
    {"note":"Move along a spline, and a 2D ground along one."},
  "feat(native): the target frame rate reaches the host, which paces its display-driven loop to it":
    {"note":"A native game runs at the frame rate it asks for."},
  "fix(android): ask the system for 60 fps and clock frames by the vsync timestamp":
    {"note":"A native game runs at the frame rate it asks for."},
  "feat(terrain): brushes change an area's ground in place, with the pages made again only where a stroke reached":
    {"note":"Terrain brushes."},
  "fix(desktop): graph wires take Unreal's spline, a pinned tilemap mode has a way out, and dev keeps the main-process externals":
    {"note":"Tilemap mode has a way out."},
  "fix(viewport): a camera move wakes the paint that carries it":
    {"note":"A camera move in the viewport always repaints."},
  "fix(material): a live texture edit keeps drawing once the texture's cooked form lands":
    {"note":"A live texture edit keeps drawing once the texture's cooked form lands,"},
  "fix(checks): the editor checks run a fresh English profile and wake the lazy editor":
    {"internal":"an editor or engine check, which a creator does not run"},
  "fix(checks): collider3d-gizmo measures the dimmed wire by its ink, not by bright pixels":
    {"internal":"an editor or engine check, which a creator does not run"},
  "fix(checks): gizmo checks follow the orthoSize rule and the plane handles' new place":
    {"internal":"an editor or engine check, which a creator does not run"},
  "fix(scripts): a shipped editor type-checks with the TS standard library":
    {"note":"A packaged editor type-checks scripts with TypeScript's standard library,"},
  "fix(settings): an Android package carries PhysX only when it is chosen":
    {"note":"PhysX as a second 3D solver."},
  "fix(settings): the 3D solver note says native apps run the chosen solver":
    {"note":"PhysX as a second 3D solver."},
  "feat(settings): Project Settings → Physics → 3D solver picks Jolt or PhysX, and Play runs the one chosen":
    {"note":"PhysX as a second 3D solver."},
  "feat(settings): Web packaging can carry the JavaScript engine — off by default":
    {"note":"A web game can run in a browser without WebAssembly."},
  "fix(play): a streamed clip plays in Play — the realm's CSP allows blob: media":
    {"note":"Long music plays in an exported web game and in Play."},
  "feat(packaging): Android setting to compress the APK's native libraries (on by default)":
    {"note":"An Android APK is less than half the size."},
  "fix(ui-inspect): the pointer verdict asks the nearest decided node, so Receive under None reads as hit":
    {"note":"`pointerEvents: Receive` under a `None` ancestor."},
  "feat(build): the Package dialog says when an Android export needs the NDK for compiled systems":
    {"note":"An Android package runs its `@compiled` systems as machine code."},
  "feat(history): Undo run takes back a whole agent run in one click":
    {"note":"History shows where an agent run began"},
  "feat(history): an agent's undo reaches as far back as space allows, and History shows where its run began":
    {"note":"History shows where an agent run began"},
  "fix(mcp): an editor that fails to start is a tool error; the server tells a session how to work":
    {"note":"The MCP connection survives an editor that fails to start"},
  "feat(mcp): capture_viewport realm play reads the running game's own frame back":
    {"note":"More of the editor answers over MCP."},
  "feat(mcp): a local log of which tools fail, and a summary of it":
    {"note":"An agent call over MCP is one undo step, files included."},
  "feat(mcp): edit_controller and set_gear_binding author UI controllers and gears":
    {"note":"More of the editor answers over MCP."},
  "fix(mcp): take back two tools another session's work-in-progress lent my last commit":
    {"internal":"reverted tools that a previous commit lent by mistake; no release carried them"},
  "feat(mcp): arguments are checked all the way down, and the error names where":
    {"note":"An agent call over MCP is one undo step, files included."},
  "feat(shaders): a project shader's WGSL twin is derived as it is read, in a packaged editor too":
    {"note":"Every shader's WGSL twin is derived as it is read."},
  "feat(mcp): a long call tells the client it is still running":
    {"note":"An agent call over MCP is one undo step, files included."},
  "feat(mcp): every tool carries MCP annotations from its effect":
    {"note":"An agent call over MCP is one undo step, files included."},
  "feat(mcp): one agent call is one undo step, and its files go back with it":
    {"note":"An agent call over MCP is one undo step, files included."},
  "fix(mcp): set_field on a MeshRenderer's inline geometry says what to use instead":
    {"note":"An agent call over MCP is one undo step, files included."},
  "fix(editor): the editor shows a texture's shipped image, not only its KTX2":
    {"note":"A live texture edit keeps drawing once the texture's cooked form lands,"},
  "feat(build): the size report names assets that ship because the scripts name them":
    {"note":"An asset path written into a component while the game runs is loaded."},
  "feat(editor)!: remove the built-in agent; plugin agent tools are served over MCP":
    {"note":"The editor no longer has an agent of its own."},
  "fix(mcp): step waits for scene loads in flight and names them":
    {"note":"More of the editor answers over MCP."},
  "fix(mcp): a play_input click presses on the first frame it is given":
    {"note":"More of the editor answers over MCP."},
  "fix(mcp): click_ui confirms its target with the game's hit test":
    {"note":"More of the editor answers over MCP."},
  "feat(mcp): the everyday tools are listed from the start and the rest in groups enable_tools turns on; every tool stays callable by name":
    {"note":"More of the editor answers over MCP."},
  "refactor(mcp): the fourteen longest tool descriptions say the same in about half the words":
    {"internal":"tool descriptions read shorter; what each tool does is unchanged"},
  "feat(mcp): the editor starts on the first tool call, not before the handshake; get_stats answers for the running game; a probe has the SDK as sdk":
    {"note":"More of the editor answers over MCP."},
  "fix(play): Play keeps running in a hidden or background editor window":
    {"note":"Play keeps running in a hidden or background editor window,"},
  "fix(scripts): the shipped editor carries TypeScript's standard library, so check_scripts stops reporting 'Cannot find name Math'":
    {"note":"A packaged editor type-checks scripts with TypeScript's standard library,"},
  "fix(project): text writes publish whole files, so a reader never sees a half-written manifest":
    {"note":"A project manifest is never seen half-written."},
  "fix(export): an export that does not name an option takes what the Package dialog saved":
    {"note":"An export that does not name an option takes what the Package dialog saved."},
  "fix(editor): fitting a sprite to its texture never overwrites a size written after the texture":
    {"note":"Fitting a sprite to its texture never overwrites a size written after the texture."},
  "fix(play): a new Play reads textures as they are on disk now":
    {"note":"Play keeps running in a hidden or background editor window,"},
  "feat(checks): texture-streaming says what a build with small copies would fetch once settled; the streaming setting names the download it saves":
    {"internal":"an editor or engine check, which a creator does not run"},
  "feat(history): an edit made through an MCP tool is recorded as automation's, and an on-disk change reloads the scene without asking when those are the only unsaved steps":
    {"note":"More of the editor answers over MCP."},
  "feat(checks): texture-streaming reads the memory a scene first comes up in":
    {"internal":"an editor or engine check, which a creator does not run"},
  "feat(settings): a quality level streams its mesh textures within a budget, checked on dusk-fort and bistro; the mip-need library is typed":
    {"note":"Mesh textures stream to the size their views need."},
  "feat(checks): mip-need measures how much texture a 3D example holds that its first view does not need":
    {"internal":"an editor or engine check, which a creator does not run"},
  "feat(viewport): impostors are checked: every kind's pictures are taken, each card covers its mesh in its colour, and the cards are one draw":
    {"internal":"an editor or engine check, which a creator does not run"},
  "fix(overlays): a viewport dropdown closes on its own button and on a press of the scene, which cancels pointerdown and so never sent the mousedown the dismissal waited for":
    {"note":"A viewport dropdown closes"},
  "feat(content-browser): in a dock group 800px or wider the toolbar rides in the tab strip, so the grid starts right under the tabs":
    {"note":"The content browser has one toolbar."},
  "feat(viewport): a billboard is checked turning its quad to the camera in both modes; static batching names a billboard it leaves out":
    {"internal":"an editor or engine check, which a creator does not run"},
  "feat(content-browser): path, search and filter share one 26px toolbar; New and Import move to the empty-space menu; a bottom slider switches list and grid; a narrow dock gets the folder tree as a drawer":
    {"note":"The content browser has one toolbar."},
  "feat(profiler): the Render module shows the frame's GPU draws against the quality level's draw call budget, split by pass; a level's budget is a Quality setting":
    {"note":"A draw call budget per quality level."},
  "feat(viewport): a selected ragdoll shows the limbs and joint limits it would be made of":
    {"note":"Ragdolls."},
  "feat(viewport): a Spline on its own gets drag, insert and delete handles, on the screen's plane in 2D and the ground's in 3D":
    {"note":"Move along a spline, and a 2D ground along one."},
  "feat(gizmo): shafts brighten toward the tip, scale centre is a dotted disc, as in Unreal":
    {"note":"The editor looks and handles like Unreal."},
  "fix(viewport): empties, lights and cameras get no selection box, as in Unreal":
    {"note":"The editor looks and handles like Unreal."},
  "fix(gizmo): all three plane handles are always drawn, edge-on ones as slivers, as in Unreal":
    {"note":"The editor looks and handles like Unreal."},
  "fix(gizmo): a plane handle seen edge-on is hidden instead of drawn as a sliver over an axis":
    {"note":"The editor looks and handles like Unreal."},
  "feat(viewport): Alt + right drag dollies the eye, as in Unity and Unreal":
    {"note":"The editor looks and handles like Unreal."},
  "feat(terrain): a terrain brush raises, lowers, smooths and flattens an area's ground and paints its layers":
    {"note":"Terrain brushes."},
  "feat(viewport): the transform handles default to 1.2x, arrows 96px instead of 80 — they were small in a viewport that has the whole panel; the Handle size setting still runs 0.5 to 2":
    {"note":"The editor looks and handles like Unreal."},
  "fix(viewport): a selected camera in a 3D view draws its whole frustum, strongly, instead of only the flat frame where it meets z = 0; an unselected one stays a quiet outline and Show Frustum still forces the volume":
    {"note":"The editor looks and handles like Unreal."},
  "fix(native): the x86_64 Android PhysX library links — no glibc symbol versions on bionic":
    {"internal":"the x86_64 Android PhysX library failed to link before any release shipped it"},
  "feat(settings): each group folds its own tuning rows at its foot, and the modules, splash screen and physics step are in the body":
    {"note":"The settings window shows what a project is set up with."},
  "feat(settings): each settings group folds its own tuning rows; modules, splash and the physics step are in the body":
    {"note":"The settings window shows what a project is set up with."},
  "feat(launcher): the new-project gallery shows its templates in Chinese in a Chinese editor":
    {"note":"The new-project gallery is in Chinese in a Chinese editor."},
  "fix(sdk): side modules load on a native host with no WebAssembly global, and a video's audio-track probe is not a missing asset":
    {"internal":"corrects two regressions the v0.98.0 release boot found before any release shipped them"},
  "feat(render): CompositeBatch draws a model of many parts in a few draws that follow its root, instancing repeated meshes and re-merging only the chunk an edit touches":
    {"note":"A model of many parts that moves: `CompositeBatch`."},
  "feat(mcp): get_stats reports what each CompositeBatch root draws, and the composite-batch check holds the batch":
    {"note":"A model of many parts that moves: `CompositeBatch`."},
  "fix(lightmap): built-in meshes carry the lightmap UV set the bake lays its charts by, so a baked cube or sphere draws its lightmap instead of nothing":
    {"note":"Baked lighting shows on built-in meshes."},
  "fix(lightmap): a bake reflects light 8 times by default, since two left a light-walled room at half the light Cycles gives it; the render lab takes MeshRenderer.color as the linear albedo it is":
    {"note":"Baked lighting reflects light 8 times by default, not 2."},
  "feat(render): the scene pass writes each surface's diffuse colour beside its normal, so Voxel GI and SSGI reflect bounce light by what it lands on instead of a grey guessed from the lit picture; render gates hold the baked and voxel-lit GI room":
    {"note":"Bounce light takes the colour of what it lands on."},
  "feat(render): Voxel GI on WebGPU reads the sun's shadow map back into its cache and feeds each bounce back, so light the camera does not see and light past the first bounce reach the picture":
    {"note":"Voxel GI lights what the camera does not see, and bounces light more than once."},
  "fix(render): Voxel GI brings a bounce at full strength however far the ray went, and weighs each voxel by how much of it a surface covers, so a fine grid is no longer dim and a coarse one no longer brighter":
    {"note":"Voxel GI lights what the camera does not see, and bounces light more than once."},
  "feat(render): the WebGL2 Voxel GI takes what the sun lights from its shadow map and bounces light more than once, as the WebGPU one does":
    {"note":"Voxel GI lights what the camera does not see, and bounces light more than once."},
  "fix(native): a native build asks its GPU for timestamps, so its GPU frame time reads a number instead of -1":
    {"note":"A native build reports its GPU frame time."},
  "perf(render): Voxel GI reads its cache plainly where nothing else writes it, and skips empty slots when it ages them, so a phone spends far less on its upkeep and its rays":
    {"note":"Voxel GI costs less on mobile GPUs."},
  "fix(native): every native host draws from one pacer, its present's own block and the game's cap, so an Android frame near its budget holds 60 fps instead of dropping to 30":
    {"note":"Android frames no longer drop to 30 fps when they come close to the frame budget"},
  "fix(native): a platform only names the font face a glyph needs, and the rasterizer maps each face's file once, so a new glyph no longer reads a whole system font":
    {"note":"A new glyph on a native build no longer stalls the frame reading a whole system font"},
  "fix(native): Android draws a face the shared rasterizer cannot read with its own, as Apple does, so a native build shows the system's CJK text":
    {"note":"A native Android build shows CJK text from the system font."},
  "perf(text): a new glyph is drawn and distance-transformed at 2x rather than 4x, and the transform skips what cannot change its bytes, so a phone pays a third of what it did":
    {"note":"A new character costs a phone about a third of what it did."},
  "fix(native): a bench lifts the pacer's frame-rate cap as well as its floor, so a phone's benched frame reads what it cost":
    {"internal":"only the bench switches reach it; a game never runs with them on"},
  "feat(text): preloadGlyphs puts a text's characters on the atlas ahead of time, a slice a frame, so the frame that shows them does not pay for them":
    {"note":"Glyphs can be put on the atlas before they are shown."},
  "fix(tools): the preload note's golden classification waits for the release, which is when check-golden reads a feature as shipped":
    {"internal":"a release-gate table, nothing a creator can observe"},
  "fix(ecs): a Mut row is no longer rewritten by its own write-back, so walking one on the web keeps its colours and a list field crosses as a vector":
    {"note":"`Mut()` on the web no longer turns a component's colours to NaN"},
  "fix(eht): writing an entity list on the web replaces it, where every write used to add to what was there and an empty list cleared nothing":
    {"note":"Writing an entity list on the web replaces it"},
  "fix(native): a component's entity list reaches the native core, so a spring bone's colliders work in a device build and a script can read them":
    {"note":"A spring bone's colliders work in a native build"},
  "perf(render): a Voxel GI ray asks a small table whether a cell holds anything and wraps it with a mask, so a default frame costs a third of what it did":
    {"note":"Voxel GI costs a third of what it did."},
  "fix(render): Voxel GI's screen samples take a different pixel of four each frame, so a thin face no longer makes a wall's bounce change with the size of the picture":
    {"note":"Voxel GI no longer changes with the size of the picture."},
  "fix(native): a packaged game's colour space, output transform, MSAA, quality, layers and camera fit reach a native host, so a linear project is no longer far too dark":
    {"note":"A linear project on a native build is no longer far too dark."},
  "fix(water): the albedo lines of the water shader go back inside its source, where a misplaced edit left them as top-level script that stopped every export from loading":
    {"internal":"broke after 0.98.0 and before any release, so no creator ever had it"},
  "fix(render): the target pool no longer destroys a frame's own targets every frame once they add up past its idle budget, which cost a phone 40 ms at quality high":
    {"note":"Quality high no longer costs a phone 40 ms a frame."},
  "fix(water): crests bend and ripples spread wider, so a sea from above is no longer scored with straight parallel strokes that turn with the wind":
    {"note":"A sea seen from above is no longer scored with straight lines."},
  "fix(examples): Terrain & Water's detail map has waves in every direction, where one wave laid fine diagonal lines across its whole sea":
    {"note":"A sea seen from above is no longer scored with straight lines."},
  "feat(mcp): an agent builds a 3D model in the editor from steps, changes it by one number, and sees every side of it":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(mcp): model_write says 64 shapes count at once, and the modeling check proves sixteen do":
    {"note":"A mesh can blend 64 morph targets at once, up from 8."},
  "fix(render): a linear game looks the same on every Play, where from the second on a scene with no effects showed raw linear values":
    {"note":"A linear game looks the same on every Play."},
  "test(editor): a scene draws the same on every Play, with effects or without":
    {"internal":"a check, for a fix the engine commit carries"},
  "perf(lightmap): charts are laid out by their outlines at the largest size that fits, about half of an atlas where it was a third":
    {"note":"A lightmap or a baked normal map gets nearly twice as many texels on its model."},
  "feat(modeling): a decimate can start from the form before its detail, and a mirrored displace takes its spot with it":
    {"note":"An AI building a model can make it light and keep its detail."},
  "feat(mcp): model_write teaches thinning the form rather than its detail":
    {"note":"An AI building a model can make it light and keep its detail."},
  "fix(mcp): a rotation given as a quaternion is that rotation, where its parts were read as degrees and its w dropped":
    {"note":"A rotation given to an agent as a quaternion is that rotation."},
  "fix(asset): a map a material names keeps its import settings in Play, where it was decoded as colour":
    {"note":"A material's normal and metal-rough maps are read as data in the editor's Play."},
  "fix(minigame): no mini-game module needs BigInt64Array, so WeChat DevTools boots the game":
    {"note":"A WeChat mini-game opens in WeChat DevTools."},
  "feat(look): layers and pixels drawn to a picture, on the CPU":
    {"note":"An AI can draw 2D pictures."},
  "feat(look): layers moved and wrapped, one pixel changed, a set and a close look drawn":
    {"note":"An AI can draw 2D pictures."},
  "feat(look): text, a grid on a face, buildings in perspective, reflections":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): image_write draws text in the editor's fonts, and documents the built world":
    {"note":"An AI can draw 2D pictures."},
  "fix(ci): the mini-game host only refuses to make a BigInt64Array, and the unoffered ops are not asked of the text":
    {"internal":"test hosts and a test: nothing a creator runs changed"},
  "feat(look): adjustment layers, filters, every blend mode, feather; repaint removed":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): image_write teaches the finish of a picture, in place of repaint":
    {"note":"An AI can draw 2D pictures."},
  "feat(look): repaint the picture so far in strokes, and an edit draws only what changed":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): image_write teaches repaint":
    {"note":"An AI can draw 2D pictures."},
  "feat(look): text and strokes on a face, a text's core and wear, bloom":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): image_write teaches the order of a picture, neon and paint on a wall":
    {"note":"An AI can draw 2D pictures."},
  "fix(look): what clips to a clipped layer stays inside what that layer holds":
    {"internal":"the paint, figure and image layers it fixes have not been released"},
  "fix(look): a hidden guide still works, opacity 0 hides its bones, a faint layer has a real box":
    {"internal":"what it fixes has not been released"},
  "feat(look): brushes: flat tips, paper grain, dry streaks, wet mixing, and named media":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): image_write documents the brushes":
    {"note":"An AI can draw 2D pictures."},
  "feat(look): a figure is bones and blocks, and a picture from the project can be drawn over":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): a picture as a reference, and the body no longer offered to build a character on":
    {"note":"An AI can draw 2D pictures."},
  "feat(look): a posed body to draw over, its joints in the picture and light by its form":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): image_write takes a figure as a guide":
    {"note":"An AI can draw 2D pictures."},
  "feat(look): painting across the picture, strokes along a line, values and colours read":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): image_read shows values and picks colours; the painting text in full":
    {"note":"An AI can draw 2D pictures."},
  "fix(look): a dab with a taper drew nothing":
    {"internal":"the paint layer it fixes has not been released"},
  "feat(look): one instruction, many strokes: sweep for hair, field for a region":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): image_write documents sweep and field":
    {"note":"An AI can draw 2D pictures."},
  "feat(look): a paint layer, brush strokes on a canvas replayed in order":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): image_write and image_edit paint with brush strokes":
    {"note":"An AI can draw 2D pictures."},
  "feat(look): a picture's layers blurred, and noise as a fill":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): image_write documents blur and noise":
    {"note":"An AI can draw 2D pictures."},
  "feat(look): stroke joins and ends, what a picture measures, pixels by the block":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): a picture's reply measures it; stroke join and cap, pixel blocks":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): image_set, a region in image_read, and what image_edit can now do":
    {"note":"An AI can draw 2D pictures."},
  "feat(mcp): image_write, image_edit and image_read":
    {"note":"An AI can draw 2D pictures."},
  "feat(modeling): a whole person from a few numbers, clothes from the body's own surface, and a pose by where a hand should be":
    {"note":"An AI can give a body standard bones, pose it, and model a limb by its sections."},
  "feat(mcp): model_write describes a person, and scene_views looks round a subject without a shot's lens":
    {"note":"An AI can give a body standard bones, pose it, and model a limb by its sections."},
  "feat(mcp): model_write lists humanoid, garment and pose":
    {"note":"An AI can give a body standard bones, pose it, and model a limb by its sections."},
  "feat(look): a part of a picture traced as points, its edges as lines, and the colour of a patch":
    {"note":"An AI can read shapes and colours off a picture as numbers."},
  "feat(mcp): reference_trace, reference_probe, and the outline of one part on the reference":
    {"note":"An AI can read shapes and colours off a picture as numbers."},
  "feat(mcp): a region is drawn close through the camera, camera_layers takes a frame apart, and light_sheet shows each light alone":
    {"note":"An AI can take a frame apart to see why it looks wrong."},
  "fix(modeling): an outline is a dome with no flat on it, a stroke fades behind what is in front, and a line can bend":
    {"note":"An AI can read a shape off a picture and model it."},
  "feat(mcp): model_write describes the dome, and a stroke or a stain line that bends":
    {"note":"An AI can read a shape off a picture and model it."},
  "fix(render): a fixed shadow map stays on what casts, and gtao takes a strand for a strand":
    {"note":"A fixed shadow map stays on what casts, and ambient occlusion leaves hair alone."},
  "test(mcp): gtao keeps hair from going black and still shades round a solid block":
    {"note":"A fixed shadow map stays on what casts, and ambient occlusion leaves hair alone."},
  "feat(modeling): a drawing stands up as a solid, sculpt works a surface by stroke, and a view takes coordinates off a picture":
    {"note":"An AI can read a shape off a picture and model it."},
  "feat(mcp): reference_view numbers a grid on a picture, and a close-up shows the same part of both":
    {"note":"An AI can read a shape off a picture and model it."},
  "feat(modeling): hair follows guides over the head, stain draws lines, scatter lays out copies, and a material gives off light":
    {"note":"An AI can model a character's hair by where it goes, and draw on a surface."},
  "feat(mcp): model_write describes the new steps, and apply_scene_ops says which field a component does not have":
    {"note":"An AI can model a character's hair by where it goes, and draw on a surface."},
  "fix(postprocess): Color Grade contrast keeps a dark scene in a linear project":
    {"note":"Color Grade contrast no longer blacks out a dark scene in a linear project."},
  "feat(look): pictures laid side by side, one outlined over another, and their exact colours":
    {"note":"An AI can put the game beside the pictures it is imitating."},
  "feat(mcp): reference_compare, field_sweep and motion_sheet show the game beside what it imitates, at several values and over time":
    {"note":"An AI can put the game beside the pictures it is imitating."},
  "feat(modeling): a hanging part swings as a ring of chains, kept out of the legs, and a pattern presses pleats into it":
    {"note":"An AI building a model can dress it in clothes that swing."},
  "feat(mcp): model_write dresses a model in clothes that swing, and a check walks a skirt":
    {"note":"An AI building a model can dress it in clothes that swing."},
  "feat(modeling): a character wears another model at a joint, through saving and export":
    {"note":"An AI building a model can make hair."},
  "fix(mcp): a child added inside a prefab instance is warned about, and a check runs a real package of it all":
    {"note":"An agent is told when a child it adds inside a prefab instance will not last."},
  "feat(modeling): a hair step grows cards from a scalp, and a material can cut holes or let light through":
    {"note":"An AI building a model can make hair."},
  "feat(mcp): model_write makes hair and see-through surfaces, and a check draws them":
    {"note":"An AI building a model can make things see-through."},
  "feat(modeling): a bake works out how much sky a dense surface sees, and shades its creases by it":
    {"note":"An AI building a model can shade its creases."},
  "feat(mcp): model_write bakes an occlusion map, and a check draws a groove with and without it":
    {"note":"An AI building a model can shade its creases."},
  "feat(modeling): a model says how rough and how metal it is, part by part, and a bake keeps that as a map":
    {"note":"An AI building a model can say what it is made of."},
  "feat(mcp): model_write writes a material and a surface map, and a check draws the map against its constant":
    {"note":"An AI building a model can say what it is made of."},
  "feat(modeling): a stain step colours a surface by what is there, and a bake keeps it as a colour map":
    {"note":"An AI building a model can colour it finely, and keep that on a thin mesh."},
  "feat(mcp): model_write stains and bakes colour, checked in both colour spaces":
    {"note":"An AI building a model can colour it finely, and keep that on a thin mesh."},
  "feat(modeling): a displace step carves wrinkles, cracks, scales and weave into a surface":
    {"note":"An AI building a model can carve fine detail into it."},
  "feat(mcp): model_write carves fine detail, and a check takes every pattern through the bake":
    {"note":"An AI building a model can carve fine detail into it."},
  "feat(modeling): a model thins to a few triangles and keeps its detail as a normal map":
    {"note":"An AI building a model can make it light and keep its detail."},
  "feat(mcp): model_write thins a model and bakes its detail, and a check compares it lit against the dense one":
    {"note":"An AI building a model can make it light and keep its detail."},
  "feat(render): a mesh can have 256 joints where 64 imported a rig with fingers and a face as a statue":
    {"note":"A mesh can have 256 joints, up from 64."},
  "feat(mcp): model_write takes 256 joints, and the modeling check poses past the old limit":
    {"note":"A mesh can have 256 joints, up from 64."},
  "feat(render): a draw blends up to 64 morph targets at once, where 8 left a face rig's lighter shapes reading as zero":
    {"note":"A mesh can blend 64 morph targets at once, up from 8."},
  "feat(animation): a foot-plant constraint keeps a foot on the physics ground under it, slopes and steps included":
    {"note":"A foot stands on the ground under it."},
  "feat(mcp): model_write plants feet on the ground, and model_views runs the IK on a test floor":
    {"note":"A foot stands on the ground under it."},
  "feat(modeling): found weights can be corrected, shapes make expressions, and a controller can reach and look at goals in the game":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(mcp): model_write corrects weights, makes shapes and wires ik goals":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(modeling): a foot can be told where to land, a controller says which clip plays when, and surfaces can be subdivided and edges rounded":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(mcp): model_write plants feet, writes an animator, subdivides and rounds":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(modeling): a model can have a rig with weights found over its surface, and clips of a few keys, so what an agent builds can move":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(mcp): model_write rigs and animates a model, and model_views shows the bones, the weights and a clip through time":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(modeling): lathe and loft make curved solids from a few points, so an agent can build vases, pipes, handles and hulls":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(mcp): model_write turns outlines and joins sections into curved solids":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(modeling): a boolean step cuts real holes and a uv step aims textures, with an atlas for a texture painted for one model":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(mcp): model_write cuts holes and lays out textures":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(modeling): an organic step makes one skin over parts that melt into each other, so an agent can build creatures, plants and rocks":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(mcp): model_views looks at one part up close and from more sides, and model_write explains how to build a body":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(modeling): a model is the steps that build it, baked to the mesh a scene draws, so one number changes the whole shape":
    {"note":"AI agents can build 3D models in the editor from steps."},
  "feat(quality): a phone or tablet takes Medium when a project names no level, and an orthographic camera is left out of its temporal smoothing":
    {"note": "Phones and tablets take Medium when a project names no level."},
  "feat(settings): the quality level can be left at Default, which holds a phone to Medium, and Off is a choice that holds there":
    {"note": "Phones and tablets take Medium when a project names no level."},
  "perf(water): a sea on a phone costs half of what it did, 45 ms to 21.5, with the same picture":
    {"note": "Water costs a phone half of what it did."},
  "feat(templates): the blank template starts in the linear pipeline":
    {"note": "The blank template starts in the linear pipeline."},
  "fix(quality): a level can skip every effect there is, where past thirty-two the rest quietly kept running":
    {"note": "A quality level can skip every effect there is."},
  "feat(render): an Ambient light can be two colours, sky and ground, without baking a panorama":
    {"note": "An Ambient light can be two colours, sky and ground."},
  "fix(render): an opaque mesh tests and writes depth whatever its material says, so a new material no longer shows a sphere's inside":
    {"note": "A new material no longer shows the inside of a sphere."},
  "fix(asset): a texture made or rewritten from JS leaves the device's unit bound as it was, so a scene view no longer goes black for good after a heightmap loads":
    {"note": "A scene view no longer goes black for good after a heightmap loads."},
  "fix(render): with no post-process chain, a blended pane in front of water is drawn over it instead of under it":
    {"note": "A blended pane in front of water is drawn over it."},
  "feat(render): a material past seven textures takes the units below 8 its shader never reads, and Water gains a foam texture":
    {"note": "A material can hold more than seven textures, and Water gains a foam texture."},
  "fix(runtime): a restarted scene draws its images again instead of white":
    {"note": "A restarted scene draws its images again instead of white."},
  "fix(editor): a saved layout of empty groups no longer leaves an editor with no viewport, and a plugin writing its cache is not reloaded on Windows":
    {"note": "A saved layout of empty groups no longer leaves an editor with no viewport."},
  "fix(project): a setting the manifest would refuse is not written, so one bad field can no longer leave a project that does not open":
    {"note": "A setting the manifest would refuse is not written."},
  "feat(mcp): every row of Project Settings reads and writes by id, and a partial write keeps what it did not name":
    {"note": "Every row of Project Settings can be read and written by id over MCP."},
  "fix(editor): a script-built mesh's colour stays as typed, the graph and terrain pickers show the true colour, and a lit mesh in gamma offers linear":
    {"note": "A mesh's colour draws as picked."},
  "fix(editor): a picked colour draws as its swatch on a mesh, and a new surface material tests depth":
    {"note": "A mesh's colour draws as picked."},
  "fix(inspector): one box of a vector row edits a material or a clip, and a Rotation scrub survives the pole":
    {"note": "One box of a vector row edits a material or a clip, and Rotation boxes behave."},
  "fix(inspector): typing one box of a Rotation row turns that axis, where it stored NaN in all four components":
    {"note": "One box of a vector row edits a material or a clip, and Rotation boxes behave."},
  "fix(mcp): a save is no undo step, so Undo after it takes back the edit instead of the save":
    {"note": "Undo after a save takes back the edit over MCP."},
  "fix(lighting): the bake's bounces start at 8 and go to 16 in the panel, as the SDK default now does":
    {"note": "A lightmap bake's bounces start at 8 and go to 16 in the panel."},
  "fix(ci): the WebGL2 Voxel GI scene is not launched on a runner with no GPU, where it kills the GPU process before it draws":
    {"internal": "CI only: which scenes a runner launches."},
  "fix(templates): the 3D templates' camera no longer names a field Camera dropped, and the debug channel's test knows the world the stats read":
    {"internal": "The stale field was dropped on load either way, so no frame changes; the rest is a test."},
  "fix(play): get_stats waits out a long frame, where two seconds read a slow machine as a game that had stopped":
    {"note": "An agent's `get_stats` waits out a long frame."},
  "fix(project): a saved file reaches the device preview on Linux, where the watch followed the file's old inode":
    {"note": "A saved scene reaches a device preview on Linux."},
  "fix(project): asset registry updates run one after another, so a prefab made a moment before is in list_assets":
    {"note": "A prefab made over MCP is in `list_assets` at once."},
  "fix(docs): the CompositeBatch entry of the component reference quotes its apostrophe, which stopped the site building":
    {"internal": "The docs site did not build, so v0.99.0 was not deployed to it; no package changes."},
  "refactor(image): a text mask draws in the canvas's own default colour, since only its alpha is read":
    {"internal": "Two assignments of the colour a fresh canvas already has; the mask read back is the same."},
  "refactor(image): the noise, colour and path helpers live in their own modules, so no two image or modeling modules import each other":
    {"internal": "Declarations moved between files unchanged; every image and modeling test draws and builds the same."},
  "fix(minigame): the engine subpackage notice shows only a real percentage, stops at load, and comes down when the boot fails":
    {"note": "The engine-subpackage loading notice shows a real percentage, and comes down when it should."},
  "fix(wechat): build the mini-game engine without auto-vectorization, so WeChat on iOS no longer takes itself down with the game":
    {"note": "A WeChat mini-game no longer takes WeChat down with it on iOS."},
  "fix(timeline): importing esengine/timeline installs timelines again, so a mini-game's animated characters leave the bind pose":
    {"note": "Animated characters move in a WeChat mini-game."},
  "fix(render): a lighting-direct surface takes a hard shadow from a sun with a size, where it took none":
    {"note": "A `#pragma lighting direct` surface takes a sun's shadow."},
  "feat(quality): low and medium light 3D surfaces directly, so a phone pays about half for a lit scene":
    {"note": "On a phone, a lit 3D scene costs about half as much."},
  "feat(quality): the quality levels have a 3D lighting row":
    {"note": "On a phone, a lit 3D scene costs about half as much."},
  "fix(native): a render target is made on a device, so RenderTexture and a camera's renderTarget draw there":
    {"note": "A render target works on a native device."},
  "fix(native): the audio device is watched and brought back when it stops taking sound, so a game is not left silent after the background":
    {"note": "Sound comes back when a device's audio dies on its own."},
  "fix(text): world text under a perspective camera draws as SDF, and no bitmap glyph is rasterized past half an atlas page":
    {"note": "World text under a perspective camera no longer eats the memory."},
  "fix(shader): a param may not take a name the engine declares for its domain, read from what the engine injects rather than a list of three":
    {"note": "A material parameter named like an engine uniform is refused on every platform."},
  "fix(spine): the atlas reaches the module through the heap as UTF-8 bytes, so an atlas past 60 KB or with non-ASCII names loads":
    {"note": "A Spine atlas of any size loads."},
  "fix(ios): the host adopts the scene lifecycle, so a game built with Xcode 27 opens on iOS 27":
    {"note": "An iOS game opens on iOS 27."},
  "fix(native): the audio watchdog compiles under the min macro windows.h defines":
    {"internal": "The watchdog had not reached a release; the Windows host failed to build on master only."},
  "feat(render): share native BRDF for specular glossiness materials":
    {"note": "An imported specular-glossiness material, and a normal map's strength, come through."},
  "fix(import): preserve normal strength and specular glossiness materials":
    {"note": "An imported specular-glossiness material, and a normal map's strength, come through."},
  "feat(import): restore scene materials, animation and native effects":
    {"note": "An imported scene keeps its materials, animation, particles and colliders."},
  "feat(physics): support compound colliders and scaled model geometry":
    {"note": "A 3D body can be several shapes, and a scaled model collides at its scale."},
  "fix(foliage): release retired generation assets after the last chunk":
    {"note": "Generated plants and placements let go of what they held."},
  "fix(worldgen): release scene zones and stabilize authored placements":
    {"note": "Generated plants and placements let go of what they held."},
  "fix(worldgen): preserve shared 2D placement change subscriptions":
    {"note": "Generated plants and placements let go of what they held."},
  "fix(profiler): separate work counters and manual steps from frame timing":
    {"note": "The profiler's frame time is the frame's own."},
  "fix(profiler): reject stepped and reset play FPS windows":
    {"note": "The profiler's frame time is the frame's own."},
  "perf(transform): reuse authored matrix decomposition across frames":
    {"internal": "A cached decomposition of an authored matrix; every transform resolves to what it did, only the work per frame is less."},
  "fix(render): a render target hands out its picture the right way up on a device that stores rows top first":
    {"note": "A render target reads the right way up on WebGPU, Android and iOS."},
  "fix: budget terrain page sampling and painting across frames":
    {"note": "Building terrain no longer stalls a frame."},
  "fix: preserve authored UVs through model transforms and scattering":
    {"note": "A moved or scattered model part keeps its texture mapping."},
  "feat: fit procedural buildings and reserve roads from foliage":
    {"note": "A generated building stands on its ground, and generated roads keep foliage off them."},
  "feat: expose ground fitting and vegetation budgets to editor agents":
    {"note": "A generated building stands on its ground, and generated roads keep foliage off them."},
  "perf(tilemap): a row of tiles being edited uploads a piece of itself":
    {"note": "A row of tiles being edited uploads a piece of itself."},
  "feat(tilemap): a tile layer can be dug, blown up and rebuilt while the game runs":
    {"note": "A tile layer can be dug, blown up and rebuilt while the game runs."},
  "fix(render): a skinned mesh is culled around its joints, not where its entity stands":
    {"note": "A skinned mesh is not culled for where its entity stands."},
  "feat(rig2d): a 2D character can be rigged with no other program, with IK and bone constraints":
    {"note": "A 2D character can be rigged in the editor, with no other program."},
  "feat(physics): a side-on character runs, jumps and forgives, on a mover that handles slopes, ledges and platforms":
    {"note": "A side-on character comes ready to run and jump."},
  "feat(foliage): plants part for what touches them, come near as entities with colliders, and can be felled and harvested":
    {"note": "Plants can be touched, felled and harvested."},
  "feat(particles): GPU particles collide with scene depth and distance functions, fire sub-emitters from an event buffer, and drag trails":
    {"note": "GPU particles can hit things, tell each other, and drag trails."},
  "feat(particles): draw a ParticleCollider's shape, and check GPU particle collision, events and trails in real frames":
    {"note": "GPU particles can hit things, tell each other, and drag trails."},
  "fix(ui): particles and plain sprites in a Canvas paint by their place in its tree":
    {"note": "Particles and plain sprites in a Canvas paint by their place in its tree."},
  "fix(text): stopping lets go of the labels the engine holds, so the next Play cannot draw them on other entities":
    {"note": "Labels no longer come back as black boxes after a change between Plays."},
  "feat(editor): a grip is edited where it is held, the character holding it live in the edit viewport":
    {"note": "A grip is edited where it is held."},
  "feat(animation): fingers close onto what they hold, a finger joint is dragged in the viewport, and a clip plays under the grip in edit mode":
    {"note": "Fingers close onto what they hold."},
  "feat(animation): a character holds an object by anchors on it, the arms bent to them in one order that cannot loop":
    {"note": "Holding an object in both hands."},
  "feat(animation): a rig's hands held in a named pose that fits any skeleton":
    {"note": "Hands that hold things."},
  "fix(animation): a held hand's thumb reaches for the fingers and lies over them, instead of standing out from the palm":
    {"note": "Hands that hold things."},
  "feat(sky): clouds that keep time with the game, follow the weather's wind, and have a second layer":
    {"note": "Clouds that keep time with the game."},
  "feat(voxel): ground that is a volume, carved while the game runs, with collision that follows and saves by chunk":
    {"note": "Ground that is a volume."},
  "feat(terrain): a material that fades into the ground it meets, a road laid over a terrain, and snow on whatever faces the sky":
    {"note": "What stands on the ground can blend into it."},
  "fix(assets): one hot load at a time per asset, so two rescans cannot lose a texture":
    {"note": "A texture stays on a scene that rescans as it is placed."},
  "feat(rig): the 2D rig editor, from an image to a character in the scene":
    {"note": "A 2D character can be rigged in the editor, with no other program."},
  "fix(text): a glyph's outline costs what its size does, and text too large for a bitmap glyph draws from a distance field":
    {"note": "Zooming in on outlined text no longer freezes the editor."},
  "feat(terrain): a tiled terrain's heights export to one image and import from one, over every tile or only the loaded ones":
    {"note": "A tiled terrain exports and imports its heightmap, over every tile or only the loaded ones."},
  "fix(editor): a tiled terrain's .esterrain is a known asset, and the cell load and split buttons carry their state and tip through Button's own props":
    {"note": "Tiled terrain can be sculpted and painted, and a save writes only what changed."},
  "feat(terrain): tiled ground is sculpted and painted on the tiles in memory, a changed tile stays until it is saved, and a save writes only what changed":
    {"note": "Tiled terrain can be sculpted and painted, and a save writes only what changed."},
  "feat(terrain): the sculpt panel saves tiled ground, and a tiled terrain is sculpted, saved and reopened in the editor":
    {"note": "Tiled terrain can be sculpted and painted, and a save writes only what changed."},
  "feat(terrain): an area's ground can be kept as tiles, read where it is looked at under a memory budget, with an overview for the distance":
    {"note": "A terrain can be kept as tiles that are read where they are looked at."},
  "feat(terrain): a terrain splits into tiles from the sculpt panel, the editor waits for ground still being built, and opening a tiled terrain is measured near and far":
    {"note": "A terrain can be kept as tiles that are read where they are looked at."},
  "feat(world): a streamed world opens in the editor with only what never streams, and cells are loaded and unloaded in the edit view without touching the document":
    {"note": "A streamed world opens in the editor without its cells."},
  "fix(editor): what grows round the view follows the viewport in 2D and 3D, and a terrain stroke keeps only the tiles it touched":
    {"note": "While editing, foliage and generated worlds follow the viewport."},
  "fix(profiler): a long block in the render submit is work, not vsync, and text has a scope of its own":
    {"note": "The profiler no longer calls a long render stall vsync."},
  "fix(profiler): a long block in the render submit is work, not vsync":
    {"note": "The profiler no longer calls a long render stall vsync."},
  "fix(profiler): a long task is put down to the scope that timed it":
    {"note": "The profiler no longer calls a long render stall vsync."},
  "fix(profiler): the long tasks under a pinned frame name the scope that timed them":
    {"note": "The profiler no longer calls a long render stall vsync."},
  "fix(gates): the world anchor system declares what it touches, the sky effect door and the 3D physics declarations have their dispositions, and the generated tables, baked scene and long shader literal follow":
    {"internal": "a build-check and generated-file fix; nothing a creator can observe"},
  "fix(ci): the shading-mode count test names the last mode, the fetch names the full commit, and the pipeline tests get the Spine runtimes they read":
    {"internal": "a build-check and generated-file fix; nothing a creator can observe"},
  "fix(ci): refresh the API snapshots, count the probe grid sampler, and fetch the commit the grip checks read":
    {"internal": "a build-check and generated-file fix; nothing a creator can observe"},
  "feat(post): Color Grade has split toning, an S-curve and lift":
    {"note": "Color Grade has split toning, an S-curve and lift."},
  "feat(probes): a captured probe volume drives reflections too":
    {"note": "A captured probe volume drives reflections too."},
  "feat(probes): a probe volume can be filled at run time":
    {"note": "A probe volume can be filled at run time."},
  "feat(light): inverse-square falloff; a bake falls light off as the frame does":
    {"note": "Lamps can fall off as real ones do."},
  "feat(sky): a project's own sky lights the scene; probes chosen by a mesh's box":
    {"note": "A sky of your own lights the scene."},
  "feat(sky): the sky's lower half is the sunlit ground":
    {"note": "The sky's lower half is the sunlit ground."},
  "feat(render): Direct and Indirect Lighting Only view modes":
    {"note": "Direct Lighting Only and Indirect Lighting Only view modes."},
  "feat(postprocess): pyramid bloom; a pass reads earlier passes of its effect":
    {"note": "Bloom glows round and soft, and costs less."},
  "feat(render): probe volumes light each pixel":
    {"note": "A probe volume lights each pixel, not each object."},
  "fix(render): a glass roof keeps rain off":
    {"note": "Rain does not fall through a glass roof."},
  "feat(postprocess): effect lengths follow the project's units":
    {"note": "Defaults follow the project's units."},
  "feat: defaults follow the project's units; Particle.emitAt; first-person jump feel":
    {"note": "Defaults follow the project's units."},
  "feat(ui): UIWorldAnchor \u2014 a UI node over a point in the 3D world":
    {"note": "A UI node can stand over a point in the 3D world."},
  "feat(ai): hearing, world-pose perception, nav bakes implicit statics; rays can meet characters":
    {"note": "Perceivers hear."},
  "fix(render): an overlay camera composites over the camera beneath":
    {"note": "Post-process volumes skip a camera that draws over another one."},
  "feat(physics3d): a collider with no RigidBody3D is a static body":
    {"note": "A 3D collider with no RigidBody3D is a static body, as in Unity."},
  "feat(physics3d): the 3D world is made from project settings, not constants":
    {"note": "The 3D physics world is set in Project Settings, not in code."},
  "feat(render): sky occlusion \u2014 rooms stay dark under a sky that changes":
    {"note": "Rooms stay dark under a sky that changes (sky occlusion)."},
  "feat(prefab): instances in the open scene take a changed prefab at once":
    {"note": "Instances in the open scene take a changed prefab at once."},
  "fix(editor): the prefab bar and the Details header fit a narrow panel":
    {"note": "The prefab bar and the Details header fit a narrow panel."},
  "feat(rig2d): bones keep an id, take a new parent, and rebind onto another skeleton by name":
    {"note": "A 2D rig's bones keep an id, take a new parent and rebind onto another skeleton."},
  "feat(render): the sky lights the scene \u2014 Sky Atmosphere as the environment":
    {"note": "The sky lights the scene."},
  "fix(render): what a three.js container port showed \u2014 tiled maps, the sky through walls, wet floors indoors":
    {"note": "A material reads its maps through Tiling, Offset and Rotation."},
  "fix(postprocess): a colour written among a volume's uniforms is read as a colour, not blended into NaN":
    {"note": "A colour written among a post-process volume's uniforms is read as a colour."},
  "feat(viewport): Direct and Indirect Lighting Only view modes":
    {"note": "Direct Lighting Only and Indirect Lighting Only view modes."},
  "feat(editor): post-process inspector in the project's units":
    {"note": "Defaults follow the project's units."},
  "feat(editor): defaults follow the project's 3D units; import note reads them":
    {"note": "Defaults follow the project's units."},
  "fix(mcp): start the editor again after it goes away":
    {"note": "The editor's MCP server starts its editor again after the editor goes away."},
  "feat(settings): the 3D physics world is set in Project Settings":
    {"note": "The 3D physics world is set in Project Settings, not in code."},
  "feat(lighting): a Sky occlusion switch in the bake settings":
    {"note": "Rooms stay dark under a sky that changes (sky occlusion)."},
  "feat(prefab): a changed prefab reaches the open scene's instances at once":
    {"note": "Instances in the open scene take a changed prefab at once."},
  "fix(editor): the prefab bar and the Details header fit a narrow panel":
    {"note": "The prefab bar and the Details header fit a narrow panel."},
  "feat(rig): rebind a 2D rig after it is bound \u2014 new parents, another rig's skeleton, clips that follow, skins rebound in the scene":
    {"note": "A 2D rig's bones keep an id, take a new parent and rebind onto another skeleton."},
  "feat(editor): a finger joint is dragged in the viewport, a clip plays under the grip, and the fingers' surfaces are listed and made":
    {"note": "A grip is edited where it is held."},
  "feat(settings): Project Settings \u2192 Runtime \u2192 Multi-touch sets whether a game starts with several fingers or one":
    {"note": "Multi-touch can be turned off."},
  "feat(viewport): a perceiver's hearing range is drawn beside its sight, and the sky occlusion hint uses the editor's own tip":
    {"note": "Perceivers hear."},
  "feat(material): wet ground: a map says where it is damp and where water stands":
    {"note": "Wet ground: a map says where it is damp and where water stands."},
  "feat(planar): a reflection softens with roughness and keeps a hot spot's hue":
    {"note": "A planar reflection softens with roughness and keeps a hot spot's hue."},
  "fix(editor): a reload from disk gives way to an edit made while the file is read":
    {"note": "A prefab reverted just after the editor noticed its scene file change is no longer lost."},
  "fix(terrain): an edited page keeps drawing as it was until it is made again, so a brush stroke leaves no hole":
    {"note": "A terrain brush stroke no longer makes the ground vanish for a moment."},
  "feat(editor): several editors open at once are told apart by an agent, and each grants on its own (refs esengine/estella#118)":
    {"note": "Several editors open at once can be told apart by an agent, and each grants on its own."},
  "feat(rhi): a shader program that holds the page is named in the log; terrain-water compiles in the background":
    {"internal": "A log line for engineers (a shader program that held the page 40 ms or more) and one example project's own quality setting."},
  "fix(voxel): Voxel Ground compiles on WebGPU again, the wet map no longer pushes it past its texture units":
    {"note": "Voxel Ground compiles on WebGPU again."},
  "fix: the docs build parses the GripSurface summary; dusk-fort keeps its fog colour in colors":
    {"internal": "A docs build error and an example scene's fog colour moved to where the loader reads it; no creator's project changes."},
  "feat(assets): a material says what it left out - a texture that would not load, a property nothing reads":
    {"note": "A material that loaded with part of it missing no longer fails in silence."},
  "feat(editor): an asset that loaded with part of it missing is a diagnostic and a project warning, not a log line":
    {"note": "A material that loaded with part of it missing no longer fails in silence."},
  "feat(editor): a material written with something that will not take effect says so in the reply, and its field in Details is marked":
    {"note": "A material that loaded with part of it missing no longer fails in silence."},
  "fix(shadows): every level asks its shadow from a point moved off the surface along the normal - the full-lighting path too, hard edge, blocker search and soft filter; the nine shadow oracles hold on both backends":
    {"note": "A wall under a roof is no longer sunlit along its top."},
  "perf(foliage): a field's cells are made on the workers and only landed in the frame - the first seconds of a generated world run at 5-12 ms a frame instead of 20":
    {"note": "A generated world is there in a second instead of thirty."},
  "perf(streaming): a generated world is there in a second instead of thirty - terrain pages are made on the workers, the frame's budget is shared among what streams, and what stands by the player gets more of it":
    {"note": "A generated world is there in a second instead of thirty."},
  "fix(shadows): no sunlight on the top of a wall under a roof at the low and medium levels - a level that lights directly moves the lookup off the surface along its normal instead of up to eleven coarse texels toward the light, which was further than a ceiling is thick":
    {"note": "A wall under a roof is no longer sunlit along its top."},
  "fix(quality): the cheaper dynamic GI reaches a level put in force after the stack was built - it is written on the effects each frame, not on the stack as it is made; on a phone the switch did nothing (14.9 ms) and now gives 12.3":
    {"note": "A quality level decides what the dynamic GI spends."},
  "perf(gi): the medium level runs the dynamic GI its cheaper way - half-resolution gather, a quarter of a probe's rays a frame, cards over eight frames, two thirds of the probe rows; 7.3 -> 4.5 ms on a Snapdragon 8 Elite":
    {"note": "A quality level decides what the dynamic GI spends."},
  "fix(worldgen): a chunk of decoration or grass is drawn out to the distance its rule names, however little stands in it - a chunk with one group of rocks was culled 60 m away under a rule that said 1200":
    {"note": "A chunk of decoration or grass is drawn out to the distance its rule names."},
  "feat(gi): a half-resolution way to add the light - one pixel in four asks the probes and every pixel takes it from the four round it; the medium level runs it, and the apply costs 0.14 ms where it cost 0.25 at 1080p":
    {"note": "A quality level decides what the dynamic GI spends."},
  "feat(quality): the low level leaves the dynamic GI out, and a level that does builds no distance field for it either":
    {"note": "A quality level decides what the dynamic GI spends."},
  "fix(gi): no bright and dark blobs beside an edge the camera moves past - a probe whose own history is of another surface still mixes with the neighbours that are on its own":
    {"note": "Dynamic global illumination that does not leak."},
  "feat(audio): a native host streams long clips - the file stays compressed and each voice decodes as it plays, by the same rule as the web; a 175 s mp3 keeps 2.3 MB instead of 64, and loads in no time instead of a decode on the frame":
    {"note": "A native app streams long audio clips."},
  "fix(gi): walls that looked dirty - a probe that has not moved keeps five times the history, so the blotches left of the grain on a still wall go":
    {"note": "Dynamic global illumination that does not leak."},
  "fix(sidemodules): a game started over and over in one page no longer runs out of WebAssembly memory - the module host has an end, the App that made it disposes it on quit, and the KTX2 transcode workers stop with it":
    {"note": "A game started over and over in one page no longer runs out of WebAssembly memory."},
  "fix(gi): no dashed dark line down the edge two walls share - a probe whose G-buffer normal faces into a wall takes the field's way out instead, and a pixel weighs a probe's light by its own normal only as far as the probe faces the same way":
    {"note": "Dynamic global illumination that does not leak."},
  "fix(quality): dynamic resolution lowers the scale when the frame is late and its own run was not - a GPU timer that reads half a millisecond no longer counts as headroom, and on WebGPU that timer now covers the whole frame instead of the surface pass":
    {"note": "Dynamic resolution lowers the scale when a frame is late."},
  "fix(gi): the grain and the dots in the corners - a probe's history is mixed with the eight round it on the same surface, a probe the eye sees is always moved clear of the walls it stands between, and a pixel no probe agrees with takes what the probes get themselves":
    {"note": "Dynamic global illumination that does not leak."},
  "fix(native): the device language reaches the game - Android, iOS and desktop report the system locale, and 'zh-Hans-CN' reads as the 'zh-CN' a browser gives instead of always 'en'":
    {"note": "The device's language reaches a native game."},
  "fix(gi): no black band along the edges of a room - a ray that starts in a corner is moved clear of the wall next to it, and a card pixel buried in another body stays where it is so a sealed room stays dark":
    {"note": "Dynamic global illumination that does not leak."},
  "perf(gi): a scene with no GI yet is built 12 ms a frame instead of 3 - on a phone the first light comes in about 2 s, not 10; a moving camera keeps 3 ms":
    {"note": "Dynamic global illumination that does not leak."},
  "perf(gi): the first build of the field is sliced over frames, and a camera move sends only the rebuilt range - the cards keep their light instead of starting the bounces again every step":
    {"note": "Dynamic global illumination that does not leak."},
  "perf(gi): a camera that moves rebuilds the following field a few milliseconds a frame - boxes built only when the scene changes, levels repacked only when they changed, slabs queued; measured with a walking camera":
    {"note": "Dynamic global illumination that does not leak."},
  "perf(gi): half the probe rows on a phone, and a continuous probe filter - GI on a Snapdragon 8 Elite 20.5 -> 6.4 ms":
    {"note": "Dynamic global illumination that does not leak."},
  "perf(gi): the scene key is asked every frame and the boxes are built only when it changes; profiling switch u_skip is declared so it reaches the engine":
    {"note": "Dynamic global illumination that does not leak."},
  "fix(gi): the dynamic GI runs on a device - the scene is fed through the native heap, the apply reads each probe's stored position instead of rebuilding it; phone numbers and a skip switch for measuring":
    {"note": "Dynamic global illumination that does not leak."},
  "feat(gi): a distance field of three levels that follows the camera, and point and spot lights - lit in the cards with the frame's own falloff, shadowed through the field, held to the CPU reference on the lamp lab":
    {"note": "Dynamic global illumination that does not leak."},
  "perf(gi): dynamic GI 8.9 -> 3.3 ms at 1080p - a card relit by a workgroup of 64 rays, cards relit in slices, probes by stride and a fixed count, the nearest instance recorded per field cell; frame timing tool":
    {"note": "Dynamic global illumination that does not leak."},
  "fix(gi): the dynamic GI has no dark seam in a wall corner and a quieter picture - probes are taken from the nine nearest with a tent weight, history blend 0.15":
    {"note": "Dynamic global illumination that does not leak."},
  "feat(gi): the dynamic GI reads material emission and baked meshes - cards carry the emissive colour, a mesh brings its distance field and cards through the cook, checked on the lab rooms as meshes":
    {"note": "Dynamic global illumination that does not leak."},
  "feat(gi): dynamic GI on the GPU - card lighting, 8x8 screen probes traced through the distance field, applied to the picture; no leak in the sealed room and 0.54-1.08 of Cycles in the lab rooms":
    {"note": "Dynamic global illumination that does not leak."},
  "feat(gi): screen probes - octahedral hemisphere probes traced through the distance field into the surface cache, many bounces by iteration, checked against Cycles on the lab rooms":
    {"note": "Dynamic global illumination that does not leak."},
  "feat(gi): surface cache - mesh cards baked at import, lit by the sun with distance-field shadows, and looked up by a ray's hit":
    {"note": "Dynamic global illumination that does not leak."},
  "feat(gi): mesh distance fields load as assets, import can bake them, and the scene field composes them into clipmaps with a sphere trace checked on WebGPU":
    {"note": "Dynamic global illumination that does not leak."},
  "feat(pipeline): mesh signed distance field baker for the dynamic GI - exact near the surface, thin walls grown to a body, half-float file format":
    {"note": "Dynamic global illumination that does not leak."},
  "fix(sdk): importing esengine/gameplay or esengine/replication installs them under a bundler that treats chunks as pure":
    {"note": "Importing a feature module installs it under a bundler that treats chunks as pure."},
  "feat(post): AgX is its own effect group, esengine/fx-agx, so a package that does not use it does not carry its 80 KB of tables":
    {"note": "AgX is its own effect group, `esengine/fx-agx`."},
  "feat(post): AgX carries Blender's own tables and looks - 57^3 view transform and the luminance-compensated contrast look - read tetrahedrally, packed to 81 KB; within 1 code of Blender":
    {"note": "AgX is Blender's AgX."},
  "feat(export): a web package bundles the SDK with the host and the scripts, so what the game does not reach is not shipped":
    {"note": "A web package carries only the SDK its game reaches."},
  "fix(sdk): importing esengine/ai, tilemap, logic, worldgen, rig2d or dragonbones installs them under a bundler that treats chunks as pure":
    {"note": "Importing a feature module installs it under a bundler that treats chunks as pure."},
  "fix(post): AgX reads its table tetrahedrally as Blender does, so greys stay grey; oracle scenes for AgX against Blender and for soft point and spot shadows":
    {"note": "AgX is Blender's AgX."},
  "refactor(sdk): the animator graph and grip poses ship in esengine/skeletal-animation, installed only where the content uses them":
    {"note": "The animator graph and grip poses ship in `esengine/skeletal-animation`."},
  "fix(post): light shafts run along the sun's direction on screen under an orthographic camera; oracle scenes for shafts":
    {"note": "Fog, water, sky, rain, depth of field and light shafts work under an orthographic camera."},
  "fix(post): rain and depth of field measure from the camera's plane under an orthographic camera; oracle scenes for rain, depth of field and custom sky":
    {"note": "Fog, water, sky, rain, depth of field and light shafts work under an orthographic camera."},
  "fix(render): a camera that does not start at the window's corner draws through the post chain":
    {"note": "A camera whose viewport does not start at the window's corner draws through the post-process chain."},
  "fix(post): sky and clouds place the cloud layer from the camera's plane under an orthographic camera; oracle scenes for the sky dome and cloud shadows":
    {"note": "Fog, water, sky, rain, depth of field and light shafts work under an orthographic camera."},
  "fix(post): height fog and underwater start their ray at the camera's plane under an orthographic camera; oracle scenes for both":
    {"note": "Fog, water, sky, rain, depth of field and light shafts work under an orthographic camera."},
  "feat(mcp): the 3D look is taught by the editor's MCP, not a guide page":
    {"note": "The 3D Starter looks finished out of the box."},
  "feat(templates): the 3D Starter ships a finished look - sun shadows, sky light, fog, exposure and grade - with a guide to getting it":
    {"note": "The 3D Starter looks finished out of the box."},
  "feat(mcp): audit_look says why a 3D scene looks flat, and apply_look gives it a finished look":
    {"note": "The 3D Starter looks finished out of the box."},
  "fix(prefab): a prefab whose root was parented under an authored Canvas saves with that Canvas as its root, so it opens again":
    {"note": "A prefab whose root was put under a Canvas opens again."},
  "fix(shadows): the lookup steps toward the light as far as a slope of 1.2 asks and takes the rest along the normal - a floor under a sun reads as it did, and a wall the light grazes still does not reach past a ceiling":
    {"note": "A wall under a roof is no longer sunlit along its top."},
  "feat(settings): a row for the cheaper dynamic GI, per quality level":
    {"note": "A quality level decides what the dynamic GI spends."},
  "fix(export): a 16-bit PNG ships as the file it is - a build shrank a 4096 heightmap to 2048 and decoded it to 8 bits, so exported ground stood in 256 steps where the editor drew 65536":
    {"note": "A 16-bit heightmap keeps its depth and size in a build."},
  "fix(export): a texture a Terrain reads as its heightmap ships as the file it is, whatever its size cap - an 8-bit heightmap over Max Size was still shrunk":
    {"note": "A 16-bit heightmap keeps its depth and size in a build."},
  "feat(water): an ocean reaches the horizon - a flat apron carries the surface on from its rings, so the sea no longer ends in a line where its mesh does":
    {"note": "An ocean reaches the horizon."},
  "feat(units): a shader param says it is a length with unit(length) and follows the project's units per metre, as components and effects do - the water's defaults were metres in an engine of centimetres":
    {"note": "One setting says what a unit is, for materials too."},
  "feat(assets): a texture's Use says whether it is a picture or numbers - Data keeps its depth and its size in a build, a 16-bit PNG is imported as Data, a Terrain's heightmap is marked Data when it is set, and Project Health lists the ones that are not":
    {"note": "A texture says whether it is a picture or numbers."},
  "feat(editor): a texture given to a Terrain as its heightmap is marked Data, and Project Health lists the ones read as numbers that are still pictures":
    {"note": "A texture says whether it is a picture or numbers."},
  "fix(terrain): the ground's lengths follow the project's units - a new Terrain is a kilometre on 2 m cells in a centimetre project and a metre one, its shaders' tiles, relief and wet line say unit(length), a layer with no tile repeats every 4 m, and ground with layers is no longer sent four colours its shader does not have":
    {"note": "The ground's lengths follow the project's units."},
  "fix(water): water mirrors only what is there - over open sea with nothing behind it the reflection took the unpainted sky for something met and went black, and a ripple that sent the ray down drew the sea bed as white flecks; the copy of the scene's distances marks the sky, a ray goes on up, and waves finer than a pixel widen the highlight":
    {"note": "Water mirrors only what is there."},
  "feat(material): a shader param's range is where its slider runs, not a limit on the value - a material may hold a number typed past it, as a UI range does in Unreal":
    {"note": "A shader param's range is where its slider runs."},
  "fix(water): a reflection's step and the thickness of what it meets are shares of the distance, not a number of units, and the sky in the copy of distances is as far as the copy can say":
    {"note": "Water mirrors only what is there."},
  "feat(material): a shader param's range is where its slider runs, not a limit - a typed value may go past it":
    {"note": "A shader param's range is where its slider runs."},
  "feat(water): the wind's ripples are a map of many waves, not six - two fields of a built-in tiling normal map, default(ripples), read with mips, where six straight wave trains crossed in a board of dark spots once the short ones had faded":
    {"note": "The wind's ripples are a map of many waves."},
  "feat(water): a sea is eight waves spread about the wind, not four - each shorter and lower than the last at a heading of its own, so the swell no longer reads as bands; the shader's waves are written out from the one table the CPU sums, and a quality level allows 3, 5 or 8 of them":
    {"note": "A sea is eight waves spread about the wind."},
  "feat(water): the quality row and the checks know the water's eight waves":
    {"note": "A sea is eight waves spread about the wind."},
  "feat(water): water is a body and a surface, and its ripples do not repeat - the body's colour is lit as light from under the surface instead of darkening on the far side of every ripple, the surface is a coat of water's reflectance over it, the ripples are three layers of the map at sizes that share no multiple with gusts and slicks across them, and every number of it is a material param":
    {"note": "Water is a body and a surface."},
  "feat(terrain): a colour map over the ground - Terrain.colorMap is a picture laid over a whole area and mixed into the ground's colour by its alpha, on the plain shader and on the layered one, with colorMapStrength read each frame":
    {"note": "A colour map over the ground."},
  "fix(materials): a mesh shader's eighth texture finds a unit - reading its base texture as u_textures[0] was counted as reading all eight batch units, so Ground Blend lost its wet map and did not compile on WebGPU, and voxel ground had given its own up; a literal index is that unit alone":
    {"note": "A mesh shader's eighth texture finds a unit."},
  "feat(foliage): a density map and a colour map - Foliage.densityMap says how many of the plants stand where, so flowers grow in drifts, and Foliage.colorMap colours them by where they stand, so one mesh and one material make a meadow of many colours":
    {"note": "A meadow: a density map and a colour map for Foliage."},
  "fix(foliage): a field of any size is cut into cells no wider than its cell size - past 200 cells a side each cell was left wider than the plants scattered in it, so a meadow over a large terrain grew in clumps with bare ground between":
    {"note": "A Foliage field of any size is cut into cells no wider than its cell size."},
  "feat(foliage): far versions that thin plant by plant and are grown only where they are drawn - up to three, each the same plants fewer and larger, chosen by each plant's own number so nothing jumps where one takes over; with a material each is a layer of cells of its own, so a meadow is whole near the eye and a tenth of itself far off, and it fades to none at its draw distance":
    {"note": "Foliage thins plant by plant with distance, and is grown only where it is drawn."},
  "feat(gates): --suites related runs of an owed suite only the tests that reach what changed - where its runner can follow imports from every changed file, and the whole suite where it cannot; the run names each suite it ran in part":
    {"internal": "How the repository's own checks are run before a push; nothing a creator sees."},
  "feat(foliage): a field draws with its own instance of its material, grass widens as it thins, and a palette colours each plant - two fields on one material wrote their own values over each other's; a blade now widens by as much as its neighbours are left out so the field covers the same ground at every distance; and Foliage.palette is a strip each plant takes the colour of its top from":
    {"note": "A Foliage field has its own material instance, grass that widens as it thins, and a palette."},
  "feat(terrain): a baked occlusion over the ground - Terrain.occlusionMap is an image whose red says how much of the sky reaches the ground, for the gullies and cliff feet no screen-space pass sees across; it dims the light from all round and leaves the sun's to the shadows":
    {"note": "A baked occlusion over the ground."},
  "fix(water): water is as deep as it is, not as far as the eye's line through it - the light a pixel shows crossed the depth under it at the slope light takes in water, where the straight line to the bed made any sea seen low across it deep and blue; the bed is dimmed by the water its light came down through too, and how soon the water's colour deepens is a param":
    {"note": "Water is as deep as it is, not as far as the eye's line through it."},
  "fix(water): a far sea mirrors the sky again - the widening of the highlight by how the normal turns across a pixel made distant water as rough as chalk and took most of its glancing reflection away; it is gone, and the ripple map's own mips are what keep far water from flashing":
    {"note": "Water mirrors only what is there."},
  "fix(terrain): a splatmap is numbers too - cooked as a picture its three weights were overwritten wherever the fourth was 0, and the whole ground was painted as grass; it is marked Data when it is set, as the heightmap is":
    {"note": "A texture says whether it is a picture or numbers."},
  "perf(lighting): a lit sprite is lit by its own short function - the general model's sums term for term, the two 2D masks read once for the pixel where each light read them again, and none of the highlight carried along; 32 screen-filling lit layers under four lamps go from 5.4 ms to 4.7 on WebGL2 and from 8.8 to 6.5 on WebGPU, and the note prices what is left":
    {"note": "2D lighting works out only the lights that reach a pixel."},
  "perf(lighting): a lit quad says which lights can reach it and its pixels work out only those - the reach is settled where the sprite is submitted, quad by quad, and rides beside the layer in the lane the layer already had; 448 lit tiles four deep under sixteen local lamps go from 2.03 ms to 0.58 on WebGL2 and from 2.72 to 0.76 on WebGPU with the same pixels, and a render gate pins the light slots spared":
    {"note": "2D lighting works out only the lights that reach a pixel."},
  "feat(tilemap): a tilemap layer can be lit - TilemapLayer.lit draws its tiles with the program a lit sprite uses, and which of the loop's lights a flat lit pixel works out is its screen tile's say, so strips stay on the GPU while lights move; four lit layers under sixteen local lamps cost 0.71 ms where working every light out cost 2.58":
    {"note": "A tilemap layer can be lit."},
  "feat(text): Text has letter spacing - Text.letterSpacing is extra px after every glyph and a negative value draws them closer; the layout always took one and no path handed it over. Retained labels, the per-frame fallback and inline images read a Text through one derivation, which gives the fallback the underline it never drew":
    {"note": "Text has letter spacing."},
  "feat(native): a game calls its own Java or Objective-C by name - NativeChannel.call, has and on reach the handlers an app registers (NativeChannel.register on Android, EstellaNativeChannel on iOS) with JSON both ways, and Ads works on a device once that code answers ads.show; the engine links no ad SDK":
    {"note": "A game calls its own native code by name."},
  "fix(aot): the engine digest counts TilemapLayer.lit - the field landed without it, so a packaged native game refused its own compiled systems as built against a different engine; the digest and the two conformance files are regenerated":
    {"internal": "Repairs a field added since the last release: no released build refused its compiled systems."},
  "feat(modeling): scatter stands copies off a path in rows - rows 1 or 2 with sweep, lift and up lays the leaflets of a frond or the barbs of a feather in one step where each was a step of its own, and sizes shapes them along the path; a palm of 386 steps is 40":
    {"note": "An AI can lay leaflets along a stem in one step."},
  "feat(modeling): the model tools say scatter's rows - rows, sweep, lift, up and sizes are in what model_write offers":
    {"note": "An AI can lay leaflets along a stem in one step."},
  "feat(modeling): a model source names its numbers and repeats its steps, and a leaf is a strip that reads a picture - params, sums written \"=length * 0.4\", repeat over rows and let; a strip step for a band with no thickness and a picture along it, material.texture for the picture, and an up for loft; a palm is six steps written and a third of the triangles":
    {"note": "A model is written once for all its like parts, and a leaf can be a picture."},
  "feat(modeling): the model tools say names, sums and repeats, strip, and a material's picture - and a model whose picture is not in the project is refused before anything is written":
    {"note": "A model is written once for all its like parts, and a leaf can be a picture."},
  "fix(repo): put back the modeling commit the last one took out - 'a flower turns to face the eye' was built on the tree as it stood before 641f0da4e landed and committed on top of it, so it reverted that commit's files; they are as that commit left them, with both commits' notes":
    {"internal": "Repairs the repository after one commit reverted another; the feature it restores has its own note."},
  "feat(image): a picture repeats, and a picture is a surface - tile brings what leaves one edge in at the other (shapes, lines, brush strokes, shadows, blurs, noise), and material draws the relief, roughness and metal as grey pictures of their own, from which a normal map and a surface map are made":
    {"note": "An AI can draw a surface: a picture that repeats, with what the light does on it."},
  "feat(image): image_write makes a surface - a repeating picture is shown laid beside itself and under a light, and its normal map, surface map and material are written with it":
    {"note": "An AI can draw a surface: a picture that repeats, with what the light does on it."},
  "feat(sound): a sound effect is the layers that make it - an .essound of tones, noise and the ringing of struck things, each shaped by an envelope, filters, a bend, a drive and repeats, with an echo and a room over the whole, makes the .wav a game plays; and a picture of the sound, its wave over its pitches, for whoever cannot hear it":
    {"note": "An AI can make a sound effect."},
  "feat(sound): sound_write, sound_edit and sound_read - an AI makes a sound effect from layers and is answered with the picture of it, its level and where its energy lies":
    {"note": "An AI can make a sound effect."},
  "feat(sound): a made sound is built as a real one is - noise in bands that each die at their own rate, a tail to a decay, an impulse for the front of a bang, strikes scattered in time and pitch, a bounce, a peak filter, and a place made by convolution with first echoes and a top that dies before its bottom":
    {"note": "An AI can make a sound effect."},
  "feat(sound): sound_write teaches the method - bands of noise behind an impulse, strikes scattered by the hundred, two clicks to a step, and what a real bang looks like in the picture":
    {"note": "An AI can make a sound effect."},
  "feat(sound): layers struck together, sounds that differ, and a recording to be like - a group is several layers as one event to repeat or scatter, variants makes up to eight files that are the same sound and not the same samples, and reference draws a recording above the made sound to one scale of time":
    {"note": "An AI can make a sound effect."},
  "feat(sound): variants write a sound event, a reference is drawn above the sound, and sound_read reads a recording - the model tools say groups, variants and references":
    {"note": "An AI can make a sound effect."},
  "fix(sound): the tool text makes a footstep as a shoe on a floor - a blow on something that rings briefly, heel then ball of the foot, a scrape, and a place round it, where it taught the tick of a machine":
    {"note": "An AI can make a sound effect."},
  "chore(desktop): the sound tool text makes a footstep as a shoe on a floor":
    {"note": "An AI can make a sound effect."},
  "feat(music): a piece of music is its instruments, the patterns they play and the order they come in - an .esmusic of steps written as degrees of the key, with chords a bass or a pad follows, makes a .wav that runs into itself and a file for each instrument; and a picture of its notes for whoever cannot hear it":
    {"note": "An AI can make background music."},
  "feat(music): music_write, music_edit and music_read make background music from instruments and patterns - the reply is a picture of the notes and what can be said of them unheard":
    {"note": "An AI can make background music."},
  "test(editor): the sound and music tools are run in the editor - a check writes a sound with variants and a reference and a piece with stems, edits both, and holds a refused source to changing nothing":
    {"internal": "A check of tools already noted; nothing a user sees changes."},
  "chore(desktop): an editor check runs the sound and music tools":
    {"internal": "A check of tools already noted; nothing a user sees changes."},
  "feat(music): an instrument can be recordings of a real one - samples name a recording for each of a few notes, every note of the piece is played from the one nearest it, faster to be higher and slower to be lower, and a held note goes round the steady middle of its recording":
    {"note": "An AI can make background music."},
  "feat(music): music_write plays instruments made of recordings in the project - the tool text says how many are needed and which loop, and the editor check plays one":
    {"note": "An AI can make background music."},
  "feat(music): a recording called a note it is not is heard and said - the pitch of each of an instrument's recordings is found, and one that is not the note it is named, or a whole library an octave out, is a warning with the note to set":
    {"note": "An AI can make background music."},
  "docs(music): the tool text says the reply listens to each recording and that recordings differ in level":
    {"note": "An AI can make background music."},
  "feat(music): a piece that ends rings out and can fade, and a loop says where it meets itself - loop false keeps what rings past the last bar, fadeIn and fadeOut are its to set, and a loop whose last bar is unlike its first is a warning that names what stops dead":
    {"note": "An AI can make background music."},
  "feat(music): the reply gives the join of a loop or how long an ending rings, and the tool text says how a loop is written and who fades one":
    {"note": "An AI can make background music."},
  "feat(music): recordings played soft and loud that take turns, a recording as a layer of a sound, and an instrument out of a SoundFont - samples carry dynamic and tune and share a note in turn, a sound has a sample layer shaped as any other, and an .sf2 is read for its instruments and one lifted out as recordings with their notes, ranges, tuning and loops":
    {"note": "An AI can make background music."},
  "feat(music): soundfont_read lists a SoundFont and takes an instrument out of it, and a sound's sample layers read their recordings - the tool text says dynamics, turns and where recordings come from":
    {"note": "An AI can make background music."},
  "fix(music): a real SoundFont comes out as it sounds - zones it plays together are one kept, an instrument set whole octaves from its recordings comes out at their pitch and says so, and the pitch heard in a recording is right for a high note at a low rate and counts its tuning":
    {"note": "An AI can make background music."},
  "docs(music): soundfont_read says what a SoundFont does that is undone on the way out":
    {"note": "An AI can make background music."},
  "feat(audio): music with an introduction, and a source that fades - a looping voice comes back to loopStart and not to its start, on the web, a mini-game and the native host, from playBGM or an AudioSource; an AudioSource comes up over fadeIn and goes down over fadeOut before it stops; and a piece of music marks its first parts as an intro and says where the round begins":
    {"note": "Music with an introduction, and a source that fades."},
  "feat(music): the reply gives where the round begins for a piece with an introduction, and the tool text says how a game plays one and how a source fades":
    {"note": "An AI can make background music."},
  "feat(music): a line is played and not only sounded - dynamics give each bar the loudness it begins on and move evenly between, legato brings a note in under the one before from past its attack, and pedal holds every note of a piano to the end of its bar":
    {"note": "An AI can make background music."},
  "feat(music): the tool text says dynamics, legato and the pedal, and that a piece without them is notes and not playing":
    {"note": "An AI can make background music."},
  "feat(music): a piece is mixed, breathes, and takes all a SoundFont gives - master compress and shelves and an instrument's lowcut and highcut, rubato that gives and takes back time across a pattern, and from a SoundFont both sides of a stereo recording with each zone's level and filter as the sample's gain and cutoff":
    {"note": "An AI can make background music."},
  "feat(music): the tool text says how to mix a piece, when time should give, and how a part is written against another - a bass that moves, a second line, chords laid out by hand":
    {"note": "An AI can make background music."},
  "fix(music): the tool text puts leaving a part alone before adding to it - a walking bass and a second line made a quiet piece worse when they were heard, so a held bass under a slow tune is said to be right and movement is for where a piece is bare":
    {"note": "An AI can make background music."},
  "chore(desktop): the music tool text puts leaving a part alone before adding to it":
    {"note": "An AI can make background music."},
  "fix(music): an instrument only struck as a drum is not told its recording is the wrong note - the pitch found in a drum is not a note it can be out of":
    {"note": "An AI can make background music."},
  "feat(music): scales of five notes, for a piece or for one instrument in it - pentatonic and the five Chinese modes count their degrees to five, so a line cannot touch the two notes they leave out, and an instrument's own scale writes a five-note tune over chords that have all seven":
    {"note": "An AI can make background music."},
  "feat(music): the tool text says the five-note scales and how a tune in one sits over a piece in seven":
    {"note": "An AI can make background music."},
  "fix(audio): a loop is seamless in a packaged game, and an effect is on time - an exported .wav became an MP3 that decodes with 1105 samples of silence before it and more after, so every loop had a gap each time round and every sound began a fortieth of a second late; the exporter now records how long each clip really is and the web, mini-game and native backends play it from past the silence to its real end":
    {"note": "A loop is seamless in a packaged game."},
  "feat(music): a piece that goes round is set to be decoded when a game loads it - played from its compressed file it could not loop between two samples, and the reply says what it costs in memory":
    {"note": "An AI can make background music."},
  "feat(audio): music plays as its layers - playLayers begins every stem of a piece on the same sample, each with a level of its own that is brought up and down while it plays, and plays the whole piece in their place where layers cannot be kept in step":
    {"note": "Music plays as its layers."},
  "feat(music): the reply and the tool text say how a game plays a piece's stems as layers":
    {"note": "An AI can make background music."},
  "feat(sky): a sky of your own shades the ground under its clouds - defineSkyEffect takes groundShadow and a second function, skyShadow(world, sun), what is left of the light at a world position, and the sky pass multiplies every surface it finds by it, as Sky Atmosphere does with its own clouds":
    {"note": "A sky of your own shades the ground under its clouds."},
  "fix(terrain): a colour map and an occlusion map lie the way the heightmap does - Terrain.colorMap, Terrain.occlusionMap and Foliage.colorMap were sampled with their rows turned over, so a picture painted to match a heightmap, a splatmap or a density map came out mirrored north to south under them; an image over an area now has its first row along the least z whoever reads it":
    {"note": "A colour map and an occlusion map lie the way the heightmap does."},
  "fix(water): the sea past the rings lies at the sea's level - the apron that carries an ocean to the horizon took its inner edge's height from the water under it, so with a river on high ground under that edge a strip of sea eighty kilometres long rose to the river's height; the apron's vertices are marked and the shader lays them at the ocean's level":
    {"note": "The sea past the rings lies at the sea's level."},
  "feat(water): a waterfall - a Waterfall on an entity at a lip throws sheets of water level at a speed and lets gravity take them, each ending where it meets the ground or water that is not the water it left; it is the entity's own MeshRenderer, and with no material it takes the stock Waterfall shader, glass at the lip tearing into strands that ride down with the water":
    {"note": "A waterfall."},
  "feat(water): an anchor on a waterfall - a child of a Waterfall with a WaterfallAnchor is kept on the middle of the fall, at its foot wherever the water lands or a share of the time down, so the mist a ParticleEmitter makes there follows the fall when what is under it changes":
    {"note": "An anchor on a waterfall."},
  "feat(post): the tonemap has the fitted ACES curve too - Tonemap's Fitted ACES (u_curve 1) runs Hill's fit of the RRT and ODT, the one three.js calls ACES Filmic, in place of the engine's curve: a picture made for it was a third brighter in its shadows and kept colours it sends to white":
    {"note": "The tonemap has the fitted ACES curve too."},
  "feat(terrain): a cliff's beds can wander - a layer read from the side lies by height, so its beds ran dead straight along a whole wall; Terrain Layers' u_strataWarp moves them up and down by slow noise u_strataSpan wide, and 0, the default, leaves them straight":
    {"note": "A cliff's beds can wander."},
  "fix(water): a waterfall falls in strands, not in speckle - the stock Waterfall shader's pattern was sixteen times too fine each way, so a sheet was a solid white board peppered with dark flecks; about four strands now lie across half a sheet and one lasts about a second of the fall, and u_strands 60 with u_run 15.4 is the old pattern":
    {"note": "A waterfall falls in strands, not in speckle."},
  "fix(water): a waterfall's foot is torn to veils, and light goes through it - three blended sheets added up to a board at the foot, where the fall the shader was made from shows the most of its three: the stock Waterfall tears more of the foot away (u_veil 0.75, u_tearBy 1), and u_translucency lights the sheet from whichever side the sun is on":
    {"note": "A waterfall's foot is torn to veils, and light goes through it."},
  "fix(webgpu): a view of many materials no longer loses the device - the bind group cache held 256 and was emptied when full, so a view that binds more made every group again each frame and the device ran out of descriptors after some hundreds of frames; it holds 4096 by hash and lets go only of what the last two frames did not bind":
    {"note": "A view of many materials no longer loses the WebGPU device."},
  "feat(terrain): a layer with a grain is read without repeat and without hexagons - near the eye every hex cell took its layer turned any way round, so sand in ripples or rock in beds was lit cell by cell and showed the cells; u_antiTileTurn is how far a cell may be turned, and 0 shifts it only":
    {"note": "A layer with a grain is read without repeat and without hexagons."},
  "fix(foliage): grass on a hill is not thinned under your feet - a cell stood at the Foliage entity's height while its plants stood on the ground, and how far a cell is was measured from the cell, so on ground 16 m up the grass at the eye was thinned as grass 19 m off and on a mountain all of it was; a cell stands on the ground under its centre":
    {"note": "Grass on a hill is not thinned under your feet."},
  "feat(foliage): a far field of flowers shows its colour - a far mesh plant grows across the ground, so a flat flower was a disc facing the sky, edge on to a low eye, and a meadow lost its colour a field away; Foliage.farTilt tips the top of each far plant over, its own way round, and its stem stays upright":
    {"note": "A far field of flowers shows its colour."},
  "feat(foliage): a flower turns to face the eye - a material's vertex hook reads the mesh's second uv as es_vertexUv1, and a Foliage with faceEye puts there where each vertex of a plant's head sits from its axis; the Foliage shader turns the head about it, by faceEyeNear close to and faceEye far off, so a far field of flat flowers shows its colour from a low eye":
    {"note": "A flower turns to face the eye."},
  "feat(foliage): a blade's lean, its turn to the eye, and what a leaf lets through and mirrors are yours to set - Foliage.bladeLean was a 0.12 written into the builder, the mirror a 0.5 written into the shader, and the light through a leaf could only be the leaf's own colour; u_bladeFaceEye turns a blade's flat to the eye":
    {"note": "A blade's lean, its turn to the eye, and what a leaf lets through and mirrors are yours to set."},
  "feat(post): the grade has a gain and an offset, and the vignette a radius and a roundness - a grade could lift the blacks and not sink them, so a look whose contrast is a line through 0.5 came out a third as saturated in the dark; and a vignette was always full at the middle of every edge":
    {"note": "The grade has a gain and an offset, and the vignette a radius and a roundness."},
  "feat(foliage): a scale map - Foliage.scaleMap says how large the plants stand where, as the density map says how many, so a sward gets shorter as it runs out and its edge is soft where thinning alone left tufts at full height":
    {"note": "A scale map."},
  "fix(terrain): a splatmap is read between its pixels - the ground took the nearest pixel of its splatmap, and a page near the eye samples finer than the paint, so every pixel of a splatmap was a flat square on the ground and a soft edge between two layers was a staircase":
    {"note": "A splatmap is read between its pixels."},
  "feat(assets): a texture can ship as its recipe - an .esimage named where a texture goes is carried as its source and drawn on the device when it loads, to the pixels its png has; the raster that draws it moved from the pipeline into the SDK as esengine/image, which an export adds when a recipe ships":
    {"note": "A texture can ship as its recipe."},
  "feat(assets): a texture recipe is drawn on a worker, once - the picture is drawn off the main thread and its pixels are kept in the content cache, so the next run reads them and draws nothing; a browser has a content cache now, in IndexedDB, and a changed recipe or raster is a different entry":
    {"note": "A texture recipe is drawn on a worker, once."},
  "feat(assets): a recipe is read wherever an image is, with its text, its figures and its surface maps - a ground's layers and a field's maps take an .esimage, a map of a picture is a two-line recipe that names it, text is set by the device's canvas and a figure is posed by the bones the pipeline poses, which moved into the SDK; a recipe ships with the pictures and fonts it names and is drawn again when one changes":
    {"note": "A recipe is read wherever an image is, with its text, its figures and its surface maps."},
  "feat(assets): a picture's source is one kind of asset that ships as a texture - an .esimage made in the editor is a recipe an export carries and a game draws, where its type sent it out as a file nothing loads; the editor takes it in a texture field and writes a picture's maps as recipes beside it":
    {"note": "A picture made in the editor ships as a recipe."},
  "fix(render): the built-in ripple map is drawn again after a device loss, and no copy of it is kept - every game held 256 KB for a map only water reads; and the checks that went red since: a cost scene with no criterion, TilemapLayer.lit in its defaults, NativeChannel frozen before it earned it, a wav encoder that refused read-only channels, a worker test with five seconds for twenty realms":
    {"note": "A game no longer keeps a copy of the built-in ripple map."},
  "fix(docs): the manual builds again, and a gate reads what broke it - an apostrophe in Waterfall's summary ended its string and five links were written from the site's root, so 0.104.0 published with the manual not deployed; check-doc-sources parses the data files and reads every page's links without building the site":
    {"internal": "the manual's own build and a gate over its sources; no page a reader sees changed but the five links that now resolve"},
  "fix(terrain): a ground with more pages wanted than it holds no longer throws every frame - the pages it had chosen to draw were marked in use only after new pages were made, so a new page took the slot of one about to be drawn and its node was placed on nothing":
    {"note": "A large ground no longer throws every frame once its pages run out."},
  "fix(terrain): a ground with no layer files is painted again - its paint is the eighth texture of its shader and found no unit, because three colours the shader keeps in s0..s3 were read as four engine units in use; a name a WGSL source declares for itself is no longer a unit, and a criterion draws a painted ground":
    {"note": "A ground with no layer files is painted again."},
  "fix(water): baking a water region no longer holds the frame - its steps were a fixed count of rows and whole sweeps of the grid, 70 to 400 ms each at 2048 texels a side; a step is a count of cells now, 20 ms at the most":
    {"note": "Baking a water region no longer holds the frame."},
  "perf(streaming): a layer of chunks with nothing left to make is not walked - every cell in reach was keyed, measured and asked each frame, 9 ms for six fields of plants with the camera standing; the walk is kept while its sources stand and skipped once every chunk is made":
    {"note": "A meadow at rest no longer costs the frame 9 ms."},
  "fix(render): a cloud's shadow dims the sun, not the sky - a sky's clouds multiplied every surface in its post pass, ambient and emission included; now the sky draws a cloud shadow map before the scene into a tile of the sun's shadow atlas and the first directional light reads it where each surface is shaded, as Unreal's atmosphere sun reads its clouds' shadow map":
    {"note": "A cloud's shadow dims the sun, not the sky."},
  "feat(render): an ambient light's diffuse has its own scale and tint - Diffuse Scale and Diffuse Tint multiply the light an environment gives surfaces and leave what they reflect of it and the sky drawn behind them alone, as Unreal's Sky Light keeps Intensity apart from its Indirect Lighting and Specular scales: a sky whose irradiance is too dark or too blue for a look is lifted without brightening every reflection":
    {"note": "An ambient light's diffuse has its own scale and tint."},
  "feat(render): a terrain layer and a field of plants each say how much of the sky reaches them - a .esterrainlayer's occlusion scales the occlusion its mask holds, and the Foliage material's u_rootOcclusion dims a plant's root and nothing at its tip; both reach the lighting model's ambient occlusion, which dims the environment's light and not the sun's, as a material's Ambient Occlusion does in Unreal: grass shaded by its own blades and the ground under it take less of the sky than bare rock":
    {"note": "A terrain layer and a field of plants each say how much of the sky reaches them."},
  "chore(gates): what the checks asked of this week's work - a disposition for esengine/image in a native script and its namespace there, Waterfall's width and its place in the corpus, the recipe worker's bundle as not a contract, shadeLight2D's inout against its return, and a test that named App as a type":
    {"internal": "tables the gates read, brought level; a natively packaged script can now import esengine/image, which no native game has run yet"},
  "feat(image): a picture's source goes where a texture goes, and its maps are recipes too - a texture field takes an .esimage, the image tools write a picture's normal and surface maps as recipes beside it and answer their refs, text is set by the drawer a game sets it with, and the viewport draws a recipe as a game does":
    {"note": "A picture made in the editor ships as a recipe."},
  "fix(checks): the quality page's water rows are the levels the engine has, and a template to mirror has its native channel header - Low draws 3 waves and High 8 since the wave set grew, and an iOS template without EstellaNativeChannel.h is incomplete":
    {"internal": "two checks brought level with what the engine does; nothing a creator sees changed"},
  "fix(checks): the motion sheet call has the time a slow runner takes - sixty stepped frames passed two minutes on the runner that takes the check twice as long, four times in fourteen builds":
    {"internal": "a longer wait in an editor check on a slow runner"},
  "fix(terrain): a detail the pages cannot hold no longer cracks the ground - a tree that wanted more nodes than the atlas has pages was drawn in part by coarser pages standing in, which do not meet their finer neighbours' edges, and the pages were fought over every frame; the ground is now drawn at the share of its detail's range that fits, and says so once":
    {"note": "A detail the pages cannot hold no longer cracks the ground."},
  "fix(foliage): a far plant grows across the ground, not taller - a mesh plant kept in a far version was grown the same every way to cover the ground of those left out, so a flower that stood for ten stood ten times as high and a far meadow was a field of poles; it now grows across the ground only, and Foliage.farGrowUp gives its height a share of the growth back":
    {"note": "A far plant grows across the ground, not taller."},
  "feat(physics3d): things that break - a model's fracture step cuts it beforehand into pieces that fit with no gap, the editor writes them as a prefab of bodies and hulls, and a Breakable swaps the whole for them when its flag is raised, throws them out from where it was struck and mends when the flag is lowered; its pieces are loaded while it stands, so they appear on the frame it breaks":
    {"note": "Things that break."},
  "feat(editor): a model with a fracture step writes its pieces and their prefab, and the reply hands over the Breakable that breaks it":
    {"note": "Things that break."},
  "feat(physics3d): a thing breaks when it is hit hard enough - every 3D contact carries the speed at which the two came together, read before the solver from Jolt and PhysX alike, and a Breakable with a breakSpeed breaks on a hit at least that fast, from where it was hit":
    {"note": "A thing breaks when it is hit hard enough."},
  "feat(editor): a fractured model's reply hands over a hull of its shape, and the breakable check drops a stone on one pot and a pebble on another":
    {"note": "A thing breaks when it is hit hard enough."},
  "feat(physics3d): a hit is judged by its impulse - every 3D contact carries the mass the two met with and the impulse, speed by mass, and a Breakable breaks on a hit at least as hard as its breakImpulse; RigidBody3D.mass gives a moving body a mass of its own in kilograms, 0 keeping the one its shape gives":
    {"note": "A thing breaks when it is hit hard enough."},
  "feat(editor): the breakable check drops a 2 kg stone and a 50 g pebble from the same height, and the tool text says how hard a hit is":
    {"note": "A thing breaks when it is hit hard enough."},
  "feat(physics3d): a script can push a 3D body about - Physics3D applies forces, impulses and torques at a point or the centre of mass, reads and sets linear and angular velocity, reads mass, wakes and sleeps bodies and changes gravity, from Jolt and PhysX alike; explode strikes everything in reach and every Breakable it reaches; Broke is sent when a thing breaks":
    {"note": "A script can push a 3D body about."},
  "feat(editor): the breakable check sets off a blast beside the last pot, which breaks it and throws the pebble at its foot":
    {"note": "A blast."},
  "feat(physics3d): a turned box and an upright capsule can be swept, a body's mass data read, and a joint's range, motor limit, lengths and spring changed while it runs, from Jolt and PhysX alike; a Jolt motor switched on in play keeps its torque limit":
    {"note": "A joint changed while it runs."},
  "feat(physics3d): what a shooter asks of the 3D world - raycastAll names every body on a line with how thick it was, joints give way past a breakForce or breakTorque, a character's meetings are told and strike what can break, and Hitboxes put a box on each bone that follows the animation, from Jolt and PhysX alike":
    {"note": "A shot through cover."},
  "feat(editor): the shooting-physics check aims at an animated character's bones, shoots through a wall and hangs two weights on ropes rated either side of their load":
    {"note": "Telling the parts of a character apart."},
  "fix(assets): an empty asset path is no asset, and is asked for by nobody - an empty string in a handle field went to the resolver, came back still a string, was written back as one and asked for the same load again without end; a field of plants whose material had been cleared put it on every cell it grew and the packaged game stopped answering; a path nothing resolves keeps its placeholder":
    {"note": "A cleared asset field no longer stops a game."},
  "fix(image): a package that ships texture recipes can draw them - esengine/image installs its drawer with a call that the build puts in a chunk the native entry shares, the chunk was not listed as having side effects, and a bundler dropped the whole of it: an export drew its ground and its walls with no texture; the chunk is listed, and the boot check bundles a consumer that imports the subpath and looks for the drawer":
    {"note": "A package that ships texture recipes draws them."},
  "fix(playable): a playable imports the module an asset needs and its entry does not carry - the whole entry installs what a scene can name and not esengine/image, which only a texture recipe asks for, so a playable shipped its recipes and drew none of them; the modules its cooked assets name are imported before the host, and one with no recipe carries no drawer":
    {"note": "A package that ships texture recipes draws them."},
  "feat(image): a picture made in the editor is named by its recipe - image_write answers the .esimage as ref and as the texture of meshRenderer, and the material it writes names its maps as recipes, so a game ships layers and not pixels (a project of six textures packaged 2.4 MB lighter); the .png is pngRef. The Play realm imports esengine/image, as the edit realm does: a scene naming a recipe played with no texture":
    {"note": "A picture made in the editor is named by its recipe."},
  "feat(audio): a sound or a piece of music can ship as its recipe - an .essound or .esmusic named where a clip goes is carried as its source and made on the device when it loads, by the synthesis the editor bakes it with, on a worker and kept in the content cache; a game of five clips packaged 1.7 MB lighter":
    {"note": "A sound or a piece of music can ship as its recipe."},
  "feat(audio): a sound made in the editor is named by its source - sound_write answers the .essound as ref (the .wav is wavRef) and music_write adds recipeRef beside the .wav, with what each costs; the edit realm and the Play realm import esengine/sound, so a clip named by its source plays in the editor as it does in a package":
    {"note": "A sound or a piece of music can ship as its recipe."},
  "perf(audio): a piece of music is made in less than half the time - a note's sample loop asked for an exponential and a sine again every sample and read each pitch, loudness and filter corner through a curve; what does not change is worked out before the loop, a decay is a product kept up sample by sample and a ringing mode a point carried round a circle: a minute of music in 2.4 s where it took 5.3, two samples in five million off by one step of sixteen bits":
    {"note": "A sound or a piece of music can ship as its recipe."},
  "fix(playable): a playable samples its textures as their .meta says - the page was handed no manifest, so no texture's wrap, filter, colour space or 9-slice border reached it and each took the defaults: a ground or a wall whose picture repeats drew one copy and smeared its edge over the rest, right in the editor and in a web export and wrong in the playable; the import settings of what is inlined ride in the page and the host hands them to the runtime":
    {"note": "A playable samples its textures as their import settings say."},
  "perf(render): drawing a frame costs the CPU a third of what it did - a draw no probe lights reads the zero block instead of staging its own, a draw binds only the texture units its program samples, the cull face is cached, vertex arrays are bound without asking the browser for their index buffer (no FULL_ES3), and device objects are found by index":
    {"note": "Drawing a frame costs the CPU a third of what it did."},
  "fix(foliage): a mesh scattered with no material keeps its own colours - a field with no material painted every plant the stock green of grass from root to tip, a mesh's own vertex colours with it, so a grey rock came out a green one and a dark spruce a pale one; a mesh that has colours is painted in them, each plant by its shade, and one with none (or white throughout) is painted as before":
    {"note": "A mesh scattered with no material keeps its own colours."},
  "fix(text): a wide blurred shadow is one soft shape - a blur was always one ring of eight copies of the label at its own radius, which is a soft edge at two or three pixels and nine separate labels at eighteen: a title set large stood in blocks of dark squares; past three pixels the copies are as many rings as keep each within a stroke's thickness of its neighbours, sixty-four at the most":
    {"note": "A wide blurred text shadow is one soft shape."},
  "fix(playable): a playable waits for its shaders when the project asks it to - prewarmShaders was read by the web host alone, so a single-file page opened on an empty scene that filled in over seconds; its canvas is now kept out of sight while the first scene's shaders compile, for prewarmTimeoutMs at most":
    {"note": "A playable waits for its shaders when the project asks it to."},
  "perf(terrain): a ground's layer pictures are read together - each layer's albedo, normal and mask were read one after another, and a picture that is a recipe is drawn when it is read, so a ground of four layers stayed out of sight for as long as twelve drawings took in a row; they are asked for at once and drawn on as many workers as there are":
    {"note": "A ground's layer pictures are read together."},
  "fix(render): a shader warm-up waits for the scene still being made - it stopped at the first three frames with nothing compiling, and a ground still painting its pages or a field still growing its cells asks for its shaders seconds later: half the runs of one scene opened early and filled in; Terrain and Foliage now hold the warm-up while they prepare (holdShaderWarmup)":
    {"note": "A shader warm-up waits for the scene still being made."},
  "perf(render): sprite and particle shaders compile in the background too - the batch shader's variants and the particle shader were linked in place whatever asyncShaderCompile said, a third to half a second of one frame when a lit sprite or the first particle appeared; they are deferred as mesh shaders are, their samplers seeded when the link lands":
    {"note": "Sprite and particle shaders compile in the background too."},
  "perf(render): walking a frame's meshes asks nothing by name - a material's per-draw questions were string searches, a still child was decomposed again by every view, and the walk's own clock was most of what it reported":
    {"note": "Walking a frame's meshes costs less, and the profiler says what it costs."},
  "perf(postprocess): an effect chain keeps its uniform buffers from frame to frame - a camera's chain is said again every frame, and each pass made a uniform buffer and deleted it each time, seventeen a frame for one lake scene; a cleared chain's buffers are taken over by the next chain's passes of the same size, and one nothing takes in eight clears is deleted":
    {"note": "An effect chain keeps its uniform buffers from frame to frame."},
  "feat(playable): a playable opens on a start screen - the page was empty while the engine was inflated and compiled and the first scene warmed, twenty-five seconds of nothing for one lake scene; it carries the web export's start screen now (title, bar, what the boot is doing), taken away just before the loop starts, and a stretch nothing measures (shaders compiling, a world being made) runs a light along the bar and says so, on a web page too":
    {"note": "A playable opens on a start screen."},
  "fix(playable): a playable's start-screen bar moves through the whole boot - it was weighed as a web page's, whose start is mostly fetching the engine, so a page with everything inlined stood at 82% within a second and crawled for the rest; a playable weighs its own stages, and the scene's is followed through loading, shaders compiled and the world still being made, which a warm-up hold can now count (holdShaderWarmup answers how much is left)":
    {"note": "A playable's start-screen bar moves through the whole boot."},
  "perf(render): a shadow map is drawn again only when what it holds changed - every caster of every light was drawn into the atlas every frame, still or not; the frame keeps its atlas and a hash of what each square would draw, and skips the pass when nothing in it moved":
    {"note": "A shadow map is drawn again only when what it holds changed."},
  "fix(modeling): a model's report is its steps as written, and names a step that undoes a decimate - the report listed every plain step a repeat came to (a tree of thirteen rows of branches was a hundred and thirty-eight entries) under indexes no edit takes, and said nothing when a patterned stain after a decimate split 1100 triangles into 214,534; a repeat is one entry counted, each step says the triangles it left, and such a step is a warning naming both":
    {"note": "A model's report is its steps as written, and names a step that undoes a decimate."},
  "fix(modeling): a model's picture can be a recipe - material.texture took a .png, .jpg or .webp and refused the .esimage the picture was drawn from, so a model named pixels where the scene beside it named layers; a recipe is accepted, and whether a path names one is asked in one place (textureRecipePath) by the runtime, the packager and the model source":
    {"note": "A model's picture can be a recipe."},
  "fix(mcp): clearing an asset field from automation clears it - set_field turned 0 and null into the paths \"0\" and \"null\", which the scene kept and an export then could not find; nothing (null, 0, false, the empty string, or the words for it from a text transport) is what the inspector's clear button stores, by one function both ask, and a number that names nothing is refused":
    {"note": "Clearing an asset field from automation clears it."},
  "perf(render): meshes of one vertex shape share a vertex buffer, an index buffer and a layout - each mesh had its own, so every draw of a scene switched vertex array and pipeline; replayable meshes take ranges of shared pages (MeshArena) with their indices rebased, and a run of them switches nothing":
    {"note": "Meshes of one vertex shape share their buffers."},
  "fix(sdk): the worker freshness check names the sound worker, and the planning worker's script is what its source makes now - the sound worker landed without being listed, and the planning worker drew with code that had changed since its script was written":
    {"internal": "A test list and a regenerated script that matches its unchanged source; nothing a creator runs behaves differently."},
  "fix(gates): the device boot removes each example's app when it is done - every example installs under its own id, and the nightly emulator ran out of storage two thirds of the way through":
    {"internal": "The nightly device check's own housekeeping; no package or editor changes."},
  "fix(gates): the hot-update check expects a browser to cache an update - the web platform has kept a content cache since the texture recipes, and the check still asked for none":
    {"internal": "A verifier's expectation caught up with the runtime; the runtime is unchanged."},
  "fix(gates): an API snapshot lists a union of string literals in one order - the checker prints them in the order it first met them, so a snapshot drifted with no change to the source":
    {"internal": "The API snapshot's printing order; the API itself is unchanged."},
  "fix(render): the WeChat lite engine builds again - the cloud shadow reached for the post-process pipeline in a build that has none":
    {"internal": "The lite WeChat engine stopped building after the last release and builds again before the next; no release shipped without it."},
  "fix(transform): a child whose transform a script wrote moves when its new place is the identity - the write left an identity cache beside the old world fields, and a child whose new matrix was the identity read as unchanged and stayed where it had been":
    {"internal": "The transform cache this restores was made lazy after the last release; no release kept a child in its old place."},
  "perf(render): a run of mesh draws that differ only by their geometry and records is one call - with WEBGL_multi_draw, each draw reads its record base and probe offset by gl_DrawID from one block staged for the run, so a run binds its blocks once and draws once":
    {"note": "A run of mesh draws is one call on WebGL2."},
  "feat(ecs): every component carries the tick of its last write, and an audit finds a write that left none - Registry::patch, markChanged, changedSince and anyChangedSince over stamps kept beside the components, the reader's tick from beginChangeRead, and setChangeAudit, which reports each component type written without a stamp; the first step toward a renderer that walks only what changed":
    {"note": "Components carry the tick of their last write."},
  "fix(render): an unset texture array binds layers of its default - a textureArray param a material leaves unset was given the 2D white texture, which a sampler2DArray cannot read: on WebGL it read black, so a Planet with no layers packed yet, or any material whose array was not set, drew black where WebGPU drew white; the render context keeps white, black and flat-normal layers and MaterialStore::builtinDefault binds them for an array slot, in the scene and in post-processing alike":
    {"note": "An unset texture array reads its default on WebGL."},
  "perf(terrain): ground reads the four layers that weigh most at a pixel, and Planet draws its layers with the same code - the layer blend (weights, hex tiling, far tile, side planes, height blend) is one GLSL and one WGSL text in layerSurfaceShader.ts that Terrain Layers and Planet both call, and one loader binds the arrays for both; a pixel keeps the four heaviest layers (Unreal's landscape caps the layers a component blends) and a layer not painted there costs no noise: the terrain-water lakeside's ground 3.04 -> 2.58 ms, with the plants off 4.24 -> 3.62, the frame unchanged to 0.04% of pixels; a planet's layer masks now darken the sky's light as a flat terrain's do, and its height blend, blend noise and hex tiling default to 0, which draws it as before":
    {"note": "Terrain layers cost less, and a Planet draws its layers as a Terrain does."},
  "feat(ecs): an engine component is stamped whoever writes it - script writes are handed to the engine in a batch before the frame is composed, physics stamps the bodies that moved, the transform system the world matrices that changed, and tweens and the editor what they set; the change audit finds no unstamped write in 28 examples":
    {"note": "An engine component is stamped whoever writes it."},
  "feat(terrain): a terrain layer's sky occlusion is edited beside its normal strength":
    {"note": "A terrain layer and a field of plants each say how much of the sky reaches them."},
  "fix(editor): a project file is served with its length - without it a large file crossed the estella:// scheme a chunk per renderer task, and on a starved machine (software GL on the CI runner) a 10 MB heightmap took 30 s as an image and 170 s as a fetch, so the 4097 terrain's heightmap hit the 30 s asset deadline and its ground came up as noise; with the length the same image loads in 8 s and the 4097 one in 21 s, on a real GPU both stay under 0.3 s":
    {"note": "A large image reaches the editor's viewport on a busy machine."},
  "fix(editor): a Spine skeleton is selected by a click on the character it draws, and its outline follows it":
    {"note": "A Spine skeleton is selected by the character it draws."},
  "fix(editor): a light, camera, marker or other icon is drawn and clickable whether or not it is selected - 'selected entities only' limits the wireframes and handles, as its description says":
    {"note": "Icons stay drawn and clickable with \"selected entities only\"."},
  "feat(editor): UE-style viewport defaults and keys - grid snapping starts on, a Space tap cycles Move/Rotate/Scale while Space held still pans, Ctrl/Cmd+backtick switches World and Local, End drops a selection onto the floor":
    {"note": "Viewport keys for moving things quickly."},
  "fix(editor): an image field holds the path of its file in the World, and picking one loads no texture - a Terrain's heightmap and splatmaps and a Foliage's density and scale maps are read from their files as numbers, so the Reconciler projects them as paths, the picker offers images for them and stores the ref without uploading it, and their empty value is ''":
    {"note": "A terrain's heightmap and splatmaps, and a foliage field's density and scale maps, are read from their files and never uploaded."},
  "fix(terrain): a heightmap, splatmaps and foliage density and scale maps are read from their files and never uploaded - they are image fields, which hold the project path at run time; the scene loaded each as a texture too, 64 MiB of video memory for a 4097 heightmap whose upload missed the load deadline on a busy runner and left the terrain as noise; a terrain or foliage field grows again when one of its images changes (Assets.onSourceChanged)":
    {"note": "A terrain's heightmap and splatmaps, and a foliage field's density and scale maps, are read from their files and never uploaded."},
  "fix(editor): project files reach the viewport with their length, and the editor's viewport keys, icon and Spine pick fixes are noted - moves the editor to d83f603e":
    {"note": "A large image reaches the editor's viewport on a busy machine."},
  "fix(checks): the nightly editor checks say what they take on the runner, terrain-open authors its heightmaps as the editor does and counts an import once it has landed, and an idle wait the overlay holds says why - model-detail took 4200 s against the 1500 it declared and took its shard's budget with it; a heightmap written into a scene file was a picture where one assigned in the inspector is Data, and the tiles were counted while the ground still streamed":
    {"internal": "The nightly editor checks' own budgets, fixtures and diagnosis; nothing a creator runs changes."},
  "fix(editor): a click lands on what is drawn - a Canvas or bare layout container no longer takes the click from the sprites beneath it, and is picked only where nothing else is":
    {"note": "A click selects a shape by its drawn size, and a bare Canvas no longer takes the click."},
  "fix(editor): nudging a selection moves each selected root once, so a selected child no longer travels twice; the clipboard and selection edits are checked end to end":
    {"note": "Nudging a selection moves each selected root once, so a selected child no longer travels twice."},
  "feat(pick): the box of an entity can take a drawn extent from the caller, so a skeleton is picked by what it draws":
    {"note": "A Spine skeleton is selected by the character it draws."},
  "fix(pick): a shape is selected by its drawn size and layer, so a click inside it lands":
    {"note": "A click selects a shape by its drawn size, and a bare Canvas no longer takes the click."},
  "feat(render): a mesh, a material, a texture and the frame's probes each carry a revision that changes whenever their content does - one counter for all of them (core/Revision.hpp), so what the renderer derives from a resource can be kept until the resource itself changes":
    {"note": "Resources carry a revision that changes with their content."},
  "fix(render): a post-process shader with more than seven textures has units for them, and WebGPU says what made a frame invalid - material texture params take units 8 to 14, and past them a Lit shader takes a unit below 8 it never reads while a PostProcess one took none: the eighth texture of a fullscreen pass had no unit (on WebGPU no binding); 4 and 5, which no fullscreen pass is handed anything on, are now free for it. A WebGPU validation error was dropped in silence, leaving only the queue refusing an invalid command buffer: the first eight are now logged":
    {"note": "A post-process shader can read more than seven textures."},
  "feat(terrain): a terrain's surface can be baked into a runtime virtual texture - with virtualTexture on, each node of a layered ground from virtualTextureFrom (level 1) out is drawn from a page of what Terrain Layers makes of it before lighting (colour and roughness, normal and occlusion), baked once on the GPU through the ground's own material and read in two texture fetches; steep ground and a node whose page is not ready are drawn live. The engine draws a material through another (PostProcess) shader into a rect of a render target before the scene (Renderer.bakeMaterial, MaterialStore::bindThrough, matched by name), and a render target can keep its texture as drawn. On terrain-water (RTX 3060, 1080p, WebGL2) the ground's shading 2.1 -> 0.8 ms and the frame 15.1 -> 13.5 ms at the default camera; 2.6 -> 1.8 ms at the lake (1.2 from level 0). Off by default. Also: the planet-layers scene's sky at half strength, where its layered box read a saturated 255 that the earlier tolerance let pass":
    {"note": "A terrain's surface can be baked into a runtime virtual texture."},
  "perf(render): a mesh's draw keeps what no view changes between frames - where it stands, its world box, its model and normal matrices, its material's say over culling and its program facts are derived once and kept until its Transform or MeshRenderer is written, its mesh realized again, its material changed or the render origin moves; a static mesh that did not move is passed over by the motion pass before its cull, and the change audit checks every kept draw against a fresh one":
    {"note": "A mesh's draw keeps what no view changes."},
  "perf(render): a frame whose shadow casters, lights and camera are those of the frame that drew the shadow map does not collect the map again - before the shadow collect, each casting plugin gives one number for what it would read (the mesh plugin: whether any caster's Transform, MeshRenderer or the components beside it changed since it last looked, found from the stamps alone, and the material, mesh and program revisions), and with the views and the camera they decide whether the collect would come back with the key the atlas holds; with the change audit on the collect is made anyway and a different key is counted":
    {"note": "A still shadow map is not collected again."},
  "perf(render): the shadow atlas is kept square by square - each view's square (a lamp's face, a cascade) has a key of its own, from its view, its draws and the records they read wherever they lie in the pool, and a frame whose squares sit where they did draws only the squares whose key moved, each in a pass that clears its own square; one moving caster no longer redraws every light's map":
    {"note": "One moving caster redraws only the shadow squares that see it."},

  // Covered after the CI gate reported them unnoted (README rewrite, rain, snow, TAA).
  "feat(terrain): a land written as steps - pipeline/src/land bakes a .esland source (the ground as the things it is made of: ranges, plateaus, lakes, rivers with the heights their water runs at, streams that find their own way, roads held to a grade, a coast, pillars, terraces, a slope limit, smoothing by a world radius, erosion, brush strokes) to heights, layer weights and plant maps, measures what came of it (how far each step moved the ground, how much is walkable, steep, cliff and creased, each road's steepest stretch and the length it would need, each river's falls) and draws it without an engine (relief, slope, creases, contours, layers, an oblique view, a profile along a line). The editor's terrain tools are this kernel's door; .esland is an asset type of its own, never shipped":
    {"note": "An agent can shape ground as steps."},
  "feat(mcp): terrain tools - an agent had no way to shape ground: the brush is a mouse's, and nothing showed a slope, so land was written blind as a heightmap from a script and its faults found in screenshots. A land is now a source of steps (.esland: fill, noise, hill, ridge, plateau, lake, river with the heights its water runs at, stream that finds its own way, road held to a grade, valley, crater, dunes, pillars, coast, terrace, talus, smooth by a world radius, erode, sculpt strokes, a heightmap picture) baked to a 16-bit heightmap, layer weights and plant maps; terrain_write and terrain_edit answer with relief, slope and an oblique view and a report (how far each step moved the ground, the share that is walkable, steep, cliff and creased, each road's steepest stretch and whether its length can reach its grade, each river's falls, what is wrong); terrain_views draws relief, slope, creases, contours, layers and an oblique view, a region close, and the ground along a line in section; terrain_probe reads height, slope, layers and the distance to water, road and coast at places; terrain_apply builds the Terrain, the sea, lakes, rivers in reaches with a Waterfall at each fall, and road surfaces under one entity. Also: set_field writes a list a component declares and the inspector has no row for (Terrain.layers)":
    {"note": "An agent can shape ground as steps."},
  "feat(foliage): a field of plants can be lit as the ground it stands on - u_groundNormal turns a plant's shading normal toward straight up, so a meadow takes the light as one surface instead of a thousand facets half of which face away from the sun and read dark over a bright ground; 0, the default, leaves each plant its own shape":
    {"note": "A field of plants can be lit as the ground it stands on."},
  "fix(terrain): ground no packed layer has a say in is drawn as the first layer, not black - while a layered ground's pictures are still being drawn it has one stand-in layer, and paint that named only the others (a path, a cliff) summed to no weight and shaded black; the same held for any texel painted with nothing. Also importedAsData, the one reading of a texture's Use the editor's field warning asks without the cook's module":
    {"note": "Ground no packed layer has a say in is drawn, not black."},
  "fix(physics): what stands on ground that is still being made waits for it - a terrain's heights are read after a game starts and its collision tiles cut after that, and for those frames a character or a body on it fell through ground that was about to exist and never came back (a third-person game on a 1025 heightmap opened under the sea); a maker of static collision now says where it still owes pieces (CollisionGeometry.owe, which a Terrain does from the frame it is declared), and the 3D physics world leaves a character unswept and keeps a dynamic body asleep there until they come. A chunk layer can say it is waiting, so a field of grass whose ground or water is still being made is not asked for each of its thousand cells every frame to hear not yet":
    {"note": "What stands on ground still being made waits for it."},
  "fix(terrain): a ground or a water whose material cannot be made fails once and says why - preparing what a Terrain is drawn with (and building a WaterZone's surface) only logged a failure and asked again the next frame, for ever: a shader that did not compile was compiled sixty times a second and filled the log; now it is the failure a ground whose heights could not be read already was (Terrains.status says failed with the reason), asked again when the component changes, as a Planet did":
    {"note": "A ground or a water whose material cannot be made fails once and says why."},
  "fix(ui): spawnUIEntity keeps every Text field the init names - letterSpacing was dropped (#127)":
    {"note": "`spawnUIEntity` keeps every Text field it is given."},
  "fix(editor): a light's status rows line up with its fields in Details - moves the editor to 69005f70":
    {"note": "A light's status rows line up with its fields in Details."},
  "fix(editor): a light's status rows sit on the field rows' grid - the Status / Lights in frame / Shadow block renders outside .comp-fields and had no inset of its own, so its labels touched the panel's left edge and its bold values its right; it now takes the fields' padding and label/value columns, plain weight, and a hairline before the authored fields":
    {"note": "A light's status rows line up with its fields in Details."},
  "fix(mcp): an editor spawned from a stale build says so - the MCP front runs the built app, and one built before the engine was synced or a source changed started and answered all the same (a terrain and a water that would not compile, from an engine binary seven hours older than the SDK beside it); the rule the editor checks refused by is now scripts/lib/editorFreshness.mjs, shared, and the front puts what is stale and what to build in the first answer it gives, refusing only an editor that was never built":
    {"note": "An editor an agent starts from a stale build says so."},
  "fix(mcp): what automation writes reaches the scene by the same rules as a hand - a Terrain or a Foliage created with its data texture already set (an automation batch, a template) is marked Data as an edit of the field always was, by a hook on the door new entities come through; a field that reads a texture as numbers says so, in Details and in get_diagnostics, while the texture is still imported as a picture; and set_field takes effects.<type>.<name> on a PostProcessVolume (one uniform, colour or switch of an effect in its list), which only field_sweep did. The session's connect text names tool_guide, which the test of that text now knows as the front's own":
    {"note": "What an agent writes reaches the scene by the same rules as a hand."},
  "fix(mcp): a tool's guide reaches the model whole - a client cuts a long tool description where it likes, and it cut model_write's at 16,354 characters of 29,488 (image_write's at 16,313 of 26,250): how organic shapes, hair, clothes that swing, baked detail and painted layers are made never reached a model that was then judged on its models; a listed description now has a budget of 12,000 characters, held by a test, and what does not fit is a topic of the tool's guide (ten for model_write, five for image_write, six for music_write), named at the end of the description with what each is for and read with tool_guide, which the front answers from the catalog without starting an editor":
    {"note": "A long tool guide reaches the model whole."},
  "feat(render): snow falls - the Snow weather laid snow on the ground and nothing came down; the Rain effect gains snowfall, soft flakes in the rain's three layers that drift down and sway, none under a roof and no wet ground or rings, which the Snow preset sets to 1 and a weather transition fades. Checked on Bistro at night on WebGL2 and WebGPU":
    {"note": "Snow falls."},
  "fix(render): rain rings only on standing water - the Rain effect drew a ring where every drop landed, a dry or merely wet street included (0.4 of a puddle's strength, and a smaller ring for the splash beside it); a ring now needs a puddle under it, and off the water a drop splashes as a point and five droplets thrown out from it, gone within a fifth of its cycle. Checked on Bistro on WebGL2 and WebGPU":
    {"note": "Rain rings only on standing water."},
  "fix(examples): Bistro's far street keeps its detail - auto exposure lifted the shaded terrace view +0.15 EV over the meter and the sunlit facades down the street ran near white (far mean 160/255); the bias is -0.35 now (133). Sky haze drops 0.6 -> 0.15: the doorway and the alley's end are holes onto the HDRI, which the height fog hazes as sky, and at 0.6 they read as pale blue walls":
    {"internal": "Retunes one example scene's exposure bias and sky haze; no engine or editor behaviour changes."},
  "fix(render): TAA no longer shakes the picture - temporal anti-aliasing read the current frame where the jittered camera drew it, so wherever the history was clipped the output moved with the jitter, up to half a pixel a frame; the engine now hands the pass this frame's jitter (u_jitter) and the frame and its neighbourhood are read back without it":
    {"note": "TAA no longer shakes the picture."},
  "fix(terrain): a land's lines are rounded through their points, and a valley opens round the foot of a fall - a river, road, valley or ridge written as a few points is carried on a curve through them (straight: true keeps the corners; a stretch short enough to be a fall stays one), and beyond its own bank a river's wall is as low as any of its reaches allows, so the reach under a fall cuts a bowl about the plunge where the nearest reach alone left a ruled cliff. A river that rises is still said of the points as written":
    {"note": "An agent can shape ground as steps."},
  "fix(mcp): a river bends, a fall has a bowl, and a road with no material draws no band - used on a real land, the terrain tools cut a river as its points joined by straight runs (a valley with corners), ended a fall's headwall on a ruled line across the valley, and terrain_apply laid a RoadDecal with no material: a white band over the path the layers had painted. The ops text follows the kernel; a road's surface is built only when roadMaterial is given, and the reply says the roads are the ground's own otherwise":
    {"note": "An agent can shape ground as steps."},
  "fix(render): GPU pass times keep coming when the device answers later than frames are drawn - the pass timer was opened and closed for every render graph, so a frame of several cameras and chains went through its four slots before the device answered for any, every timed frame was dropped, and the times read were the first frame's for as long as the game ran; a frame is now timed once across all its graphs, a frame that finds every slot still waiting is not timed instead of dropping the oldest, and render.gpuTimer.read / skipped / dropped / disjoint say how the timer is doing. The submit-cost harness takes --gpu and --gpu-detail":
    {"note": "GPU pass times keep coming in a heavy scene."},
  "fix(terrain): the rock round a plunge stands sheer - under a fall the lower reach cut its bowl at its own valley's slope, so a 138 m fall had a 37 degree headwall and its water landed half way down; a reach that is not the nearest now cuts far steeper than its valley's sides":
    {"note": "An agent can shape ground as steps."},
  "fix(mcp): a fall terrain_apply stands is thrown clear of its headwall - a Waterfall left the lip at a speed set by the river's width, and a tall one landed on the rock under it a third of the way down; its speed now grows with its drop":
    {"note": "An agent can shape ground as steps."},
  "feat(editor): an install whose program and data files carry different V8 versions says so and quits - an update that could not replace estella-editor.exe left a new snapshot beside an old program, and every start crashed the window at once":
    {"note": "An install of mixed versions says so instead of crashing."},
  "feat(editor): the editor can start in safe mode - with --safe-mode or ESTELLA_SAFE_MODE=1 it runs with GPU acceleration off, draws with WebGL2 and does not restore the last workspace, and the window-crashed dialog offers it as Restart in Safe Mode":
    {"note": "The editor can start in safe mode."},
  "feat(terrain): a cliff is not one tile repeated, and a land carries a wash of colour - a wall's sides are read plain (hex tiling would turn a rock's beds), so a face a hundred tiles tall stood in rows and columns; they are now read a second time on the wider tile and mixed by u_wallBreak (0.4, or more with distance), in GLSL and WGSL. A land source takes tints, colours laid in order under the same masks as layers, baked to one RGBA picture whose alpha is how much is laid; the editor writes it as the Terrain's Color Map and gives each fall its mist":
    {"note": "An agent can shape ground as steps."},
  "feat(terrain): a land's falls come with their mist and its ground with a wash of colour - terrain_apply gives every Waterfall two emitters that ride it (WaterfallAnchor: one at the foot, one off the sheet), sized by the fall's width, and mist: false leaves them out; a land source's tints are baked to one picture the Terrain mixes into its layers (its Color Map) and the reply names it, so a Foliage can take the colour of the ground it stands on":
    {"note": "An agent can shape ground as steps."},
  "perf(render): a lit 3D pixel works out only the lights that can reach it - the loop's sixteen lights are marked on the screen tiles their spheres cover (the tile masks' upper half), through a view that goes with the masks, and a 3D surface skips a light whose bit is clear in its tile, whichever camera draws it (a reflection, a probe face); every light was worked out for every lit pixel before":
    {"note": "A lit 3D pixel works out only the lights that can reach it."},
  "feat(foliage): a meadow melts into the ground instead of ending on a line - the field thinned over the last 15% of its draw distance with every blade left standing whole, which across a valley is a line; it now melts over the last third (u_thinFade), and grass sinks as it goes (u_bladeHeight, written by the Foliage component), in GLSL and WGSL. The grass-fade scene draws Foliage on both backends, which no scene did":
    {"note": "A meadow melts into the ground at the end of its draw distance."},
  "fix(render): the sea reaches the horizon and the horizon is not olive - the copy of the scene's distances water reads is 16-bit floats, which hold nothing past 65504: in a world drawn in centimetres every bed and every stretch of open sky further than 655 m read as nearer than the water, the water over it was taken to have no depth, and the sea past that ring was the cleared frame, black under the fog. The copy now also carries the distance in units of 1024 (b), and water and Ground Blend read that once r is full. The sky's march took 16 even steps along a ray 900 km long at the horizon, so its first sample stood behind most of the blue and the horizon came out olive at noon: the steps now lengthen with the square of the way out, the air to a step is taken to its middle, and light scattered more than once is added as an even glow (SKY_GLOW), in both shaders, both languages and the CPU twin that lights the scene. Three scenes that pinned the old sky's colours take the new ones":
    {"note": "The sea reaches the horizon, and the horizon is not olive."},
  "fix(oracle): the sky dome's reference carries the glow the shader now adds - the converged integral gained the same SKY_GLOW term and the mid-step optical depth, so the noon, afternoon, low-sun and hazy scenes compare the shader's 16 steps with the same model (worst probe off by 10 of 255 against a tolerance of 18)":
    {"internal": "The sky dome verification scenes compare against a reference that now carries the glow the shader added; only the checks read it."},
  "fix(notes): the sky oracle entry is a key, not a list item":
    {"internal": "Fixes the shape of an entry in this file; nothing a creator runs changes."},
  "fix(terrain): a fall's mist is soft and does not paint the fall out - its emitters named no picture, so the mist was squares, and blended over water in sunlight an unlit white (1, where the lit water is several times that) painted the lower half of a tall fall out: terrain_apply now writes a puff (<land>_mist.png) and the mist is added to the picture. The round-ground guide says to round the brows of the walls over the rivers: a hard brow on a grid is a saw that streaks a fall's bowl":
    {"note": "An agent can shape ground as steps."},
  "perf(render): opening a scene does not hold the page on its shaders or its images - with background compiles on, a post-process effect whose program the browser is still compiling sits the frame out as a draw does (all of its passes together, since a later one reads the earlier ones' pictures by name, and the cloud shadow that borrows its shader with it), where it waited for the compile at its first use; and a texture is decoded from its fetched bytes (createImageBitmap of a Blob, off the page's thread) before an <img> is tried, whose decode ran on the page's thread. Moves the editor to 8ac5fbae, which turns the background compile on for its viewport. Opening examples/bistro in the editor on Windows (ANGLE/D3D11): the page held 27.5 s in all and 25.6 s at once, now 2.2 s and 0.7 s; the viewport's picture is the same once its shaders have landed":
    {"note": "Opening a 3D scene no longer freezes the editor."},
  "perf(editor): the viewport compiles shaders in the background, so opening a 3D scene no longer holds the whole editor - the edit host turns on the engine's background compile (a draw whose program is still compiling is left out until it is ready) whatever the project's quality.asyncShaderCompile says, which is a shipped game's delivery choice and on desktop never reached the editor at all; every capture and automation wait now waits for the compiles through a 'shader compiles' work probe. Opening examples/bistro on Windows (ANGLE/D3D11): the page held 27.5 s in all, the longest single freeze 25.6 s waiting in glGetProgramiv; 2.2 s and 0.7 s with the engine's post-process and texture-decode changes beside it":
    {"note": "Opening a 3D scene no longer freezes the editor."},
  "feat(launcher): the large sample projects are downloaded when picked instead of riding in every installer - Bistro, Dusk Fort, Terrain Water and Cyber Rooftop are packed to R2 under examples/ by their own digest, the installer keeps only their manifests, and creating a project from one fetches, verifies and keeps the files":
    {"note": "The installer is about 220 MB smaller: the large samples download when picked."},
  "feat(render): plants answer a wake and a blast - a WindWake body leaves a pass every half radius it travels and a WindBurst (or emitWindBurst) sends a pressure front out at a finite speed; the Foliage shader and the 2D Sway template lean a plant by a damped spring's answer to each shove, from the time since it alone, so a plant is pushed over, springs back past upright and rings down with nothing kept between frames, and windLean is the same arithmetic on the CPU":
    {"note": "Plants answer a wake and a blast."},
  "feat(particles): particles can be lit by the scene - the stock particle is its picture times its colour, so its white is 1 at noon and at midnight: beside sunlit water it is grey, and a cloud of it laid over a fall painted the fall out. A particle shader that declares PARTICLE_WORLD gets, in its particle variant, a world position and a normal (the way to the eye), and the Lit Particle shader (builtin:particle-lit) lights with them as any surface is lit, as much from behind as u_translucency says; in a flat scene it is lit by its layer. A particle with a material takes its depth test and write from it, as a sprite and a trail do, where it tested nothing and showed through hills":
    {"note": "Particles can be lit by the scene."},
  "feat(terrain): a fall's mist is lit by the scene - terrain_apply writes a material of the Lit Particle shader beside the puff (<land>_mist.esmaterial) and the mist draws with it, laid over the picture again and not added to it: white under the sun, grey in shade, dark at night, and hidden by the hill in front of it":
    {"note": "Particles can be lit by the scene."},
  "feat(foliage): a blade narrower than a pixel and a fifth is drawn that wide and fades instead of breaking into dashes - the Foliage vertex widens a grass blade to u_strandMinPx on screen (1.2 by default; 0 leaves it) along its own width, after the thinning has widened it for the neighbours it stands for, and the fragment cuts its alpha to the share of that width the blade really has, from the distance alone, so alpha-to-coverage fades a far blade the samples would miss":
    {"note": "A far blade of grass fades instead of breaking into dashes."},
  "perf(render): a lit 3D pixel facing away from a light, or out of its reach, works out nothing of it - no shadow lookup and no lobe, where a soft shadow searched twenty-one texels first; the picture is the same bit for bit over 101 lit scenes":
    {"note": "A light is not worked out where it gives nothing."},
  "feat(terrain): a stone forest's pillars have shoulders, splinters and canted tops - a pillar was one sheer tube with a level top: `ledges` gives each up to four shoulders stepping out to its foot, broken round it, `cluster` stands lower, thinner pillars against a share of them, and `tilt` cants the tops, each its own way. A face is no steeper than three samples of the grid can carry, and the inside corner where two shapes meet is filled, since a crease on a grid is a row of teeth":
    {"note": "An agent can shape ground as steps."},
  "feat(terrain): the pillars op is described with its shoulders, splinters and canted tops - the op text terrain_write lists is the kernel's own, which now carries ledges, cluster and tilt and says to stand a stone forest after any smoothing of the whole land":
    {"note": "An agent can shape ground as steps."},
  "feat(render): the weather and the clock are where a moment has them, not a sum of frames - a Weather's sequence and a TimeOfDay's hour are worked out from where their run began and the scene clock (the game's own seconds of play) by weatherAt and hourAt, so any moment is reached without playing up to it; seekSceneClock moves the clock, the clouds go where the sky's wind summed over the weather's changes would have carried them, and a field a script or a hand writes begins a new run from it":
    {"note": "The weather and the clock can be put at any moment."},
  "perf(render): WebGL2 does not wait for the GPU to read a frame back or make a render target - a readback reads into a pixel-pack buffer behind a fence and is Ready once the fence has passed (glReadPixels into memory waited for the whole scene: the editor's Camera preview held the page 4.6 s on Bistro); whether a framebuffer is complete is asked of the driver once per make of attachments, not for every target a pool makes (8.3 s of glCheckFramebufferStatus over 20 s of opening Bistro, each one waiting behind the background compiles); the sky and a script's immediate mesh draw take a program still compiling as every other draw does, drawing from the frame it is ready. All sync GL calls in that window: 8.8 s to 0.5 s":
    {"note": "Opening a 3D scene no longer freezes the editor."},
  "feat(terrain): a land says what stands on it - a heightfield is one height at every place, so a sheer pillar a few samples wide is a saw on its grid and an overhang cannot be at all; a land source now takes stands: models stood one to a cell where a mask allows (its weight the chance) or at places written by hand, each one of several meshes at a size, a turn and a lean of its own, sunk under the lowest ground at its foot. The bake answers every place and the report counts them; a stand that stands nowhere or runs to thousands is a warning":
    {"note": "A land stands models where ground cannot be the shape."},
  "feat(terrain): a land stands models - terrain_apply puts what a land source's stands worked out under Stand <name>: each place a MeshRenderer of one of the stand's models (mesh, material, colour texture), turned, leant, scaled and sunk in the ground, with a MeshCollider3D unless it says collide: false. The scene guide says what ground cannot be (a sheer pillar, an arch, a boulder) and how to model and stand it":
    {"note": "A land stands models where ground cannot be the shape."},
  "perf(render): a camera frame can be drawn into a render target and read back from it, and the screen's camera state restored without drawing - renderCameraFrame takes a target (cleared, drawn, its post-process chain and screen overlay ending in it; refused while a screen-level effect stack is on), captureTargetPixels reads a target back through a new renderer_captureTarget / renderer_takeTargetCapture without waiting for the GPU, and syncScreenCameras publishes the renderer's size, the UI's camera and the screen layout for a size with no frame drawn. Moves the editor to c28c7287, whose Camera preview stops drawing a second whole editor frame each refresh":
    {"note": "Opening a 3D scene no longer freezes the editor."},
  "perf(editor): the Camera preview draws into a target of its own and the editor view is not drawn again to repair it - each refresh drew the camera over the editor's canvas and then a second whole editor frame at full size only to put the view back; it now renders into a preview-sized render target it keeps, reads that back without waiting for the GPU, and restores only the screen's camera state (syncScreenCameras). On Bistro a refresh's main-thread work 5-16 ms to 3-6 ms and the refresh interval settles at 1 s instead of stretching to 2.4 s, and the GPU no longer draws the full view again every refresh. A screen-level effect stack, which only the screen can hold, keeps the old path":
    {"note": "Opening a 3D scene no longer freezes the editor."},
  "perf(sky): Baked Clouds - a Sky Atmosphere's clouds can be marched into a 512 x 512 panorama of the dome a sixteenth a frame and each sky pixel read from it by direction, instead of every pixel marching the layer: the low tier for a phone or a mini-game. On Wilds at 3840 x 2160 the cloud pass took 5.96 ms marched and 3.5 ms baked, plus 0.07 ms for the strip; marched and baked skies agree on either backend (render checks sky-clouds-marched and sky-clouds-baked). The read is four bilinear taps, since one panorama texel near the horizon covers more pixels than the composite's filter and showed the march's jitter as a comb":
    {"note": "A sky can bake its clouds for a phone."},
  "feat(material): the Model shader lays a repeating detail over what is large - a rock the size of a house has one picture of its own, a few centimetres to the texel, and from beside it that is a blur: u_detailMap is a grey picture laid every u_detailSize world units from the three sides of the world, varying the colour by u_detailStrength and, read as a height, tilting the light by u_detailBump, fading out where a tile is a few pixels. Off (size 0) it costs one comparison. Voxel Ground and Ground Blend, made from Model with layers of their own and no unit to spare, take the source without it. A model source's material.detail writes it":
    {"note": "A Model material lays a repeating detail over what is large."},
  "feat(modeling): the model tool says how something large keeps its grain up close - a model's material takes detail: { texture, size, strength?, bump? }, a grey picture laid again every size units from three sides":
    {"note": "A Model material lays a repeating detail over what is large."},
  "chore(ui): the built-in widget prefabs carry letterSpacing and underline - regenerated after buildText began to fill every Text field (#127); the generator test rewrites them and does not fail on drift, so they had stayed as before":
    {"note": "`spawnUIEntity` keeps every Text field it is given."},
  "feat(terrain): a land source says its unit - a scene of 100 units to the metre had its land written in hundreds of thousands, or in metres through a script that multiplied every number but the fields it knew by name, and a field of the same name with another meaning (a noise's scale is a distance, a model's scale is not) turned a land into cliffs. unit: 100 lets the source be written in metres: the kernel, which is what knows which field of which op is a length, multiplies those and nothing else, in steps, where masks, layers, maps, tints and stands. The bake works from world units; reports and probes stay in them":
    {"note": "A land stands models where ground cannot be the shape."},
  "feat(terrain): the terrain tool says a land can be written in metres - a source's unit multiplies its lengths and nothing else, so a project of 100 units to the metre writes a kilometre as 1000":
    {"note": "A land stands models where ground cannot be the shape."},
  "perf(sky): a sky with baked clouds draws its cloud pass with a shader that only reads the panorama - the read was a branch inside the march, and the march's size cost every pixel that took the branch (and the branch and its sampler cost the marched sky too): on Wilds at 3840 x 2160, ABBA, the cloud pass is 3.9-4.4 ms marched and 1.2-2.1 ms baked (was 5.96 and 3.5), the baked picture bit for bit the same on either backend. A multi-pass effect's sub-pass can name an alternate shader, chosen by the effect's values and built in when the choice turns. Also on WebGPU a surface pixel under a sky whose clouds cast shadows marched the whole cloud layer for nothing, where GLSL has written the surface's mark since the shadows went to the sun's map":
    {"note": "A sky can bake its clouds for a phone."},
  "fix(build): the native engine surface names the render-target capture - nativeEngineApi.generated.ts is refreshed only by a native build, and renderer_captureTarget / renderer_takeTargetCapture were added without one, so CI's generated-fresh gate found it stale":
    {"internal": "A committed generated file brought up to date; nothing a creator runs changes."},
  "fix(water): the editor draws a river wherever its eye is - the water's surface keeps its fine cells round where it is looked at from, and that was the scene's active camera even while the editor looked from its own eye: a river a kilometre from the camera was drawn by cells wider than it is, so in the editor its bed lay dry though the game showed its water. The surface follows the editor's eye while a scene is edited, as the terrain and the streamed cells do":
    {"note": "The editor draws a river wherever its eye is."},
  "feat(mcp): view_from draws the open scene from a place - an eye and what it looks at, drawn by the engine in the editor with the scene's own ground, water, plants and light and no game running: the view's eye is put there (its turning point far along the line, so it sees as far as asked), the scene is given frames and the water its bake, gizmos are left out, and the view is put back. The terrain guide sends a land's author to it":
    {"note": "An agent can look at a scene from a place."},
  "chore(examples): Bistro, Chat and Wilds map the SDK's subpath modules and Bistro's piece list keeps one uuid - the tsconfig the editor writes on open names esengine/spine, esengine/terrain and the rest, as the other examples already commit, and pieces.json's meta was made on open and never committed":
    {"internal": "What the editor writes when it opens these examples, committed; nothing a creator runs changes."},
  "feat(mcp): view_from stands the eye a height above the ground - a guessed y put the eye inside a hill as often as not: above (and toAbove) take the ground under the place, waited for where a scene has just opened, so from may be [x, z]; the answer says the ground under the eye, warns when the eye is under it, and says when seeing far has cut the foreground away":
    {"note": "An agent can look at a scene from a place."},
  "fix(ci): the five gates the stale generated file hid are green - a WGSL literal past MSVC's 16380-byte cap is split where a function ends (the source joined is the same), WindWake.radius and the two wind components say what they are to the gizmo and corpus checks, a test's temp directory is removed with retries, and the published API inventory names the render-target capture":
    {"internal": "Gates and a split literal; the shader the engine assembles is the same and nothing a creator runs changes."},
  "ci: work lands on develop and reaches master through a pull request - Build runs on develop pushes and on pull requests into master, and its Build passed job, which needs every other, is the one check master's protection requires; AGENTS.md says so for every agent":
    {"internal": "How the repository takes changes; nothing a creator runs changes."},
  "feat(terrain): a land source says what grows on it - plants: each kind a field as thick as one of the land's maps, grass from a blade or a model's mesh with the picture its colours were baked to, a count to a cell, how far it is drawn whole and at all, and how much of the land's tints it takes. Its lengths follow the source's unit; a plant with no such map, no shape or no count is refused by name":
    {"note": "A land grows its grass, flowers and trees."},
  "feat(terrain): a land grows plants - terrain_apply makes a Foliage for each of a land source's plants, over the whole land, as thick as the map it names and tinted by the land's wash: grass from a blade, anything else from a model's mesh, with a Foliage material written for a mesh whose colours are in a picture. The scene guide says how to plant a land, and that one with nothing growing is not ready to be judged":
    {"note": "A land grows its grass, flowers and trees."},
  "chore(release): the land's plants are classified for 0.105.0 - its Added headline joined the 0.105.0 section after the release commit, and check-golden wants every shipped headline to say what certifies it":
    {"internal": "A release classification; nothing a creator runs changes."},
  "ci: no pre-push hook - the release-note check it ran is the changelog-covers gate every pull request into master runs, so a push to develop no longer waits on it":
    {"internal": "How the repository takes changes; nothing a creator runs changes."},
  "feat(modeling): a tree is written with its leaves, and a land places its trees one by one - a model with leaf cards gets <name>_leaves.png beside it and a cut-out material; a land plant with lods becomes a kind of one PlacedFoliage, each tree choosing its detail by how far off it is; model_write and terrain_write say how a tree is grown and planted":
    {"note": "A tree is grown in one step."},
  "feat(modeling): the tree step grows a whole tree - a trunk that tapers and bends, limbs, twigs and a crown of leaf cards cut out by a sprig's picture, in five shapes and at three levels of detail from the same numbers; a land plant with lods is placed one by one where its map lets it stand, a grove the bake counts":
    {"note": "A tree is grown in one step."},
  "fix(modeling): a tree's leaves are lit as its crown - each card takes its light from the way out of its clump and of the whole crown, where its own flat face lit every card a different way and a crown read as patchwork; the sprig has more and smaller leaves, a clump more cards, the greens of neighbouring cards stand closer, and no card reaches the picture's solid corners":
    {"note": "A tree is grown in one step."},
  "feat(modeling): a tree's leaves let light through - a model with leaf cards is written with a material translucency of 0.6 unless its source gives one, and model_write says what `material.translucency` is for":
    {"note": "A tree is grown in one step."},
  "feat(modeling): a sprig is twigs with leaves along them, and a model material lets light through - the picture a tree's cards are cut out by is three twigs from one foot, leaves off each by turns and one at its tip, where a ring of leaves read as a pinwheel, and a card runs its twig out of its clump and across it with its leaves facing outward, no leaf past what the card shows; `material.translucency` (0..1) writes the Model shader's back light for what is thin":
    {"note": "A tree is grown in one step."},
  "docs(mcp): a tree's crown is tufts, and model_views shows it cut out - the tree guide says what the crown is made of and what to look for in the silhouette row":
    {"note": "A tree is grown in one step."},
  "feat(modeling): a tree's crown is tufts of leaves - each clump carries a few large cards spread evenly round it, facing out of it and overlapping, cut out by a tuft that is solid at its heart and leaves at its rim, where sprigs thrown about a clump read as litter; the model sheet cuts leaf cards out by their picture and lights them as the crown, so a tree can be judged before it is planted":
    {"note": "A tree is grown in one step."},
  "fix(render): a readback waits for the GPU as long as a blocking read did - WebGL2 reads now land behind a fence, which on CI's CPU rasterizer passed after the 15 s backstop on the heaviest scenes (mesh shadows, terrain occlusion, GPU particles, grass fade), so their captures came back empty; the backstop is 120 s, there only for a queue that never drains, since a lost device fails the poll itself":
    {"note": "Opening a 3D scene no longer freezes the editor."},
  "ci: the Android matrix wraps a template built from the PR when the PR changes the engine - the host carries src/esengine, so a released template refused every game's AOT module built against the PR's engine and the report showed every API as failing to boot; src/esengine also starts the matrix now":
    {"internal": "Which binary a CI matrix tests; nothing a creator runs changes."},
  "ci: a pull request runs the core and a merge runs the rest - the web build, C++ tests, static gates with the suites, engine-coupled tests and render verify gate a pull request (about 45 minutes against 90); editor authoring checks, the second backend, the desktop hosts, playables, golden packages, sanitizers and scale run on master once it merges; develop pushes no longer run Build twice for one commit, and the Android matrix runs by hand":
    {"internal": "How the repository takes changes; nothing a creator runs changes."},
  "ci: no Android or iOS checks - the emulator matrix, the device farm, the template boot smoke (native-smoke, which also held a release's publish) and the nightly Android criteria are gone; the Android and iOS templates are still built and published with each release":
    {"internal": "Which checks CI runs; nothing a creator runs changes."},
  "ci: no editor checks - the editor authoring shards, the nightly heavy editor checks, the three hand-run editor acceptance workflows, the release's installed-editor upgrade test and the legacy 2D gizmo verifier are gone; the navigation workshop's web check is a package script, and the readback backstop's comment fits the comment rule":
    {"internal": "Which checks CI runs; nothing a creator runs changes."},
  "fix(render): a frame capture on WebGL2 reads the canvas at once again - the fenced read cost CI's headless CPU rasterizer about 60% more per scene, so the pr render tier ran out of its 25 minutes with 98 scenes unrun and grass-fade, which captures several times, passed its 45 s; render targets (the camera preview) and the engine's own reads keep the fence":
    {"note": "Opening a 3D scene no longer freezes the editor."},
  "ci: the render verify runs in two shards, and grass-fade is not drawn on a software rasteriser - the pr tier on CI's SwiftShader had grown half as slow again per scene since the far-blade and wind-field foliage changes and ran out of its 25 minutes with 98 scenes unrun; verify-render takes --shard i/n, and grass-fade, whose GPU process died before it drew on every CI launch, says softwareGpu: false as terrain-virtual-texture and gi-room-voxel do":
    {"internal": "How CI runs its render checks; nothing a creator runs changes."},
  "chore(ci): grass-fade's software-rasteriser note is the commit's, not a comment that outgrew the rule":
    {"internal": "A comment; nothing a creator runs changes."},
  "ci: the nightly runs no macOS exit criteria - the job that ran the macos host's release criteria on a macOS runner is gone, and the night's report no longer waits on it":
    {"internal": "Which checks CI runs; nothing a creator runs changes."},
  "docs(agents): work goes on a short-lived branch and reaches master by pull request - no standing develop branch; a merge deletes the branch it came from":
    {"internal": "How the repository takes changes; nothing a creator runs changes."},
  "feat(modeling): a tree's picture is drawn with its bark - the picture written beside a tree model holds the bark its wood reads, in the style its tree step names, and model_write says what barkStyle is":
    {"note": "A tree has bark."},
  "feat(modeling): a tree has bark - the picture a tree is given holds its bark along the top, furrowed, banded or smooth by barkStyle, and the wood reads it along each limb and round it, so the grain runs up a trunk and out along a branch; the leaf square stands clear of every edge of the picture, and thinning keeps each corner's own place in a picture and its own light":
    {"note": "A tree has bark."},
  "chore(examples): seven examples' tsconfig name the SDK's sub-entries the editor writes for them":
    {"internal": "Type-check paths of seven examples; nothing a game or the editor does changes."},
  "fix(engine): one UTF-8 decoder and one hash header - bitmap text measured with a decoder that turned a bad byte into U+FFFD and drew with one that kept the byte, so malformed text was laid out at a width it was not measured at; both, and the label atlas's third copy, now read text/Utf8.hpp, which also rejects a lead without its continuation, overlong forms and surrogates. The FNV-1a and combine steps copied across the renderer, the UI tree and RandomSource come from core/Hash.hpp, and the four in-process digests that started from an offset basis one digit short start from the real one. The native host's bundle digest keeps its value: it keys bytecode caches on disk and three build tools write it":
    {"note": "Bitmap text with a broken byte is drawn at the width it is measured at."},
  "fix(native): the debug channel refuses a frame it could not hold and honours a close asked for while connecting - the reader allocated whatever the 64-bit length field said and let fragments pile up without end; a message past 64 MiB, in one frame or summed over fragments, now ends the connection with 1009 before a byte is allocated, and a control frame that is fragmented or over 125 bytes ends it with 1002. wsClose during the dial found no socket and was dropped, so the connection opened anyway: the request is kept and the connection closes with 1006 instead of opening":
    {"note": "A development build's line to the editor refuses a message it cannot hold."},
  "refactor(engine): module entries are checked against their own declarations, and walking a particle pool costs no std::function - the video, 2D physics and 3D physics sources defined their exported functions without including the header that declares them, and C linkage does not compare the two; each now includes it, so a signature that drifts is a compile error. ParticlePool::forEachAlive and ParticleSystem::forEachParticle take the callable as a template parameter, as ResourcePool does":
    {"internal": "Which headers the module sources include and how a particle walk takes its callback; nothing a creator runs changes."},
  "feat(particles): particles glow in HDR, fade into the scene behind them and wear away, and a material can bend the frame drawn so far":
    { note: "Particles glow in HDR, fade into the scene and wear away." },
  "feat(examples): a VFX showcase - an energy core charges over a rune circle, detonates and burns out":
    { note: "A VFX showcase example." },
  "fix(particles): a particle's new inputs stay within its eight vertex slots, and the snapshots that record the emitter's shape follow it":
    { note: "Particles glow in HDR, fade into the scene and wear away." },
  "chore(editor): the submodule moves to the gallery text of the VFX showcase":
    { note: "A VFX showcase example." },
  "feat(launcher): the VFX showcase example reads in Chinese in the new-project gallery":
    { note: "A VFX showcase example." },
  "chore(notes): the showcase's gallery text reaches the note of the example it names":
    {"internal": "A line in the notes file; nothing a creator runs changes."},
  "fix(native): a second save on Windows reaches the disk - the desktop host moved its temp file over the save with rename(), which Windows refuses when the target exists, so every save after the first was dropped without a word; the host replaces the file (MoveFileExW) and opens its paths as UTF-8, the SDK reports a write the host refused, and the packaged-game check launches a game three times and reads the count it kept":
    { note: "On Windows a packaged game keeps every save, not only its first." },
  "fix(panels): a popped-out panel listens on the window it lives in - the flipbook lane's scrub and resize drags, the input map's key capture, the locale table's focused-cell check, the listbox's arrow keys and the log's copied selection all read the main window's globals, so in a popped-out panel they heard nothing; the four main-window dialogs take their window the same way":
    {"note": "A popped-out panel hears its own keys and drags."},
  "feat(nav): a NavGrid can lie on the ground - plane 'xz' lays its rows along world z at the height of its origin, so an agent in a 3D scene is steered on a grid; obstacles and area costs mark cells by that plane, and a step is checked along all three axes":
    { note: "A navigation grid can lie on the ground of a 3D scene." },
  "fix(ecs): a spawn or frame-end callback that unsubscribes itself no longer makes the next one miss that call - world.onSpawn and app.onFrameEnd spliced the list being walked, so the callback after one that unsubscribed inside its own call was skipped; both now copy on subscription change as world.onDespawn already did. A static batch that fails while shrinking is logged instead of rejecting unhandled":
    {"note": "A spawn or frame-end callback that unsubscribes itself no longer makes the next one miss that call."},
  "chore(sdk): the engine package is checked for unused code and type-only imports like the other packages - tsconfig gains noUnusedLocals, noUnusedParameters, isolatedModules and verbatimModuleSyntax, and the 126 unused imports, locals, parameters, fields and functions it found are gone (54 of them heap-view parameters the pointer-accessor generator now names only where a body reads them). 13 UI constants nothing read are removed. The emitted chunks import the same modules as before":
    {"internal": "Compiler checks and unused code inside the engine package; the emitted modules import what they did."},
  "fix(sky): the hour does not dim an ambient light the sky already lights - with Light the Scene on, the sky a TimeOfDay moves is the environment of every Ambient light that names none, and it darkens as the sun sets; the clock scaled and tinted that light by the hour as well (0.17 of its strength just after sunset), so at dusk the ground under a bright sky was black; such a light is left as authored, and an Ambient light with a colour or an environment of its own is scaled as before":
    { note: "Dusk is not black under a sky that lights the scene." },
  "fix(export): the script compile step runs from a path with a space or an ampersand on Windows - emcc is a batch file there and was started through a shell with its arguments unquoted, as were the emsdk setup, the GLX toolchain, the engine build commands and with-env; they all start through runTool now, and check-tool-spawn refuses a shell passed by hand":
    {"note": "A project in a folder with a space or `&` in its name exports its compiled scripts on Windows."},
  "feat(outliner): double-clicking an entity row frames it in the viewport":
    { note: "Double-clicking an entity in the Outliner frames it." },
  "feat(outliner): double-clicking an entity row frames it in the viewport - the same as F, as the common editors do; renaming an entity stays on F2 and the context menu, and a folder row, having nothing to frame, still renames on double-click. The twist, lock and eye do not frame when clicked twice quickly":
    { note: "Double-clicking an entity in the Outliner frames it." },
  "fix(play): multiplayer client tabs open once the client realms exist - the Game P2..N tabs were opened right after the boot was kicked off, before the asset check let the session create its clients, so the list was empty and every client ran with no view to see or drive it":
    { note: "A multiplayer preview opens a Game tab for every client." },
  "feat(outliner): palette widgets and templates can be dropped into the Outliner":
    { note: "Palette widgets and templates can be dropped into the Outliner." },
  "feat(outliner): a widget or template dragged from a palette can be dropped into the Outliner - onto an entity it is created as that entity's child, onto empty space or a folder it lands where a click would put it. A UI widget only takes a parent that is inside a Canvas; any other parent is passed over for the Canvas (made if the scene has none), so a widget dropped or created under a plain entity is not left unable to lay out":
    { note: "Palette widgets and templates can be dropped into the Outliner." },
  "feat(modeling): stains as fine as the baked map, hull plating, glow, and a model bake without the editor - a stain with texel: true is worked out for every texel of the map a normalBake writes (wear and dirt read the dense surface's shape there, and fray lets a pattern move the line of wear), the panels step cuts faces into bevelled plates with seams, paint and stain take glow and the bake writes an emissive map the material reads, and bake-model writes a still model's mesh, maps and material from the command line; import-hdr takes --sky-width":
    { note: "A stain can be as fine as the map it is baked into." },
  "feat(postprocess): a Starfield effect draws stars as points over any sky - three layers of pixel-sized stars with a band where they crowd, added over an environment's panorama instead of only where nothing was drawn; defineSkyEffect takes over: true for the same and exposes esSkyPixel, the angle a pixel covers":
    { note: "Stars that stay points." },
  "feat(postprocess): Starfield draws the sun, and every effect is found by a lean export - u_sunSize puts the first directional light in the sky as a disc with a glow; starfield and snowCover join the table of which group carries an effect's shaders (a scene using Snow Cover alone was packaged without it), and a test holds the engine's effect list against that table":
    { note: "Stars that stay points." },
  "feat(examples): a space frigate built from a recipe - a frigate patrols off a gas giant with no hand-painted texture and no imported model: one model source builds its hull, plating, worn paint, windows, lights and engines and bakes them to a thin mesh and five maps, the nebula and the planet are generated, the stars are the Starfield effect, and two small shaders draw the planet's air and the engine plumes; a camera tours six shots and the keyboard and mouse take it over and work the throttle, with scripts to regenerate the assets, capture frames and check the controls headlessly. The post-processing page lists Starfield":
    { note: "A space frigate example, built from a recipe." },
  "feat(native): a native build's sockets connect to wss:// - TLS is the operating system's, as it is for fetch (Network.framework on macOS and iOS, Schannel on Windows, libcurl on Linux, the platform SSLSocket on Android), under the host's own WebSocket framing; the certificate chain and the host name are checked against the system's trust store, and a connection that fails them reports why and closes with 1006. A ws:// URL connects as it did, and a desktop host's CI job judges both against local servers":
    { note: "A native build's sockets connect to `wss://`." },
  "feat(pipeline): a picture source draws to a PNG from the command line - draw-image draws an .esimage through the code a device draws it with, reading the pictures and recipes it lays in from its project, and writes the PNG with the notes of layers that drew nothing; --on lays it on a ground and --zoom enlarges a part. What a recipe needs is gathered by one function the runtime and the command share":
    { note: "Pictures draw without the editor." },
  "fix(render): screen UI keeps its colours in a linear frame - the screen overlay is drawn onto the frame after the output transform, where the batch shader still wrote linear colour, so every Canvas of a project in linear colour space showed its pictures, tints and text one gamma darker than authored (a mid-grey of 128 read 55); the overlay's draws now take the batch shader's DISPLAY_OUTPUT variant, which encodes what it writes. A UI material with a shader of its own is left as it was":
    { note: "A HUD keeps its colours in a linear project." },
  "feat(pipeline): an export says which file the scripts name that was never registered, and adopt registers them - a file with no .meta is unknown to the project, so an export left it out without a word and the game asked for it on the device; the cook now warns for each such file a script names whole, and estella adopt <projectDir> writes the .meta the editor would write on opening the project":
    { note: "Assets register without the editor." },
  "feat(ui): a world anchor keeps its marker off the HUD's own panels - UIWorldAnchor takes edgeInsets, room kept clear on each side over edgeMargin, which a clamped marker is moved out of by the shortest way, and reads back clamped: whether the node stands where the clamp put it and not over the point, for drawing an arrow in place of a bracket":
    { note: "A world marker stays off the HUD's own panels." },
  "feat(assets): what texture recipes cost can be read - textureRecipeStats is exported (how many pictures were drawn on the device, how long the drawing took, how many came back from the content cache), and a cooked game's headless handle answers recipes() with it":
    { note: "What texture recipes cost can be read." },
  "feat(examples): the space frigate flies with a HUD drawn from recipes - a segmented speed gauge with a commanded-thrust marker, a systems panel, a waypoint bracket that turns into an arrow at the screen's edge, a tag on the planet's horizon and the camera state, every picture of it an .esimage written by tools/hud-generate.mjs and drawn on the device, built in code by src/hud.ts and set in Inter":
    { note: "The space frigate flies with a HUD, drawn from recipes." },
  "feat(examples): the space frigate's asteroids can be locked, and a scope plots them - a click on a rock or T locks it (a bracket closes on it, a card gives its range, closing speed and size, and at the screen's edge it becomes an arrow), R releases it; rocks the hull hides carry no mark; a tactical scope plots every rock within two kilometres with a stem for its height; a log keeps the last events and the display runs a self-test as it comes up. The HUD's script is split into hud, hudKit, hudTargets and hudScope":
    { note: "The space frigate flies with a HUD, drawn from recipes." },
  "feat(ui): screen UI can stand in depth - ScreenOverlay.perspective is the distance from the eye to the screen plane, as CSS perspective is; the screen projection takes it, so a UI node turned about x or y draws foreshortened with all that is under it and a node moved along z draws nearer or further, while what lies in the screen plane stays exactly where it was. 0, the default, is the flat screen":
    { note: "Screen UI can stand in depth." },
  "feat(examples): the space frigate's HUD stands in depth - the corner panels lean inward in perspective, the tactical scope is a disc lying flat with each rock's stem standing on it and a sweep going round, the gauge's rings and figures float above its dial with an additive glow and a colour fringe, a panel carries scan lines, and the display sways against the camera's turning and flickers as it comes up":
    { note: "The space frigate flies with a HUD, drawn from recipes." },
  "feat(ui): a Canvas can be drawn through a material, and UI can read the frame under it - CanvasEffect on a screen Canvas names a material with a PostProcess shader: the screen UI on that Canvas's sorting layer is drawn into a transparent target and the material lays it on the frame, premultiplied and in the display's values in a linear frame too, after the layers without one, which are drawn straight as before; a draw that only adds light writes no alpha into the layer, so it still only adds light. A UI material that declares u_screenColor is handed a copy of the frame under its layer, with mips for a blur: the device copies a framebuffer's colour into a texture (the canvas on WebGL2; on WebGPU the surface, configured to be copied from on the frame after the first ask)":
    { note: "A Canvas can be drawn through a material, and UI can read the frame under it." },
  "feat(examples): the space frigate's HUD is seen through a lens, over frosted glass - its Canvas carries a CanvasEffect whose material bends the display's corners a little, splits its colours toward the edges, lays scan lines over it and gives it a soft halo; the ship-systems panel blurs the frame behind it; the markers that stand on the rocks, the waypoint and the planet are on a Canvas of another layer, which the lens does not bend, so each stays on what it marks":
    { note: "The space frigate flies with a HUD, drawn from recipes." },
  "chore(examples): the space frigate's HUD effects live in a file of their own - hudEffects.ts loads the lens and the frost material, puts the Hud canvas on its own layer with the CanvasEffect, moves every world-anchored node onto a second Canvas the lens does not bend, and gives the systems panel the frost material, which now draws the panel's own picture over the blurred frame in one pass; hud.ts calls it in one line and hudKit.ts and hudTargets.ts are as they were, and the materials are under assets/ui-effects":
    { note: "The space frigate flies with a HUD, drawn from recipes." },
  "chore(docs): the Details panel links CanvasEffect to its reference entry - the component link table gains the row for the engine's CanvasEffect component, which the component reference now carries":
    { note: "A Canvas can be drawn through a material, and UI can read the frame under it." },
  "chore(ui): CanvasEffect is in the component reference, and the tests' renderer doubles carry the overlay's two new calls - the reference data, the component's description and the API stability page are regenerated, the editor pointer moves to the Details panel's link for the component, and two SDK tests' hand-written renderer backends gain hasScreenOverlayEffect and setScreenOverlayEffect, which the test-types gate caught missing":
    { note: "A Canvas can be drawn through a material, and UI can read the frame under it." },
  "chore(gates): CanvasEffect has its place in the corpus accounting - the space frigate puts it on a Canvas it builds in code, so it is demonstrated from code, and the pixel fixture authors it as scene data":
    { internal: "An accounting entry for a gate; nothing a creator can observe changed." },
  "fix(ui): the screen overlay's effect layers draw from the lowest layer up - they were drawn in the order their Canvases happened to be found in the world, so which of two effect layers lay over the other followed entity ids; the plan of passes now sorts them by sorting layer, and the manual says so":
    { note: "A screen overlay's effect layers draw from the lowest layer up." },
  "feat(examples): the space frigate's display answers the ship, and its markers share its glass - the lens splits its colours, thickens its scan lines and glows more as the emitter heats, flickers when it overheats and wakes in a burst of both; the markers' Canvas is drawn through the same material with no bend, so the cards over the waypoint and the locked rock carry the display's scan lines and stay on what they mark, and both cards are frosted like the systems panel":
    { note: "The space frigate's display answers the ship." },
  "feat(examples): the space frigate mines the rock it has locked - holding F fires a beam from a turret with a clear line to the rock, drawing the capacitor down and heating the emitter; the rock wears away, breaks in a burst and leaves ore in the hold by its class, then drifts back in from the far end of the field. The beam, its glow, sparks and burst are a prefab made in code; the systems panel shows the capacitor and emitter as they are, and the card shows class, range and what is left":
    { note: "The space frigate mines its asteroids." },
  "feat(examples): the space frigate can be flown - the arrow keys turn it and it banks into the turn, B brings the bow onto the navigation gate and V onto the locked rock; the ship stays where it is and the field, the gate and the camera's frame move against its heading (a new helm module owns heading and attitude, and the flight script takes four small changes for it). Reaching the gate delivers the hold and sets the next one; ranges are in the metres the speed is in, and the scope turns with the bow":
    { note: "The space frigate can be flown." },
  "fix(ci): the gates behind the first red one are green - the corpus check knows what a picture recipe and a font file are, the published API tier inventory counts the two screen UI additions, and a test's scratch directory is removed with retries":
    { internal: "Three static gates; nothing a creator runs changes." },
  "feat(examples): the space frigate is steered by orders that hold - a flat helm desk either side of the tactical scope carries an engine telegraph, a rudder strip and an elevation ladder; a click on a step sets it and the ship keeps to it with nothing held, W/S and the arrow keys move an order one step a press, and X puts the rudder amidships. Each ladder marks what was ordered beside what the ship is doing; lock, mine, release, close and gate are controls on the desk, lit while they are on, and F switches the beam on and off":
    { note: "The space frigate is steered by orders that hold." },
  "fix(ci): the wss probe lives with the native host's tools - tests/ is the tree tests/CMakeLists.txt builds, and the probe is built by native/CMakeLists.txt as test_native_wss, so check-cpp-tests read it as a harness nothing runs; it is native/tools/ws_probe.cpp now, beside the host's other test program":
    { internal: "Where a test program sits in the repository; nothing a creator runs changes." },
  "fix(render): textures uploaded by the SDK stay sharp at a slant - a compressed or decoded image handed to WebGL2 from script set its filters and mipmaps and never its anisotropy, which only textures the engine made itself were given, so every material map of an exported web game blurred along a surface seen edge-on; it now takes up to sixteen samples where it is mipmapped and linear, asked of the device once a context. The corpus check knows what a model source is":
    { note: "Textures in a web build stay sharp on a surface seen at a slant." },
  "feat(modeling): a model's bake writes its emissive map - where a paint or stain gives faces a glow, the bake's emissive map is written beside the other maps as <model>_emissive.png, read as data, named by the material and removed with the bake that made it":
    { note: "Parts of a model can glow." },
  "feat(modeling): the modeling tool offers plating, texel stains and glow, and the gallery names the space frigate - model_write's list of steps is the build's again (panels, and texel, fray and glow on stain and paint), and the new-project gallery has the Space Frigate example's Chinese text":
    { note: "Plating for hard surfaces." },
  "feat(examples): the space frigate flies through an asteroid field, with turrets that have a shape - three rocks are model sources of their own (a sphere displaced three ways, stained texel by texel, thinned to 2,400 triangles) and forty-six of them are placed round the ship, the near forty drifting aft with its speed so their parallax shows it; the hull's plates take a bevel wide enough to catch the light, and each turret has a housing, a mantlet and muzzle brakes. generate.py bakes only the models --models names":
    { note: "A space frigate example, built from a recipe." },
  "feat(modeling): a model's material can carry a clear coat, and its maps are imported at the size they were baked - material takes coat and coatRoughness, written as the model shader's clear coat; bake-model gives each map a Max Size of the size it was baked at and raises a smaller one an earlier bake left, so a 4096 bake is not shipped at 2048; the command has tests of its own":
    { note: "A model's paint can have a clear coat." },
  "feat(assets): a texture ships at the size it was made unless told otherwise - Max Size starts at Source size for every texture where a picture's started at 2048, in the import settings table, in what a .meta that does not say resolves to and in the meta tool; a .meta that states a size keeps it":
    { note: "A texture ships at the size it was made." },
  "fix(assets): an image past 4096 by 2048 compresses - the Basis encoder refuses more than twelve million texels at once and the cook reported 'encoder produced 0 bytes', so a 4096 square texture could not be packaged; such an image is now encoded in strips from the bottom up, their UASTC blocks stacked into one level, with the levels below encoded from the halved image, and an ETC1S texture that large says what to change":
    { note: "A texture larger than 4096 by 2048 can be compressed." },
  "feat(examples): the space frigate's hull answers the light - its paint takes a thin clear coat over a lower, wider spread of roughness, each plate is cut into smaller ones, turrets, masts and cowls are gunmetal and the nozzles heat-tinted steel, reflections of the sky are raised apart from the sky itself, and each plume is a wide dim sheath round a thin bright core with shock knots; its maps are the 4096 they were baked at":
    { note: "A space frigate example, built from a recipe." },
  "perf(modeling): bake-model probes and paints on every core, and keeps what it probed - a normalBake's plan, its probes (the shape round each texel that a stain's where reads, and occlusion's rays) and its finish are separate steps; bake-model runs the probes and the stains' painting on worker threads over shared memory (--jobs) and keeps the probes under the project's .esengine/cache/model-bake by a hash of the surface and of the code that probes it, casting only what a wider stain adds (--no-cache casts all of it); the maps are the bytes one thread writes. The frigate's 4096 maps: eleven minutes to three, and thirty seconds once kept":
    { note: "A model bakes on every core, and keeps what it measured." },
  "fix(modeling): a model's maps are imported as large as they were baked - a bake past 2048 was written at its own size and then given the default Max Size of 2048, so a build shipped a 4096 normal, colour, surface and emissive map at half its resolution; each map's Max Size is now the size it was baked at":
    { note: "A texture ships at the size it was made." },
  "perf(modeling): a stain's where reads the shape round a texel from the triangles near it, gathered once - its thirty-two parallel rays each walked the tree from the root, ninety-four boxes to reach seven triangles; the triangles in the probe's box are now gathered in one walk, in the order a ray meets them, and every ray is met against them through an eight by eight grid across the probe's disc, falling back to one ray at a time past 768 triangles. The values are bit for bit what the rays gave, 4.7 times sooner; the frigate's 4096 maps bake in 66 seconds where they took 184. A bake worker no longer inherits the command line's node flags, ten of them under --cpu-prof having deadlocked in node's builtin loader":
    { note: "A model bakes on every core, and keeps what it measured." },
  "perf(modeling): bake-model shades its texels on every core too - reading the dense surface at each texel of the map was one thread's twelve seconds of a 4096 bake; the raster now only records which triangle covers each texel, and the reading runs in blocks of 16384 texels on the bake's workers, each block's counts added in order so the report is the same on any number of threads. One function weighs a texel in its triangle for both. The frigate's 4096 maps: 55 seconds, 21 once the probes are kept":
    { note: "A model bakes on every core, and keeps what it measured." },
  "fix(assets): a texture's bytes in memory are decoded as they stand, not fetched back through a blob: URL - uploadImageBytes_ wrapped the PNG a compressed source answers with in an object URL and gave it to loadImage, which since 4231ef7a4 fetches the URL first; the editor's connect-src does not allow blob:, so each such texture logged a policy violation and was decoded through an <img> on the page's thread. The bytes now go to createImageBitmap as a Blob (decodeBlobBitmap, which fetchImageBitmap also calls), and to an element only where that cannot decode them":
    { note: "Textures the editor shows as a build ships them are decoded off the main thread." },
  "fix(sound): a looping piece of music with a tilted master joins itself without a step - master.low and master.high were filtered over the closed loop from a filter at rest, so the start of every round was shaped as if silence came before it; the shelves of a loop now run in from the end of the round before they write it, as the compression follows it round. A test cuts one loop at two places and holds the two to the same sound at the join. SOUND_RENDER_REVISION is 3":
    { note: "Music that loops no longer clicks where it comes round when its master is tilted." },
  "feat(examples): the space frigate carries its number and its name, and its bridge has panes - 27 on both bows and on the foredeck and KESTREL on the armour belt are strokes of a small stencil alphabet in generate.py, laid by a stain's line from the side or from above before the wear, so paint chips and grime lie over them; the bridge's windows are divided by mullions drawn the same way and its lights vary pane to pane, where they were one white slab. The README's controls are the helm's as it is now, and its bake time is the bake's as it is now":
    { note: "The space frigate carries a hull number and a name." },
  "feat(examples): the space frigate's waypoint is a gate it flies through - a ring a hundred and seventy units in radius with six emitter nodes, a control tower and a field across it, built as one more model source in generate.py and plated and worn as the hull is; main.ts stands it where the helm says the waypoint is, and on arrival leaves it to fall astern with the ship's speed while the next appears. The field is a square and a shader. capture.mjs waits for the HUD and steps in two-second runs, since pictures now load after the scene":
    { note: "The space frigate's waypoint is a gate." },
  "feat(examples): the space frigate has debris streaming past it, lights that blink, and a flash as it goes through the gate - a hundred and fifty pebbles of the three rock models drift aft with the ship's speed in a box round it and keep clear of the hull; the masthead and keel strobes and the bow lights flash to their own beats and the red and green navigation lights burn steady, each a small sphere through a flare shader with a point light; crossing the gate's plane inside its ring pulses the field and a wide light, counted in the playthrough facts":
    { note: "The space frigate has debris, blinking lights and a flash at the gate." },
  "feat(examples): the space frigate is heard, from recipes - seven .essound sources are made into clips on the device: an engine hum that rises with the throttle, a tick for an engine, rudder or elevation order (not while the helm steers itself), a chime on taking or leaving a helm mode, a mining beam that climbs as its emitter heats, and a broken rock, an overheat and a gate arrival; soundMix.ts says what a state sounds like and audio.ts plays it and publishes what it asked for and the mixer's measured bands as facts. A test makes every recipe and holds its level, its loop seam and its band; check-audio.mjs measures an exported build. The corpus check knows what a sound recipe is":
    { note: "The space frigate is heard, from recipes." },
  "feat(examples): the space frigate's sounds are placed and quieter, with music under them - the engines and the mining beam are spatial sources on the ship with the camera as the listener, so they fall away as the camera pulls back; every sound is remade lower and duller (a drone for the engines in place of a rumble, a low knock for a helm order in place of a ping, a swell for an arrival in place of bells, rock in place of glass); drift.esmusic is seventy seconds of slow pads, a bass and a few bells in D dorian that M turns off and on. The test holds every sound to little above three kilohertz and the music to a calm loop with no step at its seam; check-audio.mjs measures near against far":
    { note: "The space frigate is heard, from recipes." },
  "feat(examples): the space frigate's music is a piano - drift.esmusic is a minute and a half of slow broken chords and a sparse tune in D major over a quiet pad, played by a sampled instrument: eleven notes of the FreePats Upright Piano KW (CC0), taken out of its SoundFont with the engine's own reader and halved to 22 kHz, with their licence beside them. They ship uncompressed, since a recipe plays .wav recordings. check-audio.mjs holds the music to being heard at the mixer and gone once M stops it":
    { note: "The space frigate is heard, from recipes." },
  "feat(examples): the space frigate's music has a theme and more than a piano - the piano carries a four-bar tune over its own broken chords, with a slow pad, a plucked figure that comes in on the second time through, high notes over the tune and a breath of noise, built up over six sections and let down before it comes round; a twelfth piano note for the top of the tune. The mining beam is two beating saws through a band with a crackle on it, a broken rock ends on two notes of ore, an overheat falls away, and an arrival rises through the chord of the music's key":
    { note: "The space frigate is heard, from recipes." },
  "fix(examples): the space frigate holds its music in an audio cache large enough for it - a minute and a half in stereo decodes to 35 MB at the 48 kHz a device plays at, more than the whole 32 MB cache, so it was dropped whenever another clip loaded and decoded again on its next play; the game asks for 64 MB, as the engine's warning says to. The piece is made at 22 kHz, which nothing in it reaches the top of and which halves the time to make it, though not what it decodes to. A fact says when the music is made, check-audio.mjs waits for it before it listens and counts an audio warning as a problem, and a test holds what the game keeps decoded under the cache it asks for":
    { note: "The space frigate is heard, from recipes." },
  "feat(examples): the space frigate's gate sends a ring of light outward as the ship goes through, and its tower stands on the ring - the transit pulsed the whole field evenly, which from the chase cameras washed the sky to a pale haze with no shape; the field now draws a thin crest travelling from its centre to the rim in nine tenths of a second with a blue wake behind it, and the even pulse is a third of what it was. The control tower's base was nine units clear of the ring's outer edge, so it floated; a neck joins them":
    { note: "The space frigate has debris, blinking lights and a flash at the gate." },
  "fix(modeling): a model's bake can be asked for as a job that crosses a thread - what a writer needs of a bake is the mesh file's bytes, the maps and the joints, with a normalBake spread over the cores and its probes kept":
    { note: "A dense model no longer freezes the editor while it bakes." },
  "fix(modeling): a model bakes on a thread of the main process, so a dense one no longer holds the window":
    { note: "A dense model no longer freezes the editor while it bakes." },
  "fix(shaders): a shader that declares fewer than eight batch textures gets its WebGPU twin - the twin generator matched only `uniform sampler2D u_textures[8]`, so `u_textures[1]` (a shader that reads one texture, as the cyber rooftop's rain film does) was read as an access to unit 1 and refused, and the shader did not render on WebGPU; any count from 1 to 8 now declares that many units":
    { note: "A shader that declares fewer than eight batch textures renders on WebGPU." },
  "fix(render): a glow added to the scene no longer reads as cover - additive and premultiplied-additive draws in the scene added their alpha to the target, so a sky drawn behind the scene took a glowing shield, plume or gate field for something solid and left a black hole the size of it; in the scene they now leave the target's alpha as it was, as they already did in a UI effect layer":
    { note: "A glowing object no longer cuts a black hole in a shader sky." },
  "perf(render): a batch draw finds its shader variant by index, not by building a key - every retained text batch, lit sprite, alpha-clipped mask and lit tile layer asked for its program with a fresh list of feature names, which was copied, sorted, joined into a string and hashed every frame":
    { note: "Nine-slice panels, tiled sprites, text and lit sprites cost less to draw each frame." },
  "perf(render): a nine-slice or tiled sprite is one draw command, not one per cell - every cell built its own command (sort key, clip state, a sort entry, a merge test) only to be merged back with its neighbours, nine for a UI panel and up to 16384 for a tiled floor":
    { note: "Nine-slice panels, tiled sprites, text and lit sprites cost less to draw each frame." },
  "perf(ecs): reading an engine component no longer builds its list-field names each time - every world.get and tryGet of a builtin spread the component's number-list and entity fields into a new array before reading the result; the list is made once per component":
    { note: "Nine-slice panels, tiled sprites, text and lit sprites cost less to draw each frame." },
  "fix(assets): a bitmap font that came in through an import keeps its page in a build - the one table every .meta is minted from wrote bitmapFont for .fnt and .bmfont, while the cook and the editor read bitmapfont, so a font imported or adopted from disk was never scanned for the page image it names and the build culled it":
    { note: "A bitmap font brought into a project through an import keeps its page image in a build." },
  "fix(assets): a bitmap font ships as a font under the .meta type it is minted with now, and a terrain's tiles as json - the loader table reads bitmapfont where it read bitmapFont, and names terrain-tiles, which .esterrain is minted as":
    { note: "`Assets.preload` and `loadGroup` load every shipped asset through its own loader." },
  "perf(render): the frame's scratch lists keep their memory from one frame to the next - particles, GPU particles, trails, the render graph and the tree order each built and freed lists every frame":
    { note: "Particles, trails, the render graph and the WebGPU backend spend less per frame." },
  "perf(render): WebGPU does not set the pipeline a pass already has - every merged draw set its pipeline again, and each set marked the bind groups for a rebuild (a lookup per uniform slot and texture unit, two cache searches and two calls into the browser) even when the pipeline had not changed":
    { note: "Particles, trails, the render graph and the WebGPU backend spend less per frame." },
  "perf(postprocess): adjacent per-pixel effects are drawn as one pass - colour grade, sharpen, film grain and vignette side by side and on are one full-screen pass instead of four, each with its own params, and sharpen reads its neighbours through the grade before it; what a quality level or a player leaves out stays out, and while the pass's shader compiles the effects draw as before. On the frigate's low level at 2400 x 1080 the four took 0.235 ms and the one takes 0.139 ms; the frame matches to 2/255":
    { note: "Colour grade, sharpen, film grain and vignette side by side are drawn as one pass." },
  "fix(render): Auto Exposure and Sky Atmosphere work in light in a gamma project - the exposure meters and scales what the codes stand for, and the sky is encoded for a gamma frame in what it draws and what it lights with":
    { note: "Auto Exposure and Sky Atmosphere are no longer dark in a gamma project." },
  "perf(ecs): queries read every fully covered engine component straight from the wasm heap":
    { note: "Queries and `Mut()` write-back read every engine component whose fields all have a fixed place in memory straight from the wasm heap." },
  "fix(render): Draw can draw over the whole frame, the screen's UI included - registerOverScreenDrawCallback runs once a frame after the screen overlay, through the view of the last camera drawn to the screen, and the engine draws what it collected in a pass of its own over the finished frame; a core without that pass draws them with the scene as before":
    { note: "The transform gizmo is no longer hidden under a Canvas's UI." },
  "fix(editor): the transform gizmo and the editor's overlay lines draw over a Canvas's screen UI - the overlay registers as an over-screen draw callback, so an image the size of the design view no longer hides the rotate ring and the handles under it":
    { note: "The transform gizmo is no longer hidden under a Canvas's UI." },
  "perf(export): a package that never draws through WebGPU ships its shaders without their WGSL - every built-in shader carried a WGSL twin a mini-game, a playable and a web build left on WebGL never read; the export cuts those sections from the SDK it bundles, and the shaders made by editing Model's text skip their WGSL edits where there is none. The cyber-rooftop example's web package is 131 KB smaller (19 KB gzipped) and hands WebGL the same GLSL, source for source":
    { note: "Mini-games and WebGL web builds ship no WGSL." },
  "fix(export): the GL-only shader filter asks the path sandbox whether a module is the SDK's - a prefix test missed an SDK reached through a link and is the idiom the sandbox gate refuses":
    { note: "Mini-games and WebGL web builds ship no WGSL." },
  "feat(shaders): a GLSL to WGSL transpiler that keeps #ifdef, for a shader's own code against the engine's WGSL header - milestone: 22 of 25 Lit and Unlit built-ins transpile at 1.03x the hand-written size, and on WebGPU draw as their hand-written twins do (Toon, Model, Matcap, Skin, Hair, Eye, Particle, Lit Particle, Foliage); not yet wired into the engine":
    { note: "Shaders are written once, in GLSL." },
  "feat(shaders): shaders are written once, in GLSL, and a device that draws through WebGPU is given the WGSL as each compiles - a transpiler that keeps #ifdef writes a shader's own fragment against the engine's WGSL header (esengine/wgsl, installed by the game host, the render host and the native host where they draw through WebGPU); Model, Ground Blend, Voxel Ground, Toon, Matcap, Skin, Hair, Eye, Particle, Lit Particle, Distortion and Foliage's surface ship as GLSL alone and draw on WebGPU as their hand-written WGSL did, Ground Blend and Voxel Ground are derived from Model's GLSL only, and what the transpiler knows of the engine's headers is generated from the engine (gen-shader-api, gated)":
    { note: "Shaders are written once, in GLSL." },
  "feat(webgpu): the editor gives a shader written only in GLSL its WGSL as it compiles, in the viewport and in Play - both hosts install esengine/wgsl when they draw through WebGPU, before the app compiles anything, as a WebGPU game's host does":
    { note: "Shaders are written once, in GLSL." },
  "fix(build): the WGSL transpiler is not a module a project picks - the host loads esengine/wgsl when its device is WebGPU, so it joins the engine binary and the platform adapters in NOT_A_MODULE instead of standing as a module with no vocabulary to detect it by":
    { note: "Shaders are written once, in GLSL." },
  "fix(ui): every hex colour is read by col.fromHex - rich text, the scene-transition colour and the picture code each parsed hex on their own and had drifted: <color=#f00> was ignored, a scene-transition colour with an alpha lost it and a short #rgb one became NaN, and rich text took a malformed digit as part of a number":
    { note: "Rich text, the scene-transition colour and picture recipes read hex colours the same way." },
  "feat(export): a portal page, a playable ad and a mini-game open on the engine's ident too - the portal builds and the playable carry the same canvas and script as a standalone page, the playable's after its ad network's own SDK, and each waits for it before the game starts. A mini-game has no page, so its runtime draws the same shader straight onto the display canvas, on the WebGL2 context the engine is about to be given, while the engine is instantiated; it hands the context back with nothing bound and nothing of its own left, and the host's loading toast waits until it is over. The shader now has one author, in the SDK. A WeChat build that renders through EmscriptenGLX does not carry it yet":
    { note: "Portal builds, playable ads and mini-games open on the Estella ident." },
  "fix(minigame): the entry's loading notice is taken down when the ident starts - a mini-game's entry shows the host's loading notice while the engine's subpackage is fetched, before the runtime exists, and it stayed up over the ident":
    { note: "Portal builds, playable ads and mini-games open on the Estella ident." },
  "fix(export): the ident stands aside for a render harness and a development preview - a page opened with ?headless neither draws it nor waits for it, and a development preview build does not carry it: under software rendering its full-screen shader and its hold kept a previewed game from starting inside the time a test gave it":
    { note: "Portal builds, playable ads and mini-games open on the Estella ident." },
  "fix(export): the ident is drawn sharp at any size and follows the window - its edges ramped over eight pixels whatever the screen, so the mark and the word were soft everywhere, and its canvas was held to 1800 pixels on its long side and sized once, so a wide screen drew it at seven tenths and a turned phone stretched it; the edges now ramp over two pixels, the canvas is held to six million pixels, and it is sized again when the window changes":
    { note: "The Estella ident is sharp." },
  "feat(modeling): a model's maps can be baked on the graphics device - the dense surface and its tree go into float textures, and fragment shaders find each texel's place on it, probe its relief with all thirty-two spokes in one walk of the tree, count its open sky and lay the stains, so a frigate's 4096 maps take 21 seconds in a browser where every core took 89, and come out the same":
    { note: "A web game can ship its models as recipes and bake them on the player's graphics card." },
  "feat(modeling): a model source can be baked where the game loads - the map size follows the device (4096 on a desktop, 2048, 1024 and 512 down the phones), and what was baked is kept in the browser under the source's own digest, so the second launch reads it back":
    { note: "A web game can ship its models as recipes and bake them on the player's graphics card." },
  "feat(export): a web export can leave a model as its recipe and bake it where the game loads - a model source marked bake: load ships as its text in place of its mesh and maps, workers bake them on the graphics device behind the game's own loading screen through loadWork(), at a size the device sets, and keep them for the next launch":
    { note: "A web game can ship its models as recipes and bake them on the player's graphics card." },
  "fix(export): a texture a model source bakes at load does not count as art to compress - the pictures left out of the package were still weighed, so a game that ships its models as recipes compressed its one remaining texture and carried the 1.2 MB transcoder for it":
    { note: "A web game can ship its models as recipes and bake them on the player's graphics card." },
  "feat(export): a playable can bake its models where it loads, carry every scene, and pack what deflates - the single file takes the web export's recipes and worker inline, --all-scenes inlines the scenes folder for a game that switches scenes, a model source with no maps is expanded at load too, a music recipe's samples may ship compressed and are decoded for the synthesis, and meshes, text and recipes are deflated before they are inlined":
    { note: "A web game can ship its models as recipes and bake them on the player's graphics card." },
  "feat(export): a playable is built on the lean engine entry, and a desktop bakes its models at 4096 - the single file installs the engine modules its content names, as the web export does, in place of the whole entry (4.22 MB to 3.68 MB for the space frigate), and the desktop tier goes back to 4096":
    { note: "A web game can ship its models as recipes and bake them on the player's graphics card." },
  "perf(export): a playable's scenes are deflated before they are inlined - the one large text block still inlined as it was, 233 KB of the space frigate's file, now 35 KB":
    { note: "A web game can ship its models as recipes and bake them on the player's graphics card." },
  "fix(export): a texture decoded after the game let a model's baked maps go is read back from the bake, not drawn as a placeholder - a quality change, a scene loaded again or a single-file page decoding late drew the flat placeholder for good once loadWork().release() had cleared the maps; the maps the model was baked with are asked of the bake worker again, which reads them from its cache, and are held for five seconds so the maps of one model decoded together read it once":
    { note: "A game no longer has to wait for every model to bake." },
  "fix(export): a model that finishes baking after the game let the maps go lets its own go once its textures are drawn with them - release() cleared only the maps baked by then, so a model that finished later kept its pixels for the life of the page; now that a map decoded after release is read back from the bake, those maps are cleared as soon as the textures shown with a placeholder have been decoded again":
    { note: "A game no longer has to wait for every model to bake." },
  "refactor(ecs): which components feed the transform composition is said once - world, the AOT dispatcher and the native AOT dispatcher each held their own set of the names Transform, Parent and Children; feedsTransformComposition is built from the component definitions and all three ask it":
    { internal: "Shared readers and sets that several modules restated now have one author; the one thing a project can see is that esengine/sound also exports readWav, the sample reader decodeWav is built on." },
  "fix(ecs): the composition-input set is built on first use, so a test that mocks the component module without Transform still loads the world":
    { internal: "Shared readers and sets that several modules restated now have one author; the one thing a project can see is that esengine/sound also exports readWav, the sample reader decodeWav is built on." },
  "refactor(pipeline): a cooked WAV is read by the engine's decoder, and audio import settings are read against their spec - audioCook kept a RIFF walker of its own beside soundRender's decodeWav, the two already apart on the extensible-format guard; and audioImportSettings restated the bitrate choices and defaults the AUDIO importer spec declares":
    { internal: "Shared readers and sets that several modules restated now have one author; the one thing a project can see is that esengine/sound also exports readWav, the sample reader decodeWav is built on." },
  "feat(editor): the Outliner's Type names a prefab instance's prefab as a link that opens it, as Unreal's does - a root instance reads \"Edit <prefab>\" and opens it in Prefab Mode; while playing it names the prefab and says to stop first, since Prefab Mode swaps the document Stop writes kept changes into; a missing prefab says so; a member of an instance reads its own kind; the Type column shows by default and is wide enough for a name":
    { note: "The Outliner's Type column opens a prefab, as Unreal's opens a Blueprint." },
  "fix(render): a frame's GPU timing counts its screen UI - the screen overlay's graph ran without the pass timer, so the UI's own draw, a CanvasEffect layer's draw and compose, and a backdrop grab were in no pass time and left out of the frame's total; it is now timed like a camera's graph, and a layer's compose is named screen-ui-effect so it is told apart from the UI's draw":
    { note: "A frame's GPU timing counts its screen UI." },
  "fix(modeling): panels cuts a face that is square to along - a panels step given along projected that direction onto each face to line the seams up, and where the face's normal ran with it there was nothing left to line up with, so the face was passed through uncut and unreported: a hull panelled along its length kept bare end faces. Such a face is now cut by its longest edge, the rule a step without along already uses":
    { note: "`panels` cuts the faces that are square to `along`." },
  "fix(particle): a stretched particle in a 3D view lies along its motion as the camera sees it - the quad's direction and length came from the velocity's x and y alone, as if the camera always looked down z, and left out addedVelocity, so a particle moving along z or carried by an added velocity was drawn as a dot; the velocity it moves with is now projected onto the same camera-facing axes its quad is drawn on, which head-on are x and y unchanged":
    { note: "A stretched particle in a 3D view lies along its motion as the camera sees it." },
  "fix(assets): a shipped asset preloads through the loader that reads it - the addressable manifest names each asset by the runtime loader its .meta type ships to, so a font, an anim clip, a tilemap, a timeline or a state machine no longer ships as binary and finds no loader, and a name-published asset loads through its slot instead of throwing":
    { note: "`Assets.preload` and `loadGroup` load every shipped asset through its own loader." },
  "fix(assets): only a name-published asset's typed load goes through its slot - acquireTyped keeps the slot lookup that lets a teardown stop a loader before it starts, and a plain loader is still reached without waiting a turn":
    { note: "`Assets.preload` and `loadGroup` load every shipped asset through its own loader." },
  "feat(export): a game opens before its models are baked, and each model's maps appear as they are done - the bake gives every mesh first, a map is drawn as a flat placeholder until its model is baked and is then decoded again behind the same texture handle, and LoadWork.yieldToGame turns the rest of the bake into short turns that leave the frames their time":
    { note: "A game no longer has to wait for every model to bake." },
  "fix(export): a model baked at load keeps its maps until the game lets them go - a scene loaded twice decoded its textures again after the first take had dropped them and drew placeholders for good; LoadWork.release replaces yieldToGame, whose short turns left a hull blurred for most of a minute":
    { note: "A game no longer has to wait for every model to bake." },
  "feat(render): a player's graphics choices hold over the quality level - QualityController.setPreferences takes a render scale, antialiasing off, MSAA or temporal, SSAO and effects to leave out, and they stay through every level the mode or a ceiling picks; temporal smoothing chosen on a level that skips it runs":
    { note: "A settings screen can change the picture without editing profiles." },
  "fix(render-host): the render host resolves esengine/wgsl - host.ts installs the transpiler from it, and the alias that maps esengine to the SDK's index file turned the subpath into a path under that file, so the host did not build":
    { internal: "The render host used by the pixel gates builds again; nothing a project can call or draw changes." },
  "fix(text): a label in a perspective view is not laid out again every frame - an automatic label in a perspective view draws with SDF glyphs at any scale, but the retained label told the engine its pipeline followed its world scale, and the engine's stale check, which knows only the rule by scale, found every such label at a scale near one to be on the wrong pipeline, every frame; each was laid out again each frame (23 MB allocated a frame and 50 ms frames for a HUD of 150 labels, 16.7 ms after). A retained label is marked as chosen by scale only when the view is flat, and is laid out again when its view changes between flat and perspective":
    { note: "Text in a perspective view is no longer laid out again every frame." },
  "fix(editor): an entity is never created under a parent that is not in the scene - apply_scene_ops took any number as a live id, so a create naming an id not yet allocated could be given that very id and became its own parent: the batch failed with a stack overflow and the saved scene no longer loaded (parent cycle 1 -> 1); a live id is now checked in every op and SceneCommands.create refuses a missing parent before it allocates one":
    { note: "An agent's scene edit can no longer make an entity its own parent." },
  "fix(text): a thin stroke of small distance-field text no longer drops out - the edge ramp was the distance's own screen derivative, which falls to nothing where a stroke under a pixel wide sits across two pixel columns, so whole stems of small labels vanished; a distance-field page now carries in red the texels one distance unit spans and is stored as data rather than sRGB colour, and the shader keeps the ramp no sharper than the page's texels per pixel allow":
    { note: "Small distance-field text keeps its thin strokes." },
  "refactor(render): the built-in shaders splice one copy of each helper they share - packNormal was written out eleven times in each language, ign thirteen, the sky's scattering, clouds and ray start three to eight; a new sdk/src/render/shaderLib.ts holds the helpers more than one module uses (normal encoding, dither, hashes, value noise, Henyey-Greenstein), shared.ts the post-process ones (ray start, rain streaks), and the sky, water, planet and terrain-layer files a constant for each function more than one of their own shaders writes. Every shader source these modules produce (270) is the same text as before apart from comments and whitespace; the shader text in the SDK is 59 KB smaller":
    { internal: "The built-in shaders produce the same source text as before apart from comments and whitespace; no shipped game or editor behaviour changed." },
  "fix(audio): music made on a worker joins its loop without a step, and a stale worker bundle turns a gate red - the sound worker's committed text was built before the loop-seam fix (b129fd4b5) and was never rebuilt, so a game that makes its music on a worker still filtered every round of a loop from rest; and it kept those clips under SOUND_RENDER_REVISION 3, the revision that promised the fix":
    { note: "Music a game makes on a worker joins its loop without a step." },
  "feat(export): a web game opens on the engine's ident - a full-screen shader draws the Estella star and name over the page while the engine loads: a point of light and a lens streak, the four facets growing out and closing with a flash, the name coming in letter by letter, a sweep of light, and then the facets lit in turn until the game is ready. It is 4.7 KB in the page, 2 KB compressed, with no image, font or request, and draws on a thread of its own so a busy start does not stall it. The game waits for it to finish, and a project's own logo comes in after it. A portal's page and a playable ad do not carry it":
    { note: "A web game opens on the Estella ident." },
  "perf(postprocess): a still sky lights the scene from one capture - the environment of a sky defined still is drawn and read back once, and again only when its params, its brightness or a directional light change (at most once a second, as before), where it was redrawn and read back every second, 0.4 to 1.7 ms of GPU each time on the frigate's nebula at high and about 4 ms of a desktop CPU to make it an environment":
    { note: "A still sky lights the scene from one capture." },
  "perf(postprocess): a sky defined still is read from a panorama below high quality - defineSkyEffect still draws the sky into a 2048 x 1024 panorama an eighth a frame whenever its params change, as Baked Clouds does, and the sky pass looks each pixel up in it once it is whole; QualityProfile.stillSky asks for it (low and medium). A nebula of fifty noise lookups went from 2.8 ms to 0.1 ms of a 2400 x 1080 frame":
    { note: "A shader sky can stand still." },
  "fix(export): the model baker runs from a page opened as a file - it was started as a module worker from a blob, which a page with no origin (a single file double-clicked) refuses, so every model's maps failed to load; it is built and started as a classic script on the web and in a playable":
    { note: "A shader sky can stand still." },
  "fix(render): streaming no longer decodes a texture again and again at the size it already has - a texture that loaded as a placeholder, as a model baked at load does, kept the placeholder's size as its file's, so the streamer kept shrinking it to that size and the decode kept giving the full map back: a decode and an upload every quarter second for each such texture, and no memory saved; the loader learns a texture's full size from every decode that gives it, and the streamer reads each texture's sizes afresh on every pass instead of keeping what it saw first":
    { note: "Texture streaming no longer decodes a model's baked maps over and over." },
  "perf(assets): halving an RGBA image allocates nothing per pixel - halveRgba built an array of four taps and reduced it for every channel of every pixel; it now adds the four taps directly, the same sums in the same order and so the same bytes, and a 1024 map halves in 2.5 ms, 9.4 as sRGB":
    { note: "Texture streaming no longer decodes a model's baked maps over and over." },
  "fix(export): a model's baked map is decoded no larger than the size asked for - the bake's decoder handed back the whole map whatever size texture streaming asked for, so streaming took every baked map for one it could not make smaller and left it whole; a map is halved down to the edge asked for, colour and glow averaged as light, and says the size it was made from":
    { note: "Texture streaming no longer decodes a model's baked maps over and over." },
  "fix(render): a texture streaming shrank goes back to full size once the quality level stops streaming - a level with textureStreaming off returned before the streamer did anything, so what low or medium had shrunk, and what had loaded small while they streamed, stayed small at high for good; once streaming is off the streamer puts every texture held below its file back at full size, four at a time and after the moves still landing, and putting a texture back is one move shared with the textures something other than a mesh draws":
    { note: "Textures are sharp again after switching to a quality level that does not stream them." },
  "fix(render): a texture that cannot come back at full size is asked for once, not on every pass - a put-back that decoded smaller than its file, or that the host could not do, was tried again every quarter second for as long as streaming stayed off; it now keeps the size it reached and counts as a failure":
    { note: "Textures are sharp again after switching to a quality level that does not stream them." },
  "perf(sdk): the bundled SDK carries its shader text without comments or indentation - a fifth of index.bundled.js was the built-in GLSL and WGSL as written; the build strips each shader template's comments and indentation, keeping every line break so a compile error names the same line, and a full bundle is 156 KB smaller (46 KB gzipped). The two shaders made by editing Model's text match its lines whatever their indentation, and the SDK suites run on the stripped text":
    { note: "Games download less shader text." },
  "fix(postprocess): the temporal pass a level adds goes before the bloom, the grading and the grain - with no auto exposure in the chain it was put at the end, after the film grain, the vignette and the sharpening, and smoothed the grain away; it now goes before the first lens, colour or stylize effect, after the lighting and the fog, as it always meant to":
    { note: "Temporal anti-aliasing no longer smooths away the film grain." },
  "refactor(render): TextureAtlas packs with the shelf packer and one nextPowerOf2 serves every caller - packRects kept a third packer, the single-open-row heuristic shelfPack.ts was written to retire, and four modules each wrote the next power of two":
    { note: "`TextureAtlas.pack` fits textures into the rows already open before starting a new one." },
  "fix(shaders): a lit shader written only in GLSL is lit on WebGPU - its WGSL copy was translated with only the switches and features the shader declares, so a symbol the engine defines when it assembles the shader (MESH_NORMALS, ES_GBUFFER) took its undefined branch for good: a mesh read the flat 2D normal and drew one colour on WebGPU where WebGL shaded it. Every symbol the shader's GLSL tests is now a toggle of the translation, and a twin made before is made again":
    { note: "A lit shader written only in GLSL is lit on WebGPU." },
  "feat(ui): moving a UI node by hand has one answer the editor and a running game share - uiAbsoluteMove turns a drag into an Absolute node's inset and margin patch, each side in its own unit, uiFlowSlot says which slot among its siblings a flow node dragged to a point takes, and moveUINodeBy and moveUINodeToward apply them to a live world":
    { note: "UI nodes can be dragged in the viewport and while the game runs." },
  "fix(editor): a UI node is dragged in the viewport and in a running game - Inspect (F8) gave a UI node no handle, so nothing on a Canvas could be moved while playing, and in the viewport a flow node only said to switch to Absolute; an Absolute node's drag now writes its insets through the SDK's uiAbsoluteMove in both worlds, a flow node's drag takes the slot among its siblings the pointer is over (as Unreal's designer and Figma's auto layout reorder), one undo step in the scene and kept at Stop for an Absolute node's insets":
    { note: "UI nodes can be dragged in the viewport and while the game runs." },
  "perf(text): a blurred text shadow is drawn once per glyph from a baked cell - the shadow stamped the whole label around rings of offsets, up to 64 copies, so a HUD of labels with a 6 px blur drew every glyph 53 times; the copies are now composited once into a cell of the glyph atlas beside the glyph, mapped so that one draw at the shadow's alpha lands where the stack did. A distance-field glyph's cell is made from its distances at about the size it is shown and read through the glyph's own program with a bias that passes its coverage through, so a label's shadow and fill still draw together":
    { note: "A blurred text shadow is drawn once per glyph instead of dozens of times, and the screen UI does less work every frame." },
  "perf(ui): the layout solves once for each change, not twice a frame - the early pass asked whether anything had changed since one tick before the late pass solved, so every write the late pass had already solved was solved again the next frame; both passes now compare the write and topology revisions of UINode and FlexContainer with the ones they last solved at":
    { note: "A blurred text shadow is drawn once per glyph instead of dozens of times, and the screen UI does less work every frame." },
  "perf(ui): a world anchor reads its camera once a frame, not once per anchor - every anchor read the same camera's Camera and Transform again; the lens is now made once per camera and frame":
    { note: "A blurred text shadow is drawn once per glyph instead of dozens of times, and the screen UI does less work every frame." },
  "perf(ui): a pointer that has not moved over a UI where nothing changed no longer runs the hit test every frame - UILayoutGeneration advances only when the layout is solved or the screen roots move, the hit test also reruns on the change ticks of what layout does not move, and UIInteraction is read only for the controls a pointer is over or left":
    { note: "A pointer that has not moved over a UI where nothing changed no longer runs the hit test every frame." },
  "perf(render): text and the quads around it draw through one batch program - a sprite, a distance-field glyph and the two halves of a glyph whose outline is baked into its page each took a program of their own, so a screen UI that alternates panels and labels started a new draw at every label; the default batch program now reads which of the four a vertex is from the bits above its texture slot, and the merge keeps those bits when it gives the vertex a slot":
    { note: "Text and the sprites and UI quads around it now draw in the same batch." },
  "feat(webgpu): WebGPU draws with GL's screen convention, so a shader's GLSL means the same on both backends - every WebGPU vertex stage turns clip y over and a target's rows land bottom-up as GL lays them; the backbuffer is drawn into a texture of its own and reaches the swapchain turned over once at the frame's end; viewport, scissor and readback rows, the published copy of every render target, textureOriginTopLeft and the y fixes in the hand-written WGSL are gone; every fullscreen pass and the Water fragment ship as GLSL alone":
    { note: "WebGPU and WebGL now see the screen the same way." },
  "feat(shaders): the transpiler writes fullscreen passes, the engine's samplers and vertex hooks too - a PostProcess pass, the depth texture, sampler2DArray layers, findSun and the other derived bridges, esMaterialVertex hooks, array constructors and chained assignment; a project's own .esshader is served as written and transpiled as it compiles, with naga only for what the transpiler refuses; Terrain Layers ships as GLSL alone":
    { note: "Shaders are written once, in GLSL." },
  "feat(agent): Estella ships official skills - how a task is done end to end in this engine, for an agent to follow: the workflow every task takes (acceptance first, build, verify until it passes), screen UI, 2D gameplay and finding why something fails, each with the mistakes agents make in that work, as SKILL.md directories an agent loads itself or reads through skill_guide":
    { note: "An agent working in Estella is told how a task is done here and can prove it done: official skills and `verify`." },
  "feat(agent): verify says whether the work is done - one verdict over whether the scripts build, the scene has no empty required field or dead reference, nothing blocks a build, and the game, played deterministically with the inputs given at their frames, meets the expectations given, logs no error and draws more than one flat colour; each failure names where and what to do, and an acceptance file holds the task's expectations so an agent writes them first":
    { note: "An agent working in Estella is told how a task is done here and can prove it done: official skills and `verify`." },
  "feat(agent): skill_guide serves Estella's official skills, and every session is told to read the workflow first - the skills ship beside the templates and are read from disk by the MCP front without an editor; a test fails a skill that names a tool the front does not serve or a verify op verify does not take":
    { note: "An agent working in Estella is told how a task is done here and can prove it done: official skills and `verify`." },
  "fix(agent): verify compares objects by their contents, not by the order their keys were written - a UINode's width answered { unit, value } and an expectation wrote { value, unit }, so a correct panel failed; equality and changed / unchanged now compare data key by key":
    { note: "An agent working in Estella is told how a task is done here and can prove it done: official skills and `verify`." },
  "refactor(agent): every editor tool calls one thing by one name - an entity is `entity` in what a tool takes and in what it answers, a component field `field`, search text `query`, a cap `limit`; get_entity took `id` where get_inspector took `entity`, and in twelve trial runs 62 of the 69 calls the editor refused were a name carried over from another tool, so the old names are now read as the declared ones and the scene tree and entity search answer `entity`":
    { note: "Every editor tool calls one thing by one name." },
  "feat(agent): every entity argument takes a name as well as a number - looked up where the tool acts, the running game for inspect_entity and the open scene for the rest, refused with the candidates' numbers when two share it, and a scene path such as HUD/ScoreText picks one; the scene and the running game number the same Player differently, and an agent that passed {entity: \"Player\"} to inspect_entity was refused nine times in one run":
    { note: "Every editor tool calls one thing by one name." },
  "fix(postprocess): ambient occlusion leaves open a surface too far off to measure - where the radius is under a texel or two, or one step of the depth buffer is longer than the bias, SSAO and GTAO fade out, where the radius was clamped up to two or three texels and the samples, a depth step apart at random, voted occluded differently each frame: a planet seen from space boiled by eight levels a frame whenever the view moved":
    { note: "Ambient occlusion no longer flickers on a surface seen from very far off." },
  "fix(ci): the cache check waits for the game after its offline restart - a launch opens on the engine's ident, and the check judged the frame half a second in, so it saw the ident and reported the cached version lost; it now waits for the game's colour as the update steps above it do":
    { internal: "A CI check's timing; the engine, the editor and every package are unchanged." },
  "perf(ecs): the hierarchy is a ChildOf relation and world transforms compose in one cascade walk - each entity's parent, first and last child, siblings and depth live in flat arrays indexed by entity, so linking, unlinking and reordering are O(1) and allocate nothing, and composition walks every tree as one parent-first array instead of a stack of child lists; a 100,000-entity scene of 1,000 trees composes in 2.6 ms where it took 3.4 ms":
    { note: "The hierarchy is a relationship the engine stores itself, and world transforms recompose only what moved." },
  "perf(ecs): world transforms recompose only what was written since the last composition - each writer stamps the Transforms it writes, and composition reads the stamps: an entity in no tree is copied only when written, and a written entity in a tree recomposes its own subtree, one contiguous range of the cascade; 1% of 100,000 entities moving composes in 50 to 80 µs where it took 0.9 to 3.4 ms, and a write that left no stamp (bytes written behind the world's back) makes the next composition compose everything":
    { note: "The hierarchy is a relationship the engine stores itself, and world transforms recompose only what moved." },
  "perf(ecs): a reparent recomposes only the subtree that moved, and rebuilds only the trees it touched - the relation lists the entities whose parent changed and keeps its cascade one array per tree, so moving a 100-entity subtree in a 100,000-entity world costs 6 µs where it cost 3.5 ms; destroying a parent says its children's world transforms are stale":
    { note: "The hierarchy is a relationship the engine stores itself, and world transforms recompose only what moved." },
  "perf(ecs): an incremental composition takes each written Transform from the pool's dense arrays - one pass down entities, components and stamps side by side hands it the component, where it looked each written entity up again":
    { note: "The hierarchy is a relationship the engine stores itself, and world transforms recompose only what moved." },
  "perf(ecs): a frame with no static, dirty-tagged or watched Transform copies each root with nothing around the copy - composition no longer asks every root whether it is static, tagged or watched when nothing is, and the flag that says a Transform's world fields are current sits beside them, so composing 100,000 moved roots costs what copying them costs":
    { note: "The hierarchy is a relationship the engine stores itself, and world transforms recompose only what moved." },
  "perf(render): on Direct3D a shader's counted loops are compiled as loops - the D3D compiler unrolls every for loop with a literal start, so a noise shader of nested octave loops took two minutes to link on a cold cache; each such loop now starts at its literal plus a uniform that is always 0, which it cannot fold":
    { note: "A game's first start on Windows no longer waits minutes for its shaders." },
  "perf(render): a material variant that differs only by a feature its shader never reads is the same program - an unlit surface drawn with and without the environment map compiled the same source twice, the second only after the scene opened":
    { note: "A game's first start on Windows no longer waits minutes for its shaders." },
  "feat(export): nothing is compressed unless it is ticked - textures by their import settings, atlas packing, WAV to MP3, a playable's images as WebP (lossless, 90 or 80) and a mini-game's engine binary are each a box in the Build dialog, off until chosen; the one auto/skip switch that turned the first three on for everyone is gone, and a playable's size budget is reported against but no longer picks a WebP quality, lowers an MP3 bitrate or converts anything":
    { note: "Nothing is compressed unless you tick it." },
  "feat(build): the Build dialog shows one box for each compression the target can do, each off until ticked - textures by import settings, atlas packing, audio to MP3, the engine binary on mini-games, and a playable's images as WebP (off, lossless, quality 90 or 80); a profile can set each one, and the export tool takes the WebP choice too":
    { note: "Nothing is compressed unless you tick it." },
  "fix(tests): the engine suite lets a worker read its replies between tests - a file of synchronous tests that ran past a minute, as modeling-displace does on a loaded runner, held a status update in flight the whole time, so the worker's own 60 s RPC timeout fired before the reply could be read and the file's results were lost":
    { internal: "The engine's test runner turns its event loop between tests; nothing a project can call or draw changes." },
  "fix(camera): a frame names one Canvas, the running scene's, for its cameras, its layout boxes and its clear colour - each looked the Canvas up for itself, seven times a frame and by two rules: the cameras took the Canvas of a running scene, while the screen layout, the UI layout box and the clear colour took the first Canvas there was, so with two scenes loaded the UI was laid out in one Canvas's box under cameras fitted to another's; the Canvas is resolved once where the cameras are and handed to each, and the early sync the UI lays out from uses the same running scenes as the render":
    { note: "With two scenes loaded, the UI is laid out in the running scene's Canvas, the one its cameras are fitted to." },
  "perf(ecs): world.get and tryGet read an engine component out of the wasm heap, as a query does - they went through the embind getter, which marshals the whole component into a new object field by field (5.5 us for a UINode, 0.9 for a Transform) while a query row read the same bytes directly; both now take the one heap reader, 4 to 19 times cheaper a read, and a query of one or two components by name keeps its cache key and dependency list instead of sorting and joining them on every call":
    { note: "A frame in which nothing changed costs less: reading a component, running a system and asking for entities are each cheaper." },
  "perf(app): the scheduler keeps one record per system and reads the clock once a frame - a system's arguments, queries, removal readers and last-run ticks were five maps read and written eight times around every call, its command buffers were found by testing every argument twice, every system run read the clock for its plugin's liveness beat, and every schedule waited a turn of the task queue for systems that had not parked":
    { note: "A frame in which nothing changed costs less: reading a component, running a system and asking for entities are each cheaper." },
  "perf(ui): a widget's system runs only while a widget of its kind exists - the dialog, slider, toggle, tab view, dropdown and virtual control systems, and the camera's follow and bounds, ran every frame of every game whether or not the scene had one; each is now gated on its component and runs one frame past the last, when it lets go of what it kept":
    { note: "A frame in which nothing changed costs less: reading a component, running a system and asking for entities are each cheaper." },
  "chore(tools): render-submit-cost reports each system's and scope's mean over many frames - --avg N steps N frames one at a time and averages, since one frame's reading of a system that takes microseconds rounds to 0 or 0.1 ms":
    { internal: "render-submit-cost averages each system over many frames; nothing a project can call or draw changes." },
  "fix(export): the engine's ident plays over a game that is already starting - every target boots behind it, a mini-game keeps drawing it while the game runs underneath and draws the game once it ends, a page paints its opening black itself, and the runtime says when it has gone":
    { note: "The engine's ident no longer holds a game back." },
  "fix(minigame): the engine takes the GL context once the ident has ended - drawing the ident while the engine set itself up on the same context lost that context now and then on a software rasteriser":
    { note: "The engine's ident no longer holds a game back." },
  "fix(minigame): the ident says it is done only once the game has drawn three frames after it, and draws on the host's animation frames as it did before":
    { note: "The engine's ident no longer holds a game back." },
  "fix(minigame): the ident leaves the GL context alone between its own draws again - the engine no longer shares the context with it, so it neither reads back nor restores the engine's state":
    { note: "The engine's ident no longer holds a game back." },
  "fix(minigame): a display context the browser takes back while the ident plays is kept restorable, and the engine waits for it to come back before it takes it - made at boot, it could be lost moments later while a busy GPU process was still starting, and the engine then compiled every shader on a dead context":
    { note: "The engine's ident no longer holds a game back." },
  "chore(tools): the cost harnesses measure at a phone's CPU speed - render-submit-cost, terrain-water-cost and shader-compile-cost slow the page's CPU five times through the browser's own throttle unless --slow or ESTELLA_CPU_SLOWDOWN says otherwise and say so beside their numbers (GPU times are not slowed); render-submit-cost also lists who calls a function (--callers) and as many systems as asked (--systems)":
    { internal: "The cost harnesses under tools/ measure with the CPU slowed to a phone's speed; nothing a project can call or draw changes." },
  "feat(terrain): a planet can tint its layers by its four layer colours - `tintLayers` multiplies the layers' pictures by the colour the planet gives each layer, so grey pictures of grain serve every world of a game in that world's own colours, where a planet with layers drew them in the pictures' colours alone and its layer colours did nothing":
    { note: "A planet can tint its terrain layers by its own four layer colours." },
  "fix(worldgen): a world laid out on a planet stands where the planet is when the planet is moved - a chunk's places are worked out against where the planet stood then and are put in its space from there, where they were put from where it stood when the chunk was published, a frame or more later, so a game that keeps the eye at the origin and moves the planet past it had every tree off its ground by how far it had flown in between; and a plant's far cards lean with it, where they stood along the world's up a quarter of the way round a planet":
    { note: "A world laid out on a planet stays on its ground when the planet is moved, and its far plants lean with the planet." },
  "fix(app): a runtime still loading when its App quits stops instead of running it, and leaving play mode ends the session's sound":
    { note: "Stopping a game in the editor stops its music and sound effects." },
  "fix(editor): a play realm runs one game at a time, so Stop ends the music a Play handed over mid-load had started":
    { note: "Stopping a game in the editor stops its music and sound effects." },
  "fix(export): a playable packs atlases, each page inlined once, and its sprites draw their own frame - the playable export never passed atlas packing to its cook, and had no way to tell its runtime where a frame sits on its page, so it shipped every sprite separately and a packed one would have drawn the whole page; the page now rides once under its first frame, every other frame points at it, and a catalog of frame positions reaches the runtime as it does in a web build":
    { note: "Playables can pack atlases." },
  "feat(build): a playable's Build dialog offers atlas packing - the playable export now carries each page once and every frame's place on it, so the box the dialog hid from playables is shown there too":
    { note: "Playables can pack atlases." },
  "perf(export): a playable's images are lossless WebP whenever that is smaller, not only once the package is over its budget - a playable carries every image as base64 in its one HTML file, a third larger than the PNG, and below the budget nothing shrank it; lossless loses nothing, so it now runs on every export that compresses, and only the lossy qualities still wait for the budget":
    { note: "A playable's images are lossless WebP whenever that is smaller." },
  "feat(export): a project chooses when its playable ad tells the network it is ready - when the game starts running, as before, or once the engine's ident has gone (packaging.platforms.playable.ready)":
    { note: "A playable ad can wait for the engine's ident before telling its ad network it is ready." },
  "feat(settings): the engine intro and a playable's ready timing are project settings - Start screen has an Engine intro switch, on unless the project turned it off, and the playable page asks whether to tell the ad network it is ready when the game starts or after the intro":
    { note: "A playable ad can wait for the engine's ident before telling its ad network it is ready." },
  "perf(render): a screen UI that did not change is drawn from what the engine holds - the screen overlay collected every control, mask and label, re-transformed every glyph, sorted, merged and uploaded its vertices every frame; it now keeps a pool and draw list of its own and, while no component of an entity in the screen's UI was written, added or removed and nothing else it was built from moved, draws what it holds, with nothing collected or uploaded":
    { note: "A screen UI that did not change is drawn from what the engine already holds, not built again every frame." },
  "fix(render): a screen root that replaces another takes over the segment the other held - opening a scene gave its Canvas a new root, so the held overlay shut the old root's pool down and made a new one, whose fresh vertex layouts named new pipelines that are never erased; the editor grew two pipelines and about 2.4 KB of heap on every scene opened back and forth":
    { note: "A screen UI split over several root Canvases rebuilds only the Canvas that changed." },
  "perf(render): a screen UI over several root Canvases rebuilds only the Canvas that changed - the held overlay is held per screen root, each root's controls, masks and labels in a list of their own drawn in the roots' order, and a write, addition or removal under one root, a label laid out again there or a particle emitter beneath it rebuilds that root's list alone; a pass with host geometry, an effect, a second pass, or roots whose draw order interleaves stays one list":
    { note: "A screen UI split over several root Canvases rebuilds only the Canvas that changed." },
  "fix(export): exporting a game's server again retries the deletes that clear the last export":
    { note: "Exporting a game's server over an earlier export no longer fails at random on Windows." },
  "feat(export): a game's server exports and deploys with its page":
    { note: "A game's server exports with its page, ready to deploy." },
  "feat(export): a page served apart from its game server dials the address the project names":
    { note: "A game's page can be served apart from its server." },
  "fix(render): stars no longer show through a blended surface in front of the sky":
    { note: "Stars no longer show through a blended surface in front of the sky." },
  "perf(input): a web game with no gamepad does not ask the browser for its pads every frame - navigator.getGamepads() ran in every frame of every game, and nearly every game on a phone has no pad; with none known the browser is asked once a second, at once when it announces one, and every frame while one is plugged in":
    { note: "A web game with no gamepad, a UI with focusable controls and every camera cost less each frame." },
  "perf(ui): the focus system asks whether one control may hold focus, not for the whole Tab ring, every frame - it built and sorted every Focusable's traversal entry each frame to check the focused control and any pressed one; it now checks those two, and sorts the ring only when Tab is pressed":
    { note: "A web game with no gamepad, a UI with focusable controls and every camera cost less each frame." },
  "perf(camera): a camera's view is read out of the engine's memory - the two camera resolves of every frame built each camera's Camera and Transform through the registry's getters, field by field into new objects; they now read them through the world as a query does":
    { note: "A web game with no gamepad, a UI with focusable controls and every camera cost less each frame." },
  "perf(text): labels are laid out once a frame where something changed, and the engine draws them in its own collects - every camera's pass and the screen overlay's walked every Text comparing each label's fields, then handed the engine its glyphs from a script callback; TextLayoutSystem lays out both domains just before the frame is drawn and only when a Text, a font, the pixel ratio, a domain's view or an atlas moved or the engine reports a label stale, and the camera's collect and the overlay's draw the retained labels themselves, after every other plugin":
    { note: "Text is laid out once a frame, only where something changed, and drawn by the engine in the same collect as every other UI element." },
  "fix(text): a large label is laid out once, not again every frame - the engine asks whether the world scale still chooses the pipeline a label was laid out for, and was told the large-glyph atlas's format, a distance field the scale rule never chose, so every label drawn from it was reported stale and laid out again each frame; the engine is told what the scale chose":
    { note: "Text is laid out once a frame, only where something changed, and drawn by the engine in the same collect as every other UI element." },
  "perf(wasm): stop exporting yoga's C entry points from the engine module":
    { note: "The web and mini-game engine binaries are smaller: yoga's C entry points and the editor reflection bindings no longer ship in them." },
  "perf(wasm): keep the editor reflection bindings out of the SDK engine":
    { note: "The web and mini-game engine binaries are smaller: yoga's C entry points and the editor reflection bindings no longer ship in them." },
  "fix(shaders): a Lit shader written in GLSL alone hands the WGSL header the varyings its GLSL reads straight - the transpiled entry sets g_probeSlot, g_lightmap and g_worldTangent from VSOut, as the hand-written twins did, so on WebGPU a Model surface shows its lightmap, a mesh's own tangents orient its normal map, and each instance reads its own light probes":
    { note: "On WebGPU, a Model material shows its baked lightmap and lights its normal map with the mesh's own tangents again." },
  "fix(shaders): a GLSL shader's sampleNormal reads the normal map through its mips on WebGPU too - the transpiler wrote it as the WGSL header's level-0 read, so every built-in lit shader written in GLSL alone sampled the full-size normal map at any distance; in a fragment it now goes through sampleNormalGrad with the derivatives of its uv, as GLSL's texture() does":
    { note: "On WebGPU, a distant normal-mapped surface no longer shimmers." },
  "feat(animation): a clip event with a duration is a window - a melee swing sweeps its anchor's path over its active window, a transition can wait for a window on the clip being left, and a trigger buffers a press for a set time":
    { note: "A clip can declare windows, and a melee swing reaches along the path its weapon travelled." },
  "feat(editor): Browser beside Scan Preview opens the current scene in the default browser to debug with its developer tools - the preview build (unminified, with source maps, reloading on save) is also served on 127.0.0.1, so it needs no network, and a preview with no LAN serves this computer alone instead of refusing to start":
    { note: "The editor previews a scene in your own browser with one click, to debug it there." },
  "perf(residency): a streamed cell's preparation takes its pieces in a frame's turns - parsing its document, expanding its prefabs, resolving its assets and readying its programs wait for Bakes.turn instead of running whenever a fetch answers, and an urgent or rushed cell passes at once":
    { note: "A streamed cell's preparation runs inside the frame's budget." },
  "feat(residency): a streamed cell arrives and leaves over frames under the frame's budget - its roots stay switched off until it is whole, at most four cells prepare and one publishes at a time, and a cell a source is upon is finished at once and, under the default slowStreaming 'wait', holds the game until it is in, as Unreal's level streaming does":
    { note: "A streamed world's cells arrive and leave within the frame's budget, with Unreal's streaming policy." },
  "feat(animation): a clip event with a duration is a window - a melee swing sweeps its anchor's path over its active window, a transition can wait for a window on the clip being left, and a trigger buffers a press for a set time":
    { note: "Combos chain inside the window their clip declares, and an attack press is buffered rather than kept forever." },
  "feat(editor): the animator's transition conditions take a window by name, and a trigger parameter has an input buffer in seconds beside it":
    { note: "Combos chain inside the window their clip declares, and an attack press is buffered rather than kept forever." },
  "fix(editor): Details reads like Unreal's - a component's title follows its arrow with the enable box at the right end, so every title starts in one column; X, Y and Z are told by a colour bar down an unoutlined well with no letter; and Advanced is a thin bar with a chevron along the component's bottom, its fields opening above it":
    { note: "The Details panel is laid out as Unreal's." },
  "fix(editor): the editor's chrome stops competing with the scene - wells a step above the panel, accent only where something is selected or running, axis letters coloured only while their field is used, no dot on every component header, a quiet viewport readout, a thin camera frustum and a lower asset drawer":
    { note: "The editor's panels are quieter, so the scene is what stands out." },
  "fix(editor): a vector field's axis shows as a thin coloured edge down its well, always on, as Unreal marks a vector cell - the letter stays grey; colour only on hover lost the link to the gizmo's arms":
    { note: "The editor's panels are quieter, so the scene is what stands out." },
  "fix(editor): a vector's value fits its well and the viewport toolbar is flat - the Details label column takes a third of the row, not two fifths, the axis tab is 12 px and a value still too long ends in an ellipsis, and the toolbar's mode and toggle groups lose their sunken ringed wells":
    { note: "The editor's panels are quieter, so the scene is what stands out." },
  "fix(editor): a vector value too long for its well is cut by the box, not ended in an ellipsis - an ellipsis, like rounding the value down to fit, shows a number that is not the value; the digits shown are the value's own":
    { note: "The editor's panels are quieter, so the scene is what stands out." },
  "feat(residency): a streamed world can bake each cell a far proxy that stands in for it while it is not resident - the cell's static, opaque meshes merged per material and simplified at build time, handed over with no gap either way":
    { note: "A streamed world draws its distant places: each cell can ship a far proxy that stands in for it while it is not loaded." },
  "perf(residency): a far proxy is simplified as far as proxyError allows, carries its tints in its vertices and drops the lightmap UV - proxyRatio is a floor that defaults to 1%, surfaces that differ only in colour share one draw, and a 144-cell town's proxies went from 43 MB to 11 MB, its frames from 436 draws to 354":
    { note: "A streamed world draws its distant places: each cell can ship a far proxy that stands in for it while it is not loaded." },
  "perf(play): Play simplifies a streamed world's far proxies with the build's own simplifier - its proxies kept every triangle of the cells they stood for, 3.1 million in a 144-cell town and 120 MB of meshes, where a package's keep 162 thousand":
    { note: "A streamed world draws its distant places: each cell can ship a far proxy that stands in for it while it is not loaded." },
  "perf(residency): Play makes each far proxy when the streamer first asks for it, not all of them before the game starts - simplifying a 144-cell town's took 10 s before its first frame; naming them takes 172 ms, and each proxy about 30 ms as it arrives":
    { note: "A streamed world draws its distant places: each cell can ship a far proxy that stands in for it while it is not loaded." },
  "feat(residency): ExcludeFromFarProxy keeps a subtree out of its cell's far proxy - for what a game's own system moves with no body or animator to say so, which a proxy would otherwise show frozen where it was authored":
    { note: "A streamed world draws its distant places: each cell can ship a far proxy that stands in for it while it is not loaded." },
  "fix(launcher): the new-project gallery has Far Proxy Town's Chinese text - the example shipped without an entry, so a Chinese editor showed it in English and the gallery's text check failed":
    { note: "A streamed world draws its distant places" },
  "feat(render): Graphics fills any path and is tessellated once, and flush() draws it moved, turned, scaled and faded through a batched Draw.triangles":
    { note: "`Graphics` fills any outline, builds its triangles once, and draws one shape any number of times faded and moved." },
  "perf(render): Graphics keeps its triangles in the engine's memory and flush() draws them by reference - Draw.createTriangles copies a mesh in once, so drawing a shape copies nothing":
    { note: "`Graphics` fills any outline, builds its triangles once, and draws one shape any number of times faded and moved." },
  "perf(render): a Graphics' triangles live on the GPU and each copy is an instance record - the batch shader's INSTANCED variant moves and tints the shape there, and copies drawn one after another are one instanced draw":
    { note: "`Graphics` fills any outline, builds its triangles once, and draws one shape any number of times faded and moved." },
  "perf(render): Graphics.flushMany and Draw.trianglesMany draw many copies of a shape in one call into the engine - the copies' instance records are written where the engine reads them":
    { note: "`Graphics` fills any outline, builds its triangles once, and draws one shape any number of times faded and moved." },
  "fix(render): a Graphics counts frames by the app's, not by Draw.begin - a frame opens several of those, so a drawing rebuilt in a system each frame was taken for one kept between frames and made a GPU buffer it threw away a frame later":
    { note: "`Graphics` fills any outline, builds its triangles once, and draws one shape any number of times faded and moved." },
  "refactor(app): the host's pause owners live in app/hostPause, so residency imports no value from app.ts and the cycle app -> scenePlugin -> residencyPlugin -> app is gone":
    { internal: "The host's pause owners live in their own module, so residency no longer imports the app at run time and the import cycle through the scene plugin is gone; nothing a project can call or see changes." },
  "refactor(render): ImmediateDraw::createShape keeps a Graphics shape on the GPU - it was named createMesh like ResourceManager's MeshHandle mint, so mesh-provenance read a retained shape buffer as an undeclared MeshHandle producer":
    { internal: "ImmediateDraw's method that keeps a Graphics shape on the GPU is named createShape, so it is no longer mistaken for the engine's one MeshHandle mint; nothing a project can call or see changes." },
  "fix(editor): a field's value keeps the engine's words in a Chinese editor - an empty or full mask, an empty asset slot and an unset option read None, Everything, Nothing and (none) like the English option names beside them, where 全部 sat over Color | Depth; field and option names follow the code, the editor's own chrome follows the UI language":
    { note: "In a Chinese editor, the Details panel's names and values are the engine's own, in English." },
  "fix(render): placements ask for the texture size their nearest drawn instance needs, and plants a world grows start their textures small, so a forest's textures are streamed":
    { note: "A forest's textures are streamed." },
  "fix(editor): texture streaming is called 纹理流送 in the Chinese editor, the name the documentation and the industry use - the quality settings said 贴图流式加载 and 贴图流式预算 while the World Streaming page said 纹理流送, so a search for one found neither the other nor the setting":
    { note: "A forest's textures are streamed." },
  "fix(editor): an open menubar menu closes on a press anywhere that is not a menu - it listens for pointerdown in the capture phase, so the viewport cancelling the press no longer hides it, the title row's empty part counts as outside and stops being a drag region while a menu is open, and the window losing focus closes it":
    { note: "A menu opened from the editor's menu bar now closes when you click anywhere else." },
  "feat(metrics): esengine/metrics reports a server process in the Prometheus text format - a registry with the game's own counters, gauges and histograms, collectors for the replication server, zones, player records and the process read at scrape time from totals those pieces now keep, a flat JSON snapshot, and a /metrics request handler":
    { note: "A game server can be watched, with `esengine/metrics`." },
  "refactor(nav): a streamed world's navigation reads residency through worldResidencyView, a read-only view of the cells, instead of naming the WorldStreaming resource that only residency may author":
    { internal: "Navigation reads a streamed world's cells through a read-only view the residency module hands out, instead of naming the residency resource itself; nothing a project can call or see changes." },
  "fix(nav): a streamed world's navmesh is baked a tile per grid square and follows its cells - it was baked once from the persistent world before any cell arrived and never again, so agents walked straight through every wall a cell held":
    { note: "Agents in a streamed world walk round what its cells hold." },
  "fix(persist): FileStore retries a rename Windows refuses for a moment - replacing a file another handle has open (a reader, an indexer, a virus scanner) failed with EPERM, EBUSY or EACCES and lost the write; it is retried briefly and the temporary file is removed if it never goes through":
    { note: "A game server can keep what it holds across restarts" },
  "feat(persist): one store for many processes, and writes that go together - PersistStore.transact writes several keys all or none (FileStore through a journal a crash cannot leave half-applied), StoreHub serves any store over WebSockets behind a shared secret and RemoteStore is a store that reaches it, and PlayerPersistence.saveTogether writes several players' records as one":
    { note: "A game server can keep what it holds across restarts" },
  "feat(persist): esengine/persist keeps a server's state across restarts - a versioned document store with memory and file implementations, schema-versioned records with migrations, entity snapshots, PlayerPersistence that loads and saves the records of the players present, and WorldPersistence for entities marked Persistent":
    { note: "A game server can keep what it holds across restarts, with `esengine/persist`." },
  "fix(terrain): a planet's ground is no longer left at its coarsest while the eye moves - a page was asked of a worker and thrown away every frame the workers were full, which kept them full; pages are spread over the workers that make the ground and asked for ahead of a world's plants, which have the other workers":
    { note: "A planet's ground fills in to its finest under a moving eye, where it stayed a few flat facets." },
  "feat(terrain): a planet's sea has waves, shallows and a shore - trains of slope laid over the sphere so they stay where they are when the planet is moved and fade where a pixel cannot hold them, water that is clearer and paler over a shallow bottom read from the frame's depth, foam where it runs out against the ground, and a surface that mirrors the sky seen along it, where the sea was one flat colour at one opacity; `seaWaveLength`, `seaWaveSteepness` and `seaShallowDepth` say how":
    { note: "A planet's sea has waves, shallows and a shore." },
  "feat(render): the effects that are drawn small take their size from the quality level - effectResolution multiplies the size ambient occlusion, fog light, screen-space GI, lens flare and the voxel GI gather draw at, down to a floor each effect declares; it is the first entry of a table of per-level settings (QUALITY_SETTINGS) that the profile, its parsing, player preferences and the editor row are all made from":
    { note: "A quality level sets how large the effects that are already drawn small are drawn." },
  "feat(settings): the quality level's effect resolution is a row of its post-processing group - the row is made from the engine's table of per-level settings (QUALITY_SETTINGS), with its label, description, range and three defaults read from there, so the next setting added to the table needs no editor change; only a value that differs from the level's own default is written to project.esproject":
    { note: "A quality level sets how large the effects that are already drawn small are drawn." },
  "fix(gates): project-settings reads QualityProfile now that it extends the settings table's values, and the API stability page follows the new snapshots":
    { note: "A quality level sets how large the effects that are already drawn small are drawn." },
  "fix(render): a draw that did not take the depth prepass is not lost after it on D3D11 with a multisampled target - the colour pass after a prepass switched the draws that took it to testing depth without writing it, and on ANGLE's D3D11 backend with four samples a draw that writes depth after draws that only test it is not drawn at all (the same calls on its GL and Vulkan backends draw it), so with the prepass on a cut-out the prepass has no program for, a wood of trees on the foliage material, vanished with only its shadows left; the draws that took the prepass now go on writing the depth that is there already":
    { note: "With the depth prepass on, cut-out foliage is no longer missing on Windows browsers at the high quality level." },
  "fix(export): a development preview opens without the project's logo or minimum start-screen time, and a web game asks to be turned only on a touch screen - the browser preview held the game back behind its start screen and, for a portrait game in a desktop window, hid it behind a rotate-your-device notice":
    { note: "The browser preview starts as soon as the game is loaded, and a desktop browser never hides a game behind \"rotate your device\"." },
  "perf(render): a probe volume read per pixel samples a 3D atlas of bricks through an indirection cell - nine filtered reads where it took eighteen, in the shape a sparse volumetric lightmap takes":
    { note: "A probe volume read per pixel takes half the texture reads it did, from a 3D atlas of bricks." },
  "feat(render): the engine says how a loaded probe volume is laid out - probe_volume_getResolution, probe_volume_getBricks and probeVolumeLayout, what an editor draws to show where a sparse bake put its bricks":
    { note: "A selected probe volume shows what its bake laid down." },
  "feat(editor): a selected probe volume shows what its bake laid down - a sparse grid's bricks coloured by span (violet finest, then amber, pale yellow and grey) and a dense grid's probes at its baked resolution, both read from the grid the engine loaded":
    { note: "A selected probe volume shows what its bake laid down." },
  "perf(bake): a probe grid is written as a binary .esprobes of half floats, a fifth the size of its JSON, and the loader checks the version it reads - version 1 grids still load":
    { note: "A baked probe grid is a binary file a fifth the size it was, and loading one checks its version." },
  "feat(editor): Bake Lighting writes a probe grid as a version 2 binary .esprobes - half floats, a fifth the size of the JSON it wrote, through the one writer the CLI uses; the bake check reads it back with the SDK's decoder":
    { note: "A baked probe grid is a binary file a fifth the size it was, and loading one checks its version." },
  "fix(editor): a probe grid assigned after the scene opened reaches its volume - the hot load recorded the grid's handle, but the resolver read only the material, font, mesh and environment handles, so a LightProbeVolume given a new .esprobes read nothing until the scene was reopened; it now reads every handle the slot table records":
    { note: "A probe grid assigned to a LightProbeVolume after the scene opened now lights it in the editor." },
  "feat(render): the low quality level reads probe volumes per object and holds no probe atlas, and the frame stats say what probe volumes cost - QualityProfile.probesPerPixel, renderer_setProbesPerPixel, and the draws reading per pixel and per object with the atlas's GPU bytes":
    { note: "The low quality level reads probe volumes one value per object, and the stats say what probe volumes cost." },
  "feat(editor): get_stats reports what probe volumes cost - the draws that read one per pixel and per object, the brick atlas's GPU bytes and the ten texture reads a per-pixel lookup makes, from the viewport and from a running game":
    { note: "The low quality level reads probe volumes one value per object, and the stats say what probe volumes cost." },
  "feat(bake): a probe volume can be baked sparse - fine bricks of probes near geometry and coarser ones in the open air, solved by the C++ bake kernel on every core and written as a version 3 .esprobes the runtime reads brick by brick":
    { note: "A probe volume can be baked sparse: its spacing kept near geometry, the open air between sampled coarser." },
  "feat(editor): the Lighting panel sets how many brick sizes a probe volume may use, and Bake Lighting passes it - Probe levels 1 to 4, where above 1 the bake keeps the probe spacing near geometry and samples the open air 2, 4 or 8 times coarser":
    { note: "A probe volume can be baked sparse: its spacing kept near geometry, the open air between sampled coarser." },
  "fix(bake): a sparse probe grid is stitched where bricks of two sizes meet - each probe on a finer brick's face takes the coarser brick's light there, so a read crossing the seam does not jump":
    { note: "A probe volume can be baked sparse: its spacing kept near geometry, the open air between sampled coarser." },
  "feat(render): the GI and reflection loop counts, grids and bakes take their size from the quality level":
    { note: "Global Illumination & Occlusion and Reflections hold the samples, steps, grids and bakes those effects spend." },
  "feat(render): a level holds a planar reflection's own values under its own, GTAO keeps two slices, and the docs measure the GI and reflection rows":
    { note: "Global Illumination & Occlusion and Reflections hold the samples, steps, grids and bakes those effects spend." },
  "feat(render): screen-space GI denoises in a 3 x 3 square at Medium, measured on screen against 5 x 5":
    { note: "Global Illumination & Occlusion and Reflections hold the samples, steps, grids and bakes those effects spend." },
  "fix(render): the merged quality groups build and test as one - the GI and reflection shaders declare their loop bounds as constants the WGSL translator takes, Light's new shadow fields join the field-metadata snapshot, and the API reports, native surface and AOT fixture are regenerated over the merge":
    { note: "Global Illumination & Occlusion and Reflections hold the samples, steps, grids and bakes those effects spend." },
  "feat(render): a quality level is twelve groups of settings, each declared once in a table that now also holds switches, fixed choices and names - the profile, its defaults, its parsing, player preferences and the editor's rows are made from it; each effect drawn small has a resolution of its own in its group, every effect is listed in the group it belongs to, ambient occlusion is left out only by the list of skipped effects, and a project's older fields read back unchanged":
    { note: "The quality levels are twelve groups, each a table with Low, Medium and High side by side." },
  "feat(settings): the quality levels are a table per group with Low, Medium and High side by side - every cell is edited in place, a cell is marked changed against its own level's default and reset on its own, a group's effects are a matrix of effect by level, a window too narrow for three columns keeps the one-level page, and a value set back to its level's default leaves project.esproject":
    { note: "The quality levels are twelve groups, each a table with Low, Medium and High side by side." },
  "fix(render): every built-in effect carries its Chinese name beside its English one (EffectDef.labelZh), the one name the editor shows wherever it lists effects":
    { note: "The quality levels are twelve groups, each a table with Low, Medium and High side by side." },
  "fix(settings): an effect is named in the editor's language, in the level tables and the volume inspector alike, and a changed cell is outlined whole with its control and reset centred":
    { note: "The quality levels are twelve groups, each a table with Low, Medium and High side by side." },
  "feat(render): the quality level sets how many lights a pixel works out, the tiled lights, the shadow maps a frame draws, the soft 3D shadow's search, filter and radius and the contact shadow's steps - the three budgets reach the renderer by name (renderer_setQualityValue), the soft-shadow numbers ride slots 1-3 of the frame block's u_quality, and High keeps every number the engine had; a light's shadow bias and slope floor and a sun's cascade split become fields of the Light component":
    { note: "Lights and shadows have per-level settings." },
  "fix(render): Light's shadow fields reach what is generated from the components - the component reference, the engine digest and the AOT fixtures are made again, and two quality tests say the types they use":
    { note: "Lights and shadows have per-level settings." },
  "feat(render): qualityRunsEffect answers whether a quality level runs an effect - by the effect's type and by every rule the engine applies (the skipped list, post-processing off, temporal anti-aliasing keeping TAA and dropping FXAA), so a settings screen asks the engine instead of reading skipEffects":
    { note: "`qualityRunsEffect(profile, 'ssao')` says whether a quality level runs an effect." },
  "feat(render): the step and sample counts of the sky, fog, lens effects, bloom, refraction and particle collisions are quality settings - Sky & Volumetrics, Post-Processing and Effects & Particles each gain the counts their shaders had written in, High keeping them and Medium and Low taking fewer; a shader loop is compiled for High's count and stops at the level's, bloom's pyramid loses its smallest levels, a material reads the level from the engine's frame constants, and a particle collision budget the game sets wins over the level's":
    { note: "What the sky, fog, lens effects, bloom, refraction and particle collisions spend is set by the quality level." },
  "fix(render): the clouds' march starts each pixel at a 4 x 4 ordered offset instead of interleaved gradient noise - at 12 steps the noise left fine vertical streaks on Low's clouds, which have no temporal smoothing, and the ordered offset is what the composite's read of four half-size texels a side evens out":
    { note: "What the sky, fog, lens effects, bloom, refraction and particle collisions spend is set by the quality level." },
  "feat(render): view distance, terrain, water and texture costs the engine had written in are settings of the quality level - an LOD distance scale, the occlusion grid and the batch scan interval; detail distance reaching terrains, planets and Foliage, the terrain surface page size and pages a frame, the page atlas, planet draw levels, the voxel rebuild budget and the plants that bend; underwater shaft steps, water reflection steps and caustic layers, each loop compiled at its High count and stopped by the level; texture streaming's sizes, delays, pace and textures at once, the idle render-target budget and terrain tile memory. High keeps every value it had. How many loads run at once and what a generated world caches are project runtime settings instead":
    { note: "Four quality groups gain the costs that were written into the engine: View Distance & Draws, Terrain & Foliage, Water, and Textures & Memory." },
  "feat(settings): Project Settings -> Game -> Runtime has a Loading & Streaming group - scene preload at once, chunks made at once, ground pages asked at once, planet surface tiles kept, the world plan cache and the plans a planning worker keeps, each written to project.esproject only where it differs from the engine's value":
    { note: "Four quality groups gain the costs that were written into the engine: View Distance & Draws, Terrain & Foliage, Water, and Textures & Memory." },
  "fix(render): Low's underwater light shafts walk 16 steps, not 12 - at 12 the per-pixel jitter left a fine regular grain on what lies under the water, which a full-resolution pass has nothing to smooth, and a 4 x 4 ordered offset in its place drew a plain grid":
    { note: "Four quality groups gain the costs that were written into the engine: View Distance & Draws, Terrain & Foliage, Water, and Textures & Memory." },
  "fix(render): the world generator's limits live beside the configuration, not inside the generator - read from there, a blank package carried 97 bytes of worldgen along; and the mat-tint fixture's twin carries the hash of the stages the merged engine assembles":
    { note: "Four quality groups gain the costs that were written into the engine: View Distance & Draws, Terrain & Foliage, Water, and Textures & Memory." },
  "perf(render): what a frame collects is kept while what it was collected from stands - placement sets keep their culling boxes and instance records between walks, the record texture uploads only the rows that changed, the shadow map holds the casters that did not move and collects only the movers, and the rain cover map is not drawn again while what stands over the camera is the same":
    { note: "Large 3D scenes spend far less of a phone's frame collecting what to draw." },
  "feat(net): a bandwidth budget caps each connection's replicated state stream and sends the most urgent first - setBandwidthBudget takes bytesPerSecond and an optional priority or position, the server records once when each field changed and each connection when it was last sent each entity, priority adds up while an entity waits so nothing starves, and owned entities, spawns and removals always go out":
    { note: "A crowded server can cap what each player is sent, with `server.setBandwidthBudget({ bytesPerSecond })`." },
  "feat(net): a replication server defends every connection - frames over a size are dropped unread, control messages past a rate are refused and a connection that keeps doing either is kicked, a link silent past a heartbeat or that never says hello is closed, a second hello is refused, maxConnections turns newcomers away, webSocketTransport closes a client too far behind on reading, and the client pings so a server that vanished is redialed":
    { note: "A replication server no longer takes whatever a client sends." },
  "feat(net): a replication server and its clients exchange messages of the game's own types beside the state - server.message, broadcastMessage and onMessage, client.message and onMessage, heard only from connections that said hello and under the connection limits":
    { note: "A replicated game can send its own messages between server and client, beside the state." },
  "fix(net): a client drops the ghosts of a server it left as it applies the new server's first state - the initial batch names its server process, and the client compares it there, in order with everything else it applies, where deciding at the hello could land after that state had already been applied and wipe it":
    { note: "A replicated game can say who a player is" },
  "fix(net): a replication hello over a platform socket fails as soon as the socket closes - connecting to a server that is not there, or one that dies mid-hello, waited out the 10 s request timeout before the client knew; now it knows when the socket does, so a redial or a transfer into a zone that just died moves on at once":
    { note: "A replicated client that connects to a server that is not there finds out at once." },
  "feat(net): setInterestRefresh recomputes each connection's view every N samples, staggered, so a crowd that all moves is not queried and diffed for every connection every sample - despawns still leave every view at once, and a connection whose own entities change is recomputed in that sample":
    { note: "A server with a moving crowd can recompute views less often, with `server.setInterestRefresh(n)`." },
  "perf(net): a state frame is built with a spare leading byte the channel writes its id into, so the channel sends it without copying it behind one":
    { note: "A server with a moving crowd can recompute views less often, with `server.setInterestRefresh(n)`." },
  "feat(net): replication knows who a player is - startServer takes authenticate and reconnectGraceMs, a player keeps one connection id across reconnects and stays in presentIds while dropped, a second login replaces the first and kick ends a session, and the client sends credentials, redials a dropped platform socket and keeps its ghosts as the same entities":
    { note: "A replicated game can say who a player is, and a player who drops comes back to their own pawn." },
  "feat(net): quantizeReplicatedFields sends chosen replicated number fields as whole numbers of a step, a field moving less than a step is not sent until it crosses one, and a state-frame row's netId, component id and field mask are variable-length integers (replication protocol 6)":
    { note: "Replicated numbers can be sent as whole numbers of a step, with `quantizeReplicatedFields`, and every state row is smaller." },
  "chore(tools): net-sample-microbench --quant STEP quantizes positions through quantizeReplicatedFields, and every run prints the state bytes a row":
    { note: "Replicated numbers can be sent as whole numbers of a step, with `quantizeReplicatedFields`, and every state row is smaller." },
  "feat(net): a replication client follows a server that sends it elsewhere and logs in again at an entry when its own is gone - authenticate can throw ReplicationRedirect, connect and every reconnect follow it with dial, entry (one address or a list tried in turn) takes over after entryAfterMs of failed redials, onStateChange reports every state as it happens, serverId names the server process, and a client that lands on another process drops the ghosts it held instead of matching that server's entities by number":
    { note: "A replicated game can say who a player is" },
  "perf(net): a replication sample encodes each changed row once and copies it into every frame that carries it, the radius interest provider gathers each cell's neighbourhood once per sample, and routing stops sorting every connection's delta rows":
    { note: "A replication server spends about half the time it did on each sample when players see each other." },
  "chore(tools): net-sample-microbench --wasm times the real engine's replication sample, --phases prints what each phase cost per tick, a thread-CPU column sits beside wall time, and ES_SDK_DIST points it at another build to compare two versions":
    { note: "A replication server spends about half the time it did on each sample when players see each other." },
  "refactor(scene): a staggered unload tears down through disposeSceneOwnedState_, which takes the retire step - unload had settled, despawned and finished on its own beside it, and scene-teardown could no longer see one protocol":
    { internal: "A staggered unload goes through the same teardown function as every other unload and a failed load's rollback; what a scene gives back is unchanged." },
  "perf(net): a replication sample leaves in one socket write per client - transports may hold their writes for a batch, the server opens one around each sample, and webSocketTransport from esengine/replication gives an accepted ws socket that batch, so a 400-player server keeps its tick rate where one write per frame lost half of it":
    { note: "A dedicated server sends each client one socket write per tick, not one per message." },
  "docs(skills): estella-3d-gameplay teaches an agent how to make a playable 3D game - a character controller that walks and jumps, 3D bodies and triggers, a following camera, a finished look, terrain, plants and models - and how to prove it by playing it and looking from every side":
    { note: "An agent working through the editor's MCP now has a 3D gameplay skill." },
  "docs(skills): estella-animation teaches an agent how to make things move - which tool for which motion, clips and timelines, the Animator driven by gameplay parameters, 2D rigs, Spine, imported 3D clips and spring bones - and how to prove motion over time with motion_sheet":
    { note: "An agent working through the editor's MCP now has an animation skill." },
  "docs(skills): estella-multiplayer teaches an agent how an Estella game goes online - the one rule both ends run, player identity and reconnect, what to turn on when a crowd is too much and in what order, persistence and zones, and how to prove it in a multiplayer preview":
    { note: "An agent working through the editor's MCP now has a multiplayer skill." },
  "docs(skills): estella-performance teaches an agent how to find and fix what makes a game slow - measure the warmed running frame, tell CPU from GPU from waiting, find the system or the draws that cost, apply the engine's own fixes, and prove the gain with the same measurement on the device":
    { note: "An agent working through the editor's MCP now has a performance skill." },
  "docs(skills): estella-shipping teaches an agent how to take a game out of the editor - the preflight, export_game per platform, compression and size limits, what each platform needs, and proving the build runs on its target through a development build the editor can see":
    { note: "An agent working through the editor's MCP now has a shipping skill." },
  "fix(render): a skin of more than 64 bones draws with a material - the shaders made from a material declared 64 bones while the renderer poses up to 256, so a rig with more joints (a Tripo rig has 78) read past the array and drew as a white smear; they now declare as many as the renderer poses":
    { note: "A character rigged with more than 64 bones draws correctly." },
  "fix(postprocess): a cut-out's edge is no longer lit by the sky - the sky effects read a pixel's alpha as how much sky shows through it, and a cut-out leaf holds its coverage there, so every leaf in front of the ground was drawn with a pale line round it; a pixel with surface on every side of it is now surface whatever its alpha says":
    { note: "Cut-out foliage in front of the ground no longer has a pale line round every leaf under Sky Atmosphere or a custom sky." },
  "fix(postprocess): a sky over a frame that kept no depth is drawn again - with nothing drawn into depth the scene keeps no depth target and its unit reads 0, which the cut-out edge fix counted as surface on every side of every pixel, so Sky Atmosphere and a custom sky drew nothing over a bare sky; a neighbour is surface only where its depth lies strictly between the near and far planes":
    { note: "Cut-out foliage in front of the ground no longer has a pale line round every leaf" },
  "fix(net): GameSocket and MiniGameSocket let go of a link the moment close() is called - the closing handshake still goes out, but close is emitted at once and the socket can connect again, where a peer that had stopped answering held both back until the host gave up":
    { note: "Closing a socket to a server that stopped answering no longer hangs." },
  "refactor(net): startSocketWorker is exported from esengine/node, not esengine/replication - it loads node:worker_threads, and the editor's renderer, which hands esengine/replication to plugins whole, carried that load into a browser chunk":
    { note: "A game server can keep its sockets off the simulation's thread" },
  "feat(net): startSocketWorker moves a game server's sockets onto a worker thread - the worker owns the listener and every socket, the main thread hands it each turn's frames in one message and gets clients' frames back in batches, and each connection arrives as a transport attachConnection takes unchanged":
    { note: "A game server can keep its sockets off the simulation's thread, with `startSocketWorker`." },
  "fix(residency): a streamed world stops filling the console - the files the cook writes for it are no longer reported as missing from the package, physics not being installed is said once a game, and a cell's or far proxy's preload summary is a debug line":
    { note: "A streamed world no longer fills the console while it streams." },
  "feat(asset): a texture can be made from pixels at run time - Assets.createTexture takes RGBA bytes a game worked out as it ran (a map of a world it has just generated) and answers a texture a material or a MeshRenderer takes, colours or numbers as it says, and releaseBuiltTexture gives it back; there was no way to a texture but a file or a render target":
    { note: "A texture can be made from pixels at run time." },
  "feat(editor): Tripo's China site is a setting beside the international one - the two have their own accounts, keys and credits, so the AI Agents settings take a Tripo site (international tripo3d.ai or China tripo3d.com) and a key for each; requests go to the chosen site's API, a job keeps polling the site that started it if the choice changes, and a missing key says which site it is for":
    { note: "AI agents can generate 3D models with Tripo AI." },
  "fix(editor): the China Tripo key's Chinese description ends its sentence - the line was cut off inside its string, so the editor did not compile and every check that builds it failed":
    { note: "AI agents can generate 3D models with Tripo AI." },
  "feat(editor): agents look in Tripo's history before paying for something again - tripo_history lists every job of the project with what was asked, where it landed and what it cost, the models it holds from Tripo, and with remote_days what the account made anywhere; finished jobs are kept as history across sessions, every running job is asked about in one request, a picture or model can be smart-segmented and a picture made into a Gaussian splat; and the progress display no longer flickers: digits keep one width so the notice does not shift each second, and importing keeps a full bar instead of emptying into a sweep":
    { note: "AI agents can rig, animate, retexture and reduce models with Tripo AI, and make pictures with it." },
  "fix(editor): a finished Tripo job is kept after its notice closes, so asking for it again answers its result - the window's dismissal deleted it, and tripo_task then took the task up as a new job, downloaded it again and, taking it for a model, wrote an OBJ conversion's zip over the model it was converted from; a task taken up by id now lands as its type says, only glTF, GLB and FBX are imported, and nothing that is not a model is ever written under a model's name":
    { note: "AI agents can rig, animate, retexture and reduce models with Tripo AI, and make pictures with it." },
  "fix(editor): the Tripo jobs list listens on the window it is drawn in and takes the theme's spacing grid and shadow - its Escape and outside-click listeners were the main window's, and its rows and shadow used values the theme has no step or token for":
    { internal: "The Tripo jobs list listens for Escape and outside clicks on the window it is drawn in and uses the theme's spacing and shadow; it looks and behaves as before in the main window." },
  "feat(editor): the editor keeps Tripo generations and shows them while they run - tripo_generate answers at once and main polls the task, imports the model when it finishes whether or not anyone waits, and takes up a job a closed project left running; one notice stands for every job (a single one by name and percentage, several as a count with one bar) with the list behind Details, the Content Browser shows a placeholder tile with progress where each model will land, and a failed job says why in Tripo's words":
    { note: "AI agents can generate 3D models with Tripo AI." },
  "feat(editor): agents generate 3D models with Tripo AI - tripo_generate makes a textured model from a sentence or a picture and imports it as a dropped .glb is, answering the prefab to place and Tripo's preview; tripo_task picks up a generation that outlasted the call without spending again, tripo_balance shows the credits left, and the API key is entered in Settings > Tools and AI > AI Agents and sealed in the keychain, read only by the main process at the request":
    { note: "AI agents can generate 3D models with Tripo AI." },
  "fix(editor): a Tripo model lands at its size and standing up - it is imported in metres (a lantern came in a centimetre across in a project of 100 units a metre) and asked for at its real-world size, the answer says how far to raise it since Tripo's pivot is the model's centre, and its preview reaches the agent as the picture it is where Tripo serves it as octet-stream":
    { note: "AI agents can generate 3D models with Tripo AI." },
  "feat(editor): agents use the rest of Tripo - tripo_process retextures, reduces, unwraps, splits and completes, rig-checks, rigs, animates and converts a model (one Tripo made is named by its task, kept in its .meta; any other is uploaded), tripo_image draws pictures from words or other pictures and the four views of a thing, and tripo_generate takes those views and the P series; each runs as an editor job under the one notice, which says what it is doing and what a rig check found":
    { note: "AI agents can rig, animate, retexture and reduce models with Tripo AI, and make pictures with it." },
  "feat(export): a web export covers the game with a rotate-your-device notice only when the project turns it on - packaging.platforms.web.rotateHint, off by default; off, a phone held the wrong way shows the game letterboxed, and the best-effort orientation lock and its policy hash stay":
    { note: "A web export no longer hides the game behind a \"rotate your device\" notice unless the project asks for it." },
  "feat(editor): the web build asks to rotate the device only when the project turns it on - Packaging > Web gains a switch, off by default, that writes packaging.platforms.web.rotateHint only when on":
    { note: "A web export no longer hides the game behind a \"rotate your device\" notice unless the project asks for it." },
  "feat(residency): RememberState keeps an entity as it was left when its cell unloads, and keeps it gone once destroyed - a streamed world's memory, carried through a save with WorldMemoryRes":
    { note: "A streamed world remembers what happened in a cell after you walk away." },
  "perf(worldgen): a world on a planet is laid out in a second where it took ten - the ground under what is placed was read every metre and a half whatever the world's size, which for a world of trees tens of units across seen from the air was a thousand ground points a tile and a hundred and fifty tiles a square, and every square of a face waited on one worker; `WorldGen.groundStep` says how far apart the ground is read, and a face's squares are spread over the workers by where they are":
    { note: "A world laid out on a planet fills in about a second, where a large one took ten or more." },
  "feat(zones): zones talk over a bus - ZoneBus with MemoryBus for one process and BusHub with RemoteBus across processes, and ZoneHost sends a message to a player wherever they are, kicks them there and broadcasts to every zone, following a player who moved on and holding what arrives for one on their way in":
    { note: "A world bigger than one server can be split into zones" },
  "feat(zones): a player sent to a zone that has just died comes back by itself - zones heartbeat every second and a transfer goes only to one heard from within three heartbeats, the handed-over lease lasts only arrivalLeaseMs until the destination takes it up, and the transfer names the zone left as a fallback the client logs in to again when the destination cannot be reached":
    { note: "A world bigger than one server can be split into zones" },
  "feat(zones): a zone can be taken down without dropping anyone - drain marks it so no pick, route or transfer sends anyone there and a login is sent on, transfers every player it holds where the route says with reason drain, kicks at a deadline only those with nowhere to go, then stops":
    { note: "A world bigger than one server can be split into zones" },
  "feat(zones): any zone takes a login and sends the player where they belong - a player online elsewhere is sent to that zone, which replaces the older connection, one held by a zone that stopped heartbeating is taken over without waiting out the lease, and a route hook (default - back where they logged out, else a live line of the same kind, else home) picks the zone; a player sent back to the zone they just left is taken in at once":
    { note: "A world bigger than one server can be split into zones" },
  "feat(zones): esengine/zones splits a world over several server processes - a directory of live zones, player leases that keep each player in one zone, one-use transfer tickets, and ZoneHost, which saves the record, hands the lease on and issues the ticket before server.transfer sends the client, whose dial connects it to the new zone with its ghosts from the old one dropped":
    { note: "A world bigger than one server can be split into zones, each its own process, with `esengine/zones`." },
  "fix(render): GTAO draws on WebGPU again - its slice and step bounds are constants the WGSL translator takes, as the other GI and reflection shaders' already were, where a #define left the pass with no WGSL and the frame black; the voxel GI fallback's bounce bound follows, and the test that transpiles every fullscreen pass now reads the GTAO, subsurface and voxel fallback passes too":
    { note: "Global Illumination & Occlusion and Reflections hold the samples, steps, grids and bakes those effects spend." },
  "feat(pipeline): a model's import can cut it to a triangle budget - Max Triangles in the import settings reduces every mesh by the same share, skinned ones too with their rig kept, where a generated model of 1.4 million triangles drew far more than a game needs":
    { note: "A model's import settings take a triangle budget." },
  "fix(editor): a Tripo model is imported at 60,000 triangles - Tripo's own topology is about 1.4 million a model, so a scene of nine drew eleven million and ran at 30 fps where it now runs at 60; the budget is the file's Max Triangles import setting, written when the model lands unless it already names one, and the .glb keeps every triangle":
    { note: "A model's import settings take a triangle budget." },
  "fix(editor): a Tripo model keeps every triangle unless a budget is asked for - importing each at 60,000 took detail a hero model or a bake source needs without being asked; tripo_generate and tripo_process take max_triangles for the import to cut to, and a model's answer says how many triangles it has and, past 200,000, what that costs and how to draw fewer":
    { note: "A model's import settings take a triangle budget." },
  "fix(editor): the Tripo job, landing and test files are back, with the opt-in triangle budget they were meant to carry - the commit before this one removed all three, its patch having been made in a checkout that does not track them":
    { note: "A model's import settings take a triangle budget." },
  "fix(tools): a residency read waits for a cell that is readied and wanted, not only for one loading - a cell's preparation finishes in a frame's turns now, so between prepared and publishing it is queued; with the clock handed over nothing stepped it and the read after a source came back saw the place still absent":
    { internal: "The wait a verification launcher makes before it reads a streamed world; nothing a project can call, draw or author changes." },
  "feat(editor): tripo_generate makes a game asset unless asked otherwise - smart low-poly is on by default, clean topology under 20,000 triangles for 10 credits more where Tripo's own is about 1.4 million; smart_low_poly false asks for the full topology, and detailed geometry, separable parts, a face limit past what it makes, v2.5 and the P series leave it off":
    { note: "AI agents can generate 3D models with Tripo AI." },
  "feat(editor): asset slots, colours and material parameters as Unreal's Details shows them":
    { note: "Asset fields, colours and material parameters in the Details look and work as Unreal's do." },
  "feat(camera): cameraDirectorReport names the live camera, the blend under way and the cameras chosen among":
    { note: "Cameras are authored where they are seen." },
  "feat(editor): composition guides over a camera's preview, live camera status while playing, and camera rigs in the Create menu":
    { note: "Cameras are authored where they are seen." },
  "fix(camera): a blend between 3D cameras turns the view from one to the other, and a shake moves a 3D camera across its own screen":
    { note: "A camera blend between two 3D cameras turns the view instead of snapping it to face -Z." },
  "feat(camera): CameraBrain takes custom blends for particular changes of camera, and a tie in priority goes to the camera switched on last":
    { note: "Each change of camera can have its own blend." },
  "feat(editor): the Details edits a list of records as cards and grows and shrinks an entity list":
    { note: "Each change of camera can have its own blend." },
  "feat(camera): CameraDeoccluder keeps a target in sight and PositionComposer frames one by moving the camera, in 2D and 3D":
    { note: "A camera keeps its target in sight, and a 2D camera frames like Cinemachine's." },
  "feat(editor): the camera presets keep a tracking camera's target in sight and frame a 2D camera with a PositionComposer":
    { note: "A camera keeps its target in sight, and a 2D camera frames like Cinemachine's." },
  "docs(editor): the inspector links CameraDeoccluder and PositionComposer to their documentation":
    { note: "A camera keeps its target in sight, and a 2D camera frames like Cinemachine's." },
  "feat(camera): CameraDolly rides a camera on a Spline track and CameraNoise drifts its view like a handheld camera":
    { note: "A camera can ride a track and drift like one held by hand." },
  "feat(editor): the inspector links CameraDolly and CameraNoise to their documentation":
    { note: "A camera can ride a track and drift like one held by hand." },
  "feat(camera): CameraEvent tells a game when a camera goes live and when the blend into it finishes":
    { note: "A game can answer the view changing cameras." },
  "test(editor): an editor check hears the view's camera events from a game system in play":
    { note: "A game can answer the view changing cameras." },
  "feat(camera): CameraImpulseSource fires a jolt from a place and CameraImpulseListener cameras feel it by their distance":
    { note: "A shake happens somewhere." },
  "feat(editor): an Impulse Source in the Create menu, and the follow, tracking and group camera presets listen for impulses":
    { note: "A shake happens somewhere." },
  "feat(camera): virtual cameras switch by priority with a CameraBrain blend, and LookAtTarget frames a 3D shot, in one camera pipeline":
    { note: "Cameras now work like Cinemachine: the highest-priority camera is live, a `CameraBrain` blends into it, and `LookAtTarget` frames a target on screen." },
  "feat(editor): the inspector links LookAtTarget and CameraBrain to their documentation":
    { note: "Cameras now work like Cinemachine: the highest-priority camera is live, a `CameraBrain` blends into it, and `LookAtTarget` frames a target on screen." },
  "feat(examples): a Camera Shots example films a runner with a tracking rail, a crane orbit and a wide shot, with no camera code":
    { note: "A Camera Shots example puts the camera pipeline together with no camera code." },
  "feat(editor): the example gallery describes Camera Shots in Chinese":
    { note: "A Camera Shots example puts the camera pipeline together with no camera code." },
  "docs(skills): estella-camera teaches an agent camera rigs, blends, shakes and cutscenes":
    { note: "An agent working through the editor's MCP now has a camera skill." },
  "fix(editor): timeline_add_items keeps a shot's length so overlapping shots blend, and warns of a switched-off camera":
    { note: "An agent working through the editor's MCP now has a camera skill." },
  "feat(camera): StateDrivenCamera picks the live camera by what an Animator is doing":
    { note: "The camera follows what a character is doing." },
  "feat(editor): a State-Driven Camera in the Create menu, its rules edited as a table":
    { note: "The camera follows what a character is doing." },
  "feat(camera): CameraTargetGroup frames several entities as one target and GroupFraming sizes a shot to them by zoom or dolly":
    { note: "One camera frames several targets." },
  "feat(editor): Target Group Camera presets, and an agent's create op makes everything a template makes":
    { note: "One camera frames several targets." },
  "feat(render): Renderer.clusterInspect answers what the last frames drew of an entity's Cluster LOD mesh":
    { note: "The viewport says what a Cluster LOD mesh draws." },
  "feat(editor): the selection readout says how many of a Cluster LOD mesh's triangles the view drew":
    { note: "The viewport says what a Cluster LOD mesh draws." },
  "feat(render): Cluster LOD keeps every triangle of a dense static mesh and draws the clusters a view can tell apart":
    { note: "A dense static model can keep every triangle and be drawn with only the ones a view can tell apart." },
  "fix(pipeline): Cluster LOD groups up to sixteen clusters and keeps the larger error, not the sum - a generated 1.4M-triangle model now draws 84 triangles at 19 pixels tall where it drew 30,000":
    { note: "A dense static model can keep every triangle and be drawn with only the ones a view can tell apart." },
  "feat(render): the Clusters view shading colours each cluster of a Cluster LOD mesh, so the level every part of a surface is drawn at can be seen":
    { note: "The viewport can show which level of detail each part of a Cluster LOD mesh is drawn at." },
  "feat(editor): the viewport's shading menu offers Clusters":
    { note: "The viewport can show which level of detail each part of a Cluster LOD mesh is drawn at." },
  "feat(editor): the Content Browser folds a model's products under the model":
    { note: "The Content Browser folds a model's imported assets under the model." },
  "feat(pipeline): a model import records in each product's .meta the model it came from":
    { note: "The Content Browser folds a model's imported assets under the model." },
  "feat(editor): lay out Details choices, ranges, arrays and Sequencer properties as Unreal does":
    { note: "The Details panel lays out choices, ranges, lists and Sequencer properties as Unreal's does." },
  "fix(editor): the viewport compresses textures only when the Build dialog's box is ticked":
    { note: "The editor draws textures compressed only when the build will compress them." },
  "fix(scene): an entity numbered 0 can be named by a reference field, and a prefab reference to its own root reaches it":
    { note: "A reference field can name a scene's first entity and a prefab's own root." },
  "fix(editor): a scene opened in the editor gives an entity numbered 0 a new id, and a new scene's camera starts at 1":
    { note: "A reference field can name a scene's first entity and a prefab's own root." },
  "feat(editor): the viewport draws a camera impulse source's reach":
    { note: "A camera impulse source shows its reach in the viewport." },
  "perf(timeline): a blank package leaves out the timeline's events, time dilation and constants":
    { internal: "A package that never plays a timeline no longer carries the timeline's event, slow-motion and constant tables; nothing a project can call or draw changes." },
  "feat(editor): a model given to an asset slot takes its fitting product, or offers a menu of several":
    { note: "A model dropped on a Details asset slot puts in the product the slot takes." },
  "fix(build): SDL and Dawn are configured fresh - their build directories are cached between runs and a CMakeCache names its compiler by full path, so when a build machine's MSVC toolset moved the configure failed on a cl.exe that was gone":
    { internal: "How the engine's own build configures SDL and Dawn on a build machine; nothing a project can call, draw or author changes." },
  "feat(editor): the Sequencer selects, moves, copies, pastes and splits many keys and clips at once":
    { note: "The Sequencer edits many things at once." },
  "feat(editor): the Sequencer previews a timeline's screen fade over the scene view":
    { note: "A timeline's fade shows while it is authored." },
  "feat(editor): the Sequencer zooms and scrolls its time axis and shows markers on its ruler":
    { note: "The Sequencer zooms." },
  "refactor(examples): the space frigate is no longer a submodule of the engine repository":
    { note: "The Space Frigate example is no longer part of the engine repository." },
  "refactor(editor): the template gallery no longer names the space frigate, which leaves the engine repository":
    { note: "The Space Frigate example is no longer part of the engine repository." },
  "feat(examples): add the Starfall mobile 2D action showcase":
    { internal: "An example that was added and then taken out again before any release; nothing a project can use or see changes." },
  "feat(examples): animate Starfall combat and illuminate skills":
    { internal: "An example that was added and then taken out again before any release; nothing a project can use or see changes." },
  "feat(timeline): animation clips extrapolate past their ends and animation tracks layer with masks":
    { note: "Animation tracks extrapolate and layer." },
  "feat(timeline): an animation track plays skeletal clips on a rig, easing them in and out and crossfading where they overlap":
    { note: "Timelines animate 3D characters." },
  "feat(editor): the Sequencer adds animation tracks, draws their eases and crossfades, and previews the blend":
    { note: "Timelines animate 3D characters." },
  "feat(timeline): an audio item with a length is a clip, heard while the playhead is inside it, faded, looped and paused with the timeline":
    { note: "Timeline sounds are clips." },
  "feat(editor): the Sequencer edits audio clips as bars with their fades, and plays and scrubs their sound":
    { note: "Timeline sounds are clips." },
  "feat(timeline): a track path @Name animates what the playing TimelinePlayer binds that name to, anywhere in the scene":
    { note: "A timeline drives what its player binds." },
  "feat(editor): the Sequencer binds a track to any scene entity through the player, and the player's Details lists its bindings by name":
    { note: "A timeline drives what its player binds." },
  "feat(timeline): camera shake tracks fire impulses or shake the view at moments":
    { note: "Timelines shake the camera." },
  "feat(timeline): a TimelinePlayer sends the events and markers it crosses as TimelineEvent, and an activation track switches an entity whole":
    { note: "Every timeline track is authored in the Sequencer, and its events reach the game." },
  "feat(editor): the Sequencer authors every track the runtime plays, as bars and pins edited in the Details":
    { note: "Every timeline track is authored in the Sequencer, and its events reach the game." },
  "feat(timeline): ScreenFade fades the screen to a colour and TimeDilation slows the game, components a timeline keys like UE's Fade and Time Dilation tracks":
    { note: "A cutscene fades to black and slows time." },
  "feat(editor): the Sequencer adds Fade and Time dilation tracks":
    { note: "A cutscene fades to black and slows time." },
  "feat(editor): MCP tools that add timeline tracks, items and keys as the Sequencer does":
    { note: "An agent can build a cutscene on a timeline." },
  "feat(timeline): a track's mute, lock and group are saved with the timeline, and a muted track or channel plays nowhere":
    { note: "Timeline tracks are muted, locked and grouped as in Unity and UE." },
  "feat(editor): Sequencer tracks are muted, locked, filed in folders and renamed from their rows":
    { note: "Timeline tracks are muted, locked and grouped as in Unity and UE." },
  "feat(timeline): a TimelinePlayer plays a range of its timeline, can run on real time, and sends played, paused, stopped, finished and looped events":
    { note: "A timeline player is controlled like Unity's and UE's." },
  "test(editor): an editor check plays a ranged loop, a real-time player under a paused game and the playback events in play":
    { note: "A timeline player is controlled like Unity's and UE's." },
  "feat(editor): the Sequencer renders a timeline to PNG frames and an MP4 or WebM by stepping the game a frame at a time":
    { note: "A timeline renders to a video." },
  "feat(timeline): animation tracks move their rig by its clips' root motion":
    { note: "Animation tracks have root motion." },
  "feat(timeline): timeline markers and events reach visual scripts as timeline:<name>":
    { note: "Visual scripts hear a timeline." },
  "feat(timeline): spawn tracks bring in an entity from a prefab for the span of a clip":
    { note: "Timelines spawn entities." },
  "feat(timeline): shakes in the scrubbed preview, joint-tree masks, payload pins and same-frame spawns":
    { note: "Timelines preview camera shakes, pick masks from the rig, hand event payloads to visual scripts and spawn on the frame a clip starts." },
  "fix(timeline): the default view shake's roll stays typed as a number":
    { internal: "The default view shake's roll keeps its public type; nothing a project can call or draw changes." },
  "fix(editor): Add Origin in the Web packaging page adds a row to type into":
    { note: "Add Origin on the Package Project dialog's Web page works." },
  "feat(export): enable background shader compilation by default for Web builds":
    { note: "Web exports compile shaders in the background by default." },
  "feat(editor): expose the platform default for shader compilation":
    { note: "Web exports compile shaders in the background by default." },
  "feat(examples): add an explorable Windrise character and landscape study":
    { internal: "An example that was added and then taken out again before any release; nothing a project can use or see changes." },
  "feat(examples): refine the Windrise oak and Lumine costume against fixed views":
    { internal: "An example that was added and then taken out again before any release; nothing a project can use or see changes." },
  "fix(editor): the Chinese template gallery has text for the Windrise example":
    { internal: "An example that was added and then taken out again before any release; nothing a project can use or see changes." },
  "fix(examples): allow the Windrise first view to finish warming under load":
    { internal: "An example that was added and then taken out again before any release; nothing a project can use or see changes." },
  "perf(examples): shorten Windrise startup and reduce meadow rendering cost":
    { internal: "An example that was added and then taken out again before any release; nothing a project can use or see changes." },
  "fix(editor-checks): timeline-mcp-authoring's describes line parses again":
    { internal: "An editor check's description string that would not parse; the checks run again, and nothing a project can see changes." },
  "fix(editor): the AI tools endpoint keeps its port across launches":
    { note: "Connect AI Tools keeps the same address from one launch to the next." },
  "feat(editor): the selection outline is the engine's, drawn on the GPU":
    { note: "A selected mesh is outlined by the engine, and selecting no longer slows the viewport." },
  "perf(render): a frame waits for the GPU to finish the last, and the engine outlines the editor's selection":
    { note: "A selected mesh is outlined by the engine, and selecting no longer slows the viewport." },
  "perf(render): a frame waits for the GPU to finish the last, and the engine outlines the editor's selection":
    { note: "A character no longer keeps moving after its key is let go." },
  "feat(editor): a transform handle behind geometry is a full-colour stipple, as Unreal draws it":
    { note: "A transform handle behind an object is drawn as a stipple in its own colour." },
  "feat(render): immediate draws can be dithered, one half of a checkerboard at a time":
    { note: "A transform handle behind an object is drawn as a stipple in its own colour." },
  "refactor(editor): the grid's linear-light alpha is set where its colour is":
    { internal: "The editor grid's linear-light alpha correction moved from the SDK grid renderer to the editor, which already sets the grid's colour; the grid looks the same." },
  "refactor(render): the editor grid renderer reads no colour space":
    { internal: "The editor grid's linear-light alpha correction moved from the SDK grid renderer to the editor, which already sets the grid's colour; the grid looks the same." },
  "feat(editor): the grid's colour and opacity are viewport settings":
    { note: "The viewport grid's colour and opacity can be set, and the grid is no longer glaring in linear projects." },
  "fix(render): the editor grid looks the same in a linear project as in a gamma one":
    { note: "The viewport grid's colour and opacity can be set, and the grid is no longer glaring in linear projects." },
  "fix(editor): the overlay reads the HLOD sphere from a module of its own":
    { internal: "The overlay reads the HLOD cluster sphere from a small module of its own instead of the HLOD model, which kept an editor test from loading; nothing a user sees changes." },
  "feat(editor): an HLOD tab in the World panel, as Unreal's Hierarchical LOD Outliner":
    { note: "An HLOD view of a streamed world's far-proxy clusters." },
  "fix(editor): the live-camera label is drawn over the game only in Inspect":
    { note: "The live-camera label no longer covers a running game." },
  "feat(editor): the LOD Group inspector is a bar of its levels, as Unity's is":
    { note: "The LOD Group inspector shows its levels as a bar, as Unity's does." },
  "feat(render): a mesh whose material is still compiling draws with its default surface meanwhile":
    { note: "A scene shows all its meshes while their materials compile." },
  "fix(editor): nothing is drawn over a running game outside Inspect":
    { note: "A game running in the viewport is no longer covered by editor labels." },
  "feat(editor): Standalone Game runs Play in a process of its own, multiplayer included":
    { note: "Starting Play no longer covers the viewport with a loading card." },
  "fix(editor): while a game runs, a tool edits what the Details panel would":
    { note: "An AI agent no longer changes the saved scene behind a running game." },
  "feat(editor): the Plugins window lists plugins as Unreal's Plugins browser does":
    { note: "The Plugins window is a browser with a category tree." },
  "feat(plugins): built-in plugins name their category":
    { note: "The Plugins window is a browser with a category tree." },
  "fix(editor): preferences are kept in a file in the user's profile, not the page's origin":
    { note: "The editor no longer forgets its preferences after an update." },
  "fix(export): a development preview carries no start screen of its own":
    { note: "A browser or device preview opens on the game alone." },
  "feat(render): previews take the angle they are seen from":
    { note: "Turn a mesh or material preview by dragging it." },
  "feat(editor): turn the Details mesh and material previews by dragging":
    { note: "Turn a mesh or material preview by dragging it." },
  "fix(render): a draw whose program is compiling draws with the preview program, and a prepass it missed does not hide it":
    { note: "A large scene opens whole instead of filling in for seconds." },
  "fix(editor): open progress names the programs compiling and the draws waiting for them":
    { note: "A large scene opens whole instead of filling in for seconds." },
  "fix(editor): a set op in the wrong shape says the shape it takes":
    { note: "apply_scene_ops explains a set written in the wrong shape." },
  "refactor(editor): the Advanced fold is the shared Button, flattened":
    { internal: "The Settings fold is drawn by the shared Button and the row padding sits on the 2px grid; nothing a user sees changes." },
  "feat(editor): Settings is laid out as Unreal's Editor Preferences, and a colour picker in it closes on a press or Enter":
    { note: "Settings has titled pages and folding groups, and its colour pickers close properly." },
  "feat(render): a compute skin cache poses each skinned mesh once a frame for every pass that draws it":
    { note: "Skinned meshes are posed once a frame, not once per pass." },
  "feat(editor): skin cache settings in Project Settings, and Skin Cache Usage on MeshSkin":
    { note: "Skinned meshes are posed once a frame, not once per pass." },
  "fix(render): the skin cache builds where GPU particles are not compiled in":
    { note: "Skinned meshes are posed once a frame, not once per pass." },
  "fix(render): the skin weights view poses its mesh in the vertex stage, not through the skin cache":
    { note: "Skinned meshes are posed once a frame, not once per pass." },
  "feat(render): skinned meshes past 256 bones are drawn in chunks, with byte-sized skin channels":
    { note: "Skinned meshes with any number of bones, at a third of the skin memory." },
  "feat(editor): Skinning in Project Settings, and a model's own bone influence limit":
    { note: "Skinned meshes with any number of bones, at a third of the skin memory." },
  "feat(editor): Standalone Game runs Play in a process of its own, multiplayer included":
    { note: "Play can run the game in a process of its own (Standalone Game), multiplayer included." },
  "feat(editor): Details, the Outliner, Add Component and asset tiles as Unreal lays them out":
    { note: "Details shows components as a tree, and the Outliner, Add Component and the Content Browser tiles are reworked." },
  "feat(editor): move to Details, Outliner and asset tiles laid out as Unreal's":
    { note: "Details shows components as a tree, and the Outliner, Add Component and the Content Browser tiles are reworked." },
  "fix(editor): viewport settings survive a restart, and Settings reads as Unreal's preferences":
    { note: "Grid size, snapping, grid and gizmo visibility are remembered after the editor is closed." },
  "fix(editor): the project watcher reports a file only when it changed, so opening a scene loads its assets once":
    { note: "Opening a large scene no longer loads every asset twice." },
  "fix(editor): opening a scene no longer loads every asset twice on Windows":
    { note: "Opening a large scene no longer loads every asset twice." },
  "fix(webgpu): a colour texture unit is never handed the scene's depth":
    { note: "WebGPU no longer drops frames after a depth-reading effect." },
  "fix(editor-checks): a check file that does not load fails itself, not the whole run":
    { internal: "How the repository is checked on a developer's machine; nothing a project can use or see changes." },
  "fix(tools): generated files check out as LF, so a build or gate run leaves none modified":
    { internal: "How the repository is checked on a developer's machine; nothing a project can use or see changes." },
  "fix(tools): tool-spawn reads the project's scripts, not what is installed beside them":
    { internal: "How the repository is checked on a developer's machine; nothing a project can use or see changes." },
  "feat(tools): run-gates says when the install is not the lockfile's, and a gate parses every editor check":
    { internal: "How the repository is checked on a developer's machine; nothing a project can use or see changes." },
  "feat(editor): the World panel opens on a World Partition map, as Unreal's does":
    { note: "The World panel shows a streamed world as a map." },
  "feat(editor): World Settings, as Unreal's: Enable Streaming and the world's partition settings beside Details":
    { note: "World Settings, a tab for the open scene's world-wide settings." },
  "fix(render): a mesh draws on Adreno 6xx phones - a draw's entry and its shapes' weights are texels of the frame's record texture, so no vertex stage indexes a uniform array by gl_DrawID or a loop counter":
    { note: "A mesh draws on Adreno 6xx phones." },
  "fix(editor): every Content Browser tile is one height, so a row of images no longer runs into the row below":
    { note: "Content Browser tiles no longer overlap the row below." },
  "feat(editor): Content Browser filters stand in a bar, collections group assets, and the browser gets the height to show them":
    { note: "Content Browser filters and collections." },
  "chore(editor): move the editor to Content Browser filters, collections and the taller browser":
    { note: "Content Browser filters and collections." },
  "chore(editor): move the editor to the Content Browser's navigation bar, Settings menu and three views":
    { note: "The Content Browser has a navigation bar, a Settings menu and three views." },
  "feat(editor): Content Browser has a navigation bar, a Settings menu and Tiles / List / Columns views":
    { note: "The Content Browser has a navigation bar, a Settings menu and three views." },
  "fix(editor): a delete the Recycle Bin refuses tries again a moment later, and then names the file or folder something holds open instead of the system's bare error":
    { note: "Deleting an asset another program has open says which and why." },
  "feat(editor): Settings can draw WebGL through OpenGL on Windows, which compiles shaders several times faster than Direct3D 11, from the next start":
    { note: "OpenGL on Windows, for faster shader compiles." },
  "fix(render): parallax in the editor's view is measured from the scene camera, not from the view's own eye":
    { note: "Parallax layers stay put while you pan or zoom the editor viewport, and move when you move the scene camera." },
  "feat(editor): parallax layers in the viewport follow the scene camera, not the view's eye":
    { note: "Parallax layers stay put while you pan or zoom the editor viewport, and move when you move the scene camera." },
  "feat(editor): an exclusion volume is drawn as the box it is, its height included":
    { note: "An exclusion volume is drawn as a box." },
  "fix(export): a web export's page lets in fonts embedded as data: URLs":
    { note: "A web export's page lets in fonts embedded as data: URLs." },
  "fix(runtime): the project fixed timestep sets the FixedUpdate step without physics too":
    { note: "The fixed timestep applies without physics." },
  "fix(editor): the fixed timestep setting says it is the FixedUpdate step, physics or not":
    { note: "The fixed timestep applies without physics." },
  "feat(runtime): a project can cap the frame rate its game boots with":
    { note: "A project can cap its frame rate." },
  "feat(editor): Project Settings has a frame rate cap":
    { note: "A project can cap its frame rate." },
  "feat(editor): AI agents can connect from the first launch, and can only read until allowed to change the project":
    { note: "AI agents can connect from the first launch." },
  "fix(editor): an agent can write a whole list of records a component has no Details row for, such as a Spline's points":
    { note: "An AI agent can set a Spline's points." },
  "fix(editor): the active tab's white is the --text-max token, and an editor check for islands and lake floors":
    { note: "Panel tabs read as cards." },
  "feat(editor): panel tabs are rounded cards with the close button at their end and a 1px focus line that fades to both ends":
    { note: "Panel tabs read as cards." },
  "fix(editor): a screenshot during Play waits for the game's shaders to compile, so its first frames are not taken without them":
    { note: "A screenshot taken during Play waits for the game's shaders." },
  "fix(editor): an entity created or moved inside a prefab instance is part of it, so Apply writes it into the prefab and a save keeps it":
    { note: "An entity added inside a prefab instance is applied and saved with it." },
  "fix(water): ripples step in substeps of one length, so uneven frames no longer make the water shake":
    { note: "Water no longer starts shaking wildly after a stutter." },
  "feat(editor): a spline point's right-click menu, and a river's current, width and depth shown and dragged in the viewport":
    { note: "River visualization and a spline point's right-click menu." },
  "fix(ui): taps that land and lift within one frame are each a click":
    { note: "Quick taps on a slow frame are no longer lost." },
  "feat(spline): a spline point has a type and tangents, and carries a river's depth, velocity and audio intensity":
    { note: "Spline points with types, tangents and river values, edited in Selected Points." },
  "feat(editor): Selected Points in Details steps through a spline's points and edits each, with a river's depth, velocity and audio intensity":
    { note: "Spline points with types, tangents and river values, edited in Selected Points." },
  "fix(editor): show the standalone game window on Windows":
    { note: "Standalone Game opens its game window on Windows." },
  "fix(editor): the viewport marks the spline point Details picks, at once":
    { note: "The viewport follows the spline point Details picks." },
  "feat(water): each body of water can have its own colour, blended into its neighbour's where they meet":
    { note: "Each body of water can have its own colour." },
  "feat(water): a Curve Channel's bank can run out at an angle from a flat edge, add onto the ground, and take blur, curl noise, smoothing and a terrace mask":
    { note: "More ways a body of water meets the ground." },
  "fix(water): a Curve Channel's outer smoothing no longer raises a ridge where an angled bank starts, nor rings from the inner smoothing":
    { note: "More ways a body of water meets the ground." },
  "feat(editor): the Create menu places each kind of water body, and islands and exclusion volumes take their outline like a lake":
    { note: "Every kind of water body in the Create menu." },
  "feat(water): a custom body of water is the shape of a mesh seen from above":
    { note: "Custom water bodies take the shape of a mesh." },
  "feat(editor): Water Body Custom in the Create menu, and a check that a custom body is the shape of its mesh":
    { note: "Custom water bodies take the shape of a mesh." },
  "feat(water): a water sample says how deep the water is down to the ground under it":
    { note: "A water sample says how deep the water is." },
  "feat(water): an exclusion volume keeps out every body overlapping it or only those it lists, and a package with no water no longer carries the water body's definition":
    { note: "Exclusion volumes that name their bodies." },
  "feat(water): an exclusion volume keeps the water out of a box":
    { note: "Exclusion volumes keep the water out of a box." },
  "feat(water): the far distance mesh past a zone's rings has its own extent, material and switch":
    { note: "Far distance settings on the Water Zone." },
  "feat(water): an island raises the terrain out of the water, and a lake cuts its floor into it":
    { note: "Islands, and lakes that cut their floor." },
  "feat(water): a lake or a river cuts the terrain along a Curve Channel of its own":
    { note: "Terrain settings on a body of water." },
  "feat(editor): Details lists the islands, exclusion volumes and zone acting on a body of water":
    { note: "Terrain settings on a body of water." },
  "feat(water): each body of water can have its own underwater look":
    { note: "Each body of water can look its own from under it." },
  "feat(water): a body's waves calm by the depth of its water, its colour wins an overlap by priority, its shape can be grown past its outline, and its look from under the water is laid over another body's by priority, blend weight and blend radius":
    { note: "More of a body of water's own settings." },
  "fix(editor): match animator clips and transition conditions to their types":
    { note: "Animator states now load the sprite clips they play." },
  "fix(editor): make animation state playback overrides explicit":
    { note: "Animator states now load the sprite clips they play." },
  "fix(animation): load sprite clips referenced by animator states":
    { note: "Animator states now load the sprite clips they play." },
  "fix(animation): play sprite states without an authored player":
    { note: "Animator states now load the sprite clips they play." },
  "fix(animation): report sprite motion playback changes":
    { note: "Animator states now load the sprite clips they play." },
  "fix(editor): show sprite controller guidance in the state inspector":
    { note: "Animator states now load the sprite clips they play." },
  "feat(render): schedule eligible GPU compute jobs on an independent Metal queue":
    { note: "GPU compute jobs can overlap independent graphics passes on Metal." },
  "feat(terrain): sculpt and paint with profiled landscape brushes":
    { note: "Sculpt and paint with a brush you can see on the landscape." },
  "feat(editor): share landscape brush settings across authoring views":
    { note: "Sculpt and paint with a brush you can see on the landscape." },
  "feat(terrain): paint and compose named landscape material weights":
    { note: "Landscape Paint can paint, smooth, flatten and add noise to a material layer." },
  "feat(editor): author landscape material weights and layer information":
    { note: "Landscape Paint can paint, smooth, flatten and add noise to a material layer." },
  "fix(editor): finish orphan deletion across weightmap reloads":
    { note: "Landscape Paint can paint, smooth, flatten and add noise to a material layer." },
  "feat(editor): author landscape spline networks in the terrain tools":
    { note: "Landscape roads, paths and junctions can now be authored in Manage → Edit Splines." },
  "feat(terrain): grade landscapes and deform static meshes along spline networks":
    { note: "Landscape roads, paths and junctions can now be authored in Manage → Edit Splines." },
  "fix(terrain): subdivide long road mesh edges through spline bends":
    { note: "Landscape roads, paths and junctions can now be authored in Manage → Edit Splines." },
  "fix(editor): preserve landscape spline asset references in the edit world":
    { note: "Landscape roads, paths and junctions can now be authored in Manage → Edit Splines." },
  "fix(editor): shape landscape control point markers like terrain peaks":
    { note: "Landscape roads, paths and junctions can now be authored in Manage → Edit Splines." },
  "feat(editor): match landscape brush details and add texture and component tools":
    { note: "Landscape brushes can stamp or tile a texture channel and edit a single terrain patch." },
  "feat(terrain): project texture masks and edit individual terrain patches":
    { note: "Landscape brushes can stamp or tile a texture channel and edit a single terrain patch." },
  "fix(terrain): bound component dirty regions and respect brush material capabilities":
    { note: "Landscape brushes can stamp or tile a texture channel and edit a single terrain patch." },
  "fix(editor): restore brush settings when a numeric gesture is cancelled":
    { note: "Landscape brushes can stamp or tile a texture channel and edit a single terrain patch." },
  "feat(editor): expose render scheduling in project settings":
    { note: "Project Settings now has switches for the dedicated render thread and GPU async compute." },
  "feat(render): carry project render scheduling choices into builds":
    { note: "Project Settings now has switches for the dedicated render thread and GPU async compute." },
  "feat(render): run native and web rendering on a dedicated CPU thread":
    { note: "Native and web games can render on a dedicated CPU thread." },
  "fix(editor): restore Sequencer sound selection and submenu navigation":
    { note: "Sequencer sound items can now pick a project audio file in Details." },
  "feat(water): couple breaking surf and lens immersion to the wave field":
    { note: "Breaking waves and half-submerged cameras follow the same surface." },
  "fix(water): reconstruct refracted beam footprints between receiver depths":
    { note: "Sunlight stays connected across underwater surfaces." },
  "perf(water): trace refracted sunlight to opaque receivers":
    { note: "Water caustics follow the surfaces they strike." },
  "fix(water): redistribute direct sunlight on submerged surfaces":
    { note: "Water caustics redistribute the sun's direct light." },
  "feat(editor): expose water mesh inspection and tiled water zone controls":
    { note: "Water tiles meet at the shoreline and sunlight follows the waves across the waterline." },
  "fix(water): project wave caustics onto shared receivers and stitch visible water tiles":
    { note: "Water tiles meet at the shoreline and sunlight follows the waves across the waterline." },
  "fix(editor): refresh water triangle counts as the viewport moves":
    { note: "Water tiles meet at the shoreline and sunlight follows the waves across the waterline." },
  "fix(editor): pin the live water mesh diagnostics":
    { note: "Water tiles meet at the shoreline and sunlight follows the waves across the waterline." },
  "fix(render): keep degenerate scale highlights out of underwater bloom":
    { note: "Water tiles meet at the shoreline and sunlight follows the waves across the waterline." },
  "fix(editor): group water mesh labels with the Details inspector":
    { note: "Water tiles meet at the shoreline and sunlight follows the waves across the waterline." },
  "fix(water): keep shore asset loading and material menu order consistent":
    { note: "Water tiles meet at the shoreline and sunlight follows the waves across the waterline." },
  "fix(water): keep mesh inspection independent of optical passes":
    { note: "Water tiles meet at the shoreline and sunlight follows the waves across the waterline." },
  "fix(editor): align water diagnostics and verify rendered wire edges":
    { note: "Water tiles meet at the shoreline and sunlight follows the waves across the waterline." },
  "fix(water): restore generated surface entities after a scene reload":
    { note: "Water tiles meet at the shoreline and sunlight follows the waves across the waterline." },
  "perf(ecs): streamline animated component writes across runtimes":
    { note: "Writing animated sprites and transforms takes less CPU time." },
  "fix(animation): blend reflected colors as channels on every runtime":
    { note: "Sprite fades keep their authored opacity on native players." },
  "perf(animation): read reflected components into reusable pose buffers":
    { note: "Animation controllers reuse pose buffers when reading sprites and transforms." },
  "perf(animation): commit evaluated component values without rebuilding defaults":
    { note: "Writing animated sprites and transforms takes less CPU time." },
  "fix(assets): preserve ownership during cache loads and texture teardown":
    { note: "Asset requests made during loader setup share one load." },
  "fix(assets): keep handle-bound assets with their producing loader":
    { note: "Scenes can keep using assets after a plugin replaces their loader." },
  "perf(assets): plan shared hot reloads from live dependency receipts":
    { note: "Shared maps and materials reload in dependency order when several files change together." },
  "perf(ecs): reuse complete descendant paths within a hierarchy revision":
    { note: "Repeated lookups of named sprite and bone paths take less time." },
  "fix(scene): release DragonBones atlas pages when a preload is discarded":
    { note: "Discarding a preloaded scene now releases its DragonBones atlas pages." },
  "perf(ecs): track world membership and narrow sparse entity queries":
    { note: "Entity queries stay current as the scene changes." },
  "perf(ecs): reuse query validation across unchanged component revisions":
    { note: "Repeated entity queries cost less in 2D and 3D systems." },
  "fix(editor): await asynchronous command writes before closing undo steps":
    { note: "Saving painted terrain keeps its weight map and undo record together." },
  "feat(groom): several meshes in one preview, and a colour per group for the Strands shader":
    { note: "A groom opens in its own editor." },
  "feat(editor): a Groom editor, the strands previewed beside a Strands panel of each group's figures and settings":
    { note: "A groom opens in its own editor." },
  "feat(groom): hair and fur as strands, read from a Blender export and drawn group by group":
    { note: "Hair and fur can be strands, not only cards." },
  "fix(editor): persist painted ground from a single snapshot":
    { note: "Saving painted terrain keeps its height and layer weights together." },
  "fix(terrain): save landscape images as one edit":
    { note: "Saving painted terrain keeps its height and layer weights together." },
  "fix(scene): migrate packaged documents before discovering assets and physics":
    { note: "Packaged games now load meshes and 2D physics from older scenes the same way the editor does." },
  "perf(assets): share hot reload across live sprite and mesh owners":
    { note: "Shared textures and other handle-based assets update faster in running games." },
  "fix(assets): restore mesh geometry through its owning loader":
    { note: "Device recovery restores 3D meshes even when a different asset loader starts the recovery." },
  "fix(native): retire socket resources before reporting closure":
    { note: "Native WebSocket connections release their transport before delivering the final close event." },
  "fix(native): use the engine texture cache on supported hosts":
    { note: "Native games can reuse recently released textures within their configured cache budget." },
  "fix(render): identify the module for every optional built-in shader":
    { note: "Materials that use an uninstalled waterfall, planet, terrain surface bake or voxel ground shader now name the module to import." },
  "fix(render): scope 2D and 3D physics debug overlays to their world":
    { note: "Two running previews can each show their own physics debug view." },
  "fix(physics): bind 3D solver lifetime and contacts to the owning app":
    { note: "Each running preview owns its 3D physics world." },
  "fix(render): exclude precipitation from its own cover capture":
    { note: "Rain and snow stop at the surfaces that shelter them." },
  "perf(profiler): read the live entity count without copying the scene":
    { note: "Sampling the profiler costs less in large scenes." },
  "fix(water): waves, waterfalls and rain rings take the project's gravity and units, as its physics does":
    { note: "Water falls as the project's physics falls." },
  "fix(editor): the editor's waves and waterfalls take the project's gravity, as its physics does":
    { note: "Water falls as the project's physics falls." },
  "fix(assets): keep plugin types distinct across release and hot reload":
    { note: "Plugin asset types can use namespaces safely alongside paths containing colons." },
  "feat(weather): 3D rain falls as streaks in the world, drawn on the GPU, and stops on what stands over it":
    { note: "3D rain falls in the world." },
  "feat(weather): rain splashes are particles in the world and its rings ring as raindrops do, every look a value of the Rain effect":
    { note: "Rain splashes are particles in the world, its rings are a raindrop's, and how all of it looks is the Rain effect's to set." },
  "fix(assets): track nested registry acquisitions by their owning slot":
    { note: "Concurrent timeline loads keep each preview's nested clips available until their last owner releases them." },
  "fix(assets): share registry loads before calling loader observers":
    { note: "A loader callback can request the same timeline without preparing its children twice." },
  "fix(resources): preserve the current owner when rebinding cache paths":
    { note: "Replacing a resource at the same path keeps the new resource available by name." },
  "fix(water): a river's banks roll over into the ground instead of folding, so the terrain draws them without a saw":
    { note: "River banks no longer saw-tooth." },
  "perf(scene): index the assets that persistent entities carry between scenes":
    { note: "Switching scenes with many persistent entities is faster." },
  "fix(scene): roll back failed scene loads across authoring and runtime":
    { note: "An interrupted scene load now releases its entities and asset references in both authoring and packaged games." },
  "perf(assets): retire scene assets through their own lookup keys":
    { note: "Scenes with many tilemaps or character rigs unload faster." },
  "fix(scene): reset scene services without orphaning live assets":
    { note: "Resetting the scene manager keeps loaded sprites and meshes drawable." },
  "fix(scene): preserve cross-scene ownership during unload and rollback":
    { note: "Entities can move between scenes while a streamed cell unloads." },
  "fix(scene): share and retire in-flight scene preparations":
    { note: "Overlapping requests to prepare and load the same scene now share its assets." },
  "fix(assets): share skeletal atlas pages with their texture owner":
    { note: "Spine and DragonBones share atlas pages with the textures loaded by their App." },
  "feat(weather): 3D snow falls as flakes in the world, swaying, and none under a roof":
    { note: "3D snow falls in the world." },
  "fix(spine): share skeleton acquisitions and reload changed binary sources":
    { note: "Spine animations pick up edits to binary skeletons as well as atlases." },
  "fix(render): bind streaming resizes to held texture generations":
    { note: "A late texture resize can no longer shrink a sprite or mesh that has reacquired the image." },
  "fix(assets): scope texture load settings to their request and app":
    { note: "Each App uses its own quality level when decoding mesh textures." },
  "fix(assets): isolate resident textures and restore them through their owner":
    { note: "Asset loaders sharing a graphics device can load the same texture path with different content, color spaces and resolutions." },
  "fix(assets): publish texture residency only for the current file revision":
    { note: "Editing a texture while it decodes now gives subsequent sprite and material loads the updated pixels." },
  "fix(assets): keep the effective GPU format with each texture upload":
    { note: "The texture inspector reports each image’s actual GPU format during concurrent loads and after streaming changes its size." },
  "fix(animation): isolate plugin playback and cleanup per app":
    { note: "Apps can share animation plugins and play their timelines independently." },
  "perf(timeline): reuse parsed property paths across channel samples":
    { note: "Timeline playback spends less time resolving animated fields." },
  "perf(timeline): share field bindings across reloaded clips":
    { note: "Timeline playback spends less time resolving animated fields." },
  "fix(timeline): resolve sprite frames against the current track target and asset":
    { note: "Sprite frame tracks animate the sprite named by their child path or player binding." },
  "fix(assets): track dependencies across registry slots and prepared generations":
    { note: "Circular material inheritance reports the two materials as soon as the cycle is found." },
  "fix(assets): share texture acquisitions across SDK entry points":
    { note: "Loading a texture through `acquireTyped('texture', ref)` and `acquireTexture(ref)` shares one upload and honors the same import settings and streaming quality." },
  "fix(water): the front of a breaker seen from behind no longer draws an even grey line of sky along every wave":
    { note: "Water looks right from under it, through it and across the floor." },
  "fix(water): caustics past the measured window add no light and are as strong as the measured ones, so the window no longer shows as a square":
    { note: "Water looks right from under it, through it and across the floor." },
  "fix(water): the underwater look, the surface seen from below, refraction and caustics drawn as the water is, and the light through wave crests":
    { note: "Water looks right from under it, through it and across the floor." },
  "fix(editor): the water outline row lines up with the Details rows":
    { note: "Water looks right from under it, through it and across the floor." },
  "fix(water): ripples stepped on the GPU and drawn as geometry, and what floats is held up by the waves the mesh draws":
    { note: "Ripples are stepped on the GPU, and a floating body sits on the water it is drawn on." },
  "fix(water): a river carries its foam, rain rings, detail and ripples downstream at its current":
    { note: "What lies on a river is carried by it." },
  "fix(water): wait for the water bake and surface during scene warm-up":
    { note: "Water is ready when scene warm-up finishes." },
  "fix(water): a waterfall with no other water is drawn and ships, and rain rings are their own size whatever the wind's ripples":
    { note: "A waterfall on its own is drawn, and ships." },
  "fix(scene): register pending operations before invoking scene callbacks":
    { note: "Scene callbacks can request the same scene while it is loading or unloading." },
  "fix(runtime): bind streamed worlds to their active scenes":
    { note: "Switching between 2D or 3D maps now streams the cells of the active map." },
  "fix(animation): release sampled pose data when its entity leaves the world":
    { note: "Removing an animated character or joint releases its sampled component data." },
  "perf(ecs): reuse hierarchy validation across unchanged joint lookups":
    { note: "Animation spends less time looking up joints in a stable hierarchy." },
  "perf(animation): share pose track lookups across sampling, blending and IK":
    { note: "Layered animations spend less CPU time looking up tracks." },
  "feat(aot): release builds compile every system the compiler takes, not only those marked @compiled":
    { note: "Release builds compile every system the compiler can take, without `@compiled`." },
  "feat(settings): Packaging has a Compile all systems row":
    { note: "Release builds compile every system the compiler can take, without `@compiled`." },
  "feat(aot): a compiled system writes a vector field whole and reads constants made of constants, and never folds a module let":
    { note: "A `@compiled` system can write a vector field whole and use constants built from other constants." },
  "fix(aot): a system querying a component with no known shape stays interpreted instead of refusing the whole compiled module at boot":
    { note: "A compiled system that queries a component with a text field no longer stops the game from starting." },
  "fix(audio): preserve clip load settings across source aliases":
    { note: "Clips that share a packaged audio file keep their own load mode and trim." },
  "fix(events): honor subscriptions cancelled during dispatch":
    { note: "A listener disconnected in the callback that registered it stays disconnected." },
  "feat(editor): drag the edges between the Content Browser's columns to size them":
    { note: "The Content Browser's columns can be sized." },
  "fix(editor): use the active divider color for column resizing":
    { note: "The Content Browser's columns can be sized." },
  "perf(animation): bound keyframe searches on dense curves":
    { note: "Dense animation clips take less CPU time to play and scrub." },
  "fix(editor): a dock group's chevron collapses it after a collapsed group was moved beside the viewport":
    { note: "A dock group's collapse chevron works after you rearrange the dock." },
  "docs(editor): reference-style Editor chapters with screenshots":
    { note: "The Editor chapters are rewritten as reference pages with screenshots, in English and Chinese." },
  "docs(getting-started): reference-style chapters with editor screenshots":
    { note: "Getting Started is rewritten with editor screenshots, in English and Chinese." },
  "docs(graphics): split the graphics chapters into reference sub-chapters":
    { note: "The graphics documentation is reorganised into sub-chapters and rewritten as reference pages, in English and Chinese." },
  "fix(editor): a menu opened in the Content Drawer closes when you click elsewhere in it":
    { note: "A menu opened in the Content Drawer closes when you click elsewhere." },
  "fix(editor): preserve entity references across selection copies and undo":
    { note: "Duplicating a selection keeps its internal links connected to the copies." },
  "fix(editor): drain startup diagnostics before rejecting host calls":
    { note: "Editor automation reports the reason a host failed to start." },
  "fix(editor): report complete host startup errors":
    { note: "Editor automation reports the reason a host failed to start." },
  "fix(assets): retire entity resources with their registry and asset realm":
    { note: "Replacing or disconnecting a registry now releases the resources owned by its entities." },
  "fix(core): support entity IDs in generic stream output":
    { note: "C++ formatters and test assertions can print entity IDs regardless of header order." },
  "fix(editor): release failed viewport and play sessions":
    { note: "A failed game start releases its input, scene and rendering resources." },
  "fix(runtime): release games and report errors when startup fails":
    { note: "A failed game start releases its input, scene and rendering resources." },
  "fix(runtime): scope input and visibility listeners to their game":
    { note: "A replacement game keeps its controls when the previous game quits." },
  "fix(groom): a groom is an asset — picked in Details, registered with a uuid, shipped with its curves, and drawn in the edit viewport":
    { note: "A Groom's groom is picked like any asset, and it ships." },
  "feat(editor): a Groom's groom is picked or dropped from the Content Browser like any asset":
    { note: "A Groom's groom is picked like any asset, and it ships." },
  "feat(groom): a groom draws its cards in place of its strands where it is small in the view":
    { note: "A groom switches to its cards by itself when it is small on screen." },
  "feat(editor): Create Hair Cards names the cards in the groom, and the Groom editor sets the screen size they take over at":
    { note: "A groom switches to its cards by itself when it is small on screen." },
  "fix(groom): cards shade as the strands they stand in for, and a two-sided card's strands run one way on both faces":
    { note: "A groom's cards look like its strands from every side." },
  "fix(editor): a groom's textures are imported as data, and its group materials are read beside it as its curves are":
    { note: "A groom's cards look like its strands from every side." },
  "feat(groom): hair cards along a groom's guides, and the Hair material reads the strands textures baked onto them":
    { note: "A groom makes its own hair cards." },
  "feat(editor): Create Hair Cards on a groom makes the cards, bakes the strands onto them and writes the material that draws them":
    { note: "A groom makes its own hair cards." },
  "feat(groom): hair grows in the engine from parameters, a .esgroom with `grow` in place of a curves file":
    { note: "Hair and fur grow in the engine from parameters." },
  "fix(groom): strands thinner than a pixel keep their coverage as a share of pixels, so fine hair is drawn":
    { note: "Hair and fur grow in the engine from parameters." },
  "feat(editor): groom_write and groom_read grow hair from parameters, and the Groom editor shows hair grown from them":
    { note: "Hair and fur grow in the engine from parameters." },
  "feat(groom): a groom bakes a follicle mask and strands textures on the GPU":
    { note: "A groom bakes a follicle mask and strands textures." },
  "fix(render): a pass that draws data into a render target is left alone by the post chain":
    { note: "A groom bakes a follicle mask and strands textures." },
  "feat(editor): Create Follicle Texture and Create Strands Textures on a groom, with their options, and the agent tools that bake them":
    { note: "A groom bakes a follicle mask and strands textures." },
  "fix(editor): Project Health findings show in the editor's language":
    { note: "Project Health speaks the editor's language." },
  "perf(ecs): avoid root walks when editing scene hierarchies":
    { note: "Deeply nested 2D sprites and 3D nodes take less time to link on native and web." },
  "fix(assets): honor the latest live component asset write":
    { note: "Changing a sprite or mesh texture while it is loading now displays the last texture assigned." },
  "fix(assets): keep hot replacements with the scope holding the outgoing binding":
    { note: "Hot updates preserve scene and entity ownership when both supply assets to one entity." },
  "fix(assets): reconcile mixed-owner fields against their pre-update receipts":
    { note: "Hot updates preserve scene and entity ownership when both supply assets to one entity." },
  "fix(assets): retire unused entity bindings after live component edits":
    { note: "Changing a sprite or mesh texture now releases the entity's unused texture acquisition." },
  "feat(render): an LODMember group dissolves one level into the next over a third of a second, per view, and lodInspect reports the fade":
    { note: "Levels of detail fade into each other instead of popping." },
  "fix(editor): the groom check watches the cards dissolve into the strands when the camera comes near":
    { note: "Levels of detail fade into each other instead of popping." },
  "fix(aot): synchronize the engine digest with LODMember":
    { note: "Native games can load precompiled systems built for the engine that introduced LODMember." },
  "feat(render): LODMember makes levels of whole entities, chosen per view by an LODGroup, and a groom's strands and cards use it":
    { note: "Levels of detail that are whole entities, chosen per view." },
  "fix(editor): the groom check reads the level the renderer chose for the game camera's view":
    { note: "Levels of detail that are whole entities, chosen per view." },
  "fix(export): install the minigame host before project scripts run":
    { note: "Mini-game project scripts can read the host during module initialization." },
  "perf(animation): reuse native sprite and transform projection buffers":
    { note: "Native timelines and animation controllers spend less time reading sprites and transforms." },
  "fix(build): compile WebGL initialization only for web targets":
    { note: "Headless C++ renderer tests build with the Windows system compiler." },
  "test(ui): compare packed entity IDs in world pick assertions":
    { note: "Headless C++ renderer tests build with the Windows system compiler." },
  "perf(nav): narrow crowd searches and reuse steering geometry":
    { note: "Crowds spend less time finding neighbours and steering around them." },
  "fix(nav): preserve project-wide standing query overrides":
    { note: "Crowds spend less time finding neighbours and steering around them." },
  "fix(nav): steer overlapping agents out of contact":
    { note: "Crowds spend less time finding neighbours and steering around them." },
  "feat(editor): drag an image, mesh, flipbook or tileset onto the Outliner to create it there":
    { note: "Drag assets into the Outliner to create entities." },
  "fix(assets): ignore plugin dependency changes in project watchers":
    { note: "Installing a project plugin's dependencies no longer triggers an editor reload." },
  "fix(render): keep screen overlays with the presented camera's scenes":
    { note: "Simultaneous worlds can draw their own HUDs and scene fades." },
  "fix(net): correct quantized drift from each viewer's exact spawn":
    { note: "Small movements after a multiplayer spawn now respect the configured position precision." },
  "fix(ecs): retire scene state when a registry is cleared":
    { note: "Clearing a world releases its tile layers, trails, particles and spring-bone poses before entity IDs are reused." },
  "fix(render): support data passes in builds without post-processing":
    { note: "Lightweight WeChat games can build the renderer with post-processing disabled." },
  "fix(ci): preserve per-scene watchdogs and share the render display":
    { internal: "This change covers the render verifier's software timeouts, virtual display and regression tests." },
  "fix(net): reconcile received component baselines across joins and reconnects":
    { note: "Joining or reconnecting a multiplayer game now restores the components the server actually sent." },
  "fix(net): preserve entity reference lists on spawn, state updates and reconnect":
    { note: "Replicated components keep ordered lists of entity references on every client." },
  "fix(net): preserve visible hierarchies across replication changes":
    { note: "Visible children keep their identities and attachments when a replicated parent leaves view." },
  "fix(net): keep entity references current across visibility and replication changes":
    { note: "Replicated entity references follow their targets in and out of each client's view." },
  "fix(runtime): retain project registrations across packaged game starts":
    { note: "A mini-game can start again with all its gameplay scripts." },
  "fix(persist): keep restored entities and streamed cell saves independent":
    { note: "The same save can be restored more than once without one copy changing the next." },
  "fix(runtime): honor declared achievements in playables and minigames":
    { note: "Single-file playables and minigames now enforce the project's achievement IDs." },
  "fix(scene): track scene arrivals from request through publication":
    { note: "Scene readiness includes loads queued behind an outgoing scene." },
  "fix(scene): share asset discovery across preload and entity ownership":
    { note: "Scene preparation now asks each component for its assets once." },
  "fix(scene): share asset progress across authored and packaged loads":
    { note: "Loading screens receive asset counts in authored and packaged scenes." },
  "fix(scene): preserve render registrations across scene handoffs":
    { note: "A scene can hand its HUD and camera effects to another scene during loading or unloading." },
  "fix(scene): preserve stored script components and their saved entity references":
    { note: "Saving a scene preserves script components that its entities still hold after a script reload." },
  "fix(pipeline): record the effective system compilation setting in build size history":
    { note: "Build size comparisons report changes to automatic system compilation." },
  "fix(scene): account for active hierarchy work across load slices":
    { note: "Scene load timings now include every entity creation and parent link across frames." },
  "fix(assets): rebind stored fields across inactivity and script reloads":
    { note: "Disabled sprites and meshes resume with the current assets after a hot update." },
  "fix(textures): honor streaming size across runtime decoders":
    { note: "Streamed image textures now honor their requested size in exported games." },
  "fix(tilemap): preserve rows in partial Tiled chunks":
    { note: "Finite Tiled maps retain tiles along their right edge." },
  "fix(tilemap): preserve painted layers when a chunk import fails":
    { note: "A damaged tilemap save preserves the tiles already on the layer." },
  "fix(tilemap): keep layer data and rendered chunks in their owning world":
    { note: "Tilemaps keep their own tiles when a scene and its preview share one engine." },
  "fix(tilemap): use the edit world for painting and collision previews":
    { note: "Tilemaps keep their own tiles when a scene and its preview share one engine." },
  "perf(timeline): adopt decoded keyframes when loading animation files":
    { note: "Opening or reloading animation files reuses their decoded keyframes." },
  "perf(editor): pass animation file text directly to the shared loader":
    { note: "Opening or reloading animation files reuses their decoded keyframes." },
  "fix(timeline): release pooled poses with their world and preview binding":
    { note: "Closing a world or rebinding its timeline preview releases cached animation data." },
  "docs(ui): split the UI guide into chapters with editor screenshots":
    { note: "The UI guide is reorganised into chapters with editor screenshots, in English and Chinese." },
  "fix(editor): a UI node created under a FlexContainer stays in its layout":
    { note: "UI elements created inside a layout container join its layout." },
  "fix(editor): an image placed in the UI is a UI Image that shows, and a Sprite on a UI node says why it does not":
    { note: "An image put in the UI shows up as a UI Image." },
  "fix(ui): keep layout and picking with each world":
    { note: "An editor preview can lay out its Canvas while another world keeps its HUD and click targets." },
  "fix(sdk): a UIVisual built with a texture and no visual type draws the texture":
    { note: "`spawnUIEntity` shows a texture given without a visual type." },
  "fix(audio): keep video tracks resident until playback starts":
    { note: "Videos keep their sound when several tracks start together under memory pressure." },
  "fix(render): preserve custom camera effects when volumes retire":
    { note: "A camera keeps its custom effect stack when a post-process volume stops contributing." },
  "perf(water): a water zone is baked on a worker, and the first bake of a scene is shown even when the ground settling overtakes it":
    { note: "Water appears seconds sooner, most of all in the editor." },
  "fix(water): the scene camera's preview in the editor draws the whole water, not only what the editor's eye sees":
    { note: "The camera preview in the editor shows all of the water." },
  "perf(water): the ground under a water zone is read in one pass, a hundred times faster":
    { note: "A water zone reads the ground under it in milliseconds rather than a second." },
  "fix(water): a web package with water installs it, so its water material loads and the water is drawn":
    { note: "Water is drawn in a web package again." },
  "feat(water): the Water material shows what an author sets, in groups, and hides what the water writes each frame":
    { note: "A water's look can be changed from Details." },
  "feat(editor): a water zone or body makes and opens its own Water material from Details, and a material hides the parameters the engine writes":
    { note: "A water's look can be changed from Details." },
  "fix(water): cull fixed zones for a lone editor view":
    { note: "A fixed water zone stops submitting near-surface triangles when the editor moves out of view in a scene without a camera." },
  "fix(assets): distinguish scene and prefab reference counts by world":
    { note: "Asset diagnostics now count each world's use of a shared texture, material or font." },
  "fix(editor): qualify inspected asset users with the editing world":
    { note: "Asset diagnostics now count each world's use of a shared texture, material or font." },
  "fix(render): keep camera LOD decisions with their world":
    { note: "Scenes that share a renderer now choose their own mesh detail levels." },
  "fix(editor): inspect and preview LODs in the owning world":
    { note: "Scenes that share a renderer now choose their own mesh detail levels." },
  "fix(runtime): read cooked cell paths through the active world view":
    { note: "Packaged web builds read mesh preparation inputs from the active world." },
  "fix(render): upload and save inline mesh geometry in its owning world":
    { note: "Each world loads and saves its own inline mesh geometry." },
  "fix(particles): isolate simulation and rendering per world":
    { note: "Particle effects stay with their scene when several worlds share an engine." },
  "perf(ui): reuse sibling order for overlapping world picks":
    { note: "Pointer picking is faster in scenes with many overlapping sprites, meshes or touch areas." },
  "perf(residency): narrow per-frame cell reconciliation":
    { note: "Streamed worlds spend less time checking distant, idle cells." },
  "perf(residency): skip gaps between streaming sources":
    { note: "Streamed worlds spend less time checking distant, idle cells." },
  "fix(render): keep drawing callbacks and scene fades with their world":
    { note: "Simultaneous worlds can draw their own HUDs and scene fades." },
  "fix(editor): bind viewport guides to the active editing world":
    { note: "Simultaneous worlds can draw their own HUDs and scene fades." },
  "fix(fx): keep trails and spring bones in their owning world":
    { note: "Trails and spring bones stay with their scene when several worlds share an engine." },
  "fix(editor): use scanned asset labels and loader types in Play":
    { note: "Asset labels now work from editor Play through packaged games and single-file playables." },
  "fix(assets): deliver labeled resources through the shared batch loader":
    { note: "Asset labels now work from editor Play through packaged games and single-file playables." },
  "fix(ai): registerCondition takes a spec with what the check reads":
    { note: "`registerCondition` accepts a condition spec." },
  "feat(animator): lay the editor out in three columns, with marked wires and live debugging":
    { note: "The animation controller editor shows a graph you can read and the details of what you picked, and follows the running game." },
  "feat(animation): an animator says what it is playing for an editor to show":
    { note: "The animation controller editor shows a graph you can read and the details of what you picked, and follows the running game." },
  "fix(animator): use shared controls and theme tokens":
    { note: "The animation controller editor now exposes its controls to keyboard and screen reader users consistently." },
  "fix(editor): ship themed animation controller controls":
    { note: "The animation controller editor now exposes its controls to keyboard and screen reader users consistently." },
  "fix(animator): wires of a two-way pair land on the card edge":
    { note: "The animation controller editor shows a graph you can read" },
  "fix(pipeline): preserve texture precision and colour when cooking mip chains and atlases":
    { note: "Compressed atlas pages now ship the mip levels and colour space their images request." },
  "fix(assets): preserve per-frame texture settings across atlas pages":
    { note: "Automatically packed sprites and UI images keep their texture import settings." },
  "fix(assets): the audio Compress tooltip no longer says to turn it off for loops":
    { note: "The audio Compress tooltip no longer tells you to turn it off for loops." },
  "fix(pipeline): stream authored KTX2 textures from their shipped mip levels":
    { note: "Web builds can show a mesh using a small preview of an imported KTX2 texture before downloading the full texture." },
  "fix(pipeline): preserve filtered edges in packed texture frames":
    { note: "Automatic atlas packing preserves filtered sprite edges." },
  "fix(gameplay): a third-person camera holds rigidly on its character unless told to trail":
    { note: "A Third Person Camera now holds rigidly on its character by default." },
  "fix(ecs): keep deferred commands with their originating world":
    { note: "Restarting a world while a system runs keeps the replacement 2D or 3D scene intact." },
  "fix(aot): resolve live frame inputs before component addresses":
    { note: "Compiled systems in packaged WebAssembly games now send and receive project events through the same bus as scripts." },
  "fix(export): stage only the compiled modules selected by each package":
    { note: "Rebuilding into an existing folder removes obsolete compiled system modules." },
  "fix(renderer): apply texture import sampling to compressed engine uploads":
    { note: "KTX2 textures use their authored filtering and wrapping on WebGPU and native targets." },
  "fix(postprocess): contact shadows fade out with distance":
    { note: "Contact Shadows no longer speckles distant ground seen at a low angle." },
  "fix(postprocess): contact shadows find a blocker a step jumped over":
    { note: "Contact Shadows no longer draws a hatch on the ground beside a wall or a crate." },
  "feat(animation): a state can be played by the distance left to travel":
    { note: "A stop clip can land where the character stops." },
  "feat(animator): states and constraints show every setting they take":
    { note: "A stop clip can land where the character stops." },
  "docs: rewrite the Gameplay, Scripting, Core Concepts, Assets, Performance, Publishing and Extending chapters as reference pages":
    { note: "The remaining documentation chapters are rewritten as reference pages, in English and Chinese." },
  "docs(world,animation): rewrite the World and Animation chapters as reference pages":
    { note: "The World and Animation documentation is rewritten as reference pages, in English and Chinese." },
  "fix(assets): release named assets after their last entity field changes":
    { note: "Living entities now release animation clips and rig avatars when their last field stops using them." },
  "fix(assets): retain audio and prefab files for live component fields":
    { note: "Persistent entities keep their loaded audio and prefabs across scene changes." },
  "feat(animation): a foot-lock constraint holds a standing foot where it stands":
    { internal: "The foot-lock constraint was added and taken out again before any release; nothing that shipped changes." },
  "feat(animator): the constraint list offers Foot stays put":
    { internal: "The foot-lock constraint was added and taken out again before any release; nothing that shipped changes." },
  "fix(animation): a foot-lock holds the ball of the foot, once it has landed":
    { internal: "The foot-lock constraint was added and taken out again before any release; nothing that shipped changes." },
  "fix(animation): a foot-lock taken up again holds where the foot is":
    { internal: "The foot-lock constraint was added and taken out again before any release; nothing that shipped changes." },
  "refactor(animation): take out the foot-lock constraint":
    { internal: "The foot-lock constraint was added and taken out again before any release; nothing that shipped changes." },
  "refactor(animator): the constraint list no longer offers Foot stays put":
    { internal: "The foot-lock constraint was added and taken out again before any release; nothing that shipped changes." },
  "fix(animation): a gait blend keeps its stride as its mix changes":
    { note: "Going from a walk to a run blends the stride instead of jumping to it." },
  "feat(animator): a blend stop takes a sync phase":
    { note: "Going from a walk to a run blends the stride instead of jumping to it." },
  "fix(assets): hold pixel-addressed textures at their imported dimensions":
    { note: "Tilemaps keep every atlas at its imported size when a 3D mesh shares the texture." },
  "feat(animation): a transition can blend by inertia":
    { note: "An animator transition can blend by inertia instead of crossfading." },
  "feat(animator): a transition can choose to inertialize":
    { note: "An animator transition can blend by inertia instead of crossfading." },
  "fix(pipeline): cook inherited mesh textures from their declared surface fields":
    { note: "Mesh material instances now get build-time texture previews for the samplers they inherit." },
  "fix(assets): mount lazy packages before reading their files":
    { note: "Scenes can use assets from a lazy subpackage on first load." },
  "fix(assets): preserve independent dependencies across live field replacement":
    { note: "Updating a live sprite or mesh field keeps the original asset available to components that declared it separately." },
  "feat(tools): Luban builds every target a project names, each into its own folders":
    { note: "Luban builds a client and a server from the same tables." },
  "feat(settings): Luban builds a row of outputs, a client and a server each into its own folders":
    { note: "Luban builds a client and a server from the same tables." },
  "fix(assets): rebind live scene fields when manifest records return":
    { note: "Running scenes follow renamed and restored materials and textures." },
  "fix(assets): apply manifest-only updates to live packaged assets":
    { note: "Packaged games now apply texture sampling and nine-slice changes during a hot update." },
  "fix(editor): Connect AI Tools lists VS Code once":
    { note: "Connect AI Tools no longer lists VS Code under Other tools." },
  "feat(physics): build and export 3D solvers for mini-games":
    { note: "WeChat and Douyin mini-games can run 3D physics with Jolt or PhysX." },
  "docs(api): refresh the mini-game physics API inventory":
    { note: "WeChat and Douyin mini-games can run 3D physics with Jolt or PhysX." },
  "fix(tools): decode CDN images in the headless minigame host":
    { note: "The headless minigame launcher can render textures from a separate CDN origin." },
  "fix(export): a mini-game vendor never ships a project module's web build":
    { note: "A mini-game export no longer ships a project module's web build." },
  "feat(animation): an orientation-warp constraint turns the legs to the way the character goes":
    { note: "A character going a different way from the one it faces runs with its legs that way." },
  "feat(animator): the constraint list offers Legs follow movement":
    { note: "A character going a different way from the one it faces runs with its legs that way." },
  "fix(pipeline): isolate compiled artifacts across concurrent exports":
    { note: "Simultaneous exports of one project keep their own compiled systems." },
  "fix(particles): the GPU Simulation tooltip names what stays on the CPU":
    { note: "The GPU Simulation tooltip says what still runs on the CPU." },
  "fix(assets): preserve imported texture dimensions during compression":
    { note: "Sprites, tilemaps, bitmap fonts and animation frames use their imported texture dimensions while editor compression is pending." },
  "fix(i18n): share ordered locale tables across scene and plugin loads":
    { note: "Localized labels keep the same translations across scene switches and loading speeds." },
  "fix(ecs): bind query rows and accessors to their world":
    { note: "Systems can safely finish a query after a scene restarts." },
  "perf(native): speed up scene loading with sequential entity IDs":
    { note: "Native games using QuickJS load scenes with sequential entity IDs faster." },
  "fix(layout): an asset editor restored in front of the viewport shows its content":
    { note: "An editor tab left open in front of the scene view opens with its content." },
  "fix(render): retain glyphs with the world that owns the label":
    { note: "An editor preview can update or close its labels while another scene keeps its own text." },
  "fix(ui): bind rich text images through their generated visuals":
    { note: "Rich text keeps inline images when it wraps and draws the correct atlas frame." },
  "feat(animation): a character walks by the travel its clips state":
    { note: "A character can cover ground by its animation's own travel, so its feet do not slide." },
  "fix(gameplay): a running character keeps its pace through a turn short of turning back":
    { note: "A character can cover ground by its animation's own travel, so its feet do not slide." },
  "fix(assets): preload registered component dependencies with their scene":
    { note: "Scenes now preload the assets declared by project components and terrain layers." },
  "fix(scene): cancel retired physics preparations without blocking live scenes":
    { note: "Prefetching a scene leaves the live 2D and 3D physics settings alone." },
  "fix(scene): bind scene publication and rollback to their owning world":
    { note: "Closing or replacing a world during scene loading preserves entities in the new scene." },
  "fix(scene): release retired physics module hosts":
    { note: "A running game can reclaim a replaced physics module host and its cached modules." },
  "fix(assets): keep packaged surface bindings distinct on shared files":
    { note: "Sprites and meshes keep their own textures and materials when two assets ship as one file." },
  "fix(assets): preserve mesh, font and lighting bindings across updates":
    { note: "Updating a mesh, font, environment or light probe volume now changes only objects that reference that asset." },
  "fix(pipeline): preserve every physical file referenced by an asset":
    { note: "Re-exporting a sprite keeps texture previews still used by 3D meshes." },
  "fix(render): scope skeletal passes to the app that owns the armature":
    { note: "Spine and DragonBones characters stay in their own scene when a game and a preview share a renderer." },
  "fix(animation): preserve source frames in packed sprite clips":
    { note: "Sprite animations keep their frame sizes and crops in automatic atlases." },
  "fix(animation): load standalone skeleton atlas pages through the texture loader":
    { note: "Spine and DragonBones keep each atlas page's texture import settings when loaded outside a scene." },
  "fix(templates): the 3D Starter ground holds a character as far as it is drawn":
    { note: "A character in the 3D Starter no longer falls through the ground 40 m out." },
  "fix(templates): the 3D Starter sky light no longer turns undersides navy":
    { note: "A character in the 3D Starter no longer has dark blue lines under the nose, lips and jaw." },
  "fix(gameplay): a character walking by its animation goes the way the stick says":
    { note: "A character can cover ground by its animation's own travel, so its feet do not slide." },
  "fix(assets): vertices left on a joint no clip moves are bound as their neighbours":
    { note: "An imported character no longer trails a thin line from one vertex left behind." },
  "fix(textures): stream authored KTX2 levels consistently across renderers":
    { note: "Streamed KTX2 textures retain their colours down to the smallest preview." },
  "fix(assets): verify and retain streamed texture previews during updates":
    { note: "Hot updates now verify streamed texture previews before activating a build." },
  "feat(animation): a stride-warp constraint fits a clip's strides to the character's speed":
    { note: "A character moved by its controller can fit its strides to the speed it is going." },
  "feat(animator): the constraint list offers Stride fits speed":
    { note: "A character moved by its controller can fit its strides to the speed it is going." },
  "fix(ecs): finish subtree destruction in its owning world":
    { note: "Restarting a 2D or 3D world from a destruction callback preserves the new scene hierarchy." },
  "fix(render): preserve imported texture resolution for unmeasured surfaces":
    { note: "Sprites, tilesets and project components get the imported texture resolution when they share an image with a mesh." },
  "fix(web): load compiled systems for the active engine memory":
    { note: "Web games with compiled systems now start with threaded rendering enabled." },
  "fix(gameplay): a character walking by its animation slows while it turns":
    { note: "A character can cover ground by its animation's own travel, so its feet do not slide." },
  "fix(viewport): gizmo marks stay hidden while the scene tab is behind another":
    { note: "The scene view's marks no longer show through the tab in front of it." },
  "fix(pipeline): preserve whole textures sampled by mesh UVs":
    { note: "Meshes keep their original texture coordinates when automatic atlas packing is enabled." },
  "fix(editor): fit the Add Component dropdown to its panel window":
    { note: "The Add Component dropdown fits narrow and short inspector windows." },
  "fix(editor): ship the responsive Add Component picker":
    { note: "The Add Component dropdown fits narrow and short inspector windows." },
  "fix(assets): resolve named playback assets through their owners":
    { note: "Additive scenes keep their own texture sampling during playback." },
  "fix(animator): use the shared dropdown for rig joints":
    { note: "The Animator joint picker shows which bone you are choosing." },
  "fix(editor): ship the animator joint dropdown":
    { note: "The Animator joint picker shows which bone you are choosing." },
  "fix(editor): choose Animator clips by project asset and preserve registered motions":
    { note: "Animator clip menus show matching files and their folders for states and blend motions." },
  "fix(assets): resolve indexed animation and graph references across targets":
    { note: "Animator clip menus show matching files and their folders for states and blend motions." },
  "fix(pipeline): preserve Aseprite tag clips across reimport":
    { note: "Reordering Aseprite tags keeps placed animations on the right action." },
  "fix(editor): refresh animations detached during source import":
    { note: "Reordering Aseprite tags keeps placed animations on the right action." },
  "fix(editor): import external Tiled tilesets as JSON sources":
    { note: "Tiled maps and 3D materials keep their intended textures when exported." },
  "fix(assets): resolve document dependencies from their authored location":
    { note: "Tiled maps and 3D materials keep their intended textures when exported." },
  "fix(editor): unify tileset and onion skin dropdowns":
    { note: "The Tile Palette and Flipbook Editor use the same dropdowns as the viewport toolbar." },
  "fix(editor): ship the updated tile palette and flipbook menus":
    { note: "The Tile Palette and Flipbook Editor use the same dropdowns as the viewport toolbar." },
  "fix(editor): reuse the visible asset registry during revalidation":
    { note: "Opening another scene can use the asset list already on screen while the editor checks it in the background." },
  "fix(editor): wait for document and workspace saves before closing":
    { note: "Closing the editor now waits for Save All to finish." },
  "fix(project): ship confirmed saves for scene and asset editors":
    { note: "Closing the editor now waits for Save All to finish." },
  "fix(postprocess): contact shadows count only what stands above a surface toward the sun":
    { note: "Contact Shadows no longer stripe a rounded thing lit from behind, or speckle the far ground at a low sun." },
  "feat(postprocess): contact shadows grade their edge over the sun's disc":
    { note: "Contact Shadows have a soft edge." },
  "fix(postprocess): contact shadows take away the sun's light, not the sky's":
    { note: "Contact Shadows no longer paint dark stains where the sky still lights a surface." },
  "fix(editor): keep the Content Browser's column header above the rows it scrolls over":
    { note: "The Content Browser's Columns view keeps its header readable while scrolling." },
  "fix(editor): Delete on a component's row removes the component, not its entity":
    { note: "Delete on a selected component removes that component, not the whole entity." },
  "fix(editor): record asset assignments before loading their previews":
    { note: "Asset slots keep your latest choice when previews load slowly." },
  "fix(editor): keep asset drops and undo in the order they were made":
    { note: "Asset slots keep your latest choice when previews load slowly." },
  "fix(editor): unify authoring dropdowns and nested keyboard navigation":
    { note: "Terrain, script graph, sound event and world rule dropdowns follow the editor theme." },
  "fix(project): ship consistent authoring dropdowns":
    { note: "Terrain, script graph, sound event and world rule dropdowns follow the editor theme." },
  "fix(editor): align dropdown styling and keep long choices readable":
    { note: "Editor dropdowns keep long choices readable in narrow panels." },
  "fix(project): apply the editor dropdown theme to mixer controls":
    { note: "Editor dropdowns keep long choices readable in narrow panels." },
  "fix(i18n): load and order editor locale tables like the runtime":
    { note: "The editor's language preview now resolves overlapping translations in the same order as the exported game." },
  "fix(editor): match locale table overrides to exported games":
    { note: "The editor's language preview now resolves overlapping translations in the same order as the exported game." },
  "fix(editor): keep the module status dropdown readable in short windows":
    { note: "The status bar’s Modules dropdown keeps the full report within reach." },
  "fix(editor): ship the status bar module report":
    { note: "The status bar’s Modules dropdown keeps the full report within reach." },
  "fix(editor): recover project documents and rebuild their runtime assets":
    { note: "Crash recovery now restores the assets a project actually uses." },
  "fix(project): ship project-scoped document recovery":
    { note: "Crash recovery now restores the assets a project actually uses." },
  "fix(editor): preserve and compare recovery copies across sessions":
    { note: "The editor keeps separate recovery copies when you reopen a project and continue editing the same file." },
  "fix(project): ship versioned editor recovery copies":
    { note: "The editor keeps separate recovery copies when you reopen a project and continue editing the same file." },
  "fix(editor): reload texture import edits with their dependent materials":
    { note: "Texture import edits now update the open scene as soon as the replacement is ready." },
  "fix(editor): keep texture import previews consistent with exported scenes":
    { note: "Texture import edits now update the open scene as soon as the replacement is ready." },
  "fix(editor): refuse a value between the steps of an effect's switch":
    { note: "A post effect's switch takes only the values it has." },
  "fix(foliage): cells standing when a field changes its material draw with a live instance":
    { note: "Grass and plants keep their material when a Foliage field's material is changed." },
  "fix(editor): unify hierarchy sorting and column menus":
    { note: "The scene hierarchy’s sort and column menus show their choices consistently." },
  "fix(editor): ship consistent hierarchy dropdowns":
    { note: "The scene hierarchy’s sort and column menus show their choices consistently." },
  "perf(assets): index live sampler variants by source":
    { note: "Batch hot updates find each animation or tilemap's sampler variants by source file." },
  "fix(editor): show the assigned asset in pickers across reference formats":
    { note: "Asset pickers show the assigned file in scenes saved with a path or UUID." },
  "fix(assets): resolve indexed references consistently in streamed world builds":
    { note: "Asset pickers show the assigned file in scenes saved with a path or UUID." },
  "fix(editor): distinguish asset choices and filter animation fields by runtime":
    { note: "The inspector shows which asset you are choosing, even when files share a name." },
  "fix(assets): share scene handle and reference rules with the editor":
    { note: "The inspector shows which asset you are choosing, even when files share a name." },
  "fix(editor): align inspector dropdowns and focus filtered choices":
    { note: "Inspector dropdowns align with the other property fields in wide and narrow docks." },
  "fix(project): ship aligned inspector dropdown fields":
    { note: "Inspector dropdowns align with the other property fields in wide and narrow docks." },
  "fix(assets): resolve live texture assignments with their owning scene":
    { note: "Runtime texture assignments use the entity's scene settings." },
  "feat(editor): close and reopen a project from MCP through the menu's own door":
    { note: "An agent can close the open project, or close it and open it again from disk, with `close_project` and `reopen_project`." },
  "fix(editor): follow active mesh lighting bakes on reimport":
    { note: "A model’s Dynamic GI import setting now applies to the edit viewport, Play and exported games." },
  "fix(gi): withdraw inactive mesh bakes across imports and runtimes":
    { note: "A model’s Dynamic GI import setting now applies to the edit viewport, Play and exported games." },
  "fix(pipeline): preserve Photoshop layer identities on reimport":
    { note: "Scene edits stay on their Photoshop layers when a PSD or PSB is reimported." },
  "fix(prefab): retain the targets picked on nested and added instance members":
    { note: "Prefab instances remember which entity you picked after saving, reopening and running a scene." },
  "fix(editor): keep prefab instances linked through scene edits":
    { note: "Duplicated and restored prefab instances keep their link to the source asset." },
  "fix(prefab): preserve instance identity across editor operations":
    { note: "Duplicated and restored prefab instances keep their link to the source asset." },
  "feat(editor): show prefabs as their contents in the Content Browser and Details":
    { note: "Prefabs show what they contain in the Content Browser and the Details panel." },
  "feat(render): draw a whole world into the preview target, screen UI included":
    { note: "Prefabs show what they contain in the Content Browser and the Details panel." },
  "fix(prefab): preserve references to scene instance roots":
    { note: "Scene references keep their prefab root when a scene reopens." },
  "fix(editor): distinguish same-named entity targets in dropdowns":
    { note: "Scene references keep their prefab root when a scene reopens." },
  "fix(editor): light a prefab that brings no light with the studio rig":
    { note: "A model prefab no longer shows black in Prefab Mode or in its thumbnail." },
  "fix(render): a preview picture is lit as its caller says, not as the viewport is":
    { note: "A model prefab no longer shows black in Prefab Mode or in its thumbnail." },
  "fix(editor): publish prefab edits without replacing the scene instance":
    { note: "Applying a prefab or creating a variant preserves the scene instance and its bindings." },
  "fix(prefab): keep scene bindings when publishing instance edits":
    { note: "Applying a prefab or creating a variant preserves the scene instance and its bindings." },
  "fix(recording): follow the render surface of the recording app":
    { note: "Web recordings capture the game canvas that belongs to the running app." },
  "fix(editor): author registered animation and graph names in asset slots":
    { note: "Animation and graph pickers accept names registered by game code." },
  "fix(assets): preserve registered names across scene and motion loading":
    { note: "Animation and graph pickers accept names registered by game code." },
  "fix(input): bind browser controls to the render canvas":
    { note: "Mouse, touch and wheel input follow the game canvas on pages with multiple previews." },
  "fix(i18n): publish prepared scene translations with their owning scene":
    { note: "Preloading a localized 2D or 3D scene keeps the current scene’s captions and language intact." },
  "fix(project): keep startup and export scenes bound across asset moves":
    { note: "Moving a scene or prefab keeps the editor saving to its new location." },
  "fix(editor): keep open documents and recovery bound across asset moves":
    { note: "Moving a scene or prefab keeps the editor saving to its new location." },
  "fix(scene): prepare destination content before retiring the active scene":
    { note: "A failed scene switch or reload keeps the current game running when the destination content cannot be prepared." },
  "fix(assets): isolate texture sampling for prepared scenes":
    { note: "Preloading a scene preserves the current scene's texture sampling." },
  "fix(logic): spawn graph prefabs with the agent's scene and asset ownership":
    { note: "Visual scripts can share a prefab across additive scenes with different texture settings." },
  "fix(editor): keep long action menus inside the viewport":
    { note: "Long editor action menus fit inside short windows." },
  "feat(pipeline): share source asset imports with the editor":
    { note: "The editor and command line use the same settings to import source assets." },
  "fix(editor): refresh imported products from source metadata":
    { note: "The editor and command line use the same settings to import source assets." },
  "fix(postprocess): the sky atmosphere absorbs light in its ozone layer":
    { note: "A low sun's sky lights the scene blue, not olive." },
  "fix(editor): show live next-draw chances for sound events":
    { note: "Sound events recognize alternate references to the same clip when avoiding repeats." },
  "fix(audio): group sound event variants by resolved clip identity":
    { note: "Sound events recognize alternate references to the same clip when avoiding repeats." },
  "fix(editor): keep generated assets current across import and export":
    { note: "Play and export now wait for source imports to finish." },
  "fix(editor): finish source reimports before play and export":
    { note: "Play and export now wait for source imports to finish." },
  "fix(postprocess): screen-space reflections find what the picture shows, however far":
    { note: "Puddles and mirrors reflect the street, not only the sky." },
  "fix(editor): keep toolbar and inspector dropdowns anchored":
    { note: "The editor keeps dropdowns within reach while you filter options or change your target screen." },
  "fix(editor): ship consistent toolbar and inspector dropdowns":
    { note: "The editor keeps dropdowns within reach while you filter options or change your target screen." },
  "fix(timeline): keep prefab spawn tracks with their player across additive scenes":
    { note: "Timeline spawn tracks give their prefab instances to the player's scene." },
  "fix(timeline): prepare spawn clips with their scene's texture settings":
    { note: "Timeline spawn clips use their scene's texture settings from the first frame." },
  "fix(editor): keep scene shortcuts out of title bar menus":
    { note: "Browsing a title bar menu keeps Delete, Duplicate and Undo from changing the scene underneath." },
  "fix(editor): ship shared title bar command menus":
    { note: "Browsing a title bar menu keeps Delete, Duplicate and Undo from changing the scene underneath." },
  "fix(editor): preserve unavailable prefab instances when editing scenes":
    { note: "Saving a scene keeps its prefab instances when a source or a nested dependency is unavailable." },
  "fix(prefab): share prefab source resolution across editing and play":
    { note: "Saving a scene keeps its prefab instances when a source or a nested dependency is unavailable." },
  "fix(editor): keep viewport dropdowns visible and keyboard accessible":
    { note: "Scene and Game view dropdowns keep every choice within reach in small windows." },
  "fix(project): update the scene and game view dropdowns":
    { note: "Scene and Game view dropdowns keep every choice within reach in small windows." },
  "fix(editor): keep tile layer and tileset actions within the window":
    { note: "Scene and Game view dropdowns keep every choice within reach in small windows." },
  "fix(project): update the tile layer and tileset menus":
    { note: "Scene and Game view dropdowns keep every choice within reach in small windows." },
  "fix(sdk): mark the planet module's definitions pure so a blank package drops it":
    { internal: "A blank mini-game package carried the planet code for a few unreleased commits, when the render origin's chunk moved in with it; the planet module's top-level definitions are marked pure and it is dropped again. Nothing released carried it." },
  "fix(editor): give IconButton its own aria-controls prop for the animator joint picker":
    { internal: "A blank mini-game package carried the planet code for a few unreleased commits, when the render origin's chunk moved in with it; the planet module's top-level definitions are marked pure and it is dropped again. Nothing released carried it." },
  "fix(sequencer): honor authored wrap modes and fit timeline settings to the dock":
    { note: "The Sequencer previews clips in their authored Once, Loop or Ping-pong mode." },
  "fix(editor): align timeline preview and settings with the authored clip":
    { note: "The Sequencer previews clips in their authored Once, Loop or Ping-pong mode." },
  "perf(runtime): spread main-thread jobs over the frame budget where there are no workers":
    { note: "Mini-games and other hosts without workers no longer freeze while textures and recipes load." },
  "fix(sdk): give the declaration build a 4 GB heap so the macOS release legs finish":
    { internal: "The SDK's declaration build ran out of Node's default 2 GB heap on the macOS release runners and stopped v0.117.0's macOS and iOS legs; it now runs with 4 GB. Nothing a project builds or calls changes." },
  "feat(minigame): carry the engine's job workers in WeChat packages":
    { note: "WeChat mini-games run the engine's background work on a worker." },
  "perf(timeline): skip asset lookups for inactive sequence clips":
    { note: "Long timelines do less work during playback and scrubbing." },
  "fix(editor): keep keyboard focus through animator constraint edits":
    { note: "Animator constraints can be expanded and edited by keyboard." },
  "fix(editor): ship keyboard controls for animator constraints":
    { note: "Animator constraints can be expanded and edited by keyboard." },
  "fix(sdk): bring the API snapshots up to the exports on master":
    { internal: "The API surface snapshots catch up with exports already on master; nothing a project can call changes." },
  "fix(assets): rebind the scene before releasing hot-reloaded handles":
    { note: "Scene assets stay valid through hot reload." },
  "fix(editor): ship safe scene asset hot reload":
    { note: "Scene assets stay valid through hot reload." },
  "fix(editor): remove recovery copies of discarded documents promptly":
    { note: "Recovery copies follow each open document's save and discard state." },
  "fix(project): ship document-scoped recovery cleanup":
    { note: "Recovery copies follow each open document's save and discard state." },
  "perf(editor): batch the snapshots used to keep Play edits":
    { note: "Keeping edits to many Play entities is faster." },
  "fix(render): route frame overlays to the capture surface":
    { note: "Camera captures include overlays on their output surface." },
  "fix(camera): align picking with the render resolution fallback":
    { note: "Camera picking follows the rendered image when display scaling is unavailable." },
  "fix(camera): query world coordinates using the drawn render origin":
    { note: "Camera picking follows the drawn scene in large worlds." },
  "fix(editor): refresh viewport overlays on render origin changes":
    { note: "Camera picking follows the drawn scene in large worlds." },
  "fix(project): ship render origin aware viewport overlays":
    { note: "Camera picking follows the drawn scene in large worlds." },
  "fix(camera): keep render texture passes off the screen":
    { note: "Render texture cameras keep their own output surfaces." },
  "fix(render): preserve authored camera texture resolution":
    { note: "Camera render textures retain their own resolution." },
  "fix(export): resolve scene names from canonical project paths":
    { note: "Exports resolve scene names and exclusions from the same project-relative paths." },
  "fix(render): preserve mesh appearance when composite transforms shear":
    { note: "Composite batching preserves mesh appearance under nonuniform scale." },
  "fix(render): preserve composite placement through deep hierarchies":
    { note: "Composite batching preserves placement in deep hierarchies." },
  "fix(editor): keep deep Outliner hierarchies searchable":
    { note: "The Outliner can now open, expand and search deeply nested scenes without running out of call stack." },
  "fix(runtime): detach script component values from world snapshots":
    { note: "Runtime inspection captures script component values at the time of the snapshot." },
  "fix(editor): validate and retire device capture pixel replies":
    { note: "Device screenshots and frame replays reject incomplete pixel data." },
  "fix(runtime): scope device debug replies to their connection":
    { note: "Device diagnostics stay in the correct editor session after reconnecting." },
  "fix(ui): make dropdown chevrons legible and dismiss one overlay at a time":
    { note: "Dropdowns show their open state with a clearer chevron and close one layer at a time." },
  "fix(export): keep colliding project scenes addressable":
    { note: "Scenes with colliding runtime names remain addressable." },
  "fix(editor): dismiss dropdowns when dock resizing moves their anchor":
    { note: "Docked dropdowns close when a splitter moves their trigger." },
  "fix(editor): ship dropdown dismissal for dock resizing":
    { note: "Docked dropdowns close when a splitter moves their trigger." },
  "fix(editor): dim check marks for disabled dropdown choices":
    { note: "Disabled dropdown choices use the same muted color for the label and check mark." },
  "fix(project): ship consistent disabled dropdown styling":
    { note: "Disabled dropdown choices use the same muted color for the label and check mark." },
  "fix(editor): match menu and dropdown typeahead against choice names":
    { note: "Typing a name in an editor menu or dropdown now matches the choice label." },
  "fix(project): ship consistent dropdown keyboard matching":
    { note: "Typing a name in an editor menu or dropdown now matches the choice label." },
  "fix(editor): preserve focus moved by a dropdown selection":
    { note: "Dropdowns preserve focus moved by a selection." },
  "fix(editor): ship focus-safe dropdown selections":
    { note: "Dropdowns preserve focus moved by a selection." },
  "fix(editor): share project scene naming with exports":
    { note: "Exports resolve scene names and exclusions from the same project-relative paths." },
  "fix(editor): ship shared project scene naming in Play":
    { note: "Exports resolve scene names and exclusions from the same project-relative paths." },
  "fix(editor): keep colliding scene names distinct in Play":
    { note: "Scenes with colliding runtime names remain addressable." },
  "fix(editor): ship distinct scene names in Play":
    { note: "Scenes with colliding runtime names remain addressable." },
  "fix(editor): keep dropdown keyboard focus when choices refresh":
    { note: "Open dropdowns remain keyboard-operable when their options change." },
  "fix(editor): align dropdown options and restore panel tab order":
    { note: "Editor dropdowns keep option labels aligned in narrow panes." },
  "perf(editor): reuse dropdown labels for keyboard prefix search":
    { note: "Typing to navigate long editor dropdowns uses fewer DOM reads." },
  "fix(editor): share authored pose restoration between clip previews":
    { note: "Grip preview restores the latest scene edits." },
  "fix(editor): ship authored pose restoration for grip previews":
    { note: "Grip preview restores the latest scene edits." },
  "fix(editor): hand off the edit pose between timeline and grip previews":
    { note: "Grip and Sequencer previews hand off the edit pose cleanly." },
  "fix(editor): ship timeline and grip preview handoff":
    { note: "Grip and Sequencer previews hand off the edit pose cleanly." },
  "perf(animator): window large constraint joint lists":
    { note: "Animator joint pickers open faster on large rigs." },
  "perf(editor): ship windowed animator joint lists":
    { note: "Animator joint pickers open faster on large rigs." },
  "perf(inspector): window large entity target lists":
    { note: "Entity target dropdowns open faster in large scenes." },
  "perf(editor): ship windowed entity target lists":
    { note: "Entity target dropdowns open faster in large scenes." },
  "fix(editor): share current project translations across the inspector and viewport":
    { note: "The text inspector and viewport now agree when translation files override the same key." },
  "perf(editor): reuse enabled choices during dropdown keyboard navigation":
    { note: "Keyboard navigation in long editor dropdowns does less work per key press." },
  "perf(animator): index source entities for target path discovery":
    { note: "Animation and Timeline target paths load faster in large scenes." },
  "perf(editor): ship faster scene target path discovery":
    { note: "Animation and Timeline target paths load faster in large scenes." },
  "fix(sequencer): offer bound cameras when adding and editing shots":
    { note: "Sequencer shots can target cameras through TimelinePlayer bindings." },
  "fix(editor): ship timeline camera binding authoring":
    { note: "Sequencer shots can target cameras through TimelinePlayer bindings." },
  "fix(sequencer): choose sequence roots by binding path":
    { note: "Sequencer can bind a nested timeline to an external entity." },
  "fix(editor): ship bound roots for nested timeline clips":
    { note: "Sequencer can bind a nested timeline to an external entity." },
  "fix(sequencer): preserve scene edits under timeline preview":
    { note: "Timeline preview restores the latest scene edits." },
  "fix(editor): ship authored pose restoration during preview":
    { note: "Timeline preview restores the latest scene edits." },
  "fix(sequencer): restore preview poses when scene bindings change":
    { note: "Timeline preview restores poses when its scene targets change." },
  "fix(editor): ship timeline preview rebinding":
    { note: "Timeline preview restores poses when its scene targets change." },
  "feat(editor): a VR switch in Project Settings, and Enter VR in Play":
    { note: "VR is switched on in Project Settings, and Play offers Enter VR." },
  "feat(particle): EffectLifetime removes a one-shot effect once it has run its course":
    { note: "One-shot effects can remove themselves, and the effect tools draw animated textures and report what an effect costs." },
  "feat(pipeline): animated flame, smoke and fireball sheets for effects, and one-shots that remove themselves":
    { note: "One-shot effects can remove themselves, and the effect tools draw animated textures and report what an effect costs." },
  "feat(editor): vfx previews in front of a backdrop without the scene's air, with each layer's overdraw":
    { note: "One-shot effects can remove themselves, and the effect tools draw animated textures and report what an effect costs." },
  "perf(editor): reuse entity picker search text within a scene revision":
    { note: "Entity picker searches respond faster in large scenes." },
  "perf(project): ship faster entity picker searches":
    { note: "Entity picker searches respond faster in large scenes." },
  "fix(scene): publish texture borders only after scene load commits":
    { note: "A failed scene load preserves the running scene's shared texture borders." },
  "fix(flipbook): resolve preview textures like the runtime":
    { note: "Flipbook previews show the textures the game uses." },
  "fix(editor): ship consistent flipbook texture resolution":
    { note: "Flipbook previews show the textures the game uses." },
  "fix(grip): preview clips with timeline bindings and nested poses":
    { note: "Grip clip previews follow timeline bindings and nested poses." },
  "fix(editor): ship grip preview timeline bindings":
    { note: "Grip clip previews follow timeline bindings and nested poses." },
  "perf(ecs): reuse children storage when syncing hierarchy edits":
    { note: "Adding many siblings to a parent allocates less memory." },
  "fix(editor): preserve preview state when toggling hierarchy visibility":
    { note: "Hiding a group now also hides the text and automatic background of its input fields in 2D and 3D views." },
  "fix(ui): respect editor visibility for generated input visuals":
    { note: "Hiding a group now also hides the text and automatic background of its input fields in 2D and 3D views." },
  "fix(render): retire inline geometry with its mesh component":
    { note: "Removing and re-adding a MeshRenderer starts with empty inline geometry." },
  "fix(ui): render text fields consistently across edit and play":
    { note: "The preview language now applies to input placeholders in both 2D and 3D scenes." },
  "fix(editor): preview localized input hints and recover unavailable languages":
    { note: "The preview language now applies to input placeholders in both 2D and 3D scenes." },
  "fix(input): keep the mouse and touch release position":
    { note: "Mouse and touch releases use their actual position." },
  "fix(runtime): omit transient fields from authoring snapshots":
    { note: "Play and device inspection follow the same transient-field rules as scene saves." },
  "fix(editor): show input binding and curve dropdowns as editable fields":
    { note: "Input binding and curve interpolation dropdowns now look editable when closed." },
  "fix(editor): keep shared input binding values visible in narrow panels":
    { note: "Input binding and curve interpolation dropdowns now look editable when closed." },
  "fix(editor): keep keyboard edits and IME input in editable property dropdowns":
    { note: "Editable inspector dropdowns support keyboard selection and input methods." },
  "fix(editor): keep inspector flags in panel tab order":
    { note: "Inspector flag dropdowns follow the panel tab order." },
  "fix(editor): ship keyboard navigation for inspector flags":
    { note: "Inspector flag dropdowns follow the panel tab order." },
  "perf(physics3d): step the 3D world on a thread pool on devices":
    { note: "3D physics uses several cores on desktop and mobile builds." },
  "fix(editor): keep only edited axes when applying Play changes":
    { note: "Keep Play changes preserves untouched axes." },
  "perf(editor): keep large editable dropdowns responsive as project choices change":
    { note: "Large localization and suggestion lists open faster and keep the highlighted choice through a project refresh." },
  "perf(scene): reuse privately parsed scene documents during preparation":
    { note: "On-demand scenes prepare without copying the document a second time." },
  "fix(render): keep light pulses finite on long-running clocks":
    { note: "Pulsing and flickering lights keep a finite brightness during long sessions." },
  "fix(runtime): include native-added renderers in live snapshots":
    { note: "Live inspection shows renderers added by the engine." },
  "fix(runtime): share visibility resolution with live snapshots":
    { note: "The Play hierarchy eye follows the entity's current renderers." },
  "perf(i18n): resolve updated translations without rebuilding every language":
    { note: "Updating a translation refreshes live labels without rebuilding every language's dictionary." },
  "fix(editor): preserve preview translations when a string table cannot reload":
    { note: "Updating a translation refreshes live labels without rebuilding every language's dictionary." },
  "fix(camera): commit the view drawn by manual screen refreshes":
    { note: "Paused viewport redraws update picking and overlays." },
  "fix(material): refresh inherited properties after dependency changes":
    { note: "Open material instances refresh when a parent material or shader changes on disk." },
  "fix(editor): ship live material inheritance refresh":
    { note: "Open material instances refresh when a parent material or shader changes on disk." },
  "fix(material): keep inherited texture references tied to their source":
    { note: "Material instances show the textures inherited from their ancestors." },
  "fix(editor): ship accurate inherited material textures":
    { note: "Material instances show the textures inherited from their ancestors." },
  "fix(material): resolve inspector references like the loader":
    { note: "Material previews and builds resolve the same files." },
  "fix(material): align runtime lookups with the cooked asset index":
    { note: "Material previews and builds resolve the same files." },
  "fix(editor): reopen the project when the MCP front restarts a dead editor, and say why":
    { note: "When the editor dies between two MCP calls, the next call opens the project again and says what happened." },
  "fix(editor): keep Outliner actions visible in narrow docks":
    { note: "The Outliner’s sort menu and Add button stay within reach in a narrow dock." },
  "fix(ecs): clear hierarchy components during native entity destruction":
    { note: "Deleting an entity through the native registry now updates the hierarchy seen by scripts and inspectors." },
  "fix(input): carry relative mouse motion on native desktop":
    { note: "Native desktop games receive relative mouse movement." },
  "fix(assets): recognize structured refs during scene reprojection":
    { note: "Scene asset updates reach references inside arrays and objects." },
  "fix(editor): ship nested asset refresh and effect reference fixes":
    { note: "Scene asset updates reach references inside arrays and objects." },
  "perf(editor): index Outliner folder children and counts":
    { note: "Opening and filtering scenes with many Outliner folders is faster." },
  "perf(editor): group Outliner folder work by path":
    { note: "Large scenes with shared folders respond faster in the Outliner." },
  "perf(project): ship faster Outliner folder projection":
    { note: "Large scenes with shared folders respond faster in the Outliner." },
  "perf(editor): reuse scene data between Outliner projections":
    { note: "Searching and sorting the Outliner takes less work in large scenes." },
  "perf(project): ship faster Outliner searches in large scenes":
    { note: "Searching and sorting the Outliner takes less work in large scenes." },
  "fix(scene): share prefab preparation across scene loading paths":
    { note: "Preview and file-backed scene loads share prefab preparation." },
  "fix(particle): retire simulation state with its emitter component":
    { note: "Replacing a particle emitter starts a fresh simulation on that entity." },
  "refactor(render): share the particle instance layout contract":
    { internal: "Share the particle instance record across render paths and fix the native batch test's outdated fixture." },
  "fix(render): align CPU particle trails with the render origin":
    { note: "CPU particle trails stay attached in large worlds." },
  "fix(runtime): keep pending asset paths in authored snapshots":
    { note: "Inspection and scene snapshots retain the selected asset while it loads." },
  "perf(editor): skip camera-only renders in Play diagnostics":
    { note: "Play diagnostics stay responsive while the camera moves." },
  "perf(editor): skip Game inspector renders on camera-only updates":
    { note: "The Game inspector does less work while the camera moves." },
  "fix(editor): use the full parent frame for Play dragging":
    { note: "Play dragging follows the selected axis and depth under a tilted parent." },
  "fix(editor): keep keyboard focus with the active play session":
    { note: "Reloading a preview keeps the keyboard where you were working." },
  "fix(project): update the editor play focus lifecycle":
    { note: "Reloading a preview keeps the keyboard where you were working." },
  "fix(editor): merge Play axis edits in the running world":
    { note: "Editing one axis in Play preserves the other axes." },
  "perf(editor): coalesce Play inspector refresh bursts":
    { note: "Rapid edits and selection changes send fewer inspection requests during Play." },
  "fix(editor): keep Play inspector replies in order":
    { note: "The Play inspector keeps the current selection when an older reply arrives late." },
  "fix(editor): preserve nested field edits in Play and scene writes":
    { note: "Play keeps nested property edits without copying neighboring values." },
  "fix(editor): bind Play snapshots to the requested scene":
    { note: "Play and timeline rendering keep their source scene while preparing." },
  "fix(project): ship scene-bound preview preparation":
    { note: "Play and timeline rendering keep their source scene while preparing." },
  "perf(editor): release Play query deadlines when requests settle":
    { note: "Play monitoring releases its timers when queries finish." },
  "fix(runtime): preserve loading assets when toggling visibility":
    { note: "Play visibility and field edits keep assets loading." },
  "fix(editor): preserve loading assets during Play field edits":
    { note: "Play visibility and field edits keep assets loading." },
  "perf(runtime): avoid world-wide scans for small hierarchy selections":
    { note: "Inspecting a small group in Play stays responsive in large scenes." },
  "fix(editor): retire Play inspection requests with their session":
    { note: "Stopping Play releases pending inspection reads." },
  "perf(editor): skip unused Play visibility detail queries":
    { note: "Keeping bulk Play visibility edits takes less work at Stop." },
  "fix(export): start all-scenes playables in the selected scene":
    { note: "Single-file playables start in the selected scene when all scenes are included." },
  "fix(export): preserve startup scene names in single-scene playables":
    { note: "Single-scene playable ads preserve the startup scene's runtime name." },
  "perf(assets): reconstruct data PNG scanlines without an intermediate image":
    { note: "Heightmap PNGs decode with less temporary memory." },
  "fix(terrain): preserve PNG data channels on non-DOM hosts":
    { note: "Terrain PNGs preserve their stored samples on hosts without browser image APIs." },
  "perf(assets): speed up portable PNG decompression":
    { note: "Large data PNGs load faster on hosts without streaming decompression." },
  "fix(scene): validate parent cycles before expanding prefabs":
    { note: "Scene loads report circular parenting before resolving prefab assets." },
  "perf(prefab): route nested overrides by slot":
    { note: "Scenes with many customized nested prefabs expand faster." },
  "fix(editor): keep prefab entity IDs stable across recovery and saves":
    { note: "Prefab recovery copies and manual saves agree on new entity IDs." },
  "fix(project): ship stable prefab recovery identities":
    { note: "Prefab recovery copies and manual saves agree on new entity IDs." },
  "fix(render): draw Multiply and Screen from a premultiplied colour, so a half-clear texel no longer lights what is behind it":
    { note: "The Multiply and Screen blends no longer brighten what is behind a soft-edged sprite, particle or trail." },
  "test(editor): hold Multiply and Screen particles to their blend formulas over a grey board":
    { note: "The Multiply and Screen blends no longer brighten what is behind a soft-edged sprite, particle or trail." },
  "fix(render): premultiply a material's own shader under Multiply and Screen too, by wrapping its fragment entry":
    { note: "The Multiply and Screen blends no longer brighten what is behind a soft-edged sprite, particle or trail." },
  "test(editor): hold sprites with a Multiply or Screen material to the same blend formulas":
    { note: "The Multiply and Screen blends no longer brighten what is behind a soft-edged sprite, particle or trail." },
  "fix(tools): find the editor's Play payload by name in the project-settings gate":
    { internal: "The project-settings gate finds the editor's Play payload by name again; nothing a project can set changes." },
  "fix(persist): queue world restores with saves and stage reads before applying":
    { note: "World restores finish reading before applying saved entities." },
  "fix(render): expose camera relative coordinates to viewport draws":
    { note: "Viewport handles stay aligned in large worlds." },
  "fix(editor): align large world overlay drawing and handle picking":
    { note: "Viewport handles stay aligned in large worlds." },
  "fix(project): ship camera relative viewport handles":
    { note: "Viewport handles stay aligned in large worlds." },
  "fix(ui): anchor world popups with the rendered camera projection":
    { note: "World-space tooltips and dropdowns stay aligned far from the origin." },
  "fix(render): keep authored geometry when the core rejects an upload":
    { note: "Inline meshes keep their last accepted geometry when an upload is rejected." },
  "fix(sequencer): reload nested timelines after disk changes":
    { note: "Open timeline previews pick up changes to nested clips on disk." },
  "fix(editor): ship nested timeline preview refresh":
    { note: "Open timeline previews pick up changes to nested clips on disk." },
  "fix(camera): follow the resolved view with the render origin":
    { note: "The floating origin follows camera cuts and blends." },
  "fix(scene): isolate saved mesh geometry and particle settings":
    { note: "Saved meshes and particle effects retain the data the engine imported." },
  "feat(pipeline): build a 2D rig and its clips from a description, and draw them for review":
    { note: "An AI agent can make and animate a 2D skeletal character through the editor's MCP tools." },
  "feat(editor): rig tools that let an agent build and animate a 2D skeletal character":
    { note: "An AI agent can make and animate a 2D skeletal character through the editor's MCP tools." },
  "feat(pipeline): solve two-bone reaches in rig clips and measure planted tips by speed":
    { note: "An AI agent can make and animate a 2D skeletal character through the editor's MCP tools." },
  "feat(editor): rig clips reach for points, report how planted feet move, and enlarge their frames":
    { note: "An AI agent can make and animate a 2D skeletal character through the editor's MCP tools." },
  "feat(pipeline): keep feet flat on a reach, copy a motion shifted, and measure the lowest point on the drawing":
    { note: "An AI agent can make and animate a 2D skeletal character through the editor's MCP tools." },
  "feat(editor): rig clips keep feet flat and copy a leg half a cycle on":
    { note: "An AI agent can make and animate a 2D skeletal character through the editor's MCP tools." },
  "fix(editor): clear Play overlays with their snapshot selection":
    { note: "Play clears the selection outline as soon as the running world reports that an entity is gone." },
  "perf(runtime): index renderer visibility for world snapshots":
    { note: "Play clears the selection outline as soon as the running world reports that an entity is gone." },
  "fix(runtime): read the drawable camera aspect after scene loading":
    { note: "A game's initial camera aspect follows the drawable surface." },
  "fix(assets): match scene atlas coordinates to the acquired textures":
    { note: "Scenes keep the atlas coordinates that match the textures they acquired." },
  "fix(editor): preserve scene save state past the undo limit":
    { note: "Scene save state survives a full undo history." },
  "fix(project): ship reliable scene save state past the undo limit":
    { note: "Scene save state survives a full undo history." },
  "fix(lighting): align scene light reports with runtime activity":
    { note: "Lighting reports respect disabled scene hierarchies." },
  "fix(scene): roll back incomplete hierarchy loads":
    { note: "The scene loader now reports a failure when the world rejects a parent link or a load callback removes a newly created entity." },
  "fix(editor): bind queued saves to the open document":
    { note: "A queued save cannot write a scene that opened after the request." },
  "fix(project): ship safe scene open and save ordering":
    { note: "A queued save cannot write a scene that opened after the request." },
  "fix(editor): roll a failed apply_scene_ops back inside an agent call, and write fields the present state hides":
    { note: "A failed `apply_scene_ops` call no longer leaves part of its work in the scene." },
  "fix(scene): check authored ids before expanding prefab instances":
    { note: "Scenes with repeated entity IDs fail consistently when they contain prefab instances." },
  "fix(assets): deduplicate skeletal asset pairs per runtime":
    { note: "Spine and DragonBones scene assets are discovered independently." },
  "fix(scene): keep saved hierarchy links consistent across runtime edits":
    { note: "Scene snapshots keep valid parent and child links when an engine system moves entities at runtime." },
  "fix(assets): report each unresolved scene reference once":
    { note: "Scene loading reports each unresolved asset reference once." },
  "perf(ecs): share the live script component name index":
    { note: "Inspecting entities with script components is faster." },
  "fix(sequencer): match nested sequence validation to playback":
    { note: "Sequencer accepts the full nesting depth supported by playback." },
  "fix(editor): ship consistent nested sequence validation":
    { note: "Sequencer accepts the full nesting depth supported by playback." },
  "fix(sequencer): isolate pending timeline reads by project":
    { note: "Timeline previews handle project changes while nested clips are loading." },
  "fix(editor): ship project-safe timeline dependency loading":
    { note: "Timeline previews handle project changes while nested clips are loading." },
  "fix(sequencer): anchor the track menu and render the current clip independently":
    { note: "The Sequencer’s Track menu stays beside its button, and Render includes unsaved timeline edits." },
  "fix(runtime): load authored asset snapshots for play and timeline renders":
    { note: "The Sequencer’s Track menu stays beside its button, and Render includes unsaved timeline edits." },
  "fix(editor): reconcile spine ownership with shared pair keys":
    { note: "Skeletal assets with colons in their URLs keep their own skeleton and atlas." },
  "fix(assets): share collision-safe skeletal pair keys":
    { note: "Skeletal assets with colons in their URLs keep their own skeleton and atlas." },
  "fix(scene): omit native-deleted handles from snapshots":
    { note: "Scene snapshots and the running-world inspector omit entities deleted by the native registry." },
  "perf(render): rank light budgets without moving collected lights":
    { note: "Scenes that exceed the light budget sort smaller records per view." },
  "fix(camera): share pixel bounds for split viewports":
    { note: "Split camera views line up on odd-sized windows and render textures." },
  "fix(editor): keep open dropdowns anchored as choices change":
    { note: "Open editor dropdowns stay aligned when their options change." },
  "fix(project): ship stable editor dropdown placement":
    { note: "Open editor dropdowns stay aligned when their options change." },
  "fix(editor): keep large string tables responsive and save translations to the intended file":
    { note: "Large string tables stay responsive while you search, scroll and edit translations." },
  "fix(editor): apply the shared theme to string table controls and rig labels":
    { note: "String table controls follow the editor theme." },
  "fix(editor): avoid duplicate suggestion field writes on blur":
    { note: "Editable suggestion fields save each edit once." },
  "fix(editor): ship single writes from suggestion fields":
    { note: "Editable suggestion fields save each edit once." },
  "perf(terrain): skip overview sampling in full heightmap exports":
    { note: "Full terrain heightmap exports do less work." },
  "perf(terrain): index the tile coverage used by heightmap imports":
    { note: "Heightmap imports update tiled terrain overviews faster." },
  "fix(terrain): bind heightmap transfers to their original ground":
    { note: "Heightmap transfers stay with the terrain that started them." },
  "fix(editor): ship terrain heightmap target checks":
    { note: "Heightmap transfers stay with the terrain that started them." },
  "fix(terrain): keep imported heights when pending tile reads finish":
    { note: "Tiles loading in the background keep the imported heights." },
  "fix(terrain): resolve tiled terrain files in editor tools":
    { note: "Tiled terrain works with UUID references." },
  "fix(terrain): treat tiled terrain documents as path-valued assets":
    { note: "Tiled terrain works with UUID references." },
  "fix(editor): keep tile layer actions inside the layer panel":
    { note: "Tile layer actions are accessible from the keyboard." },
  "fix(project): ship keyboard tile layer actions and focus recovery":
    { note: "Tile layer actions are accessible from the keyboard." },
  "perf(editor): defer tile layer enumeration until the menu opens":
    { note: "The closed layer menu stays responsive while other entities are edited." },
  "perf(project): ship lighter tile layer toolbar updates":
    { note: "The closed layer menu stays responsive while other entities are edited." },
  "fix(editor): make the tile layer panel keyboard operable":
    { note: "Switch tile layers from the keyboard." },
  "fix(project): ship keyboard navigation for tile layers":
    { note: "Switch tile layers from the keyboard." },
  "fix(editor): keep the tile layer menu anchored after switching layers":
    { note: "The tile layer menu stays open when its toolbar chip changes width." },
  "perf(editor): filter tile layer menu updates by scene changes":
    { note: "The open tile layer menu skips unrelated component edits." },
  "perf(project): ship targeted tile layer menu updates":
    { note: "The open tile layer menu skips unrelated component edits." },
  "fix(editor): close tile opacity gestures on pointer interruption":
    { note: "Interrupted tile opacity drags restore the original value." },
  "fix(project): ship tile opacity gesture recovery":
    { note: "Interrupted tile opacity drags restore the original value." },
  "fix(editor): bind tile layer drag ordering to the original layer":
    { note: "Tile layer drags keep their original source." },
  "fix(project): ship stable tile layer drag ordering":
    { note: "Tile layer drags keep their original source." },
  "perf(editor): plan tile replacements directly from chunks":
    { note: "Tile replacement previews are faster on large maps." },
  "perf(project): ship faster tile replacement previews":
    { note: "Tile replacement previews are faster on large maps." },
  "perf(editor): reuse decoded chunks while adjusting tile replacement":
    { note: "Adjusting a tile replacement reuses the layer’s decoded chunks." },
  "perf(project): ship faster tile replacement parameter edits":
    { note: "Adjusting a tile replacement reuses the layer’s decoded chunks." },
  "fix(editor): keep tile replacement bound to the opening layer":
    { note: "Replace Tiles stays tied to the chosen layer." },
  "fix(project): ship tile replacement target checks":
    { note: "Replace Tiles stays tied to the chosen layer." },
  "fix(terrain): encode tiled height images in their document format":
    { note: "Grey terrain heightmaps preserve their depth when edited." },
  "fix(terrain): carry the height format through tiled edits":
    { note: "Grey terrain heightmaps preserve their depth when edited." },
  "fix(terrain): keep heightmap exports in their originating project":
    { note: "Full terrain heightmap exports require every tile." },
  "fix(terrain): reject incomplete full heightmap exports":
    { note: "Full terrain heightmap exports require every tile." },
  "fix(editor): write imported terrain images as one file batch":
    { note: "Failed heightmap imports restore the files they replaced." },
  "fix(project): ship terrain import file rollback":
    { note: "Failed heightmap imports restore the files they replaced." },
  "fix(editor): update imported terrain previews after writing images":
    { note: "The terrain preview changes after a heightmap import is saved." },
  "fix(terrain): prepare tiled heightmap imports before editing the ground":
    { note: "The terrain preview changes after a heightmap import is saved." },
  "fix(cook): preserve the source images of reachable tiled terrain":
    { note: "Published tiled terrain keeps its original height and weight samples." },
  "perf(terrain): reuse the tile index when preparing saves":
    { note: "Saving edits to large tiled terrain prepares changed tiles faster." },
  "fix(cook): reject packages with unresolved tiled terrain images":
    { note: "Packaging reports unavailable tiled terrain images." },
  "perf(tilemap): decode aligned chunks without per-cell coordinate lookups":
    { note: "Large saved tilemaps decode faster." },
  "fix(tilemap): keep grid coordinates precise at distant origins":
    { note: "Tile coordinates stay precise far from the world origin." },
  "fix(tilemap): align gameplay coordinates with tile rendering":
    { note: "World-space digs and explosions follow the drawn tile grid." },
  "refactor(editor): use the shared tilemap world frame":
    { note: "World-space digs and explosions follow the drawn tile grid." },
  "refactor(project): share tilemap coordinates with the editor":
    { note: "World-space digs and explosions follow the drawn tile grid." },
  "fix(timeline): give back the camera when playback ends or detaches":
    { note: "Timeline gives back the view when its camera shot stops." },
  "fix(timeline): preserve nested cue entry boundaries":
    { note: "Nested Timeline cues at time zero fire once on entry or when playback reaches a new loop." },
  "fix(timeline): retain nested loop phase for cue crossings":
    { note: "Looping nested sequences keep their cues through long playback steps." },
  "fix(timeline): dispatch markers and custom events from nested sequences":
    { note: "Nested timelines deliver their custom events and markers during playback." },
  "perf(timeline): select overlapping camera shots in one pass":
    { note: "Timeline evaluates overlapping camera shots in a single pass." },
  "fix(timeline): sample poses and shots on paused seeks":
    { note: "Paused timeline seeks update the pose and camera." },
  "perf(sequencer): reuse sampled layers for camera preview":
    { note: "Timeline avoids resolving nested layers twice on steady playback and preview frames." },
  "perf(timeline): reuse sampled sequence layers for shots":
    { note: "Timeline avoids resolving nested layers twice on steady playback and preview frames." },
  "fix(editor): align transform handle picking with draw clipping":
    { note: "Clipped transform handles no longer intercept the viewport pointer." },
  "fix(project): ship transform gizmo clipping consistency":
    { note: "Clipped transform handles no longer intercept the viewport pointer." },
  "fix(ui): keep dropdown options visible and selectable across canvas edges":
    { note: "Game UI dropdowns keep their options within the screen’s safe area." },
  "perf(ui): reuse child lists during layout traversal":
    { note: "Large UI trees cost less to check on static frames." },
  "perf(ui): reuse screen membership across stable layout passes":
    { note: "Large screen-space UI trees cost less CPU time to check for layout changes." },
  "fix(ui): keep transient text field and dropdown visuals out of scene snapshots":
    { note: "Input fields and open dropdowns now survive repeated scene saves and reloads without duplicating text or menu items." },
  "fix(scene): preserve failed asset refs when spawning prepared documents":
    { note: "Loaded scenes and prepared prefabs retain failed asset references." },
  "fix(assets): keep unresolved paths in runtime scene snapshots":
    { note: "Failed runtime asset loads preserve their authored paths in scene snapshots." },
  "fix(sequencer): validate new sequence references before editing":
    { note: "New nested sequence references are checked before the timeline changes." },
  "fix(editor): ship validation for newly selected sequences":
    { note: "New nested sequence references are checked before the timeline changes." },
  "fix(scene): validate replacement scenes before clearing the world":
    { note: "Replacing a scene keeps the current world intact when validation rejects the new scene." },
  "feat(particle): orbital and radial velocity, arc and rim emission, ground-flat and upright quads, and a light that pulses or flickers by itself":
    { note: "Particles can swirl, gather, be born on a rim or part of a ring, and lie flat on the ground; lights can pulse or flicker on their own." },
  "feat(editor): vfx_write lays rings on the ground, swirls and gathers layers, and lets the engine flicker or pulse the light":
    { note: "Particles can swirl, gather, be born on a rim or part of a ring, and lie flat on the ground; lights can pulse or flicker on their own." },
  "fix(pipeline): effect textures clear to their edges, a cone's angle as its half-angle, and one number for a size":
    { note: "Effects no longer draw lit squares from a faint veil in their textures, and several agent tools that misled were fixed." },
  "fix(editor): field_sweep requires the field it takes, and every tool schema is checked for it":
    { note: "Effects no longer draw lit squares from a faint veil in their textures, and several agent tools that misled were fixed." },
  "fix(editor): image_write says when a picture is almost invisible":
    { note: "Effects no longer draw lit squares from a faint veil in their textures, and several agent tools that misled were fixed." },
  "fix(editor): vfx tools warn of a texture veil, keep other effects out of a preview, and take one number for a size":
    { note: "Effects no longer draw lit squares from a faint veil in their textures, and several agent tools that misled were fixed." },
  "feat(pipeline): describe a visual effect in metres and seconds, build it as a prefab of particle layers and a light, and read it back":
    { note: "An AI agent can build visual effects through the editor's MCP tools and see them without Play." },
  "feat(editor): vfx tools that write an effect as a prefab and show it at chosen moments without Play":
    { note: "An AI agent can build visual effects through the editor's MCP tools and see them without Play." },
  "fix(editor): carry a particle emitter's gradient, size curve and bursts to the engine when it is placed, created or restored":
    { note: "An AI agent can build visual effects through the editor's MCP tools and see them without Play." },
  "fix(editor): commit viewport transforms at the release position":
    { note: "Viewport transforms follow the pointer all the way to release." },
  "fix(project): ship accurate viewport transform release positions":
    { note: "Viewport transforms follow the pointer all the way to release." },
  "fix(input): keep web drags moving outside the canvas":
    { note: "Web drags keep moving beyond the game canvas." },
  "fix(input): align mouse and touch on scaled web canvases":
    { note: "Mouse and touch agree on bordered web canvases and canvases with axis-aligned CSS scaling." },
  "fix(xr): keep the frozen Binding type, name the headset framebuffer through the GL bridge, and give VR its gates":
    { note: "VR controllers work as input and can hold things." },
  "feat(xr): VR controllers as input, and entities that follow the controllers and the head":
    { note: "VR controllers work as input and can hold things." },
  "perf(xr): cull and collect the scene once for both eyes, and draw every frame a headset asks for":
    { note: "In VR the scene is culled and collected once a frame, and the game draws every frame the headset asks for." },
  "perf(xr): plan one shadow atlas for both eyes, and keep each eye's temporal history apart":
    { note: "VR draws its shadows once a frame instead of twice, and temporal effects no longer blend the two eyes." },
  "feat(xr): present web builds in a VR headset through WebXR":
    { note: "Web builds can be played in a VR headset." },
  "fix(render): a WeChat mini-game draws again - the device works out which texture units a program samples from the units it set itself, instead of reading them back with glGetUniformiv, which WeChat's WebGL does not implement":
    { note: "3D games exported to WeChat draw again." },
  "fix(ui): preserve loading textures while updating widget colors":
    { note: "Widgets keep their images when their color changes during loading." },
  "perf(ui): skip unchanged widget color writes when applying a theme":
    { note: "Reapplying project settings is faster in scenes with many themed widgets." },
  "fix(editor): read preview themes from the packaged project settings":
    { note: "Dropdowns created from prefabs now match the project’s widget palette." },
  "fix(ui): resolve widget colors in their owning world":
    { note: "Dropdowns created from prefabs now match the project’s widget palette." },
  "fix(persist): filter snapshots before export and keep flush errors on the queue":
    { note: "World persistence reports a failed flush through its returned promise." },
  "fix(ui): place the caret using the text field's press ray":
    { note: "Clicking a 3D text field places the caret at the clicked character." },
  "fix(ui): project the IME anchor from the world caret":
    { note: "IME candidate windows follow the caret on 3D text inputs." },
  "perf(editor): reuse Animator graph and card wire layout data":
    { note: "Large Animator graphs update faster during playback." },
  "fix(editor): keep Animator editing usable in narrow docks":
    { note: "The Animator stays editable in narrow docks." },
  "fix(editor): show unbound Animator parameters":
    { note: "Deleting an Animator parameter leaves its transition conditions inactive." },
  "fix(animation): unbind deleted Animator parameters":
    { note: "Deleting an Animator parameter leaves its transition conditions inactive." },
  "fix(animation): ignore transitions to deleted Animator states":
    { note: "Deleted Animator states no longer interrupt playback through old transitions." },
  "fix(editor): keep the live Animator dropdown visible in narrow docks":
    { note: "The Animator's live entity dropdown stays reachable in narrow docks." },
  "fix(animation): preserve Animator playback settings when replacing motion":
    { note: "Changing an Animator motion keeps the state's playback settings." },
  "fix(editor): restore rejected Animator parameter names":
    { note: "Renaming an Animator parameter keeps its controller bindings." },
  "fix(animation): keep controller references when renaming Animator parameters":
    { note: "Renaming an Animator parameter keeps its controller bindings." },
  "perf(animation): reuse the active Animator state path within each update":
    { note: "Animator updates do less work when many entities share a controller." },
  "fix(assets): refresh loaders when an indexed reference candidate changes":
    { note: "Adding a higher-priority asset updates documents that were using a fallback." },
  "fix(ui): give an auto-sized Text its text's size in flex layout":
    { note: "A Text left auto in a flex row or column takes its text's size." },
  "perf(editor): prune floor support searches for large selections":
    { note: "Drop to Floor searches nearby supports when moving large selections." },
  "fix(editor): restore deleted selections in one hierarchy pass":
    { note: "Deleting and restoring scene selections follows the actual parent links." },
  "fix(project): ship reliable batch deletion undo":
    { note: "Deleting and restoring scene selections follows the actual parent links." },
  "fix(input): anchor the browser IME to the displayed canvas caret":
    { note: "The browser's text input anchor follows the visible caret." },
  "fix(input): use browser wheel coordinates before pointer motion":
    { note: "The first wheel gesture reaches the UI under the pointer." },
  "fix(picking): honor the far plane of presented camera rays":
    { note: "Click selection follows the camera’s depth range." },
  "fix(input): use the render canvas window scale for pointer projection":
    { note: "Pointer input follows the canvas when it moves between windows." },
  "test(editor): give the input binding and curve picker check the file's timeout":
    { internal: "A generated docs table and API tier page brought up to date, the rules graph's source declared unloaded at runtime, and a test given its file's timeout; nothing a project loads or does changes." },
  "chore: declare rules graphs unloaded and regenerate the component and API pages":
    { internal: "A generated docs table and API tier page brought up to date, the rules graph's source declared unloaded at runtime, and a test given its file's timeout; nothing a project loads or does changes." },
  "fix(ecs): read current parent and child relationships from the core":
    { note: "SDK lookups follow the current entity hierarchy after engine-side edits." },
  "fix(runtime): load deferred scenes from the active manifest revision":
    { note: "Deferred scenes load their updated files after a hot update." },
  "fix(ecs): advance component revisions on entity destruction":
    { note: "Hierarchy queries drop entities destroyed by the engine." },
  "fix(editor): close device preview selectors when builds start":
    { note: "Device Preview closes its scene and network dropdowns when the settings become locked." },
  "docs: document run conditions, profileDomain and touches on plugins":
    { note: "The manual now covers run conditions, profiler domains and declared access for plugins." },
  "docs: cover the presented camera, pixel readback, weather state, material subgraphs and prefab owners":
    { note: "Five APIs the manual never named are now documented." },
  "docs: list sound event fields, handles, rejections and stats":
    { note: "The sound events page now lists every `.esaudioevent` field and the playback API." },
  "docs: list the TabView, Tooltip, TreeView and ColorPicker handles and fields":
    { note: "The UI widgets page now lists what the TabView, Tooltip, TreeView and ColorPicker factories return." },
  "fix(editor): return focus to a dropdown's button on Escape and on a pick":
    { note: "Closing a dropdown with Escape puts focus back on its button again." },
  "fix(editor): keep focused dropdown choices visible after refresh":
    { note: "Editor dropdowns keep the focused choice in view when their options refresh." },
  "fix(editor): reveal the current dropdown choice when navigating after wheel scroll":
    { note: "Keyboard navigation brings the focused dropdown choice back into view." },
  "fix(editor): move dropdown focus with Page Up and Page Down":
    { note: "Page Up and Page Down move focus through long dropdowns and menus." },
  "fix(project): ship dropdown page navigation":
    { note: "Page Up and Page Down move focus through long dropdowns and menus." },
  "fix(editor): preserve open scene assets during cancelled reloads":
    { note: "An interrupted disk reload keeps the open scene's resources and streamed cells." },
  "fix(editor): apply cell actions to the current world partition":
    { note: "Cell loading follows the latest scene edits." },
  "perf(editor): reuse world partition plans when toggling cells":
    { note: "Loading and unloading cells is faster in large streamed worlds." },
  "perf(project): ship cached editor cell plans":
    { note: "Loading and unloading cells is faster in large streamed worlds." },
  "fix(editor): restore cell controls after repairing a world":
    { note: "Worlds that opened whole regain cell controls after repair." },
  "fix(editor): reveal clipped dropdown labels in narrow panels":
    { note: "Read long dropdown values in narrow editor panels." },
  "fix(editor): return to where a folder was scrolled in the content browser":
    { note: "The content browser returns to where you were in a folder." },
  "perf(editor): reuse mesh bounds when dropping a selection to the floor":
    { note: "Drop to Floor is faster on large selections." },
  "fix(editor): confirm a sole inspector dropdown search result with Enter":
    { note: "Enter selects the only result in an inspector dropdown search." },
  "fix(editor): wrap dropdown details when space is tight":
    { note: "Dropdown choices stay readable in narrow editor windows." },
  "fix(editor): dismiss dropdowns when their trigger shifts within a dock":
    { note: "Dropdowns stay aligned with their toolbar controls." },
  "fix(editor): keep oversized dropdown option labels visible during navigation":
    { note: "Long dropdown options keep their label visible when focused." },
  "fix(editor): reveal wrapped dropdown choices during keyboard navigation":
    { note: "Long dropdown choices stay readable during keyboard navigation." },
  "fix(editor): account for depth when framing a perspective selection":
    { note: "Frame Selection fits deep objects in the perspective viewport." },
  "perf(editor): reuse inherited visibility across hierarchy projection":
    { note: "Deep hierarchies take less time to appear in the viewport." },
  "fix(editor): match hollow tile rectangle previews to paint":
    { note: "Alt-dragging a tile rectangle previews its hollow outline." },
  "fix(editor): refresh inherited visibility when authored parents change":
    { note: "Existing descendants follow changes to their ancestors' visibility." },
  "fix(editor): migrate scene components before manifest asset preload":
    { note: "Legacy meshes and materials load in scenes opened through editor automation." },
  "fix(material): replace live shader programs with the material state":
    { note: "Changing a material's shader updates its live scene appearance and preview." },
  "fix(editor): preview material shader changes before saving":
    { note: "Changing a material's shader updates its live scene appearance and preview." },
  "perf(editor): keep material preview camera changes off the texture load path":
    { note: "Rotating a live material preview or changing its shape reuses the current material." },
  "perf(editor): reuse current textures for material parameter edits":
    { note: "Editing scalar material parameters reuses the textures already bound to the live preview." },
  "perf(editor): read each mesh box once per viewport pick":
    { note: "Viewport clicks do less work in mesh-heavy scenes." },
  "perf(picking): defer non-mesh eligibility until bounds fallback":
    { note: "Viewport clicks do less work in mesh-heavy scenes." },
  "fix(editor): preserve local depth when moving under flat parents":
    { note: "2D moves under zero-depth parents keep their stored depth." },
  "fix(editor): protect scene files written in newer formats":
    { note: "Older editors protect scenes written in newer formats." },
  "fix(scene): share the scene version gate with the editor":
    { note: "Older editors protect scenes written in newer formats." },
  "perf(editor): load live material textures concurrently":
    { note: "Material previews update sooner when several texture maps need loading." },
  "fix(editor): preserve wheel positions in Play input and recordings":
    { note: "Play input and recordings can scroll at an explicit canvas position." },
  "fix(editor): map pointer input through the displayed canvas size":
    { note: "Pointer input stays aligned with the viewport at fractional display scaling." },
  "fix(editor): preserve authored draw order when inserting prefab subtrees":
    { note: "New prefab instances draw in the same order as the saved scene." },
  "fix(scene): share prefab member ID allocation with the editor":
    { note: "Opening a prefab scene keeps existing references pointed at their original targets." },
  "fix(editor): reserve scene reference IDs during prefab expansion":
    { note: "Opening a prefab scene keeps existing references pointed at their original targets." },
  "fix(editor): project selection bounds with the displayed canvas scale":
    { note: "Selection outlines stay aligned at fractional display scaling." },
  "perf(editor): retain projected tile grids while the view is still":
    { note: "Tilemap painting reuses the grid overlay while the view is still." },
  "perf(material): retain draft material resources across preview draws":
    { note: "Rotating an off-scene material preview or changing its shape reuses the current draft." },
  "perf(editor): reuse off-scene material drafts for camera changes":
    { note: "Rotating an off-scene material preview or changing its shape reuses the current draft." },
  "perf(editor): reuse parent frames during multi-object moves":
    { note: "Dragging many objects under a nested parent does less transform work." },
  "fix(editor): keep shader picker focus through asset renames":
    { note: "The material Shader picker follows asset renames while open." },
  "feat(editor): paint the picked terrain with the rect, ellipse and line tools":
    { note: "The rect, ellipse and line tools paint the terrain you picked, edges included." },
  "fix(editor): keep new material shader and parent links through moves":
    { note: "New material links follow indexed shaders and parents when they move." },
  "fix(editor): refresh tile shape previews when modifiers change":
    { note: "Tile shape previews respond to Shift and Alt while the pointer is still." },
  "fix(editor): keep tile layer rows on one line after the terrain layer editor opens":
    { note: "Tile layer rows stay on one line after the terrain layer editor has been open." },
  "fix(editor): resume toolbar tab order after floating settings":
    { note: "Tab follows the toolbar order after leaving Gizmos settings." },
  "fix(editor): align transform gizmo drawing and picking with display scale":
    { note: "Transform handles stay aligned with their hit areas when the viewport is scaled." },
  "fix(material): preview unsaved materials through the runtime loader":
    { note: "Material previews show unsaved edits even when the material is outside the current scene." },
  "fix(editor): preview unsaved materials outside the current scene":
    { note: "Material previews show unsaved edits even when the material is outside the current scene." },
  "fix(editor): confirm updates and never install over another copy":
    { note: "Taking an editor update is asked first, and a copy kept beside the installed one is never replaced." },
  "fix(editor): pan the viewport using its displayed canvas scale":
    { note: "The scene follows the pointer when panning a scaled viewport." },
  "perf(editor): project only nearby cells in large tile paint previews":
    { note: "Large tile paint previews generate fewer off-screen outlines." },
  "fix(assets): resolve suffixed texture paths in Play and web builds":
    { note: "Local texture references with query or fragment suffixes keep their import settings in the editor and Play." },
  "fix(editor): use indexed settings for suffixed asset references":
    { note: "Local texture references with query or fragment suffixes keep their import settings in the editor and Play." },
  "fix(editor): validate streamed cells against project component schemas":
    { note: "World editing checks entity references declared by project components." },
  "fix(editor): place world-space moves using the composed parent matrix":
    { note: "World-space moves land where intended under rotated, non-uniformly scaled hierarchies." },
  "fix(editor): let post-effect dials take any value, inside their slider or not":
    { note: "A post effect's dials take any value again, inside their slider or not." },
  "fix(sdk): tell a post-effect choice from a dial, and let a fog lie on a high plain":
    { note: "A post effect's dials take any value again, inside their slider or not." },
  "fix(runtime): refresh the entry scene after a manifest update":
    { note: "Packaged games use the updated entry scene after a hot update." },
  "fix(export): reject scene formats the runtime cannot load":
    { note: "Export reports scenes in an unsupported format." },
  "perf(export): walk asset dependencies without shifting the queue":
    { note: "Export traverses large asset dependency lists with less work." },
  "fix(export): fail builds with missing required scene assets":
    { note: "Export fails when a selected scene is missing from the asset index." },
  "fix(world): match far proxy hierarchy to the loaded scene":
    { note: "Far proxies match the active hierarchy of the scene they replace." },
  "fix(world): wait for far proxy render programs before handoff":
    { note: "A visible cell stays in place while its far proxy waits for render programs." },
  "perf(world): skip cells in gaps between residency sources":
    { note: "Large worlds spend less time reconciling cells between distant residency sources." },
  "perf(editor): reuse selected rows while navigating bone pickers":
    { note: "Keyboard navigation is faster in large joint lists." },
  "perf(project): ship faster bone picker navigation":
    { note: "Keyboard navigation is faster in large joint lists." },
  "perf(editor): reuse the scene child index for branch paths":
    { note: "The Sequencer and Animator can list paths under an entity faster in large scenes." },
  "perf(project): ship faster editor branch path queries":
    { note: "The Sequencer and Animator can list paths under an entity faster in large scenes." },
  "perf(bounds): reuse rotated corners for flat entity boxes":
    { note: "Flat world bounds take less work to project." },
  "perf(editor): project a single face of flat world bounds":
    { note: "Flat world bounds take less work to project." },
  "perf(editor): reuse row positions in large suggestion lists":
    { note: "Large editor suggestion lists respond faster to keyboard navigation." },
  "perf(project): ship faster grouped editor suggestions":
    { note: "Large editor suggestion lists respond faster to keyboard navigation." },
  "perf(editor): reduce keyboard navigation work in large dropdowns":
    { note: "Large searchable dropdowns respond faster to keyboard navigation." },
  "perf(project): ship faster large editor dropdowns":
    { note: "Large searchable dropdowns respond faster to keyboard navigation." },
  "perf(editor): skip hull construction for fully enclosed marquee hits":
    { note: "Marquee selection is faster when it encloses many entities." },
  "perf(world): accumulate cell bounds during subtree placement":
    { note: "Large streamed worlds partition faster." },
  "fix(world): reject unrepresentable streamed partitions":
    { note: "Play and export report invalid streamed-world geometry before publishing cells." },
  "fix(editor): match flipbook viewport playback and preserve sprite edits":
    { note: "Flipbook viewport previews use each Sprite Animator’s speed and loop settings." },
  "fix(ui): deliver blur when a live control loses focusability":
    { note: "A live UI control emits Blur when its Focusable component is removed." },
  "fix(input): preserve fractional offsets on scaled browser canvases":
    { note: "Touch and outside-canvas drags follow the scaled canvas." },
  "fix(input): reset gamepad button history on reconnect":
    { note: "Gamepads start with fresh button history after reconnecting." },
  "fix(editor): align gizmos with the drawn viewport centre":
    { note: "Gizmos align with the drawn viewport." },
  "fix(import): track external gltf hair maps as dependencies":
    { note: "Imported glTF hair materials keep their external flow and shift textures." },
  "chore(golden): hold the rules graph's classification until it ships":
    { internal: "The release census only classifies features a released version ships; the rules graph's entry waits for its release." },
  "test(sdk): type the hierarchy members spy and record its wasm exports":
    { internal: "A test's mock typing and the recorded wasm export list; nothing a project can call or see changes." },
  "chore: note the hierarchy spy typing as internal":
    { internal: "A test's mock typing and the recorded wasm export list; nothing a project can call or see changes." },
  "fix(ecs): refresh hierarchy value predicates after reparenting":
    { note: "Cached hierarchy predicates follow reparenting." },
  "fix(editor): keep HLOD partition and proxy build errors visible":
    { note: "The HLOD panel shows why a world or proxy could not be built." },
  "perf(world): build requested far proxies without scanning the entire world":
    { note: "Generating an HLOD proxy skips unrelated cells during proxy assembly." },
  "perf(editor): build selected HLOD proxies directly":
    { note: "Generating an HLOD proxy skips unrelated cells during proxy assembly." },
  "fix(editor): keep HLOD results with the current refresh and project":
    { note: "The HLOD panel keeps the latest refresh and clears when switching projects." },
  "fix(editor): mark HLOD proxies stale when simplification settings change":
    { note: "The HLOD panel flags proxies after simplification settings change." },
  "fix(editor): refresh HLOD proxies when source assets change":
    { note: "The HLOD panel notices edits to source meshes and prefabs." },
  "fix(input): cancel host pointers without dispatching a release":
    { note: "Losing focus or cancelling a touch no longer clicks a held game UI control." },
  "perf(editor): stop hover picking at the first ranked hit":
    { note: "Faster hover picking over UI." },
  "perf(editor): reuse merged selection bounds during hover":
    { note: "Hover stays responsive with large selections." },
  "fix(editor-tools): wire entity fields by $ref and keep the HUD out of view_from":
    { note: "`apply_scene_ops` wires a widget to the parts it made in the same call, and `view_from` shows the world without the HUD." },
  "fix(editor): leave the screen HUD out of stills of the world":
    { note: "`apply_scene_ops` wires a widget to the parts it made in the same call, and `view_from` shows the world without the HUD." },
  "feat(ui): draw text at any weight with tabular figures, and shade screen UI with a Gradient material":
    { note: "Screen UI can be drawn the quiet way a designed HUD is: light type, steady numbers and lines that fade." },
  "fix(scene): preserve imported renderers under visibility gates":
    { note: "Hidden imported nodes keep their model references and authored renderer flags." },
  "fix(editor): withhold incomplete tilemap palettes and collision previews":
    { note: "A tilemap layer keeps its tile IDs when a referenced tileset goes missing." },
  "perf(assets): skip reference cache reads for leaf asset edits":
    { note: "Replacing ordinary textures or audio files updates the editor’s asset index faster." },
  "fix(assets): reconcile invalid sidecars during incremental scans":
    { note: "The editor’s asset index drops entries with invalid sidecars." },
  "perf(editor): update the source child index locally after reparenting":
    { note: "Moving several nodes between parents is faster in large scenes." },
  "perf(project): ship incremental editor hierarchy indexing":
    { note: "Moving several nodes between parents is faster in large scenes." },
  "fix(assets): resolve indexed document references with URL suffixes":
    { note: "Document-relative material and tileset references can resolve local assets with query or fragment suffixes." },
  "fix(world): resolve inherited streamed world settings across preview and export":
    { note: "Streamed worlds can inherit their settings from a prefab root." },
  "fix(editor): read resolved world settings for HLOD clusters":
    { note: "Streamed worlds can inherit their settings from a prefab root." },
  "fix(editor): restore inspector dropdown focus and reveal clipped flag summaries":
    { note: "Inspector dropdowns return focus to the field that opened them." },
  "feat(pipeline): keep places out of a land's maps, layers, tints and steps with `not`":
    { note: "A land's `where` can keep places out." },
  "perf(editor): combine offscreen option list spacers":
    { note: "Large searchable dropdowns open and scroll faster." },
  "perf(project): ship faster large dropdown rendering":
    { note: "Large searchable dropdowns open and scroll faster." },
  "fix(assets): use current asset metadata for legacy mesh components":
    { note: "Legacy mesh scenes preload and cook the same assets as current scenes." },
  "fix(ecs): refresh hierarchy queries after engine-side parenting":
    { note: "Entity queries follow engine-side parenting edits." },
  "fix(editor): apply live material edits when a texture is missing":
    { note: "Live material previews apply valid edits when a texture is missing." },
  "fix(editor): reveal the highlighted suggestion after live updates":
    { note: "Searchable lists keep the keyboard-highlighted option visible after a project refresh." },
  "fix(project): ship stable live suggestion scrolling":
    { note: "Searchable lists keep the keyboard-highlighted option visible after a project refresh." },
  "perf(editor): keep parent moves local to their sibling lists":
    { note: "Moving a node between parents costs less in large scenes." },
  "perf(ecs): support ordered reparenting without sorting the world":
    { note: "Moving a node between parents costs less in large scenes." },
  "perf(picking): skip unused sorting groups for area selection":
    { note: "Faster marquee selection in grouped scenes." },
  "perf(editor): query UI candidates separately for marquee selection":
    { note: "World marquee selection does less work in scenes with sparse UI." },
  "fix(editor): reject gutter-only marquee contact with viewports":
    { note: "Marquees in the gutter stop at the viewport edge." },
  "perf(material): send changed uniforms during material snapshot updates":
    { note: "Editing one material parameter sends fewer updates to the renderer." },
  "fix(cook): follow only dependencies a material uses":
    { note: "Material exports follow the dependencies used by the runtime." },
  "fix(export): keep indexed material dependencies without file extensions":
    { note: "Exports keep indexed material dependencies even when their filenames have no extension." },
  "fix(material): resolve the active shader through material instance chains":
    { note: "Material instances use the closest inherited shader throughout the runtime." },
  "fix(health): audit data textures through material inheritance":
    { note: "Project Health checks data textures against the shader their material actually uses." },
  "perf(material): reuse resolved state when updating material instances":
    { note: "Updating a material with many instances takes less CPU time." },
  "perf(material): read individual uniforms directly through instance chains":
    { note: "Reading one material parameter is faster on inherited materials." },
  "perf(material): keep unchanged render state during parameter edits":
    { note: "Parameter-only material edits reuse the current render state." },
  "fix(material): use the shader default for cleared texture overrides":
    { note: "Material texture overrides can be edited in Details." },
  "fix(editor): distinguish clearing a texture override from inheriting it":
    { note: "Material texture overrides can be edited in Details." },
  "fix(picking): rank opaque meshes by ray depth and respect mesh layers":
    { note: "Click the near model when opaque 3D models overlap." },
  "perf(picking): reuse live mesh transform readers during selection":
    { note: "Model selection reuses transform reads in large scenes." },
  "fix(minigame): dismiss late loading indicators independently":
    { note: "Mini-game loading indicators no longer leave the first screen covered when an earlier host call fails or misses its callback." },
  "fix(runtime): resolve mini-game scene files through the package manifest":
    { note: "Mini-game exports resolve scene paths through the package manifest." },
  "fix(minigame): stage colliding scene files at distinct paths":
    { note: "Mini-game export handles scene file and folder name collisions." },
  "fix(picking): keep mirrored shape and skeleton bounds at their drawn size":
    { note: "Mirrored shapes and Spine skeletons keep their full selection bounds." },
  "fix(editor): show all tilesets used by a tile stamp":
    { note: "Tile stamps can preview tiles from more than one tileset." },
  "fix(input): route native desktop wheel events at their own positions":
    { note: "Native desktop wheel events scroll the control under each event." },
  "fix(native): match Web children component membership":
    { note: "Native and Web agree on empty `Children` components." },
  "fix(tilemap): resolve relative atlases in native tilesets":
    { note: "Native tilesets can reference an atlas relative to their `.estileset` file." },
  "fix(editor): preview relative native tileset atlases":
    { note: "Native tilesets can reference an atlas relative to their `.estileset` file." },
  "fix(editor): draw no tree line under an Outliner folder":
    { note: "Outliner folders no longer draw a tree line under their contents." },
  "fix(assets): resolve suffixed scene references in packaged builds":
    { note: "Packaged scenes can bind indexed textures whose references carry a query or fragment suffix." },
  "perf(editor): bound tile paint previews in tilted perspective views":
    { note: "Large tile paint previews are faster in tilted views." },
  "fix(picking): exclude inactive entities from world ray picks":
    { note: "Inactive objects stay out of viewport picks." },
  "fix(editor): exclude inactive entities from viewport marquee picks":
    { note: "Inactive objects stay out of viewport picks." },
  "perf(picking): reuse live hierarchy readers across hits":
    { note: "Faster picking with camera layer filters." },
  "perf(play): share prefab assets between world detection and scene expansion":
    { note: "Play reads prefab assets once per scene load." },
  "fix(editor): align Play selection overlays with the drawn viewport":
    { note: "Play selection outlines follow the rendered frame." },
  "fix(asset): load the shader a material names in the running game":
    { note: "A material made by `shader_write` draws in Play, and `verify` fails when an asset does not load." },
  "fix(verify): count an asset the game failed to load as an error":
    { note: "A material made by `shader_write` draws in Play, and `verify` fails when an asset does not load." },
  "fix(editor): preserve export scene names during Play":
    { note: "Play keeps the scene names used by project exports." },
  "fix(project): reserve shipping scene names before editor-only names":
    { note: "Play keeps the scene names used by project exports." },
  "fix(playable): resolve embedded audio aliases consistently":
    { note: "Playable ads resolve Windows-style audio paths to their embedded clips." },
  "fix(editor): keep plugin dropdown labels and arrows inside narrow docks":
    { note: "Plugin dropdowns fit narrow docks." },
  "fix(asset): resolve Windows project paths consistently across runtimes":
    { note: "Project asset paths written with Windows separators resolve in editor Play and packaged games." },
  "fix(prefab): compare own component fields when saving overrides":
    { note: "Prefab save handles custom component fields that share names with built-in JavaScript properties." },
  "perf(editor): reuse prefab baselines while saving scenes":
    { note: "Saving scenes with repeated nested prefabs is faster." },
  "perf(prefab): share prepared scene-instance baselines with the editor":
    { note: "Saving scenes with repeated nested prefabs is faster." },
  "fix(prefab): preload the effective variant mounts":
    { note: "Prefab variants load the nested dependencies they actually use." },
  "fix(camera): identify the app that presented a camera":
    { note: "Camera changes refresh the viewport that displays them." },
  "fix(editor): scope viewport refresh to the displayed app":
    { note: "Camera changes refresh the viewport that displays them." },
  "fix(diagnostics): drop the layout notice from every well-formed UI node":
    { note: "`get_diagnostics` no longer flags every UI node." },
  "fix(editor-mcp): say when a stale editor build is someone's uncommitted edit":
    { note: "`get_diagnostics` no longer flags every UI node." },
  "perf(picking): skip icon scaling for sprite bounds":
    { note: "Faster picking in sprite-heavy scenes." },
  "fix(editor): cancel editable dropdown drafts when controls become disabled":
    { note: "Read-only transitions discard dropdown drafts." },
  "fix(editor): dismiss dropdowns when their trigger becomes disabled":
    { note: "Read-only inspector dropdowns." },
  "feat(editor): record the running game to a video through MCP":
    { note: "An AI agent can record the running game to a video through the editor's MCP tools." },
  "feat(project): ship recording the running game to a video":
    { note: "An AI agent can record the running game to a video through the editor's MCP tools." },
  "feat(sdk): give a RenderTexture's render target a public name":
    { note: "A `RenderTexture` handle names its render target as `target`." },
  "fix(editor): validate timeline paths in scene sibling order":
    { note: "The Sequencer offers paths that can be reached in scene order." },
  "fix(project): ship consistent timeline target paths":
    { note: "The Sequencer offers paths that can be reached in scene order." },
  "fix(ui): exclude retiring dialogs and controls from keyboard focus":
    { note: "Dialogs and controls that are being destroyed stop receiving keyboard input immediately." },
  "fix(editor): size the rules graph Apply icon on the ramp":
    { internal: "A test's type narrowing and an icon size held to the editor's ramp; nothing a project or a panel does changes." },
  "chore: bring the rules graph's test types and icon size green":
    { internal: "A test's type narrowing and an icon size held to the editor's ramp; nothing a project or a panel does changes." },
  "feat(pipeline): wire, order and preview rules graph nodes":
    { note: "Rules graphs open in a node editor." },
  "feat(editor): edit rules graphs as nodes, with what each node makes beside them":
    { note: "Rules graphs open in a node editor." },
  "feat(pipeline): run rules graphs again only where they changed, and make components of their parts":
    { note: "Rules graphs open in a node editor." },
  "feat(editor): preview rules graphs off the window, select nodes by box, copy them and make components of them":
    { note: "Rules graphs open in a node editor." },
  "feat(pipeline): lay out places with a rules graph":
    { note: "An AI agent can lay out towns and cities by rules through the editor's MCP tools." },
  "feat(editor): rules tools write, look at and apply rules graphs":
    { note: "An AI agent can lay out towns and cities by rules through the editor's MCP tools." },
  "feat(pipeline): tilt a rules graph part, and merge branches without copies":
    { note: "An AI agent can lay out towns and cities by rules through the editor's MCP tools." },
  "feat(pipeline): stand made models from a rules graph with a `model` node":
    { note: "A rules graph can stand models made elsewhere." },
  "feat(editor): apply the models of a rules graph, each as its own entity":
    { note: "A rules graph can stand models made elsewhere." },
  "feat(pipeline): stand plant models from a rules graph with a `plant` node":
    { note: "A rules graph can stand real trees." },
  "feat(editor): apply the plants of a rules graph as one PlacedFoliage, made as a land's are":
    { note: "A rules graph can stand real trees." },
  "feat(pipeline): name what a rules graph part is made of, drawn with tiling textures at their real size":
    { note: "A rules graph can say what each part is made of." },
  "feat(editor): apply a rules graph with a material and texture for each surface it names":
    { note: "A rules graph can say what each part is made of." },
  "fix(input): map browser pointers through the canvas content box":
    { note: "Browser pointer picking follows the actual rendered canvas size." },
  "fix(assets): align saved material texture loads with live preview":
    { note: "Saved materials leave empty texture slots unassigned." },
  "fix(scene): share authored hierarchy checks across load and export":
    { note: "Scene opens and exports report duplicate IDs and parent cycles." },
  "fix(editor): reject ambiguous scene hierarchies before projection":
    { note: "Scene opens and exports report duplicate IDs and parent cycles." },
  "fix(editor): preserve live sibling order through hierarchy edits":
    { note: "Same-named siblings resolve in the same order in the live scene and after reload." },
  "fix(ecs): keep live hierarchy order consistent with saved scenes":
    { note: "Same-named siblings resolve in the same order in the live scene and after reload." },
  "fix(scene): keep the active UI theme when a load fails":
    { note: "A failed scene load keeps the running UI's palette." },
  "fix(runtime): retry scene loads superseded by a manifest update":
    { note: "Scene loads follow the active asset manifest during hot updates." },
  "fix(scene): diagnose malformed scene records across loading and export":
    { note: "Malformed scene records are reported at their location." },
  "perf(scene): skip full distance calculations for distant streaming cells":
    { note: "Large 2D and 3D maps spend less time deciding which scene cells to stream." },
  "fix(scene): retry failed proximity streaming operations":
    { note: "Proximity streaming recovers after temporary load and unload failures." },
  "fix(scene): stream proximity cells from the focus entity's world position":
    { note: "Scene streaming follows parented entities in 2D and 3D." },
  "fix(editor): page through suggestions without leaving the input":
    { note: "Page Up and Page Down work in editable suggestion fields." },
  "fix(project): ship keyboard paging for searchable dropdowns":
    { note: "Page Up and Page Down work in editable suggestion fields." },
  "fix(editor): reveal the highlight when paging reaches a searchable dropdown boundary":
    { note: "Page Up and Page Down bring the highlighted suggestion back into view." },
  "fix(editor): keep searchable dropdown choices visible in short windows":
    { note: "Searchable dropdowns keep a full choice visible in short windows when space permits." },
  "fix(project): ship usable searchable dropdowns in short windows":
    { note: "Searchable dropdowns keep a full choice visible in short windows when space permits." },
  "perf(editor): avoid unnecessary hulls in selection bounds queries":
    { note: "Faster outlines for large selections." },
  "fix(editor): clip projected selection outlines to the drawn viewport":
    { note: "Selection outlines stay inside the picture." },
  "fix(editor): use anchored dropdowns for sequencer clip targets":
    { note: "The Sequencer’s Add Shot and Add Sequence dropdowns follow the track buttons." },
  "fix(project): ship anchored sequencer clip dropdowns":
    { note: "The Sequencer’s Add Shot and Add Sequence dropdowns follow the track buttons." },
  "feat(editor): write GLSL material shaders and see them on samples at once":
    { note: "An AI agent can write a material shader and look at it in well under a second." },
  "feat(shader): name the line where a GLSL shader stops translating for WebGPU":
    { note: "An AI agent can write a material shader and look at it in well under a second." },
  "perf(document): reduce scene and prefab validation work":
    { note: "Scene and prefab validation does less work." },
  "perf(editor): aggregate selection bounds without visiting corners":
    { note: "Large selections and asset previews use faster framing bounds." },
  "perf(render): share and streamline bounds aggregation for framing":
    { note: "Large selections and asset previews use faster framing bounds." },
  "fix(editor): show the focused toolbar choice in short windows":
    { note: "Long dropdown labels stay readable in tight editor layouts." },
  "fix(editor): show a complete dropdown option in short windows":
    { note: "Dropdowns in short editor windows make room for a complete option." },
  "fix(update): install a downloaded update silently and reopen the editor":
    { note: "Restarting into an editor update on Windows no longer opens the installer wizard." },
  "perf(ui): skip repeated wheel picks without a scroll target":
    { note: "Wheel input over non-scrollable areas does less hit testing." },
  "perf(ecs): read sparse hierarchy query candidates from the core":
    { note: "Sparse hierarchy queries refresh faster in large scenes." },
  "perf(editor): scan occupied chunks for tile replacement previews":
    { note: "Tile replacement previews skip empty space when replacing existing tiles." },
  "fix(picking): keep speculative component reads tracked":
    { note: "Entity picking tracks mesh, parent and sorting-group reads during speculative steps." },
  "fix(editor): keep dropdown search mode stable while choices update":
    { note: "Changing choices keeps focus in an open inspector dropdown." },
  "fix(project): ship stable focus for live dropdown choices":
    { note: "Changing choices keeps focus in an open inspector dropdown." },
  "fix(runtime): discard scene preloads from superseded manifests":
    { note: "Scene switches refresh stale preloads after a hot update." },
  "fix(world): preserve prefab entity references across streamed scene cuts":
    { note: "Streamed prefabs keep references to persistent scene entities." },
  "perf(world): prepare streamed prefab roots with bounded concurrency":
    { note: "Play and export can overlap prefab reads when partitioning a streamed scene." },
  "fix(export): read streamed world declarations from shipped scenes":
    { note: "Export checks actual StreamedWorld components in the scenes it ships." },
  "fix(world): migrate legacy component records before partitioning":
    { note: "Older scenes and prefabs enter the correct streamed cells." },
  "fix(runtime): resolve streamed world manifests through active assets":
    { note: "Re-entering a streamed scene uses its current world manifest." },
  "perf(world): index scene hierarchy and cell placement together":
    { note: "Large streamed worlds partition faster." },
  "fix(world): read streamed world settings from prefab instance overrides":
    { note: "A prefab instance can declare streaming from its root." },
  "fix(world): validate project entity references when exporting streamed worlds":
    { note: "Streamed-world exports validate references declared by project components." },
  "refactor(editor): share project schema extraction with the build pipeline":
    { note: "Streamed-world exports validate references declared by project components." },
  "fix(terrain): sample the interior triangle at grid-aligned outer edges":
    { note: "Terrain queries report the slope at grid-aligned outer edges." },
  "fix(editor): clip terrain brush picks to the presented camera":
    { note: "Terrain brushes stay inside the view that was drawn." },
  "perf(terrain): stop quadtree trials once they exceed the page budget":
    { note: "High-detail terrain fits its page budget faster." },
  "fix(terrain): clip collision triangles to finite terrain bounds":
    { note: "Finite terrain collision ends at the visible edge." },
  "fix(terrain): refresh collision across edited chunk boundaries":
    { note: "Terrain collision follows height edits across chunk boundaries." },
  "perf(terrain): streamline collision triangle grouping by physical material":
    { note: "Painted terrain groups collision triangles faster." },
  "perf(terrain): share height samples when querying ground paint":
    { note: "3D terrain assigns collision materials faster." },
  "fix(terrain): reject mismatched height tiles during asset cooking":
    { note: "Builds report PNG height tiles that do not match the terrain grid." },
  "fix(editor): refresh terrain hover when the presented camera moves":
    { note: "The terrain brush follows the ground under a stationary pointer." },
  "fix(editor): save ordinary terrain images as a batch":
    { note: "Terrain height and paint images save together." },
  "fix(editor): avoid filename collisions when saving terrain images":
    { note: "New terrain images use available filenames." },
  "fix(terrain): share typed manifest image dependencies with asset cooking":
    { note: "Terrain builds use the same manifest fields as the runtime." },
  "fix(terrain): refresh pages when their border samples change":
    { note: "Terrain lighting follows edits near page seams." },
  "perf(terrain): reuse height bounds across page samples":
    { note: "Terrain pages build faster in worlds with height modifiers." },
  "fix(terrain): decode render pages with their own height range":
    { note: "Cached terrain no longer jumps when a nearby edit extends the height range." },
  "perf(terrain): encode provided page weights directly":
    { note: "Terrain pages can encode supplied paint weights faster." },
  "fix(terrain): load direct physical materials and keep collision settings during reload":
    { note: "Painted ground keeps its collision material while a file reloads." },
  "fix(terrain): preserve secondary paint from region providers":
    { note: "Terrain providers can supply the upper paint layers on their own." },
  "fix(terrain): pick the nearest triangle and reuse raycast edge samples":
    { note: "3D terrain picking uses the nearest surface hit." },
  "perf(terrain): reuse triangle vertices while tracing a terrain ray":
    { note: "Long terrain ray picks allocate less as they cross the grid." },
  "perf(terrain): reuse paint composition buffers across a region":
    { note: "Painted terrain pages take less time to build." },
  "fix(editor): serialize terrain saves with project handoff":
    { note: "Terrain saves stay with their project." },
  "perf(terrain): reuse render patch topology when building collision tiles":
    { note: "Ground and planet collision tiles build faster." },
  "perf(terrain): reuse height sample coordinates during terrain splitting":
    { note: "Terrain splitting samples heights faster." },
  "fix(editor): protect terrain edits during tile conversion":
    { note: "Splitting terrain into tiles preserves existing ground and assets." },
  "perf(terrain): avoid per-pixel views when splitting paint maps":
    { note: "Splitting painted terrain samples its weight maps faster." },
  "fix(editor): align and distinguish terrain targets in the dropdown":
    { note: "The terrain target dropdown fits the brush settings panel." },
  "fix(tilemap): bound terrain rules to available tile IDs":
    { note: "Terrain brushes pick tiles that are still available." },
  "fix(editor): keep terrain brushes inside their tileset":
    { note: "Terrain brushes pick tiles that are still available." },
  "fix(terrain): resolve height references when naming new weight maps":
    { note: "Tiled terrain saves and heightmap imports support UUID-backed images." },
  "fix(editor): write tiled terrain images to resolved project files":
    { note: "Tiled terrain saves and heightmap imports support UUID-backed images." },
  "perf(ui): query only text fields missing input components":
    { note: "Text input skips redundant focus and interaction checks on initialized fields." },
  "fix(ui): isolate text editor callbacks across focus sessions":
    { note: "Returning to a text field starts from its committed value." },
  "feat(text): give Text a second shadow drawn behind the first":
    { note: "Text can carry two shadows." },
  "perf(assets): reduce path work and bound texture usage reads":
    { note: "Texture usage scans finish faster on projects with many scenes and prefabs." },
  "fix(editor): keep the tile brush atlas available across palette tabs":
    { note: "The tile brush preview follows the active tileset across palette tabs." },
  "fix(editor): refresh tile hover when the presented camera moves":
    { note: "The tile brush and status readout follow the cell under a stationary pointer." },
  "fix(editor): recover keyboard focus when tile layers change":
    { note: "Keyboard focus stays in the tile layer picker when a row disappears." },
  "fix(editor): show full tile layer names when dropdown labels are clipped":
    { note: "Long tile layer names stay readable in narrow toolbars." },
  "fix(editor): hide tile overlays when the camera clips the whole tile plane":
    { note: "Tile overlays disappear when the camera clips the map's entire flat plane." },
  "fix(editor): keep tile palette picks inside the active tileset":
    { note: "The tile palette picks the same tile IDs the game renders." },
  "fix(editor): use runtime tile ids in the tile palette":
    { note: "The tile palette uses the same global tile IDs as the runtime." },
  "fix(editor): apply tile replacement to empty cells with stored flags":
    { note: "Replace Tiles can fill empty cells that still have flip flags." },
  "perf(editor): reuse tile stamp preview slices":
    { note: "Large tile stamp previews take less time to build." },
  "fix(tilemap): compose brush transforms in displayed tile space":
    { note: "Tile brushes rotate and flip in the direction shown on screen." },
  "fix(editor): match tile brush previews to renderer orientation":
    { note: "Tile brushes rotate and flip in the direction shown on screen." },
  "fix(editor): clip tile tool picks to the presented camera":
    { note: "Tile tools pick only where the camera draws the map." },
  "fix(tilemap): load uncompressed Base64 Tiled layers":
    { note: "Uncompressed Base64 Tiled maps keep their placed tiles." },
  "fix(tilemap): keep Tiled animations and properties in direct imports":
    { note: "Direct Tiled imports retain tile animations and custom properties." },
  "fix(tilemap): preserve sparse layers in zero-size infinite Tiled maps":
    { note: "Infinite Tiled maps open and export with empty layers." },
  "fix(tilemap): load finite Tiled maps through the bounded layer store":
    { note: "Finite Tiled maps respect their declared grid when loaded directly." },
  "fix(tilemap): inherit Tiled group layer properties":
    { note: "Imported Tiled groups keep their drawing and positioning settings." },
  "perf(tilemap): reuse chunk lookups during infinite Tiled imports":
    { note: "Large infinite Tiled maps load faster." },
  "fix(tilemap): preserve atlas ranges in both Tiled layer loading paths":
    { note: "Tiled layers keep their atlas boundaries." },
  "fix(tilemap): reject oversized Tiled layer IDs in preview and export":
    { note: "Tiled maps report tile-layer IDs that exceed Estella’s 8191 limit." },
  "fix(tilemap): resolve Tiled objects from their unflagged tile IDs":
    { note: "Tiled tile objects select the correct atlas cell after a map orientation change." },
  "fix(tilemap): honor atlas margins and spacing for Tiled tile objects":
    { note: "Tiled tile objects sample their own atlas cell." },
  "fix(tilemap): resolve indexed Tiled references in preview":
    { note: "Tiled maps in preview can use the same legacy project paths as exported builds." },
  "fix(editor): save tiled terrain images and manifests as a batch":
    { note: "Tiled terrain saves publish their images and manifest together." },
  "fix(terrain): keep procedural paint beside painted tiles":
    { note: "Unpainted terrain tiles keep their procedural materials beside painted tiles." },
  "fix(terrain): honor standalone secondary paint maps on tiled ground":
    { note: "Tiled terrain keeps upper paint layers visible when only the second paint map exists." },
  "fix(tilemap): reject cell coordinates outside the native grid":
    { note: "Out-of-range tile coordinates cannot wrap to another cell." },
  "fix(editor): validate tile replacement coordinates before applying edits":
    { note: "Out-of-range tile coordinates cannot wrap to another cell." },
  "fix(tilemap): validate chunk dimensions and input length before uploading":
    { note: "Chunk uploads validate the supplied tile rows." },
  "perf(tilemap): write chunk export Base64 into a pre-sized string":
    { note: "Large tilemaps export their saved data faster." },
  "fix(tilemap): preserve layer bounds when loading saved chunks":
    { note: "Saved tile chunks respect layer bounds." },
  "perf(tilemap): decode chunk import Base64 into a pre-sized buffer":
    { note: "Large tilemap saves load faster." },
  "perf(tilemap): write saved chunk text directly into the engine heap":
    { note: "Large tilemap saves load faster in web runtimes with native text encoding." },
  "fix(tilemap): clip chunk writes to reachable cells":
    { note: "Bulk tile writes respect the layer bounds." },
  "fix(tilemap): clear flat tile layers on an empty bulk write":
    { note: "An empty bulk tile write clears the layer." },
  "perf(tilemap): load only the cells supplied for a flat layer":
    { note: "Bulk tile layer loads process the supplied rows directly." },
  "fix(tilemap): report missing local tileset inputs during builds":
    { note: "Tilemap builds report missing local tilesets and images." },
  "fix(editor): project tile painting onto the rendered layer plane":
    { note: "Tile painting follows the drawn layer in an angled view." },
  "fix(editor): align tile painting and outlines with parallax preview":
    { note: "Paint the tile you see in parallax preview." },
  "fix(camera): publish the rendered parallax anchor for editor overlays":
    { note: "Paint the tile you see in parallax preview." },
  "perf(tilemap): fill rectangles in contiguous chunk rows":
    { note: "Large tile rectangles fill and erase faster." },
  "fix(tilemap): export saved chunks in stable coordinate order":
    { note: "Identical tilemaps export the same saved tile data." },
  "fix(tilemap): preserve tile texture layout in cooked builds":
    { note: "Cooked tilemaps keep the images their tile grids expect." },
  "fix(editor): refresh open tileset atlases after disk edits":
    { note: "Open tile palettes and the Tileset Editor refresh when their atlas image changes on disk." },
  "fix(editor): use declared tileset rows for atlas editing":
    { note: "Tileset editing uses the same tile IDs as painting and play." },
  "fix(tilemap): keep tileset metadata inside its tile IDs":
    { note: "Tilesets keep their own collision, properties, and animation." },
  "fix(editor): keep tileset terrain mode controls aligned":
    { note: "The Tileset Terrain inspector keeps its mode dropdown, name and Delete button on one row." },
  "perf(ecs): reuse leaf lookups for missing animation targets":
    { note: "2D and 3D animations skip repeated hierarchy reads for missing sockets." },
  "fix(editor): return toolbar dropdown focus to its trigger":
    { note: "Toolbar dropdowns return keyboard focus to their button on Escape or selection." },
  "fix(project): ship consistent toolbar dropdown focus":
    { note: "Toolbar dropdowns return keyboard focus to their button on Escape or selection." },
  "fix(editor): retain toolbar menu focus through live option updates":
    { note: "Toolbar dropdowns keep keyboard focus visible as their choices change." },
  "fix(editor): rank transparent built-in UI behind visible geometry":
    { note: "Selection respects UI opacity." },
  "fix(editor): write a tree model again, and say why a terrain or rules edit was refused":
    { note: "A tree model can be written again, and a refused terrain edit says why." },
  "perf(ui): cache the set of controls missing interaction state":
    { note: "UI interaction avoids rescanning initialized controls when unrelated scene entities come and go." },
  "feat(ui): add UIMeter, a meter whose ghost shows how much a blow took":
    { note: "A UIMeter shows how much a blow took." },
  "fix(editor): share scene selection priority between Edit and Play":
    { note: "Layout containers no longer take priority over visible objects." },
  "feat(ui): fade what a UIMask holds in from its edges with UIMask.softness":
    { note: "A UI mask can fade its content at its edges instead of cutting it." },
  "feat(ui): fade a material's own shader under a soft UIMask":
    { note: "A UI mask can fade its content at its edges instead of cutting it." },
  "fix(editor): respect each UI viewport during selection":
    { note: "UI selection follows the viewport that drew it." },
  "fix(world): reject competing streamed world declarations":
    { note: "Play and export report competing StreamedWorld declarations." },
  "fix(world): validate manifests before changing residency":
    { note: "A malformed streaming manifest leaves the active world loaded." },
  "fix(sdk): let Velocity move kinematic bodies and leave every dynamic one to its solver":
    { note: "Velocity now moves 2D and 3D bodies the same way: kinematic and static bodies follow it, dynamic ones are left to physics." },
  "fix(editor): keep world picking inside the drawn viewport":
    { note: "World selection respects preview gutters." },
  "perf(editor): scan projected marquee bounds once":
    { note: "Marquee bounds in large scenes." },
  "fix(editor): clip viewport selection bounds to the drawn camera":
    { note: "Viewport selection follows the camera’s depth range." },
  "fix(editor): test marquee selection against projected outlines":
    { note: "Marquee selection follows projected outlines." },
  "fix(picking): share visible bounds between ray and area picks":
    { note: "Marquee selection follows the same world visibility rules as clicking." },
  "fix(editor): apply click visibility rules to viewport marquee selection":
    { note: "Marquee selection follows the same world visibility rules as clicking." },
  "fix(picking): honor the presented camera sorting-layer mask":
    { note: "Viewport clicks respect the camera's sorting-layer mask." },
  "fix(editor): pick world geometry through the presented camera mask":
    { note: "Viewport clicks respect the camera's sorting-layer mask." },
  "fix(picking): use visible renderer geometry for world clicks":
    { note: "Hidden renderer components no longer intercept viewport clicks." },
  "fix(editor): keep drawn icons pickable on hidden renderers":
    { note: "Hidden renderer components no longer intercept viewport clicks." },
  "fix(editor): inherit viewport visibility from source parent links":
    { note: "The Outliner eye hides the same descendants live and after reopening a scene." },
  "fix(project): ship consistent viewport hierarchy visibility":
    { note: "The Outliner eye hides the same descendants live and after reopening a scene." },
  "perf(editor): reuse shared corner samples while painting Wang terrain":
    { note: "Wang terrain strokes do less work per painted cell." },
  "fix(ui): stop a wheel batch when input is cancelled":
    { note: "Cancelling input stops queued UI scrolling immediately." },
  "fix(ui): route positioned wheel events to their own scroll targets":
    { note: "Wheel gestures reach the controls where they occurred." },
  "fix(ui): keep fractional wheel input on its intended route":
    { note: "Fractional wheel input stays on its intended route." },
  "perf(ui): reuse wheel picks while the scroll offset holds":
    { note: "Repeated wheel events at a scroll limit do less hit-testing." },
  "fix(editor): keep long picker highlights visible after layout changes":
    { note: "Long searchable pickers keep the keyboard highlight in view when rows are measured or the list resizes." },
  "fix(world): compose cell bounds from affine transforms":
    { note: "Streamed cells cover children under rotated, non-uniformly scaled ancestors." },
  "fix(world): preserve canonical hierarchy and texture settings in cell documents":
    { note: "Streamed scene documents keep their hierarchy and texture settings." },
  "fix(export): reject streamed scene name conflicts":
    { note: "Export catches streaming scene name conflicts before writing world files." },
  "perf(picking): keep only the nearest opaque hit for first-hit ray queries":
    { note: "Faster first-hit picking in deep scenes." },
  "perf(editor): use first-hit rays for viewport hover and Play selection":
    { note: "Faster first-hit picking in deep scenes." },
  "fix(world): restore streamed deletions through authored parent links":
    { note: "Deleted streamed entities stay gone when their cell reloads." },
  "perf(editor): index world panel cell residency":
    { note: "The editor's World panel responds faster in worlds with many cells." },
  "fix(editor): refresh world diagnostics when cell placement or references change":
    { note: "The World panel updates partition errors as you edit." },
  "perf(world): assemble streamed scene documents in one pass":
    { note: "Large streamed 2D and 3D worlds partition faster while preserving scene order." },
  "fix(world): apply prefab instance transforms before cutting cells":
    { note: "Streamed world cells follow prefab instance transforms." },
  "fix(world): honor persistent markers on prefab roots":
    { note: "Prefab roots marked WorldPersistent stay loaded." },
  "fix(world): resolve effective prefab roots before cutting cells":
    { note: "Streamed worlds can place prefab variants using inherited and overridden root positions." },
  "perf(editor): reuse indexed world preview residency":
    { note: "Large streamed worlds take less editor CPU time to show residency during Play." },
  "perf(world): sort load and prefetch candidates together":
    { note: "World streaming sorts its queues once per update." },
  "perf(world): share the near and far residency bounds pass":
    { note: "Large streamed worlds check distant cells once per residency update." },
  "perf(world): skip exact distances to out-of-range residency sources":
    { note: "World streaming spends less time comparing distant sources." },
  "fix(editor): fit World Rules dropdowns in narrow docks":
    { note: "World Rules dropdowns have room for their labels in narrow docks." },
  "perf(world): track occupied streaming slots on residency changes":
    { note: "World streaming spends less CPU time scheduling a large queue of cells." },
  "fix(world): finish discarding before preparing a cell again":
    { note: "A world cell requested while its prefetch is being discarded prepares again before publication." },
  "fix(world): stop superseded residency reconciliations":
    { note: "World streaming honors the newest source positions when a host callback triggers another update." },
  "fix(world): honor zero far distance and clear proxy failures":
    { note: "A far proxy distance of zero turns off proxies in Play and exports." },
};
