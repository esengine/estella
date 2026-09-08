// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-project-settings.mjs — a project setting reaches everything, or says why not.
 *
 * A setting like "this layer resolves by depth" is only as real as its
 * least-remembered site. The 2.5D depth mask was declared in the manifest,
 * parsed, shown in Project Settings, and sent to the play realm — and reached
 * neither the edit viewport nor ANY exported build, because the editor and the
 * export each restate the list of settings by hand. It looked right in Play and
 * shipped wrong, which is the one failure this file exists to make impossible.
 *
 * So the derivation lives once (pipeline/src/project/runtimeConfig.ts) and this
 * checks that every field of it is actually carried by each consumer:
 *
 *   parse     the manifest reader (format.ts) has a branch for the feature — that
 *             reader is a WHITELIST, so a field that persists and has no branch
 *             looks completely inert
 *   editor    applied to the edit session, so authoring shows what ships
 *   play      forwarded into the play realm
 *   packaged  written into a shipped build
 *   authoring a CREATOR can set it, and this says where
 *
 * A field that legitimately cannot reach one of them declares that HERE, with a
 * reason. The point is not that everything reaches everywhere; it is that a gap
 * is a sentence somebody wrote, not an omission nobody noticed.
 *
 * `authoring` is the one that is not about transport. The four above ask whether
 * a value SURVIVES the trip; that question was green for `msaaSamples` while the
 * only way to set it was to hand-edit project.esproject, because nothing here
 * asked whether a human could reach it at all. So it answers a different
 * question, and it has its own vocabulary:
 *
 *   ui        a row in the settings registry — the id is named and checked. That a
 *             row EXISTS, not that it writes: a control bound to nothing but React
 *             state passes here and fails check-mutator-parity, which is the half
 *             that asks whether a person's edit reaches the project
 *   manual    deliberately manifest-only (advanced, or edited as a file), + why
 *   internal  not creator-authored: derived, or a machine's business, + why
 *   owed      creator-facing, reachable from no editor surface. Debt, recorded
 *             as debt — an entry leaves by growing a UI, never by being explained
 *
 * No answer is not an option: a setting nobody decided about fails here.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const RUNTIME_CONFIG = 'pipeline/src/project/runtimeConfig.ts';
const FORMAT = 'pipeline/src/project/format.ts';
const STORE = 'desktop/src/project/ProjectStore.ts';
/** Where a project setting becomes a row a creator can see. */
const SETTINGS = 'desktop/src/settings/projectSettings.ts';

/**
 * Where each field of RuntimeProjectConfig has to show up, and the reason when
 * it deliberately does not. `null` = must be carried; a string = a declared gap,
 * printed by `--list` so the gaps stay visible rather than becoming folklore.
 */
const DECLARED_GAPS = {
  achievements: {
    editor: 'nothing unlocks one while a scene is being authored — edit mode runs no '
      + 'gameplay, so the set is checked in Play and in a shipped build',
  },
  steamAppId: {
    editor: 'edit mode is not a shipped game — a Steam client is brought up by the '
      + 'runtime, and Play rehearses that with the local provider',
    play: 'Play is not launched by Steam, so a client would refuse the ownership '
      + 'check; the local provider is what a rehearsal can honestly use',
  },
  physicsEnabled: {
    editor: 'edit mode does not simulate — bodies are authored, not stepped',
  },
  physicsConfig: {
    editor: 'edit mode does not simulate — see physicsEnabled',
  },
  colorSpace: {
    editor: 'boot-fixed — shaders compile against it, so the settings page asks '
      + 'for a reload rather than applying live (EngineHost.resolveColorSpace)',
  },
  renderBackend: {
    editor: 'the viewport runs the developer\'s own `renderer.backend` setting: which '
      + 'GPU a machine can drive is not the project\'s to decide, and a canvas cannot '
      + 'change context type once one is acquired',
    play: 'the play realm boots on the editor\'s own context; the two backends are held '
      + 'equal by the pixel gates (`verify-render --backend webgpu`) rather than by Play',
  },
  screenFit: {
    editor: 'the device preview reads it through projectSeams, not by applying it '
      + 'to the edit camera (the editor view is a free zoom by design)',
  },
  uiThemeColors: {
    editor: 'applied together with uiTheme (one applyWidgetTheme call takes both)',
  },
};

/** The feature branch in the manifest parser each field is read from. */
const PARSE_KEY = {
  achievements: 'p.achievements',
  steamAppId: 'dt.steam',
  physicsEnabled: 'p.enabled',
  physicsConfig: 'physics',
  audioConfig: 'parseAudioProjectConfig',
  uiTheme: 'u.theme',
  uiThemeColors: 'u.colors',
  ySortLayers: 'r.ySortLayers',
  depthLayers: 'r.depthLayers',
  colorSpace: 'r.colorSpace',
  outputTransform: 'r.outputTransform',
  renderBackend: 'r.backend',
  screenFit: 'r.cameraScaleMode',
  msaaSamples: 'r.msaa',
};

