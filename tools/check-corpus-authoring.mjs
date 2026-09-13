// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-corpus-authoring.mjs — a shipped component somebody has authored.
 *
 * The corpus that ships to users — `examples/` plus the editor's `templates/` —
 * is the only place where a person can see a component the way they will meet
 * it: placed in a scene, its fields set in the Inspector, saved to a document.
 * A component with runtime tests and a docs page but no authored instance
 * anywhere has never had that path walked, and nothing noticed: the audio demo
 * named its clip in code for two years while `AudioSource`, the engine's own
 * audio component, appeared in no scene in the entire corpus.
 *
 * So the polarity is inverted, as in check-gizmo-coverage. DISCOVERY is the
 * engine's own registry — every authorable component, transient ones excepted,
 * since runtime readings are not authored. The EVIDENCE side answers itself:
 * a component a corpus document actually carries needs no entry here, and gains
 * one the moment an example is written. What must be answered by hand is the
 * remainder — every component the corpus has never authored:
 *
 *   authored     (not written here — a scene or prefab carries it)
 *   code-only    an example uses it from TypeScript, and code is its honest
 *                surface; say why authoring it would not be the demonstration
 *   structural   the editor refuses to add it at all (HIDDEN_COMPONENTS)
 *   derived      a system inserts it at runtime; in an authored document it
 *                would be a bug, not coverage
 *   owed         debt. A creator-facing component nothing in the corpus has
 *                ever authored. The reason is the work item, never an excuse
 *
 * The check runs both ways. A disposition that claims debt for a component the
 * corpus now authors fails ("promote it"), so paying it off is not something
 * one can do quietly; `code-only` fails when no example imports it, because an
 * accounting error and a real gap read identically from here.
 *
 * Run: node tools/check-corpus-authoring.mjs [--list]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'docs', 'astro', 'src', 'data', 'components.generated.json');
/** Where the editor decides what a person may add to an entity at all. */
const EDITOR_SCHEMA = path.join(ROOT, 'desktop', 'src', 'engine', 'schema.ts');
/** Every project directory that ships to users — the same two roots check-examples walks. */
const CORPUS_ROOTS = ['examples', 'templates'];

/**
 * The authored documents a component instance can live in. Nothing else can
 * carry one: a `.esanimator` names clips, a `.esbt` names behaviours, an
 * `.estileset` names tiles — none of them places a component on an entity.
 */
const INSTANCE_FORMATS = ['.esscene', '.esprefab'];

/**
 * Every other extension the corpus holds, and why a component instance cannot
 * be hiding in it. An extension in neither list fails — a format nobody
 * classified is one this reader is silently not reading, which is how a census
 * reports full coverage of a world smaller than the real one.
 */
const NOT_INSTANCE_FORMATS = {
  '.ts': 'example source — read separately, as the code-only evidence',
  '.esproject': 'project settings; it names scenes rather than entities',
  '.esanimator': 'an animator graph: states and transitions over clips',
  '.estimeline': 'a timeline: tracks over time, addressed to entities the scene owns',
  '.esanim': 'a clip: curves over time',
  '.esmaterial': 'a material: shader + uniform values',
  '.esshader': 'shader source',
  '.esenv': 'an environment: sky, ambient and the HDR behind them',
  '.estileset': 'a tileset: tiles, collision shapes and terrain rules',
  '.eslocale': 'translated strings',
  '.esbt': 'a behaviour tree',
  '.esfsm': 'a state machine',
  '.esmesh': 'an import result, regenerated from the model beside it',
  '.inputmap': 'input actions and their bindings',
  '.tmj': 'a Tiled map; the engine derives RuntimeOnly entities from it',
  '.json': 'tsconfig / package metadata / user component schemas',
  '.meta': 'import settings for the file beside it',
  '.md': 'prose about the project, not the project',
  '.mjs': 'the project\'s own tooling',
  '.js': 'built output or a host shim',
  '.html': 'a page hosting the built game',
  '.gitignore': 'version control, not content',
  '.png': 'a texture',
  '.ktx2': 'a compressed texture',
  '.hdr': 'an environment map',
  '.gltf': 'an imported model',
  '.bin': 'model or compressed-asset payload',
  '.atlas': 'a Spine atlas, written by Spine',
  '.skel': 'a Spine skeleton, written by Spine',
  '.wav': 'audio content',
  '.mp4': 'video content',
  '.zip': 'a packaged fixture',
  '.wasm': 'a side module binary',
};

