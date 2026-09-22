// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  goldenProjects.mjs — the certification corpus, as a registry.
 *
 * Every stage verifier already exists and every one picked its own corpus:
 * editor-checks builds synthetic fixtures, verify-native-boot takes all 42
 * examples, verify-desktop-render takes one. So no single project was ever
 * carried from the editor through a package and back, and the seams between
 * stages are exactly where the shipping bugs live — configuration lost at
 * package time, input never wired to the host, export defaults wrong.
 *
 * A golden entry names a project that must survive the WHOLE chain, what it
 * certifies, and which tier pays for it. The gate over this file
 * (check-golden.mjs) refuses a capability nobody covers unless the gap is
 * declared here in the open.
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(ROOT, 'examples');

/** Cheapest tier a project runs at; each tier also runs everything cheaper. */
export const TIERS = ['pr', 'nightly', 'release'];

/** Export targets a golden project can be asked to package + launch for. */
export const TARGETS = ['web', 'playable', 'desktop', 'wechat', 'douyin', 'android', 'ios'];

/**
 * How far a packaged frame may sit from the editor's frame of the same game.
 * Measured: the same game scores ~0.01 and two different games 0.37–0.48, so
 * this sits an order of magnitude below anything that is actually a difference.
 */
export const DEFAULT_PARITY = 0.06;

/**
 * How much the most-changed region must move for input to count as having
 * reached the game. Measured: two undriven runs of one package differ by 0.04
 * and a driven one by 0.38, so this sits between them with room on both sides.
 */
export const DEFAULT_RESPONDS = 0.15;

/**
 * The authored, textual formats a capability claim can be found in — what
 * `projectText` opens. A reader that opens SOME of a project still answers about
 * all of it, so a capability authored in an unread format reads as absent.
 */
export const EVIDENCE_FORMATS = [
  '.ts', '.esproject', '.esscene', '.esprefab',
  '.esanimator', '.estimeline', '.esanim', '.esavatar',
  '.esmaterial', '.esshader', '.esenv',
  '.estileset', '.tmj', '.eslocale', '.esbt', '.esgraph', '.inputmap',
  '.json',
];

/**
 * Every other extension a golden project may hold, and why it carries no claim.
 * An extension in neither list fails: a format nobody classified is one the
 * reader is silently not reading.
 */
export const NOT_EVIDENCE_FORMATS = {
  '.meta': 'import settings for the file beside it; the asset is the claim, not its import row',
  '.md': 'prose about the project, not the project',
  '.mjs': 'the project\'s own tooling — engine-gaps ledgers and helpers',
  '.gitignore': 'version control, not content',
  '.png': 'a texture; what USES it is authored elsewhere',
  '.ktx2': 'a compressed texture; same',
  '.hdr': 'an environment map; the .esenv referencing it is the claim',
  '.gltf': 'an imported model; the .esmesh and prefab it produced are the claim',
  '.esmesh': 'the import result, not an authored file — regenerated from the .gltf',
  '.esprobes': 'a bake result; the LightProbeVolume naming it is the claim',
  '.atlas': 'a Spine atlas, written by Spine',
  '.skel': 'a Spine skeleton, written by Spine',
  '.mp4': 'video content',
  '.wav': 'audio content',
};

/**
 * The release the shipped-feature census reaches back to. Older releases are out
 * of its scope BY DECLARATION rather than by silence, and the gate says so.
 */
export const CENSUS_FLOOR = '0.60.0';

/**
 * Every shipped feature at or after {@link CENSUS_FLOOR}, classified: key names
 * one release-note headline, value the capability a project must carry or why
 * none can. A feature missing from {@link CAPABILITIES} reads exactly like one
 * that does not exist, and release notes are a different act. Theirs is ungated.
 */
