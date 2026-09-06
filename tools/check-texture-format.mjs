// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-texture-format.mjs — a texture's compression is decided twice, and
 *        both decisions are recorded where they are taken.
 *
 * The unit tests hold the decisions themselves (texture-cook-decision,
 * texture-format-report). This holds the WIRING, which is where this defect lived
 * for as long as it did: the cook's branch and the loader's else-branch each knew
 * the answer and neither wrote it down, so a project that spent cook time on
 * compression paid four times the VRAM with nothing anywhere saying so.
 *
 * The two must stay apart. "Compression was lost" sends an author to the Build
 * dialog when the fix was the image's dimensions, and to the image when the fix
 * was the device they were testing on.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECIDE = 'pipeline/src/assets/textureCookDecision.ts';
const COOK = 'pipeline/src/assets/cookAssets.ts';
const COMPRESSED = 'sdk/src/asset/compressed.ts';
const LOADER = 'sdk/src/asset/loaders/TextureLoader.ts';
const NATIVE = 'native/host/media/ktx2_decode.cpp';
const DETAILS = 'desktop/src/panels/Details.tsx';
const SHIP = 'desktop/src/project/textureShipFormat.ts';
const SETTINGS = 'desktop/src/settings/projectSettings.ts';
const SURFACE = 'desktop/src/engine/EditorControlSurface.ts';
const CATALOG = 'desktop/shared/toolCatalog.mjs';

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const problems = [];

// ---------------------------------------------------------------- cook (build)
const decide = read(DECIDE);
const cook = read(COOK);

// The reasons are the product. Collapsing two into one is the failure this whole
// record exists to prevent, so the vocabulary is read from the source and every
// consumer below is held to ALL of it rather than to a list written here.
const COOK_REASONS = [...decide.matchAll(/^\s+\| '([a-z-]+)';?$/gm)].map((m) => m[1]);
if (COOK_REASONS.length < 6) {
  problems.push(`${DECIDE}: could not read the TextureCookReason union (found `
    + `${COOK_REASONS.length}) — this gate holds every consumer to it, and a short list judges nothing`);
}