/**
 * Every component the corpus has never authored, and what that silence means.
 * Keyed by component name; value is [disposition, reason]. A component a scene
 * or prefab carries is NOT listed — the evidence answers for it.
 */
const DISPOSITION = {
  // — structural: the editor's HIDDEN_COMPONENTS refuses them. Not every hidden
  //   component is here — UIController, UIGear and EventBinding have an authoring
  //   panel of their own, and the corpus authors them through it. —
  Parent: ['structural'],
  Children: ['structural'],
  Name: ['structural'],

  // — derived: a system writes them; authored, they would be a bug —
  RuntimeOnly: ['derived', 'tags a world-only entity a system re-derives; scene serialization skips tagged entities, so authoring one would delete it on save'],
  NetGhost: ['derived', 'replication tags a remote proxy with it; the authority writes it, never the scene'],
  SceneOwner: ['derived', 'scene loading records which scene an entity came from; authoring it would claim an ownership the loader never granted'],

  // — code-only: an example demonstrates it from TypeScript, honestly —
  Replicated: ['code-only', 'multiplayer-arena declares its replicated set beside the server systems that own it; the wire table is a contract both ends compile against, not scene content'],

  // — owed: a creator-facing component nothing in the shipped corpus authors.
  //   Each reason names where the coverage belongs. —


  BitmapText: ['owed', 'Create > Bitmap Text exists; every corpus scene uses Text instead, so the pixel-font path ships unwitnessed'],
  SpriteMask: ['owed', 'space-shooter masks from code; masking is authored geometry and belongs in a scene'],
  TrailRenderer: ['owed', 'Create > Trail exists and trail-demo builds its trail in code'],
  ParticleForceField: ['owed', 'particle-demo adds force fields from code, and the field has a radius gizmo the Inspector already draws'],
  NavArea: ['owed', 'cost-modifying nav regions (mud, road) never appear; enemy-ai-3d authors NavVolume, NavLink and NavObstacle but no area'],
  Marker: ['owed', 'Create > Marker and Create > Trigger Area are one click each, and not one project places either — the converged target for .tmj object groups has no hand-authored instance'],
  Disabled: ['owed', 'queries skip it and the outliner switches it now; what is missing is a scene that ships something switched off — a boss gate, a tutorial-only prop'],
  Velocity: ['owed', 'motion without a physics body — the cheapest thing in the engine, authored nowhere'],
};

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const authorable = snapshot.components.filter((c) => !c.transient).map((c) => c.name);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    // `.esengine/` stages a full SDK copy inside every project: read it and every
    // component matches, from the engine's own source rather than anyone's scene.
    if (e.isDirectory()) {
      if (!['node_modules', '.esengine', 'dist', 'build'].includes(e.name)) walk(path.join(dir, e.name), out);
    } else out.push(path.join(dir, e.name));
  }
  return out;
}

const files = [];
for (const root of CORPUS_ROOTS) {
  const dir = path.join(ROOT, root);
  if (existsSync(dir)) walk(dir, files);
}

const problems = [];

/** A format nobody classified is a reader that silently skips it. */
const unclassified = new Set();
for (const f of files) {
  const ext = path.extname(f);
  if (!ext || INSTANCE_FORMATS.includes(ext) || ext in NOT_INSTANCE_FORMATS) continue;
  unclassified.add(ext);
}
for (const ext of unclassified) {
  problems.push(`the corpus holds "${ext}" files and nothing says whether a component instance can live in one`
    + ' — classify the FORMAT in check-corpus-authoring.mjs, so the answer holds for every file of it');
}