/**
 * How a CREATOR sets each field — see the header for the four answers. `ui` names
 * the settings-registry id, which is looked for in that file rather than trusted:
 * a claim of "there is a UI" that nobody checked is the same as no UI.
 */
const AUTHORING = {
  achievements: { ui: 'project.packaging.achievements' },
  steamAppId: { ui: 'project.packaging.desktop.steam.appId' },
  physicsEnabled: { ui: 'project.physics.enabled' },
  physicsConfig: { ui: ['project.physics.gravityX', 'project.physics.gravityY', 'project.physics.fixedTimestep'] },
  audioConfig: { ui: ['project.audio.maxVoices', 'project.audio.buses', 'project.audio.effects'] },
  uiTheme: { ui: 'project.ui.theme' },
  uiThemeColors: { ui: 'project.ui.color.' },
  ySortLayers: { ui: 'project.rendering.ySortLayers' },
  depthLayers: { ui: 'project.rendering.depthLayers' },
  colorSpace: { ui: 'project.rendering.colorSpace' },
  outputTransform: { ui: 'project.rendering.outputTransform' },
  msaaSamples: { ui: 'project.rendering.msaa' },
  renderBackend: { ui: 'project.rendering.backend' },
  screenFit: { ui: 'project.display.cameraFit' },
};