if (!/decideTextureCook\(\{/.test(cook)) {
  problems.push(`${COOK} no longer calls decideTextureCook — a cook that works the choice out again`
    + ' is a second answer to the question the Inspector asks before a build runs');
}
if (/%\s*4\s*===\s*0/.test(cook)) {
  problems.push(`${COOK} tests block alignment itself — that rule belongs to the decision, and a`
    + ' second copy of it is what makes a prediction agree with the build until it does not');
}
if (!/cook\.selected !== 'raw'/.test(cook)) {
  problems.push(`${COOK} does not gate the encode on the recorded decision — an encode condition`
    + ' beside the record is how the two come to disagree about what shipped');
}
if (!/cook: frameCook/.test(cook) || !/\.\.\.\(cook \? \{ cook \} : \{\}\)/.test(cook)) {
  problems.push(`${COOK} no longer writes the decision into the manifest entry — compressedFormats`
    + ' says a payload can transcode and can never say why one is absent');
}
if (!/cookIntentDefeated/.test(cook)) {
  problems.push(`${COOK} warns about nothing: a request that survived every dialog and lost to the`
    + ' image or to the folder it sits in is exactly the silent case');
}

// -------------------------------------------------------------- upload (device)
const compressed = read(COMPRESSED);
const loader = read(LOADER);

const chooser = /export function chooseTargetFormat\(([\s\S]*?)\n\}/.exec(compressed);
if (!chooser) {
  problems.push(`${COMPRESSED}: chooseTargetFormat has moved — this gate reads its body`);
} else if (/ASTC_4x4|ETC2_RGBA8|S3TC_DXT5/.test(chooser[1])) {
  problems.push(`${COMPRESSED}: chooseTargetFormat spells the preference order again instead of`
    + ' walking TARGET_PREFERENCE — two orderings let one texture land in a different format'
    + ' depending on which backend loaded it, which is a difference nobody chose');
}
if (!/export const TARGET_PREFERENCE/.test(compressed)) {
  problems.push(`${COMPRESSED} no longer declares one preference order for both upload paths`);
}
for (const [what, re] of [
  ['a device that offers none', /reason: 'no-device-format'/],
  ['a payload that would not transcode', /reason: 'transcode-failed'/],
  ['an image that is not whole blocks', /'not-block-aligned'/],
  ['a source image, which never asked', /reason: 'uncompressed-payload'/],
]) {
  if (!re.test(compressed)) {
    problems.push(`${COMPRESSED} no longer names ${what} — every one of these ends at RGBA8 and`
      + ' costs the same memory, and only the reason says which of them to go and fix');
  }
}

// One recorder, at the one entry point that chose a path. A record kept only
// where a fallback happens cannot say that everything else was fine.
const records = [...loader.matchAll(/this\.formats_\.record\(/g)].length;
if (records !== 1) {
  problems.push(`${LOADER} records the upload decision in ${records} place(s) — it must be exactly`
    + ' one, at the entry every path returns through, or the paths that were fine go uncounted');
}
for (const [what, re] of [
  ['the native host upload', /hostUploadDecision\(/],
  ['the WebGL2 upload', /this\.lastDecision_ = r\.decision/],
  ['the engine upload', /this\.lastDecision_ = compressedUploadDecision\(/],
  ['an ordinary image', /this\.lastDecision_ = RAW_PAYLOAD_UPLOAD/],
]) {
  if (!re.test(loader)) {
    problems.push(`${LOADER} no longer records ${what} — a path that says nothing is read as the`
      + ' one before it, which is worse than an absent record');
  }
}
if (!/deviceFormats\(\)/.test(loader)) {
  problems.push(`${LOADER} no longer probes the device's compressed formats — that is the half of`
    + ' the question a realm playing source images can still answer');
}

// The native host takes the same decision with an extra way to refuse, and used
// to return only a handle: an RGBA upload was indistinguishable from success.
const native = read(NATIVE);
if (!/blockRefused/.test(native) || !/compressed \? static_cast<int>\(gfxFmt\) : -1/.test(native)) {
  problems.push(`${NATIVE} no longer carries the chosen format out — a correct picture at four`
    + ' times the memory is exactly what nothing was reporting');
}

// ------------------------------------------------------------------ the editor
if (!existsSync(path.join(ROOT, 'desktop', 'src'))) {
  if (problems.length === 0) {
    console.log('check-texture-format: no editor checkout — both decisions are recorded, the readers'
      + ' were not judged.');
    process.exit(0);
  }
} else {
  const details = read(DETAILS);
  const ship = read(SHIP);
  const settings = read(SETTINGS);

  if (!/EditorControlSurface\.textureFormatReport\(\)/.test(details)) {
    problems.push(`${DETAILS} does not read the realm's upload ledger through the surface — the`
      + ' panel and the tool must be one reader, or a behavioural check drives only one of them');
  }
  if (!/textureShipFormat\(\{/.test(details)) {
    problems.push(`${DETAILS} no longer composes through textureShipFormat — a panel that works the`
      + ' cook decision out itself agrees with the build until the day it matters');
  }
  // Reading the settings is fine (the platform-override rows show the defaults);
  // TAKING the decision is not. Only the second makes a second answer.
  if (/decideTextureCook|% 4 ===/.test(details)) {
    problems.push(`${DETAILS} takes the cook decision itself — the composer exists so the panel and`
      + ' the automation surface cannot answer differently');
  }
  for (const reason of COOK_REASONS) {
    if (!details.includes(`'${reason}'`)) {
      problems.push(`${DETAILS} has no sentence for the cook reason '${reason}' — folding it into`
        + ' another sends the reader to a dialog that was never the problem');
    }
  }
  if (!/deviceProbed/.test(ship)) {
    problems.push(`${SHIP} no longer separates "nobody was asked" from "this device supports none"`
      + ' — an unprobed realm would report an empty capability as a fact');
  }
  if (!/method: 'textureFormat'/.test(read(CATALOG))) {
    problems.push(`${CATALOG}: no tool answers for a texture's format — resource_census counts`
      + ' bytes and can never say why they are that many');
  }

  // MSAA: the same one-reader rule, retrofitted. The row worked out the status
  // from the resource directly, so the tool below it would have been a second path.
  if (!/msaaSamples\(\)/.test(read(SURFACE)) || !/method: 'msaaSamples'/.test(read(CATALOG))) {
    problems.push(`${SURFACE}/${CATALOG}: the effective sample count is on no tool — an agent tuning`
      + ' quality reads its own request back and cannot tell whether the device granted it');
  }
  if (/post\.msaaCapability\(\)/.test(settings)) {
    problems.push(`${SETTINGS} asks the PostProcess resource directly while the tool asks the`
      + ' surface — two readers, and only the tool\'s is exercised');
  }
}

if (problems.length) {
  console.error(`check-texture-format: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('check-texture-format: the build records what it shipped, the upload records what the'
  + ' device made of it, and one reader answers for both.');