/** Which projects author each component, and which import it from TypeScript. */
const authored = new Map();
const inCode = new Map();
const projectOf = (f) => path.relative(ROOT, f).split(path.sep).slice(0, 2).join('/');

for (const f of files) {
  const ext = path.extname(f);
  if (INSTANCE_FORMATS.includes(ext)) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/"type"\s*:\s*"([A-Za-z0-9_]+)"/g)) {
      if (!authored.has(m[1])) authored.set(m[1], new Set());
      authored.get(m[1]).add(projectOf(f));
    }
  } else if (ext === '.ts') {
    const text = readFileSync(f, 'utf8');
    for (const name of authorable) {
      if (!new RegExp(`\\b${name}\\b`).test(text)) continue;
      if (!inCode.has(name)) inCode.set(name, new Set());
      inCode.get(name).add(projectOf(f));
    }
  }
}

const hidden = existsSync(EDITOR_SCHEMA) ? readFileSync(EDITOR_SCHEMA, 'utf8') : null;
const hiddenNames = hidden
  ? new Set((hidden.match(/const HIDDEN_COMPONENTS = new Set\(\[([^\]]*)\]/)?.[1] ?? '')
      .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean))
  : null;

const counts = { authored: 0, 'code-only': 0, structural: 0, derived: 0, owed: 0 };
const owed = [];
const unused = new Set(Object.keys(DISPOSITION));

for (const name of authorable) {
  unused.delete(name);
  const carriers = authored.get(name);
  const declared = DISPOSITION[name];

  if (carriers?.size) {
    counts.authored++;
    // Debt somebody paid without saying so goes on claiming a hole that is filled.
    if (declared) {
      problems.push(`${name} is declared "${declared[0]}" and ${[...carriers].join(', ')} now authors it`
        + ' — drop the entry; the evidence answers for it');
    }
    continue;
  }

  if (!declared) {
    problems.push(`no corpus scene or prefab authors ${name}, and nothing says why`
      + ' — add it to an example, or give it a disposition (code-only / structural / derived / owed)'
      + ' in tools/check-corpus-authoring.mjs');
    continue;
  }

  const [kind, reason] = declared;
  if (!(kind in counts)) {
    problems.push(`${name} declares an unknown disposition "${kind}"`);
    continue;
  }
  counts[kind]++;

  if (kind === 'structural') {
    if (hiddenNames && !hiddenNames.has(name)) {
      problems.push(`${name} is declared structural, but the editor's HIDDEN_COMPONENTS does not list it`
        + ' — the Add Component menu offers it, so a person can author it');
    }
    continue;
  }
  if (!reason) {
    problems.push(`${name} is declared "${kind}" with no reason — say what the silence means`);
    continue;
  }
  if (kind === 'code-only' && !inCode.has(name)) {
    problems.push(`${name} is declared code-only and no example imports it either`
      + ' — it is owed, not demonstrated');
    continue;
  }
  if (kind === 'owed') owed.push(`  ${name} — ${reason}`);
}

for (const name of unused) {
  problems.push(`DISPOSITION names "${name}", which the engine no longer registers as an authorable component`);
}

if (process.argv.includes('--list')) {
  console.log(`${authorable.length} authorable component(s): `
    + Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', '));
  if (owed.length) console.log(`owed — nothing in the shipped corpus authors it:\n${owed.join('\n')}`);
}

if (problems.length) {
  console.error(`check-corpus-authoring: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const note = hiddenNames ? '' : ' (no editor checkout — "structural" was not verified against HIDDEN_COMPONENTS)';
console.log(`check-corpus-authoring: ${authorable.length} authorable component(s) judged`
  + ` — ${counts.authored} authored in the corpus, ${counts['code-only']} demonstrated from code,`
  + ` ${counts.structural} structural, ${counts.derived} engine-written, ${counts.owed} owed`
  + ` (--list names them).${note}`);