export const SHIPPED = {
  // — 0.70.0 —
  'A project can be exported as a Douyin (抖音) mini-game.': { certifies: 'minigame-vendor' },
  'A sprite can be drawn whole even when its texture carries a 9-slice border.':
    { certifies: 'sprite-draw-mode' },
  'The start screen is yours: a logo, a background and a minimum display time.':
    { notCertifiable: 'the page AROUND the game — no golden project configures one, and'
      + ' launch-export already refuses any web package whose start screen never faded' },
  'A packaged game now says it is loading.':
    { notCertifiable: 'as above: the page around the game, held by the launcher rather than'
      + ' by a frame the game drew' },
  'The build dialog states a platform\'s size caps before you package.':
    { notCertifiable: 'a number the dialog reads out of sizeBudget.ts before a package exists;'
      + ' nothing of it ships' },
  'Douyin is selectable in the build dialog and has its own texture Import Settings tab.':
    { notCertifiable: 'editor rows; what they produce is the Douyin package, which'
      + ' input-actions packages and boots at the release tier' },
  'A mini-game says how far along its boot is, not just that it is loading.':
    { notCertifiable: 'the HOST\'s indicator, which is the vendor\'s own overlay and never a'
      + ' frame of the game; the stand-in host records the last stage for the launcher' },
  'A UI node can keep clear of WeChat\'s capsule menu, which the safe area does not cover.':
    { notCertifiable: 'it moves a node only on a host that draws a capsule, and the stand-in'
      + ' host the mini-game pairs run in draws none' },
  'A WeChat mini-game now carries only the optional subsystems its project uses.':
    { notCertifiable: 'a byte count no frame shows — a package that dropped a subsystem its'
      + ' content uses fails the wechat pairs\' pixel parity, which is where it is caught' },
  'The engine can ship outside a WeChat mini-game\'s main package entirely.':
    { certifies: 'subpackage' },
  'A WeChat mini-game can ship its engine compressed, freeing a third of the main package.':
    { notCertifiable: 'as above — bytes, not pixels; the compressed package boots in the'
      + ' stand-in host and export-wechat holds the naming both halves agree on' },
  // — 0.69.0 —
  '`getResourceStats()` reports the memory kept to survive a lost GPU.':
    { notCertifiable: 'a byte count no frame shows; the resource census reads it as'
      + ' render.rm.retainedBytes and device-roundtrip-text holds it under a 64 KiB ceiling' },
  'Geometry edges are anti-aliased on WebGPU, which is every native build.':
    { notCertifiable: 'multisampling is the backend\'s, and a golden pair reads editor-against-package'
      + ' agreement — two matching HARD edges would pass it; aa-edge and aa-edge-post read the soft'
      + ' values, and both backends now read the same ones' },
  'The build size report says why a file is in your package, and what changed since the last build.':
    { notCertifiable: 'a description of the package written beside it — no byte of it ships;'
      + ' the cook tests hold the attribution chain and the two-build comparison' },
  'A build the preflight objects to can be packaged anyway.':
    { notCertifiable: 'the door a build is started through, not what a build contains; the'
      + ' project-health editor check refuses a broken project and then answers the refusal' },
  'The editor\'s faintest label colour is readable.':
    { notCertifiable: 'the editor\'s own text colour, which no package renders; check-theme holds the'
      + ' whole --text ramp to 4.5:1 on the surfaces text sits on' },
  'The build size chart\'s video slice stops shouting.':
    { notCertifiable: 'a panel colour in the editor reading a build, never a byte in one;'
      + ' check-theme holds the label ramp quieter than the viewport\'s' },
  // — 0.68.0 —
  'Gameplay you can draw.': { certifies: 'script-graph' },
  'A graph can call another graph.': { certifies: 'script-graph' },
  'A graph can change the scene.': { certifies: 'script-graph' },
  'A scene can hold a thousand of something again.':
    { notCertifiable: 'a draw-call count: a merged run draws the picture separate draws did, so no'
      + ' package frame can show it; the per-instance irradiance it carries reaches the picture as'
      + ' light-probe, and the mesh-instancing editor check counts the draws' },
  'What a shiny thing reflects indoors is the room, not the sky.': { certifies: 'reflection-probe' },
  'The bake\'s ray tracer walked its own tree wrong.': { certifies: 'lightmap' },
  'A material-shaded surface shaded itself at z = 0.': { certifies: 'reflection-probe' },
  'A wall can stop a frame from drawing what is behind it.': { certifies: 'occlusion-culling' },
  'Decals you can place.': { certifies: 'decal' },
  'A decal\'s geometry, cut.': { certifies: 'decal' },
  'A surface can say it goes ON another one.': { certifies: 'decal' },
  'A scatter brush.':
    { notCertifiable: 'an editor tool whose product is ordinary entities — a package carries the'
      + ' copies, never the brush; the scatter-scale editor check opens, walks and saves 8000 of them' },
  'A mesh has somewhere to put its own vertex attributes.':
    { notCertifiable: 'where the per-object record is stored: every 3D package draws through it, so'
      + ' a project certifying it would certify drawing at all; both render verify tiers and'
      + ' check-mesh-instance-record hold the layout and the free slots' },
  'Automation can read what a frame cost.':
    { notCertifiable: 'a probe for automation, not a behaviour a player meets; the frame-cost'
      + ' readers in the verifiers are its consumers' },
  'A sound anything authored can start.': { certifies: 'authored-sound' },

  // — 0.67.0 —
  'A mesh can be read through the light that was baked into it.': { certifies: 'lightmap' },
  'The bake itself: lights become an atlas.': { certifies: 'lightmap' },
  'A bounce carries the colour of what it came off.': { certifies: 'lightmap' },
  'Stock geometry takes a bake, and the density suits this engine\'s units.':
    { certifies: 'lightmap' },
  'A room in the corpus is actually lit.': { certifies: 'lightmap' },
  'Light probes: what lights a thing a bake cannot hold still.': { certifies: 'light-probe' },
  'A bake now solves the probes too, and refuses to light what moves.':
    { certifies: 'light-probe' },
  'A model can be given somewhere to receive baked light.':
    { notCertifiable: 'the import setting that writes a second UV set into an .esmesh; the one'
      + ' scene that ships baked is built from stock geometry, whose UVs a bake derives per run,'
      + ' so no package carries an IMPORTED unwrap. unwrap.test.ts holds the layout, and'
      + ' check-import-settings holds that the setting has a reader' },
  'Bake Lighting.':
    { notCertifiable: 'the editor command that triggers a bake — a package carries the atlas,'
      + ' never the menu item that wrote it, and that atlas is certified as lightmap. The'
      + ' end-to-end editor check bakes a real scene and reads the saved document back' },
  'A scene says how it is lit, and whether its light still describes it.':
    { notCertifiable: 'a bake\'s INPUTS and whether they still match: the knobs change nothing a'
      + ' package draws, and staleness is a question only the editor asks. What ships is the'
      + ' light itself, certified as lightmap and light-probe, and the corpus-bake gate holds'
      + ' the committed atlas against a fresh bake so a stale one cannot pass as correct' },

  // — 0.66.0 —
  'A model brings the shapes it can be blended towards.': { certifies: 'morph-target' },
  'A controller is a stack of machines, not one.': { certifies: 'animation-layers' },
  'A layer writes the part of the rig it was given.': { certifies: 'animation-layers' },
  'The third-person rig runs and swings at the same time.': { certifies: 'animation-layers' },
  'A blend mixes its neighbours instead of picking one.': { certifies: 'animation-blend' },
  'A blend over a plane.': { certifies: 'animation-blend-2d' },
  'A clip means the same thing on a rig bound differently.': { certifies: 'animation-retarget' },
  'One clip drives rigs that do not share its bone names.': { certifies: 'animation-retarget' },
  'The posed skeleton can be made to reach something.': { certifies: 'animation-ik' },
  'A blend is something an author can make.':
    { notCertifiable: 'the editor\'s motion picker — a game ships the blend, never the panel that'
      + ' made it, and what the panel produces is certified as animation-blend. The animator'
      + ' editor checks drive this door against a real editor' },
  'A step of gameplay nobody has seen yet, and can take it back':
    { notCertifiable: 'a scope a GAME opens around its own mutation: nothing is left behind when'
      + ' it is abandoned, so a package that used it would look exactly like one that did not.'
      + ' Held by the speculation clauses, which check all three ways a step leaks' },
  'A step can be asked whether it is a function of the world.':
    { notCertifiable: 'a question asked in a test, and both runs are taken back — a game that'
      + ' asks it plays the same as one that does not. multiplayer-arena\'s applyMove is'
      + ' module-local game code, so a game holds its own rule from its own test' },

  // — 0.65.0 —
  'A spatial source you can hear in the audio demo.': { certifies: 'audio' },
  'A ScrollView scrolls where the editor drops it.': { certifies: 'ui-widgets' },
  'The UI controls demo authors its widgets instead of building them.': { certifies: 'ui-widgets' },
  'A 3D body is the shape its collider names.': { certifies: 'physics-3d' },
  'Every 3D collider shape and joint, authored in a scene.': { certifies: 'physics-3d' },
  'Every 2D collider shape and joint, authored in a scene.': { certifies: 'physics' },
  'A sorting group in the sprite demo.': { certifies: 'sprite-sorting' },
  'Six components a shipped scene now authors.': { certifies: 'sprite-mask' },
  'The starfield drifts by `Velocity`.': { certifies: 'velocity-motion' },
  'A spatial source\'s reach is drawn.':
    { notCertifiable: 'a shape in the EDITOR viewport — a game draws no gizmos, so no package'
      + ' can show it; check-gizmo-coverage holds that the extent is drawn at all and'
      + ' gizmo-chrome measures the ink in a real editor' },
  'The outliner switches an entity off.':
    { notCertifiable: 'an editor panel over the tag; what the tag DOES is the entry below,'
      + ' and the entity-disable check drives this door end to end' },
  'A disabled entity is actually skipped.':
    { notCertifiable: 'no certified project switches anything off — the one scene that does is'
      + ' enemy-ai-3d, which is not one. Held by sdk/tests/disabled-entities.test.ts and the'
      + ' entity-disable editor check, which watches a query answer without the subtree' },
  'A joint\'s anchors say whose body they are on.':
    { notCertifiable: 'Inspector prose over fields a package already carries; what the anchors'
      + ' place is certified as physics and physics-3d' },
  'A bitmap font is an asset the editor knows.':
    { notCertifiable: 'an editor type, and the corpus\'s only bitmap font is the pixel-RPG'
      + ' TEMPLATE\'s — a template is not a certified project. check-asset-vocabulary holds the'
      + ' type against what an import writes' },
  'A build keeps the page a bitmap font names.':
    { notCertifiable: 'as above: the font that proves it lives in a template, so no certified'
      + ' package carries one. pipeline/tests/document-ref-cook-deps.test.ts holds the edge' },

  // — 0.64.0 —
  'A 2D light can take the shape of a texture': { certifies: 'lighting-2d' },
  'A 2D light can be shaped, and its shadows can be less than total': { certifies: 'lighting-2d' },
  'A sprite states where it sits inside its sorting layer': { certifies: 'sprite-sorting' },
  'A subtree can sort as one unit': { certifies: 'sprite-sorting' },
  'A sprite can be cut by another sprite\'s shape': { certifies: 'sprite-mask' },
  'A polygon collider takes any ring, concave and unbounded': { certifies: 'physics' },
  'An `.aseprite` file imports':
    { notCertifiable: 'an import act: a package holds the sheet and the clips it produced and'
      + ' never the .aseprite, so what a game can show is animation — the format itself is held'
      + ' by pipeline/tests/aseprite-import.test.ts and the editor\'s aseprite-import check' },
  'A `.psd` file imports':
    { notCertifiable: 'the same shape: a package holds the PNGs and the prefab the import wrote,'
      + ' never the .psd; the layer stack is held by the pipeline tests and the editor check' },
  'A polygon collider can take the sprite\'s own silhouette':
    { notCertifiable: 'an EDITOR act — the ring it writes is an ordinary collider, certified as'
      + ' physics; the trace itself is held by alpha-outline.test.ts and the collider-trace check' },
  'A texture\'s geometry is one picture':
    { notCertifiable: 'an Inspector surface over metadata a package already carries; what it'
      + ' authors (9-slice borders, sheet cells) is drawn by the sprite capabilities above' },

  // — 0.63.0 —
  'One number turns the sky, the irradiance and the reflection': { certifies: 'environment' },
  'A second UV set survives the import boundary':
    { notCertifiable: 'the channel a lightmap is read through. It has a reader now — the bake —'
      + ' but the one scene that ships baked is built from stock geometry, whose UVs a bake'
      + ' derives per run, so no package carries an IMPORTED unwrap; check-mesh-vocabulary holds'
      + ' the two halves of the format and the .esmesh decode fixtures hold the bytes' },
  'The camera a frame was drawn with is a value anyone can hold':
    { notCertifiable: 'a publication the renderer makes for overlay authors; a game draws from the'
      + ' resolve directly and never asks which camera a past frame used' },
  'A commit says when the camera CHANGED':
    { notCertifiable: 'the same publication\'s change signal, consumed by the editor overlay;'
      + ' camera-commit.test.ts asserts the divergence a game cannot see' },
  'A renderer-owned geometric overlay':
    { notCertifiable: 'the EDITOR\'s overlay geometry, drawn by the engine for it; a package has no'
      + ' gizmos, and the editor checks plus profile_frames are what hold it' },
  'A capture carries the brackets inside a phase':
    { notCertifiable: 'a shape inside a profile capture, read by profile_frames; a game pays the'
      + ' same time whichever bracket is named' },
  'A volume\'s effects are an authored field':
    { notCertifiable: 'an Inspector door onto effects the runtime already had; what a volume DOES'
      + ' is certified by ssao, and the editor suite owns the authoring' },
  'Go to Anything':
    { notCertifiable: 'an editor palette; the editor suite owns it' },
  'Third Person Character is something you can ask for':
    { notCertifiable: 'a Create-menu entry; the composition it produces is exactly what'
      + ' third-person certifies, and asking for it is an editor act' },
  'Every open document reconciles a change made on disk':
    { notCertifiable: 'open editor documents against a watcher; a package opens no document' },
  'A build belongs to the editor':
    { notCertifiable: 'the lifetime of a package JOB, which exists only before a package does' },
  'A slow plugin says so where the plugins are listed':
    { notCertifiable: 'a projection of PerfMonitor into the editor\'s plugin list; a game loads no'
      + ' editor plugin' },
  'A health report says which moment it is a reading of':
    { notCertifiable: 'freshness of a verdict taken BEFORE a package exists; the editor check and'
      + ' check-project-health hold it' },
  'A drop target answers while the pointer is still down':
    { notCertifiable: 'a drag gesture inside the editor; a game has no drop targets' },
  'Every discrete camera intent travels':
    { notCertifiable: 'how the EDITOR\'s eye moves between poses; a game moves its own camera and'
      + ' the editor checks establish the poses they capture from' },

  // — 0.62.0 —
  'Play streams the world the way a package does': { certifies: 'world-streaming' },
  'World Workspace: the report says where its cells are':
    { notCertifiable: 'coordinates ON the residency report, read by the editor\'s World panel and'
      + ' by verify-world-residency; a game consumes the cells and never asks where they are' },
  'Readying is a named preparation phase':
    { notCertifiable: 'a phase name in the preparation interval, read by the residency bench;'
      + ' a game pays the cost either way and cannot tell which phase carried it' },
  'Workspace Continuity: a project reopens where it was left':
    { notCertifiable: 'an editor session across two processes; a package has no workspace,'
      + ' and desktop/scripts/editor-checks/workspace-continuity.mjs is the proof' },
  'Project Health / Preflight: whether a project can ship has one author':
    { notCertifiable: 'a verdict taken BEFORE a package exists; check-project-health and the'
      + ' editor check hold it, and a shipped game is what it permits rather than what it tests' },
  // — 0.61.0 —
  'World streaming': { certifies: 'world-streaming' },
  'Level of detail': { certifies: 'level-of-detail' },
  'An inventory of what the engine\'s runtime contract facts':
    { notCertifiable: 'an inventory OF contracts; check-contract-inventory reads it, and no game act exercises it' },
  'Two ways out of an animation': { certifies: ['animation-events', 'root-motion'] },
  'Emission asks the shape': { certifies: 'particles' },
  'Screen-space ambient occlusion': { certifies: 'ssao' },
  'The hitch when something first becomes visible': { certifies: 'shader-readiness' },
  'A mesh comes back after a device loss':
    { notCertifiable: 'a playthrough cannot lose the device; the device-loss harness is the proof' },
  'A texture\'s compression is two decisions':
    { notCertifiable: 'a cook/upload pair, read by check-texture-format; a game ships the result and cannot tell the two records apart' },
  'The shadow atlas and the light cap name who they turned away':
    { notCertifiable: 'a census of refusals, read by check-shadow-plan and check-light-cap' },
  'The post chain commits to one intermediate format':
    { notCertifiable: 'one format per frame, read by check-hdr-format' },
  'The built-in audio buses are declared once': { certifies: 'audio' },
  'A saved map says which encoding it was painted under': { certifies: 'tilemap' },
  'An event payload has a shape': { certifies: 'ecs' },
  'A game can state what its own run has reached':
    { notCertifiable: 'the playthrough seam every certification runs THROUGH, not a capability it certifies' },
  'The multiplayer example ships the server': { certifies: 'networking' },
  'The packaged native host answers the AOT conformance fixture':
    { notCertifiable: 'a conformance fixture across two hosts; no game content decides it' },
  'An inventory of the decisions the engine takes':
    { notCertifiable: 'an inventory OF decisions, read by check-decision-inventory' },

  // — 0.60.0 —
  'A sprite frame draws at its own size': { certifies: 'animation' },
  'A flipbook editor that reads in frames': { notCertifiable: 'an editor panel; the editor suite owns it' },
  'A spine skeleton nobody can see costs an advance': { certifies: 'spine' },
  'A spine frame that can say what it cost': { certifies: 'spine' },
  'A skeleton an editor can pose': { notCertifiable: 'an editor preview surface; the editor suite owns it' },
  'A hot update reaches what was built': { certifies: 'hot-update' },
  'A live binding follows the asset': { certifies: 'asset-lifecycle' },
  'A persistent entity owns what it carries out of its scene': { certifies: 'scene-transition' },
  'A ref-bound asset is owned as a slot': { certifies: 'asset-lifecycle' },
  'A render-graph pass can name a resource the graph must not bind':
    { notCertifiable: 'a graph authoring rule, read by check-frame-lifecycle' },
  'An offscreen preview is addressed by its handle':
    { notCertifiable: 'an editor preview surface; the editor suite owns it' },
};

