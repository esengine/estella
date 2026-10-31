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
  'feat(cocos): a document the creator edited moves from the layer Cocos.Widget to the engine RectAnchors on re-import':
    {"note":"Edited Cocos documents move to RectAnchors."},
  'feat(ui): RectAnchors pins world content to its parent rectangle or the screen in the engine, and the Cocos Widget is a view on it':
    {"note":"RectAnchors: world content that follows its parent."},
  'feat(cocos): a converted project keeps the Cocos fit width of its design, and cc.profiler exists in the compatibility layer':
    {"note":"A converted Cocos project fits the screen as the game does."},
  'fix(cocos): a renderer is put in the layer of its Cocos node, so a UI camera that culls by layer draws it':
    {"note":"A Cocos node layer is its renderers layer."},
  'feat(cocos): a converted project starts at the game launch scene and runs its global-defining scripts first, reads the editor built-in assets, and the layer components survive a replay':
    {"note":"A converted Cocos project starts as the game does."},
  'feat(cocos): the colour a script sets on a material instance is the renderer tint':
    {"note":"A material colour is the renderer tint."},
  'feat(cocos): MeshRenderer, UIMeshRenderer, material properties and cc.geometry in the compatibility layer':
    {"note":"Mesh renderers and materials in the Cocos layer."},
  'feat(cocos): cc.js, ccenum and NodePool exist in the compatibility layer':
    {"note":"More of `cc`."},
  'feat(bundle): the project script bundle is built again only when a file it read changed, and Cocos scripts that write the same class name each get a component of their own':
    {"note":"The script bundle is not rebuilt for nothing."},
  'fix(editor): opening a large project no longer spends seconds on strings that cannot be paths, a model texture the project lacks is left off instead of dangling, and an unlit mesh variant with tangents links':
    {"note":"Large projects open faster."},
  'feat(cocos): one script that fails to load no longer takes the others with it, a part of cc the layer lacks is a stand-in that survives use, and Director, AssetManager.Cache and the input dispatcher hook exist':
    {"note":"Cocos scripts load one by one."},
  'feat(cocos): a converted project links its source images instead of copying them, so conversion does not store a multi-gigabyte art folder twice':
    {"note":"A converted Cocos project links its images."},
  'feat(cocos): the importer reports its progress by stage, so a long conversion can show a bar':
    {"note":"A Cocos conversion shows its progress."},
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
    {"note":"Re-import a Cocos project without losing your edits."},
  'feat(editor): opening a Cocos Creator folder converts it into an Estella project beside it and opens that':
    {"note":"Open a Cocos Creator project from the editor."},
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
    {"note":"Cocos scripts drive scenes as the game does."},
  "fix(cocos): getComponent finds a component by a base class it derives from, so a handler bound through the Button of a Toggle's node reaches it":
    {"note":"Cocos scripts drive scenes as the game does."},
  "feat(ui): TextInput stands on a world rectangle as well as a UI node, and a Cocos EditBox becomes it: the importer folds the two labels into the field and the layer's EditBox is a view on it":
    {"note":"A text field can stand in the world."},
  "fix(ui): a pointer lands on what is drawn last by its place in the hierarchy, not on what was made last; a Toggle belongs to the container its parent holds and assigning isChecked switches its group's others off":
    {"note":"A pointer lands on what is drawn on top."},
  "fix(cocos): a Label takes a game's replaced string setter (the engine's _string and friends land on the Text), and an EditBox shows its text label while it holds text":
    {"note":"Converted Cocos UI looks as it does in Cocos."},
  "fix(cocos): a play session that follows another in the same script runtime gets the layer's systems again and none of what the last one loaded":
    {"note":"Cocos scripts drive scenes as the game does."},
  "fix(cocos): a Label with no overflow rule does not wrap and is laid out from its anchor, as the node grows to the text in Cocos":
    {"note":"Converted Cocos UI looks as it does in Cocos."},
  "feat(render): layers painted in hierarchy order, so a panel covers the text of the panel under it; the Cocos UI layer uses it. Text takes an underline field; resources.load finds an image's spriteFrame and texture by path suffix":
    {"note":"A layer can be painted in hierarchy order."},
  "fix(cocos): a node's scripts load and enable as it joins an active parent or is switched, not a frame later; a converted script component's dropped fields are ignored quietly":
    {"note":"Cocos scripts drive scenes as the game does."},
  "feat(cocos): resources.load gives images, sprite frames and audio by path, Sprite takes a spriteFrame, Node has getParent; the script entry leaves out the editor's own scripts":
    {"note":"Cocos scripts load assets by path."},
  "feat(cocos): the generated script entry loads every component class of the project, since a game opens its views by class name":
    {"note":"A converted project's scripts are components the editor knows."},
  "fix(cocos): the session check also runs when a prefab is asked for":
    {"note":"Cocos scripts drive scenes as the game does."},
  "fix(cocos): the layer drops what it kept of a session when the asset loader gives everything back":
    {"note":"Cocos scripts drive scenes as the game does."},
  "fix(cocos): a loaded asset is named for its file, and what the layer kept of a play session is dropped when the next begins":
    {"note":"Cocos scripts load assets by path."},
  "fix(cocos): a directory load leaves out what the layer cannot load instead of failing, and Component.EventHandler exists":
    {"note":"Cocos scripts load assets by path."},
  "feat(assets): a scan reports how many documents it has read of how many":
    {"note":"The loading screens say how far they are."},
  "perf(assets): a scan keeps what each document refers to by what the file was, so a second scan of a large project reads nothing it has read; fix(cocos): a component is found by its cc. name and can be named by a script":
    {"note":"A second scan of a large project reads nothing it has already read."},
  "feat(shaders): the canonical vertex stage hands a mesh second uv set to a material, and a converted effect is one shader per macro combination, compiled and given its WGSL twin before it is written":
    {"note":"A material can read a mesh's second uv set."},
  "feat(shaders): a material vertex hook gets a derived WGSL twin, and an effect that displaces its vertices is converted with the displacement as that hook":
    {"note":"A Cocos project's own effects are converted."},
  "feat(cocos): a particle effect is converted on the engine particle stage, and a particle takes the converted material":
    {"note":"A Cocos project's own effects are converted."},
  "fix(cocos): the sprite texture is no parameter of a converted material, and a material blend state it does not set is the effect's":
    {"note":"A Cocos project's own effects are converted."},
  "feat(cocos): an effect includes its chunks and its vertex program is carried into the fragment, so the project materials convert for meshes as well as sprites":
    {"note":"A Cocos project's own effects are converted."},
  "feat(cocos): a project's own effect is converted to an Estella shader and material, so a sprite or mesh that wore it keeps its look":
    {"note":"A Cocos project's own effects are converted."},
  "feat(cocos): a sprite, a label and a graphics are UIRenderers, which accept the rebuild requests scripts send":
    {"note":"Cocos scripts drive scenes as the game does."},
  "feat(cocos): the importer records its revision, so a project it wrote earlier is re-imported on open":
    {"note":"A converted Cocos project is brought up to date when it is opened."},
  "feat(cocos): director has a scheduler and fires its frame events, setSiblingIndex reorders through the engine entity order, loadAny takes a uuid, and an asset counts its holders":
    {"note":"Cocos scripts drive scenes as the game does."},
  "feat(cocos): a root pinned to the screen is stored where the engine places it in the design box, so the document and the viewport agree":
    {"note":"Converted Cocos UI looks as it does in Cocos."},
  "refactor(ui): the engine anchors run in two ordered passes and the Cocos Layout is a system between them, so alignment has one owner instead of a second hand-called copy":
    {"note":"Converted Cocos UI looks as it does in Cocos."},
  "feat(cocos): the project design resolution is known to scripts before they run, assetManager has a downloader and factory, and a node made between frames joins the running world":
    {"note":"Cocos scripts drive scenes as the game does."},
  "feat(cocos): a converted project declares its script components for the editor and starts from the scripts, and the Cocos scripts bundle past the gaps Cocos tolerates (missing cc names, reassigned const, package files outside exports, preview-only imports)":
    {"note":"A converted project's scripts are components the editor knows."},
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
    {"note":"Converted Cocos UI looks as it does in Cocos."},
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
    {"note":"Converted Cocos UI looks as it does in Cocos."},
  "feat(2d): a generated world on the screen plane, laid out by the worldgen rules and published in chunks":
    {"note":"A generated 2D world."},
  "fix(art): reject Qinglan face study after visual review":
    {"internal":"Source art studies kept in the repository's art/ folder; no part of the engine, the editor or a build reads or ships them."},
  "fix(import): Cocos enums as the engine's numbers, bitmapfont meta so the page ships, and the engine's own component validation in the test":
    {"note":"Converted Cocos UI looks as it does in Cocos."},
  "feat(2d): 2D shadows have eight channels and reach the tiled lights past the loop's sixteen":
    {"note":"More 2D lights cast shadows at once."},
  "feat(art): add editable Qinglan face cage study":
    {"internal":"Source art studies kept in the repository's art/ folder; no part of the engine, the editor or a build reads or ships them."},
  "feat(pipeline): import a Cocos Creator 3.x project as Estella prefabs and scenes, without touching the source":
    {"note":"Open a Cocos Creator project from the editor."},
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
    {"note":"Re-import a Cocos project without losing your edits."},
  "feat(editor): a selection draws nothing over the running game unless Inspect is on; a new one shows where it is for a moment":
    {"note":"A selection stays off the running game unless Inspect is on."},
  "feat(editor): the engine step of the loading screen shows which step of the boot it is in":
    {"note":"The loading screens say how far they are."},
  "feat(editor): the loading screens say how far they are: one bar, a line per step with its count and time, and the time so far":
    {"note":"The loading screens say how far they are."},
  "feat(cocos): the import progress has a stage for checking the converted effects":
    {"note":"A Cocos project's own effects are converted."},
  "fix(editor): the status strip keeps each readout on one line and drops the long message and the least useful readouts when it is short of room":
    {"note":"The status strip fits a narrow window."},
  "feat(cocos): a project converted by an older importer is brought up to date when it is opened":
    {"note":"A converted Cocos project is brought up to date when it is opened."},
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
    {"note":"A converted project's scripts are components the editor knows."},
  "fix(cocos): the conversion progress window carries the editor icon, has no scrollbar, and speaks the editor language":
    {"note":"A Cocos conversion shows its progress."},
  "feat(cocos): converting a Cocos project runs on a thread of its own with a progress bar, so the editor no longer looks hung":
    {"note":"A Cocos conversion shows its progress."},
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
    {"note":"Cocos scripts drive scenes as the game does."},
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
};
