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
 *
 * A field that legitimately cannot reach one of them declares that HERE, with a
 * reason. The point is not that everything reaches everywhere; it is that a gap
 * is a sentence somebody wrote, not an omission nobody noticed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const RUNTIME_CONFIG = 'pipeline/src/project/runtimeConfig.ts';
const FORMAT = 'pipeline/src/project/format.ts';
const STORE = 'desktop/src/project/ProjectStore.ts';

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
  renderBackend: 'r.backend',
  screenFit: 'r.cameraScaleMode',
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

const problems = [];
const gaps = [];
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
  // A field nobody parses is a field a manifest can hold and nothing will read.
  if (!PARSE_KEY[field]) {
    problems.push(`${field} has no PARSE_KEY entry — say which manifest branch reads it.`);
  }
}

if (process.argv.includes('--list')) {
  console.log(`project settings (${fields.length}): ${fields.join(', ')}`);
  if (gaps.length) console.log(`declared gaps:\n${gaps.join('\n')}`);
}

if (problems.length) {
  console.error('check-project-settings: a project setting does not reach a consumer.\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`check-project-settings: ${fields.length} settings, ${gaps.length} declared gaps — ok`);
