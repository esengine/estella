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
export const TARGETS = ['web', 'playable', 'desktop', 'wechat', 'android', 'ios'];

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
  '.esanimator', '.estimeline', '.esanim',
  '.esmaterial', '.esshader', '.esenv',
  '.estileset', '.tmj', '.eslocale', '.esbt', '.inputmap',
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
  // — 0.63.0 —
  'One number turns the sky, the irradiance and the reflection': { certifies: 'environment' },
  'A second UV set survives the import boundary':
    { notCertifiable: 'a channel carried and deliberately unread — no lightmapper, no graph node,'
      + ' no material change — so no game act can observe it; check-mesh-vocabulary holds the two'
      + ' halves of the format and the .esmesh decode fixtures hold the bytes' },
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
  'ssao', 'navigation-3d', 'root-motion', 'animation-events', 'shader-readiness',
  'tilemap', 'tile-collision',
  'touch', 'safe-area', 'pause-resume',
  'texture-atlas',
  'single-file', 'startup-size',
  'hot-update', 'rollback',
  'networking',
  'persistence', 'save-versioning',
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
  'third-person': /\b(ThirdPersonController|ThirdPersonCamera)\b/,
  particles: /\bParticleEmitter\b/,
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
  'physics-3d': /\b(RigidBody3D|CharacterController3D|BoxCollider3D|MeshCollider3D)\b/,
  'mesh-shadow': /\bmeshShadows\b/,
  'level-of-detail': /\bLODGroup\b/,
  // The declarations, not the streamer: a project EXERCISES residency by saying
  // its world is cut and by carrying something that asks for places.
  'world-streaming': /\b(StreamedWorld|WorldStreamingSource)\b/,
  environment: /\.esenv\b/,
  // The post effect a scene turns on, not the pass that implements it.
  ssao: /"type":\s*"ssao"/,
  'navigation-3d': /\b(NavVolume|NavLink|NavAgent3D)\b/,
  'root-motion': /\brootMotion\b/,
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
    certifies: ['ecs', 'texture-atlas'],
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
    certifies: ['model-import', 'model-animation'],
    // Desktop too: these claims are about the ENGINE, and the native runtime is
    // a second one. Certified only on web, an import that reaches no native
    // frame reads as covered right up until a device says otherwise.
    targets: ['web', 'desktop'],
    tier: 'pr',
    // Nothing in it responds to input: the scene is a placed model, and the
    // chain it certifies is the import's — products, refs, prefab, package.
    interactGap: 'a placed model has nothing to drive; the import chain is what this certifies',
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
      { what: 'the skin places the mesh', x: 0.245, y: 0.31, rgb: [63, 62, 66], tol: 22 },
      { what: 'the mesh casts onto the panel', x: 0.37, y: 0.5, rgb: [64, 61, 61], tol: 22 },
      // Panel the sun still reaches, lit by the sun AND the environment: it is
      // this bright only because both are in the package.
      { what: 'sun and environment light the panel', x: 0.8, y: 0.5, rgb: [206, 195, 181], tol: 14 },
    ],
  },
  {
    id: 'physics-3d',
    certifies: ['physics-3d'],
    targets: ['web', 'desktop'],
    tier: 'nightly',
    // The character walks on the key it declares, and the debug overlay it draws
    // moves with it — the whole picture is the solver's, so a package that lost
    // the 3D world draws an empty room rather than a still one.
    interact: { keys: ['KeyW'], frames: 40 },
  },
  {
    id: 'third-person-3d',
    certifies: ['third-person', 'level-of-detail', 'ssao', 'navigation-3d',
                'root-motion', 'animation-events', 'world-streaming', 'shader-readiness'],
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
    certifies: ['ui-layout', 'text'],
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
  },
  {
    id: 'spine-demo',
    certifies: ['spine'],
    targets: ['web', 'desktop', 'android', 'ios'],
    tier: 'nightly',
    interactGap: 'a showcase that cycles its own animations; nothing to press',
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
    // a real socket and drives two clients through it, under static-gates.
    runBy: 'node tools/run-gates.mjs --scope local --complete',
  },
  {
    id: 'video-puzzle',
    // `startup-size` was a declared gap while the runtime floor (2.8MB) exceeded
    // the 2MB cap; it is 1.38MB empty now and this packages at 1.78MB — the
    // biggest playable in the corpus, not the smallest thing that would pass.
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
    certifies: ['input'],
    targets: ['web', 'desktop', 'wechat'],
    tier: 'release',
    interact: { keys: ['KeyD'], frames: 40 },
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