/** Numeric compare of two `x.y.z` strings. */
function versionAtLeast(v, floor) {
  const a = v.split('.').map(Number);
  const b = floor.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/**
 * The shipped features the CHANGELOG names at or after the floor — the ground
 * {@link SHIPPED} is answerable against. Headlines only: a bullet leads with a
 * bolded sentence, and the prose under it is the same claim at length.
 */
export function shippedGround() {
  const text = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const out = [];
  let version = null;
  let inAdded = false;
  let bullet = null;
  const flush = () => {
    if (bullet === null) return;
    const head = /^-\s+\*\*(.+?)\*\*/s.exec(bullet.replace(/\n/g, ' '));
    if (head) out.push({ version, headline: head[1].replace(/\s+/g, ' ').trim() });
    bullet = null;
  };
  for (const line of text.split('\n')) {
    const release = /^## \[(\d+\.\d+\.\d+)\]/.exec(line);
    if (release) { flush(); version = release[1]; inAdded = false; continue; }
    if (/^## /.test(line)) { flush(); version = null; inAdded = false; continue; }
    if (/^### /.test(line)) { flush(); inAdded = /^### Added/.test(line); continue; }
    if (!inAdded || version === null || !versionAtLeast(version, CENSUS_FLOOR)) continue;
    if (/^- /.test(line)) { flush(); bullet = line; } else if (bullet !== null) { bullet += `\n${line}`; }
  }
  flush();
  return out;
}

/**
 * What the suite claims to cover. A capability here with no project behind it
 * is a hole in the release argument, so the gate fails on one that is not in
 * {@link KNOWN_GAPS}.
 */
export const CAPABILITIES = [
  'physics', 'input', 'animation', 'third-person',
  'ecs', 'particles', 'audio',
  'ui-layout', 'text', 'localization',
  'spine', 'material', 'asset-lifecycle',
  'model-import', 'model-animation', 'model-skinning',
  'physics-3d', 'mesh-shadow', 'environment', 'level-of-detail', 'world-streaming',
  'lightmap', 'light-probe', 'reflection-probe', 'decal', 'occlusion-culling',
  'lighting-2d',
  'sprite-sorting', 'sprite-mask', 'ui-widgets', 'velocity-motion',
  'ssao', 'navigation-3d', 'root-motion', 'animation-events', 'shader-readiness',
  'animation-layers', 'animation-ik', 'morph-target',
  'animation-blend', 'animation-blend-2d', 'animation-retarget',
  'tilemap', 'tile-collision',
  'touch', 'safe-area', 'pause-resume',
  'texture-atlas',
  'single-file', 'startup-size', 'minigame-vendor', 'sprite-draw-mode',
  'hot-update', 'rollback', 'subpackage',
  'networking',
  'persistence', 'save-versioning',
  'script-graph', 'authored-sound',
  // What a game needs and no sample carried end to end. Each holds a gap below
  // until the phase covering it lands, so the gate prints how much of a game the
  // corpus still cannot certify. See docs/REARCH_CELESTIAL_HEIGHTS.md.
  'navigation', 'behavior-tree', 'scene-transition', 'y-sort',
  'settings', 'controller', 'achievements', 'ui-inventory',
];

/**
 * What EXERCISING a capability looks like, as a pattern a project's sources or
 * scene data must match. Without one, `certifies` is a word nothing reads:
 * space-shooter certified `audio` with no sound in it and coverage passed.
 * `null` = the claim is about the PACKAGE, so no source could show it.
 */
export const EVIDENCE = {
  physics: /\b(RigidBody2D|BoxCollider2D|CircleCollider2D|CapsuleCollider2D|physics2dPlugin|CharacterController2D)\b/,
  input: /\b(Input|defineInputMap|isKeyDown|InputState)\b/,
  animation: /\b(SpriteAnimator|Animator|spriteAnim|Flipbook|TimelinePlayer|AnimClip)\b/,
  ecs: /\b(defineComponent|defineSystem)\b/,
  // The component that RUNS one. A `.esgraph` on disk that no scene
  // attaches is a picture of gameplay, not gameplay.
  'script-graph': /\bScriptGraphAgent\b/,
  'third-person': /\b(ThirdPersonController|ThirdPersonCamera)\b/,
  particles: /\bParticleEmitter\b/,
  'lighting-2d': /\b(Light2D|ShadowCaster2D)\b/,
  // A scene that STATES its draw order: the field, or the group that takes a
  // subtree's place in it. The optional quote matches a field set in a SCENE
  // (`"order": 0`) as well as one set in code.
  'sprite-sorting': /\border"?:\s*\d|\bSortingGroup\b/,
  'sprite-mask': /\bSpriteMask\b/,
  // The composite controls, as opposed to the boxes they are laid out in: a
  // scene that carries one has taken the editor's Create → UI path.
  'ui-widgets': /\b(UIToggle|UISlider|UIDropdown|UIDialog|UIScroll)\b/,
  // Motion with no physics body behind it. `\b` keeps `linearVelocity` out —
  // a body's own speed is physics, and this is the component that moves a
  // transform without one.
  'velocity-motion': /\bVelocity\b/,
  // Components OR the resource: audio-demo takes Res(Audio) and never inserts a
  // component, and a pattern that only knew the components read it as unused.
  audio: /\b(AudioSource|AudioListener|AudioAPI|audioPlugin)\b|Res\(Audio\)/,
  'ui-layout': /\b(UINode|Canvas|spawnUIEntity|FlexContainer)\b/,
  text: /\bText\b/,
  localization: /\b(Localization|i18nKey|setLocale)\b/,
  spine: /\bSpine(Animation)?\b/,
  material: /\b(Material|material)\b/,
  // The products, not the source: a .gltf in the project proves an import ran,
  // and a scene referencing an .esmesh proves the products are what it draws.
  'model-import': /\.esmesh\b/,
  // The clip the import wrote, referenced by the prefab the scene places.
  'model-animation': /\.estimeline\b/,
  'model-skinning': /\bMeshSkin\b/,
  // The COMPONENT, not the mesh: a `.esmesh` carrying shapes nothing is blended
  // towards is geometry with an unused section, and that is what an import of a
  // model whose targets nobody authored produces.
  'morph-target': /\bMeshMorph\b/,
  // A motion that MIXES rather than picks. The kind, not the word "blend": a
  // state named "Blend" proves nothing, and the kind is what the runtime reads.
  'animation-blend': /"kind"\s*:\s*"blend[12]d"/,
  'animation-blend-2d': /"kind"\s*:\s*"blend2d"/,
  // A RIG that needs translating, not a controller naming its own source: every
  // controller may carry the avatar its clips came from, so matching that alone
  // certifies a project retargeting nothing. `[^}]*` stays inside one component.
  'animation-retarget': /"controller"\s*:\s*"[^"]+\.esanimator"[^}]*"avatar"\s*:\s*"[^"]+\.esavatar"/,
  'physics-3d': /\b(RigidBody3D|CharacterController3D|BoxCollider3D|MeshCollider3D)\b/,
  'mesh-shadow': /\bmeshShadows\b/,
  'level-of-detail': /\bLODGroup\b/,
  // The declarations, not the streamer: a project EXERCISES residency by saying
  // its world is cut and by carrying something that asks for places.
  'world-streaming': /\b(StreamedWorld|WorldStreamingSource)\b/,
  environment: /\.esenv\b/,
  // The component that names a patch, not the atlas file beside the scene: a
  // scene carrying one draws light a bake wrote, so a bake that stops writing
  // changes the picture the suite compares.
  lightmap: /\bMeshLightmap\b/,
  'reflection-probe': /\bReflectionProbe\b/,
  // The projector a scene places; the cut geometry beside it is what it wrote.
  decal: /\bDecalProjector\b/,
  // The component, not the word: 2D light occluders share the name's tail.
  'occlusion-culling': /"type":\s*"Occluder"/,
  // The flag authored data raises, not the component: playOnAwake was the only door before.
  'authored-sound': /"type":\s*"AudioSource"[^}]*"playing"/,
  // The volume, which is where a MOVING thing takes its indirect light from —
  // the half of a bake no atlas can hold.
  'light-probe': /\bLightProbeVolume\b/,
  // The post effect a scene turns on, not the pass that implements it.
  ssao: /"type":\s*"ssao"/,
  'navigation-3d': /\b(NavVolume|NavLink|NavAgent3D)\b/,
  'root-motion': /\brootMotion\b/,
  // The MASK, not the layer list: a controller can carry an empty `layers` and
  // claim the stack, and what a stack is for is one machine reaching part of the
  // rig while another reaches the rest.
  'animation-layers': /"mask":\s*\{\s*"paths"/,
  // The constraint a controller declares, not the solver behind it.
  'animation-ik': /"kind":\s*"(two-bone|look-at)"/,
  // The authored track, not any key called events: the runtime always read them,
  // and what shipped is a format and an editor that can write them.
  'animation-events': /"type":\s*"customEvent"/,
  // Nothing in a project's text can show it: the claim is that the first visible
  // frame pays no compile, which only a run can settle. See NEEDS_RUN.
  'shader-readiness': null,
  'asset-lifecycle': /\b(Assets|loadGroup|releaseGroup|preload)\b/,
  tilemap: /\bTilemap(Layer)?\b/,
  'tile-collision': /\b(collision|Collider|tileCollision)\b/,
  touch: /\b(touches|touchesStarted|touchAvailable|GestureDetector)\b/,
  'safe-area': /\bSafeArea\b/,
  'pause-resume': /\b(setPaused|Time|scale|onSuspend)\b/,
  // The atlas directory is the evidence, and the `atlas` run block above already
  // reads it — a text pattern would only find the word.
  'texture-atlas': null,
  'single-file': null,
  'startup-size': null,
  // A package's, not a source's: the claim is that a second vendor's package
  // boots, which only the launched package can show.
  'minigame-vendor': null,
  // Where the engine binary SITS in the package, which no source mentions: the
  // `subpackage` block on input-actions is the claim, and the pair of launches
  // it drives (mounted, then refused) is what backs it.
  subpackage: null,
  'sprite-draw-mode': /\bdrawMode\b/,
  'hot-update': /\b(checkForUpdate|applyUpdate)\b/,
  rollback: /\b(applyUpdate|rollback)\b/,
  networking: /\b(Net|Replicated|NetId)\b/,
  persistence: /\b(SaveManager|Storage|SaveEnvelope)\b/,
  'save-versioning': /\b(SaveMigration|migrations)\b/,
  navigation: /\b(Nav|NavAgent|NavGrid|setNavDestination)\b/,
  'behavior-tree': /\b(BehaviorTreeAgent|behaviortree)\b|\.esbt\b/,
  'scene-transition': /\b(transitionTo|switchTo|SceneManager)\b/,
  'y-sort': /\bySortLayers\b/,
  settings: /\b(Storage|settings)\b/,
  controller: /\b(GamepadButton|GpButton|Stick|isGamepadConnected)\b/,
  achievements: /\bAchievements\b/,
  'ui-inventory': /\b(ListView|createListView|ArrayDataSource)\b/,
};

/**
 * Capabilities the corpus does NOT cover yet, each with the reason. Declared so
 * the hole is visible in the gate's output instead of being mistaken for
 * coverage — the same bargain check-project-settings strikes.
 */
export const KNOWN_GAPS = {
  // Present in the engine and shown by non-golden samples, but never carried
  // through the chain by a project the release argues from.
  settings: 'Celestial Heights persists language, effects and key bindings and reads them back at boot; volume waits on the game having sound',
  // hot-update-demo ships one now, so the package SHAPE is a real project's.
  // What no automated run reaches is the vendor mounting it: only a mini-game
  // host implements the download, and none of the tiers builds for one.
  'authored-sound': 'AudioSource.playing is what a graph, a behaviour or a wire raises, and audio-demo still starts its loop from code through Res(Audio) — no golden project sounds a clip from authored data yet; audio-source-flag.test.ts holds the contract',
};

/**
 * The corpus. `certifies` is the claim, `targets` the packages that must build
 * AND launch, `tier` the cheapest run that pays for it. Existing examples on
 * purpose — a parallel suite would be a second set of games to keep alive.
 *
 * `parity` overrides {@link DEFAULT_PARITY} for a game whose opening seconds
 * move too much to compare that tightly; `parityGap` opts out with a reason.
 * `interact` is the input a package must visibly answer; `interactGap` opts out.
 * A pointer target is a FRACTION of the surface and therefore tied to the layout
 * it was aimed at: when one moves, the check fails loudly and names both frames.
 */
export const GOLDEN = [
  {
    id: 'platformer',
    certifies: ['physics', 'input'],
    targets: ['web', 'desktop', 'android'],
    tier: 'pr',
    interact: { keys: ['ArrowRight'], frames: 40 },
    // A KTX2 that is not whole 4x4 blocks, on purpose, so ktx2_decode.cpp falls back
    // to RGBA32. What LOADS it is the native boot smoke (it packages every asset);
    // check-golden only holds the file to its odd size.
    oddSizedKtx2: 'assets/textures/block-guard.ktx2',
    // Two textured platforms and the sky behind them. Measured over three runs
    // and stable to the byte; the falling player is NOT, which is why it is not
    // here. A frame that lost its textures still spreads, and still fails these.
    // Every desktop OS must read the same values: the swapchain's sRGB-ness is
    // the engine's decision, not the driver's, and these are what says so.
    desktopPixels: [
      { x: 0.30, y: 0.35, rgb: [121, 76, 32], tol: 12 },
      { x: 0.70, y: 0.20, rgb: [121, 76, 32], tol: 12 },
      { x: 0.10, y: 0.10, rgb: [208, 244, 247], tol: 12 },
    ],
  },
  {
    id: 'space-shooter',
    // Its hull bar is a sprite cut by another sprite, drawn at an order it states
    // rather than at the one its position would give it — so the draw order and the
    // mask are both something a packaged game here actually does.
    certifies: ['ecs', 'texture-atlas', 'sprite-sorting', 'sprite-mask', 'velocity-motion', 'sprite-draw-mode'],
    targets: ['web', 'desktop', 'android'],
    tier: 'pr',
    interact: { keys: ['ArrowLeft'], frames: 40 },
    // Its small sprites live in a `<name>.atlas/` folder, so the cook packs them
    // into one page and the package samples frames the editor never sees. The
    // count is the claim: packing that quietly stops still passes parity.
    atlas: { packed: 7 },
  },
  {
    id: 'model-import',
    certifies: ['model-import', 'model-animation', 'morph-target'],
    // Desktop too: these claims are about the ENGINE, and the native runtime is
    // a second one. Certified only on web, an import that reaches no native
    // frame reads as covered right up until a device says otherwise.
    targets: ['web', 'desktop'],
    tier: 'pr',
    // Nothing in it responds to input: the scene is a placed model, and the
    // chain it certifies is the import's — products, refs, prefab, package.
    interactGap: 'a placed model has nothing to drive; the import chain is what this certifies',
    // Both colours of the model's own texture: an import that lost the texture, or
    // the model, leaves the clear colour here.
    webPixels: [
      { what: 'the model draws its texture', x: 0.19, y: 0.385, rgb: [212, 156, 75], tol: 24 },
      { what: 'and the texture\'s second colour', x: 0.40, y: 0.385, rgb: [58, 46, 40], tol: 24 },
    ],
  },
  {
    id: 'lighting-3d',
    certifies: ['model-skinning', 'mesh-shadow', 'environment'],
    // The shadow pass is the engine's, not the web build's, and it broke on the
    // native runtime while this claim was green: see launchTimeoutMs below for
    // what a map costs where there is no GPU, on either gate.
    targets: ['web', 'desktop'],
    tier: 'pr',
    // What a pixel scene proved and no packaged game carried: the model is skinned
    // by its import's own products, the sun casts it onto the panel behind it, and
    // the baked environment is what its metal reflects.
    interactGap: 'a lighting showcase has nothing to drive; what it certifies is what reaches the frame',
    // The only pr-tier project with a shadow pass, and a runner with no GPU
    // rasterises that 1024² map in software: its frames cost about a second each,
    // so the settle window has to be minutes rather than the 2D default.
    launchTimeoutMs: 180_000,
    // The pose is HELD rather than played, so a point means one thing rather than
    // one moment. Measured on the package; each was checked by breaking the
    // feature it is about and watching it, and only it, go.
    webPixels: [
      // Only the joints put the mesh here — with the skin gone it draws nowhere.
      { what: 'the skin places the mesh', x: 0.245, y: 0.31, rgb: [255, 255, 255], tol: 22 },
      { what: 'the mesh casts onto the panel', x: 0.515, y: 0.55, rgb: [64, 61, 61], tol: 22 },
      // Panel the sun still reaches, lit by the sun AND the environment: it is
      // this bright only because both are in the package.
      { what: 'sun and environment light the panel', x: 0.8, y: 0.5, rgb: [206, 195, 181], tol: 14 },
    ],
  },
  {
    id: 'lighting-2d',
    certifies: ['lighting-2d'],
    // The shadow is a pass of the engine's, not of the web build's: it renders a mask
    // and samples it back, and the two backends store the rows of a target the other
    // way up. A packaged game on the desktop runtime is the second backend.
    targets: ['web', 'desktop'],
    tier: 'pr',
    interactGap: 'the torch follows a pointer the runner does not have; what it certifies is that the pass survives the package',
    // The launcher moves no pointer, so the torch rests where the scene puts it.
    // Two cells one distance from it, past a block and in the open, differ only by
    // the shadow pass — whether it survives a package, not what a shadow looks like.
    webPixels: [
      { what: 'the torch lights the floor', x: 0.55, y: 0.42, rgb: [172, 165, 147], tol: 30 },
      { what: 'the open side is lit at that distance', x: 0.65, y: 0.42, rgb: [63, 61, 56], tol: 24 },
      { what: 'the block shadows its far side', x: 0.35, y: 0.42, rgb: [13, 14, 14], tol: 24 },
    ],
  },
  {
    id: 'physics-3d',
    // Also the only scene that ships its lighting baked: an atlas its surfaces
    // read and a volume its thirteen moving bodies take their indirect light
    // from. Both halves of a bake are in the picture the suite compares.
    certifies: ['physics-3d', 'lightmap', 'light-probe', 'reflection-probe', 'decal'],
    targets: ['web', 'desktop'],
    tier: 'nightly',
    // The character walks on the key it declares, and the debug overlay it draws
    // moves with it — the whole picture is the solver's, so a package that lost
    // the 3D world draws an empty room rather than a still one.
    interact: { keys: ['KeyW'], frames: 40 },
  },
  {
    id: 'character-rig',
    certifies: ['animation-ik', 'animation-retarget', 'animation-blend-2d'],
    // Two CC0 packs by different artists: the hero's Rigify skeleton carries the
    // clips, the knight's own naming carries none. What the avatar translates is
    // a difference two people actually made, not one invented for a fixture.
    targets: ['web'],
    tier: 'pr',
    // All three at once: W walks the blend plane's speed axis, C its stance axis,
    // Space bends the arm onto a target no clip reaches for.
    interact: { keys: ['KeyW', 'KeyC', 'Space'], frames: 90 },
    // Measured on a runner of its own: 26 of 30 settle frames inside the 30 s
    // default. Beside two other launches it had been getting three times that.
    launchTimeoutMs: 180_000,
  },
  {
    id: 'third-person-3d',
    certifies: ['third-person', 'level-of-detail', 'ssao', 'navigation-3d', 'occlusion-culling',
                'root-motion', 'animation-events', 'world-streaming', 'shader-readiness',
                'animation-layers', 'animation-blend'],
    // A packaged frame looks the same whether first sight of the outpost cost a
    // compile or not; the run is what reads the counter on both sides of the
    // boundary. Scheduled by `a-streamed-place-is-ready-before-it-is-seen`.
    runBy: 'node tools/verify-third-person.mjs',
    targets: ['web'],
    tier: 'pr',
    // The character walks on the key it declares. What it DOES on the way is
    // verify-third-person's, over this same package: a frame that differs says
    // something moved, not that the world allowed it.
    interact: { keys: ['KeyW'], frames: 60 },
    // Measured, not guessed: 22 of 30 settle frames inside the 2D default's 30 s,
    // on a frame that came back LIVE with no errors — an arena of LOD'd rocks costs
    // about 1.4 s each on a software rasteriser. lighting-3d's shadow pass got here first.
    launchTimeoutMs: 180_000,
  },
  {
    id: 'world-streaming-3d',
    certifies: ['world-streaming'],
    targets: ['web'],
    tier: 'pr',
    // Walking is what makes a place exist here, so the frame after 60 frames of
    // it differs by more than a character moving — a cell came in.
    interact: { keys: ['KeyD'], frames: 60 },
    // Comparable now that the editor cuts this world the way the package does —
    // but not the claim: the frame moved only 0.0073 → 0.0008 when Play stopped
    // loading it whole. verify-world-residency.mjs asks both for their residency.
  },
  {
    id: 'ui-controls',
    certifies: ['ui-layout', 'text', 'ui-widgets'],
    targets: ['web', 'desktop'],
    tier: 'pr',
    // Opens the modal — a whole-panel change, so the response is unmistakable.
    interact: { pointer: { x: 0.625, y: 0.675 }, frames: 40 },
  },
  {
    id: 'tilemap-demo',
    certifies: ['tilemap', 'tile-collision'],
    targets: ['web', 'desktop', 'android'],
    tier: 'pr',
    // Measured: the scene's own patrolling enemy moves as much as the player
    // does (drift 0.041 against a driven 0.100), so a pixel A/B cannot say the
    // key caused it. The keyboard is covered by platformer and input-actions.
    interactGap: 'an autonomous enemy moves as much as the input does; the A/B cannot attribute it',
    // Away from the patrol: the ground and the water are layers of their own.
    webPixels: [
      { what: 'the ground layer draws', x: 0.84, y: 0.93, rgb: [198, 124, 89], tol: 24 },
      { what: 'the water layer draws', x: 0.43, y: 0.83, rgb: [54, 192, 245], tol: 24 },
    ],
  },
  {
    id: 'spine-demo',
    certifies: ['spine'],
    targets: ['web', 'desktop', 'android', 'ios'],
    tier: 'nightly',
    interactGap: 'a showcase that cycles its own animations; nothing to press',
  },
  {
    id: 'script-graph-demo',
    certifies: ['script-graph'],
    targets: ['web', 'desktop'],
    tier: 'nightly',
    interactGap: 'both squares are graph-driven on a clock; the INPUT path is dodge-graph\'s',
  },
  {
    id: 'dodge-graph',
    // A game, not a demonstration: it reads the keyboard, scores, ends and
    // restarts, and every one of those is a graph. The capability is the same
    // one script-graph-demo carries; what this adds is that it is playable.
    certifies: ['script-graph'],
    targets: ['web', 'desktop'],
    tier: 'nightly',
    interact: { keys: ['ArrowRight'], frames: 40 },
  },
  {
    id: 'save-load',
    certifies: ['persistence', 'save-versioning'],
    targets: ['web', 'desktop'],
    tier: 'nightly',
    interactGap: 'pointer-driven; no stable slot target pinned yet',
  },
  {
    id: 'hot-update-demo',
    certifies: ['hot-update', 'rollback', 'asset-lifecycle'],
    targets: ['web', 'android'],
    tier: 'nightly',
    interactGap: 'swaps an asset on a timer; no input path',
    // Packaging cannot see either claim: one needs a second build served as a
    // CDN, the other a manifest that lies about its bytes. check-golden refuses
    // a runBy that no release criterion schedules.
    runBy: 'pnpm run verify:hotupdate',
  },
  {
    id: 'multiplayer-arena',
    certifies: ['networking'],
    targets: ['web', 'desktop'],
    tier: 'nightly',
    interactGap: 'needs a listen server up before input means anything',
    // A packaged frame cannot tell a live session from a dead one, so a run
    // settles this instead: check-arena-server serves the project headless over
    // a real socket and drives two clients through it, under the built-engine gates.
    runBy: 'node tools/run-gates.mjs --scope local --where local',
  },
  {
    id: 'video-puzzle',
    // `startup-size` was a declared gap while the runtime floor (2.8MB) exceeded
    // the 2MB cap; this packages at 1.56MB — the biggest playable in the corpus,
    // not the smallest thing that would pass.
    certifies: ['single-file', 'startup-size'],
    targets: ['playable', 'web'],
    tier: 'nightly',
    // Measured: this package scores 0.0763 against ITSELF — it shuffles the tiles
    // per run and the video is at a different timestamp each time. Nothing the
    // comparison says about it would be about the packaging.
    parityGap: 'shuffles per run and plays video; two runs of one build do not match either',
    interactGap: 'pointer-driven; no stable tile target pinned yet',
  },
  {
    id: 'celestial-heights',
    certifies: [
      'tilemap', 'tile-collision', 'navigation', 'behavior-tree',
      'scene-transition', 'y-sort', 'localization', 'ui-layout', 'text',
      'persistence', 'ui-inventory', 'achievements', 'touch', 'controller',
      'pause-resume', 'safe-area', 'particles',
    ],
    targets: ['web', 'desktop'],
    // Nightly, not pr: a project earns the release gate by having run, and this
    // one has not run anywhere yet. It is also the biggest thing in the corpus.
    tier: 'nightly',
    // Its player runs from frame one and the two sides settle on different clocks
    // (the editor's realm is a throttled OOPIF), so the frames are a moment apart:
    // measured 0.0015 to 0.0756, against 0.3623 for a different game.
    parity: 0.12,
    // The thumb drags the on-screen stick a touch device gets. Stricter than
    // the default because this game moves on its own: a thumb on the stick
    // measures 0.65, a thumb on empty background 0.40.
    interact: {
      keys: ['KeyD'],
      frames: 60,
      responds: 0.55,
      touches: [{ from: 4, to: 58, x: 0.13, y: 0.78, toX: 0.30, toY: 0.78 }],
      // Left stick east. The map binds it beside WASD, and nothing but a run
      // that holds a pad proves the binding is more than a line of code.
      pad: [{ from: 2, to: 58, axes: { 0: 1 } }],
    },
    // Backgrounded, the world stops; brought back, it carries on. Read as where
    // Lyra got to, because a frame comparison saturates the moment her sprite
    // stops overlapping itself and cannot tell 30 frames from 60.
    suspend: { entity: 'Lyra_Player', keys: ['KeyD'], frames: 80, hideFrom: 20, hideTo: 50, moves: 60 },
    // The HUD has to come out from UNDER a notch, on the axis it came from. The
    // two edges carry different insets on purpose, so the run also says the move
    // scales with the inset instead of being one hardcoded nudge.
    safeArea: { entity: 'HUD', reference: 'Canvas', top: 44, left: 88, moves: 40 },
  },
  {
    id: 'input-actions',
    certifies: ['input', 'minigame-vendor', 'subpackage'],
    // Two vendors from one project: the export is a profile over one family, and
    // only a second vendor's real boot shows what the family got wrong. They take
    // the same engine build, so the second costs no extra wasm build.
    targets: ['web', 'desktop', 'wechat', 'douyin'],
    tier: 'release',
    interact: { keys: ['KeyD'], frames: 40 },
    // Its engine binary rides a 分包 — the only way under the 4MB main-package
    // limit. Naming it here lets the host REFUSE it too: on a bad network the
    // game cannot start, and all it can still do is say which package failed.
    subpackage: { name: 'engine' },
    // A first screen is a question about a NETWORK: on this machine the whole
    // boot beats the splash's fade. `maxStillMs` is the longest the bar may
    // stand still — 8s leaves room for the bundle's own download.
    firstScreen: { link: 'slow-4g', maxMs: 300, maxStillMs: 8000 },
  },
  {
    id: 'sprite-animation',
    certifies: ['animation'],
    targets: ['web', 'desktop'],
    tier: 'release',
    // The player's clip switches Idle→Move on the same key that moves it, so a
    // driven frame differs because the animation changed as much as the position.
    interact: { keys: ['ArrowRight'], frames: 40 },
  },
  {
    id: 'effects-gallery',
    certifies: ['material'],
    targets: ['web', 'desktop'],
    tier: 'release',
    interactGap: 'a gallery of material templates with nothing to press — the conveyor scrolls itself from the shader clock',
  },
  {
    id: 'audio-demo',
    certifies: ['audio'],
    targets: ['web', 'desktop'],
    tier: 'release',
    interactGap: 'a pad plays a sound and draws nothing of its own — the audio block below is the run that reads the result',
    // What certifies audio, since pixels cannot — the toggle redraws itself either
    // way. Click for a SUSTAINED source (a one-shot ends before the capture), then
    // read the bar the visualizer writes from an analyser bin.
    audio: { toggle: { x: 0.5, y: 0.41 }, bar: 'Bar0', floor: 6, frames: 60 },
  },
];

/**
 * Projects as they were RELEASED — what a golden project cannot ask, since every
 * example is re-saved by whoever last touched it. Git history rather than
 * fixtures: an invented "old project" is only old in imitated ways. The risk is
 * component data; the envelope has not changed since v0.20.0.
 */
export const LEGACY = [
  { tag: 'v0.20.0', id: 'platformer', tier: 'pr' },
  { tag: 'v0.30.0', id: 'platformer', tier: 'nightly' },
  { tag: 'v0.30.0', id: 'ui-controls', tier: 'nightly' },
  { tag: 'v0.40.0', id: 'tilemap-demo', tier: 'nightly' },
  { tag: 'v0.46.0', id: 'space-shooter', tier: 'release' },
];

/** Released projects a tier must still be able to open. */
export function legacyAtTier(tier) {
  const want = TIERS.indexOf(tier);
  if (want < 0) throw new Error(`unknown tier "${tier}" (have: ${TIERS.join(', ')})`);
  return LEGACY.filter((l) => TIERS.indexOf(l.tier) <= want);
}

const rank = (tier) => TIERS.indexOf(tier);

/** Golden projects that run at `tier` — cheaper tiers included (they are cumulative). */
export function atTier(tier) {
  const want = rank(tier);
  if (want < 0) throw new Error(`unknown tier "${tier}" (have: ${TIERS.join(', ')})`);
  return GOLDEN.filter((g) => rank(g.tier) <= want);
}

/**
 * `projects` in `n` shares balanced by what each asks of a launch — the targets
 * in `owned`, times what gets driven at them — rather than by count:
 * celestial-heights alone is a third. A project stays whole, and each lands in
 * exactly one share, so a shard left out is a project nobody launched.
 */
export function sharesOf(projects, n, owned) {
  const weight = (g) => g.targets.filter((t) => owned.has(t)).length
    * (1 + [interactFor(g), audioFor(g), safeAreaFor(g), atlasFor(g)].filter(Boolean).length + (suspendFor(g) ? 3 : 0));
  const bins = Array.from({ length: n }, () => ({ projects: [], load: 0 }));
  for (const g of [...projects].sort((a, b) => weight(b) - weight(a))) {
    const bin = bins.reduce((least, b) => (b.load < least.load ? b : least));
    bin.projects.push(g);
    bin.load += weight(g);
  }
  return bins.map((b) => b.projects);
}

/** Every (project, target) pair a tier must package and launch. */
export function matrixAtTier(tier) {
  return atTier(tier).flatMap((g) => g.targets.map((target) => ({ id: g.id, target })));
}

/** Capabilities claimed by no project and not declared as a gap. */
export function uncoveredCapabilities() {
  const covered = new Set(GOLDEN.flatMap((g) => g.certifies));
  return CAPABILITIES.filter((c) => !covered.has(c) && !(c in KNOWN_GAPS));
}

/** Examples that exist on disk but are not part of the certification corpus. */
export function nonGoldenExamples() {
  if (!existsSync(EXAMPLES)) return [];
  const golden = new Set(GOLDEN.map((g) => g.id));
  return readdirSync(EXAMPLES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(EXAMPLES, e.name, 'project.esproject')))
    .map((e) => e.name)
    .filter((n) => !golden.has(n))
    .sort();
}

/** The parity tolerance in force for a project, or null when it opted out. */
export function parityFor(g) {
  if (g.parityGap) return null;
  return typeof g.parity === 'number' ? g.parity : DEFAULT_PARITY;
}

/** The input a project's package must answer, or null when it opted out. */
/** The audio claim, or null. See the `audio` block on audio-demo. */
export function audioFor(g) {
  return g.audio ?? null;
}

/** The start-screen claim, or null. See input-actions. */
export function firstScreenFor(g) {
  return g.firstScreen ?? null;
}

/** The 分包 a mini-game package rides, or null. See input-actions. */
export function subpackageFor(g) {
  return g.subpackage ?? null;
}

export function interactFor(g) {
  if (g.interactGap || !g.interact) return null;
  return {
    keys: g.interact.keys ?? [],
    pointer: g.interact.pointer ?? null,
    touches: g.interact.touches ?? null,
    pad: g.interact.pad ?? null,
    frames: g.interact.frames ?? 40,
    responds: g.interact.responds ?? DEFAULT_RESPONDS,
  };
}

/**
 * What a project asks of a run that goes to the background and comes back, or
 * null when it makes no claim. `entity` is read three times — never hidden,
 * hidden and left there, hidden and brought back — and how far it got has to
 * order itself the same way.
 */
export function suspendFor(g) {
  if (!g.suspend) return null;
  return {
    entity: g.suspend.entity,
    keys: g.suspend.keys ?? [],
    frames: g.suspend.frames ?? 80,
    hideFrom: g.suspend.hideFrom ?? 20,
    hideTo: g.suspend.hideTo ?? 50,
    moves: g.suspend.moves ?? 60,
  };
}

/**
 * What a project asks of a screen with a notch, or null when it claims nothing.
 * `entity` is a node anchored top-left, read against a `reference` that rides the
 * camera so the game's own drift cancels. `moves`: measured 88 world units on a
 * 540-tall surface, 103 on a 461-tall one — 40 is under both, over an ignored 0.
 */
export function safeAreaFor(g) {
  if (!g.safeArea) return null;
  return {
    entity: g.safeArea.entity,
    reference: g.safeArea.reference,
    top: g.safeArea.top,
    left: g.safeArea.left,
    moves: g.safeArea.moves ?? 40,
  };
}

/**
 * What a project asks of the texture cook, or null when it claims nothing.
 * `packed` is how many of its textures must come out of the cook inside an atlas
 * page — a count, because packing that silently stops still draws the same frame
 * and therefore still passes parity.
 */
export function atlasFor(g) {
  if (!g.atlas) return null;
  return { packed: g.atlas.packed };
}

/**
 * Points a packaged NATIVE frame must contain, or null when the project names
 * none. The host's own verdict only says something drew — a game that lost every
 * texture and cleared to a gradient passes that, so what drew has to be asked
 * for. `x`/`y` are fractions of the surface, `y` from the top.
 */
export function desktopPixels(g, host) {
  if (!g?.desktopPixels) return null;
  const hosts = g.desktopPixelsHosts;
  return !hosts || hosts.includes(host) ? g.desktopPixels : null;
}

/**
 * Points a packaged WEB frame must contain, or null. Parity only says the package
 * and the editor agree — a feature the PACKAGE lost that the editor never had
 * either passes it, and a launch check passes anything that is not one flat
 * colour. `x`/`y` are fractions of the surface, `y` from the top.
 */
export function webPixels(g) {
  return g?.webPixels ?? null;
}

/**
 * How long a package gets to reach a settled frame, when the default is not
 * enough. The default was measured on 2D games; a scene with a shadow pass costs
 * a second a frame on the software rasteriser a runner without a GPU falls back
 * to, and thirty settle frames do not fit in thirty seconds.
 */
export function launchTimeoutFor(g) {
  return g?.launchTimeoutMs ?? null;
}

/** Why a project's points were skipped on this host, for the run to print. */
export function desktopPixelsSkip(g, host) {
  if (!g?.desktopPixels || !g.desktopPixelsHosts || g.desktopPixelsHosts.includes(host)) return null;
  return `${g.id}: points hold on ${g.desktopPixelsHosts.join(', ')}, not ${host}`;
}

/** Absolute path to a golden project's directory. */
export function projectDir(id) {
  return path.join(EXAMPLES, id);
}