/** Field names of the RuntimeProjectConfig interface, in declaration order. */
function runtimeConfigFields(src) {
  const body = src.slice(src.indexOf('export interface RuntimeProjectConfig {'));
  const end = body.indexOf('\n}');
  return [...body.slice(0, end).matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
}

const runtimeSrc = read(RUNTIME_CONFIG);
const formatSrc = read(FORMAT);
const storeSrc = read(STORE);
const settingsSrc = read(SETTINGS);
const fields = runtimeConfigFields(runtimeSrc);

if (fields.length === 0) {
  console.error('check-project-settings: could not read RuntimeProjectConfig — has it moved?');
  process.exit(1);
}

// The consumers, each as "does this text carry the field". Deliberately textual:
// the alternative is importing the editor's module graph into a lint script.
const editorApply = storeSrc.slice(
  storeSrc.indexOf('private applyEditorRuntimeConfig'),
  storeSrc.indexOf('private applyEditorRuntimeConfig') + 1200,
);
const playPayload = storeSrc.slice(
  storeSrc.indexOf('playPayload()'),
  storeSrc.indexOf('audioFeature()'),
);
const packagedFields = runtimeSrc.slice(runtimeSrc.indexOf('export function packagedRuntimeFields'));

const inPackagedSlice = (f) => packagedFields.includes(`rc.${f}`);
const CONSUMERS = {
  parse: (f) => formatSrc.includes(PARSE_KEY[f] ?? f),
  editor: (f) => editorApply.includes(`rc.${f}`),
  // Either named in the payload, or carried by the packaged slice it spreads.
  play: (f) => playPayload.includes(`rc.${f}`)
    || (inPackagedSlice(f) && playPayload.includes('packagedRuntimeFields')),
  packaged: inPackagedSlice,
};

/**
 * The authoring answer for one field, as a problem string or null. Kept apart
 * from CONSUMERS because it is not the same question: those ask whether a value
 * survives a trip, this asks whether anybody can set it in the first place.
 */
function authoringProblem(field) {
  const answer = AUTHORING[field];
  if (!answer) {
    return `${field} says nothing about authoring — declare one of ui / manual / internal `
      + `in tools/check-project-settings.mjs (AUTHORING.${field}), or record it as owed`;
  }
  const [kind] = Object.keys(answer);
  if (kind === 'manual' || kind === 'internal' || kind === 'owed') {
    return answer[kind] ? null : `${field} declares "${kind}" with no reason`;
  }
  if (kind !== 'ui') return `${field} declares an unknown authoring kind "${kind}"`;
  const ids = Array.isArray(answer.ui) ? answer.ui : [answer.ui];
  // A trailing dot is a PREFIX, for the ids built in a loop (`project.ui.color.
  // ${role}`); anything else must appear quoted, because a bare substring test
  // let `project.rendering.msaaX` satisfy a claim about `project.rendering.msaa`.
  const missing = ids.filter((id) => (id.endsWith('.')
    ? !settingsSrc.includes(id)
    : !settingsSrc.includes(`'${id}'`)));
  return missing.length
    ? `${field} claims a settings row (${missing.join(', ')}) that ${SETTINGS} does not register`
    : null;
}

const problems = [];
const gaps = [];
const owed = [];
for (const field of fields) {
  for (const [role, carries] of Object.entries(CONSUMERS)) {
    const declared = DECLARED_GAPS[field]?.[role];
    const carried = carries(field);
    if (declared) {
      gaps.push(`  ${field} → ${role}: ${declared}`);
      // A declared gap that is now carried anyway is stale bookkeeping, not an error.
      continue;
    }
    if (!carried) {
      problems.push(
        `${field} never reaches "${role}". Either carry it there, or declare the gap `
        + `with a reason in tools/check-project-settings.mjs (DECLARED_GAPS.${field}.${role}).`,
      );
    }
  }
  const authoring = authoringProblem(field);
  if (authoring) problems.push(authoring);
  if (AUTHORING[field]?.owed) owed.push(`  ${field} → ${AUTHORING[field].owed}`);
  // A field nobody parses is a field a manifest can hold and nothing will read.
  if (!PARSE_KEY[field]) {
    problems.push(`${field} has no PARSE_KEY entry — say which manifest branch reads it.`);
  }
}

/**
 * Settings a creator can WRITE that are not RuntimeProjectConfig fields, so the
 * transport questions above never see them. An authoring surface proves only
 * that a value can be written; this asks whether anything CONSUMES it, and
 * refuses to let a `metadata-only` one be described as changing a build.
 */
const CONSUMPTION = {
  spineVersion: {
    kind: 'metadata-only',
    why: 'the runtimes a package carries are detected from its own skeletons '
      + '(sideModuleScan → detectSpineVersion); nothing reads this field',
    /** Everything a creator is told about it: none of it may promise an effect. */
    saidBy: ['set.project.spine.version.desc', 'set.project.spine.none'],
    /** …and one of them must SAY it has none. Absence of a lie is not a truth: the
     *  row looks like every other one, so silence still reads as "this works". */
    disclaimedBy: 'set.project.spine.version.desc',
  },
};
/** An absolute promise about what a build produces. Not the word "ships": the
 *  disclaimer has to be allowed to use it ("does not change what ships"). */
const BUILD_PROMISE = /and no other|package weighs|构建只会携带|决定了.*包体/;
const DISCLAIMS = /does not change what ships|不会改变最终打包/;
const MESSAGES = 'desktop/src/i18n/messages/settings.ts';
const messages = existsSync(path.join(ROOT, MESSAGES)) ? read(MESSAGES) : '';
/** Every tracked line naming `needle` under `dirs`, as `<path>:<line>`. */
function grep(needle, dirs) {
  try {
    return execFileSync('git', ['grep', '-n', '--', needle, ...dirs],
      { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
      .filter((l) => !l.includes('.generated.'));
  } catch {
    return []; // git grep exits 1 when nothing matches
  }
}
for (const [field, decl] of Object.entries(CONSUMPTION)) {
  if (!decl.why) problems.push(`${field} declares "${decl.kind}" consumption with no reason`);
  if (decl.kind !== 'metadata-only' && decl.kind !== 'unavailable') continue;
  // Ground truth against the declaration: a field that GAINS a reader must stop
  // calling itself metadata-only, or the note outlives the fact it described.
  // FORMAT declares the field's own type, which is not a reading of it.
  const readers = grep(field, ['sdk/src', 'pipeline/src']).filter((l) => !l.startsWith(FORMAT));
  if (readers.length) {
    problems.push(`${field} declares "${decl.kind}" but ${readers.length} site(s) now read it`
      + ` (${readers[0]}) — say what consumes it instead.`);
  }
  if (!messages) continue;
  for (const key of decl.saidBy ?? []) {
    const at = messages.indexOf(`'${key}'`);
    if (at < 0) { problems.push(`${field}: no message "${key}" to check what a creator is told`); continue; }
    const said = messages.slice(at, at + 700);
    if (BUILD_PROMISE.test(said)) {
      problems.push(`${field} is ${decl.kind}, and "${key}" promises a creator it decides what a build ships`);
    }
  }
  const dk = decl.disclaimedBy;
  const at = dk ? messages.indexOf(`'${dk}'`) : -1;
  if (dk && (at < 0 || !DISCLAIMS.test(messages.slice(at, at + 700)))) {
    problems.push(`${field} is ${decl.kind} and "${dk}" never says so — a row that reads like`
      + ' every other one is read as one that takes effect like every other one.');
  }
}

if (process.argv.includes('--list')) {
  console.log(`project settings (${fields.length}): ${fields.join(', ')}`);
  for (const [f, d] of Object.entries(CONSUMPTION)) console.log(`  consumption: ${f} — ${d.kind} (${d.why})`);
  if (gaps.length) console.log(`declared gaps:\n${gaps.join('\n')}`);
  if (owed.length) console.log(`owed — creator-facing, authorable from no editor surface:\n${owed.join('\n')}`);
}

if (problems.length) {
  console.error('check-project-settings: a project setting does not reach a consumer.\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`check-project-settings: ${fields.length} settings, ${gaps.length} declared gaps,`
  + ` ${owed.length} owed an authoring surface (--list names them) — ok`);
