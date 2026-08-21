// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    component-reference.mjs
 * @brief   The component reference the docs render, generated from the engine's
 *          own component registry.
 *
 * Every component a game can author, with its fields, types and authoring
 * defaults, is already described by the registry the editor's Details panel
 * reads: `getComponentRegistry()` returns each definition's merged defaults
 * (C++ ctor values with the `editor_default=` overrides applied — what you
 * actually get when you add the component), plus the asset / entity / colour /
 * enum / range / tooltip metadata authored at the C++ `ES_PROPERTY` site. Hand
 * a writer that list and it drifts the first time someone adds a field; derive
 * it and it cannot.
 *
 * Run: node tools/component-reference.mjs --update   (refresh the snapshot)
 *      node tools/component-reference.mjs --check    (CI: exit 1 on drift)
 *
 * `--update` loads the built SDK, so build it first:
 *     pnpm --filter ./sdk exec rollup -c
 *
 * `--check` needs no build. It enumerates the component NAMES straight from
 * source — every `defineComponent` / `defineBuiltin` / `defineTag` call site
 * plus every key of the EHT-generated COMPONENT_META — and fails when that set
 * disagrees with the snapshot, or when the docs' curated table (which supplies
 * each component's category and the guide that explains it) has drifted from
 * either. When a built SDK happens to be present it additionally re-derives the
 * field data and diffs that too, so a changed field is caught wherever the
 * stronger check can run.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { componentNamesFromSource } from './lib/componentNames.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const SDK_SRC = join(ROOT, 'sdk', 'src');
const SDK_DIST = join(ROOT, 'sdk', 'dist', 'index.node.js');
const SNAPSHOT = join(ROOT, 'docs', 'astro', 'src', 'data', 'components.generated.json');
const CURATED = join(ROOT, 'docs', 'astro', 'src', 'data', 'componentDocs.ts');
const DOC_PAGES = join(ROOT, 'docs', 'astro', 'src', 'content', 'docs');
// The editor's Details panel links each component header at its reference entry;
// the address is derived here so the two can never point at different pages. The
// editor is an optional submodule, so this is checked when there is one to check.
const EDITOR_LINKS = join(ROOT, 'desktop', 'src', 'engine', 'componentDocs.generated.ts');
const HAS_EDITOR = existsSync(join(ROOT, 'desktop', 'package.json'));

const mode = process.argv[2];
if (mode !== '--check' && mode !== '--update') {
  console.error('usage: node tools/component-reference.mjs --check | --update');
  process.exit(2);
}

// ── enumerating the components ───────────────────────────────────────────────

// The enumerator is shared with check-inspector-door, which refuses a component
// name written as a literal in the Details panel's render path. One definition,
// so a component cannot be known to one check and invisible to the other.
const namesFromSource = componentNamesFromSource;

// ── describing one component ─────────────────────────────────────────────────

const isVec = (v, ...keys) => {
  const k = Object.keys(v);
  return k.length === keys.length && keys.every((x) => k.includes(x));
};

function typeOf(def, key, value) {
  const asset = def.assetFields?.find((a) => a.field === key);
  if (asset) return `Asset<${asset.type}>`;
  if (def.entityFields?.includes(key)) return 'Entity';
  if (def.colorKeys?.includes(key)) return 'Color';
  const meta = def.fieldMeta?.[key];
  if (meta?.enum) return 'enum';
  if (meta?.enumSource) return `enum (${meta.enumSource})`;
  if (value === null || value === undefined) return 'unknown';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array';
    return `${typeOf(def, key, value[0])}[]`;
  }
  switch (typeof value) {
    case 'boolean': return 'boolean';
    case 'number': return 'number';
    case 'string': return 'string';
    case 'object':
      if (isVec(value, 'x', 'y')) return 'Vec2';
      if (isVec(value, 'x', 'y', 'z')) return 'Vec3';
      // A quaternion and a vec4 have the same shape; only the field's meaning
      // tells them apart, and rotation is the one the engine stores as a quat.
      if (isVec(value, 'x', 'y', 'z', 'w')) return /rotation/i.test(key) ? 'Quat' : 'Vec4';
      if (isVec(value, 'r', 'g', 'b', 'a')) return 'Color';
      if (isVec(value, 'top', 'right', 'bottom', 'left')) return 'Padding';
      if (isVec(value, 'value', 'unit')) return 'Dimension';
      return 'object';
    default: return typeof value;
  }
}

const num = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));

function formatDefault(def, key, value, type) {
  if (type.startsWith('Asset<') || type === 'Entity') return value ? String(value) : 'none';
  const meta = def.fieldMeta?.[key];
  if (meta?.enum) {
    const hit = meta.enum.find((o) => o.value === value);
    return hit ? hit.label : String(value);
  }
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : 'empty';
  switch (typeof value) {
    case 'boolean': return String(value);
    case 'number': return num(value);
    case 'string': return value === '' ? 'empty' : `"${value}"`;
    case 'object': {
      if (type === 'Color') {
        const hex = (c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0');
        return `#${hex(value.r)}${hex(value.g)}${hex(value.b)}${value.a === 1 ? '' : hex(value.a)}`;
      }
      if (type === 'Vec2' || type === 'Vec3' || type === 'Vec4' || type === 'Quat') {
        // Component order, not key order: the engine stores a quaternion as
        // {w,x,y,z}, and printing that verbatim reads as x=1 for the identity.
        const order = ['x', 'y', 'z', 'w'].filter((k) => k in value);
        return `(${order.map((k) => num(value[k])).join(', ')})`;
      }
      const json = JSON.stringify(value);
      return json === '{}' ? 'empty' : json;
    }
    default: return String(value);
  }
}

function range(meta) {
  if (!meta) return undefined;
  const { min, max, step } = meta;
  if (min === undefined && max === undefined && step === undefined) return undefined;
  const parts = [];
  if (min !== undefined && max !== undefined) parts.push(`${num(min)}–${num(max)}`);
  else if (min !== undefined) parts.push(`≥ ${num(min)}`);
  else if (max !== undefined) parts.push(`≤ ${num(max)}`);
  if (step !== undefined) parts.push(`step ${num(step)}`);
  return parts.join(', ');
}

function describe(name, def) {
  const defaults = def._default ?? {};
  const keys = Object.keys(defaults);
  const fields = keys.map((key) => {
    const value = defaults[key];
    const meta = def.fieldMeta?.[key];
    const type = typeOf(def, key, value);
    const f = { key, type, default: formatDefault(def, key, value, type) };
    if (meta?.tooltip) f.doc = meta.tooltip;
    const r = range(meta);
    if (r) f.range = r;
    if (meta?.enum) f.values = meta.enum.map((o) => o.label);
    if (def.readonlyFields?.includes(key)) f.readonly = true;
    if (def.replicatedFields?.includes(key)) f.replicated = true;
    if (meta?.advanced) f.advanced = true;
    return f;
  });
  const c = { name, source: def._builtin ? 'cpp' : 'ts', fields };
  if (keys.length === 0) c.tag = true;
  if (def.transient) c.transient = true;
  if (def.animatableFields?.length) c.animatable = def.animatableFields;
  return c;
}

async function snapshotFromSdk() {
  if (!existsSync(SDK_DIST)) {
    throw new Error(
      `no built SDK at ${SDK_DIST}\n  build it first:  pnpm --filter ./sdk exec rollup -c`,
    );
  }
  // The node entry registers every engine component at module load and needs no
  // wasm — loading the module IS the enumeration.
  const sdk = await import(pathToFileURL(SDK_DIST).href);
  const reg = sdk.getComponentRegistry();
  const components = [...reg.keys()].sort().map((n) => describe(n, reg.get(n)));
  return { generatedBy: 'tools/component-reference.mjs', abiLayoutHash: sdk.ABI_LAYOUT_HASH ?? null, components };
}

// ── the curated half ─────────────────────────────────────────────────────────

/** Component names the docs' curated table claims, without parsing TypeScript:
 *  each entry starts a line as `  Name: {`. */
function curatedNames() {
  if (!existsSync(CURATED)) return null;
  const src = readFileSync(CURATED, 'utf8');
  return [...src.matchAll(/^ {2}([A-Za-z0-9_]+): \{/gm)].map((m) => m[1]).sort();
}

/** Where each entry sends a reader: the guide, and the heading in each locale. */
function curatedTargets() {
  if (!existsSync(CURATED)) return [];
  const src = readFileSync(CURATED, 'utf8');
  const out = [];
  for (const m of src.matchAll(/^ {2}([A-Za-z0-9_]+): \{(.*)$/gm)) {
    const doc = /doc: '([^']+)'/.exec(m[2]);
    if (!doc) continue;
    out.push({
      name: m[1],
      doc: doc[1],
      anchor: /anchor: '([^']*)'/.exec(m[2])?.[1],
      anchorZh: /anchorZh: '([^']*)'/.exec(m[2])?.[1],
    });
  }
  return out;
}

/** GitHub's heading-slug rule, which is what the site gives its headings: drop
 *  all but letters, digits, `-` and `_`, then each surviving space becomes a
 *  hyphen — "Text & code" is `text--code`, with two. A Chinese heading slugs to
 *  its own characters, never to the English page's slug. */
const slugOf = (heading) =>
  heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .trim()
    .replace(/ /g, '-');

const headingCache = new Map();
/** The anchors one guide offers. Fenced blocks are skipped: a shell comment is
 *  not a heading. */
function headingSlugs(file) {
  let slugs = headingCache.get(file);
  if (slugs) return slugs;
  slugs = new Set();
  let fenced = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) {
      const h = /^#{2,6}\s+(.+?)\s*$/.exec(line);
      if (h) slugs.add(slugOf(h[1]));
    }
  }
  headingCache.set(file, slugs);
  return slugs;
}

/** name -> category, read from the same curated table. */
function curatedCategories() {
  const src = readFileSync(CURATED, 'utf8');
  const out = {};
  for (const m of src.matchAll(/^ {2}([A-Za-z0-9_]+): \{ category: '([a-z]+)'/gm)) out[m[1]] = m[2];
  return out;
}

/** The editor's link table: component -> path under the docs root. */
function editorLinksSource(names) {
  const cats = curatedCategories();
  const rows = names
    .map((n) => `  ${/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `'${n}'`}: 'reference/components/${cats[n]}/#${n.toLowerCase()}',`)
    .join('\n');
  return `// Generated by tools/component-reference.mjs — do not edit. Run --update.
//
// Where the manual documents each component, so the Details panel header can
// link straight there: the question a component's fields provoke is asked while
// looking at them, not while browsing a sidebar.
export const COMPONENT_DOC_PATHS: Readonly<Record<string, string>> = {
${rows}
};
`;
}

/** Component names the editor link table carries. */
function editorLinkNames() {
  if (!existsSync(EDITOR_LINKS)) return null;
  const src = readFileSync(EDITOR_LINKS, 'utf8');
  return [...src.matchAll(/^ {2}'?([A-Za-z0-9_]+)'?: '/gm)].map((m) => m[1]).sort();
}

// ── run ──────────────────────────────────────────────────────────────────────

const diff = (a, b) => ({ missing: b.filter((x) => !a.includes(x)), extra: a.filter((x) => !b.includes(x)) });

if (mode === '--update') {
  const snap = await snapshotFromSdk();
  writeFileSync(SNAPSHOT, `${JSON.stringify(snap, null, 2)}\n`);
  const fields = snap.components.reduce((n, c) => n + c.fields.length, 0);
  console.log(`component-reference: wrote ${snap.components.length} components, ${fields} fields`);
  const names = snap.components.map((c) => c.name);
  const curated = curatedNames();
  if (curated) {
    const d = diff(curated, names);
    if (d.missing.length) console.log(`  still to describe in componentDocs.ts: ${d.missing.join(', ')}`);
    if (d.extra.length) console.log(`  componentDocs.ts names components that no longer exist: ${d.extra.join(', ')}`);
    if (!d.missing.length && !d.extra.length) {
      if (HAS_EDITOR) {
        writeFileSync(EDITOR_LINKS, editorLinksSource(names));
        console.log(`  wrote the editor's link table (${names.length} entries)`);
      } else {
        console.log('  editor link table NOT written — no editor checkout to write it into');
      }
    } else {
      console.log("  editor link table NOT written — describe the components above first");
    }
  }
  process.exit(0);
}

// --check
if (!existsSync(SNAPSHOT)) {
  console.error(`component-reference: no snapshot at ${SNAPSHOT} — run --update`);
  process.exit(1);
}
const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const snapNames = snap.components.map((c) => c.name).sort();
const problems = [];

const fromSource = namesFromSource();
const dSrc = diff(snapNames, fromSource);
for (const n of dSrc.missing) problems.push(`component "${n}" exists in the SDK but is not in the reference snapshot`);
for (const n of dSrc.extra) problems.push(`reference snapshot has "${n}", which the SDK no longer defines`);

const curated = curatedNames();
if (curated === null) problems.push(`missing curated table ${CURATED}`);
else {
  const dCur = diff(curated, snapNames);
  for (const n of dCur.missing) problems.push(`component "${n}" has no entry in componentDocs.ts (category + where it is explained)`);
  for (const n of dCur.extra) problems.push(`componentDocs.ts describes "${n}", which is not a component`);
}

// Where those entries send a reader. The built site's link check knows this too,
// but it needs the site built and so only runs from the docs deploy — which a
// release calls, making a dead anchor a failure at the moment of shipping.
for (const t of curatedTargets()) {
  for (const [locale, rel, anchor] of [
    ['en', `${t.doc}.mdx`, t.anchor],
    ['zh-cn', join('zh-cn', `${t.doc}.mdx`), t.anchorZh],
  ]) {
    const file = join(DOC_PAGES, rel);
    if (!existsSync(file)) {
      problems.push(`componentDocs.ts sends "${t.name}" to ${locale} ${t.doc}, which is not a page`);
      continue;
    }
    if (anchor && !headingSlugs(file).has(anchor)) {
      problems.push(`"${t.name}" links ${locale} ${t.doc}#${anchor}, which is not a heading there`);
    }
  }
}

const links = HAS_EDITOR ? editorLinkNames() : undefined;
if (links === undefined) {
  console.log("component-reference: no editor checkout — its doc-link table was not checked.");
} else if (links === null) problems.push(`missing the editor's link table ${EDITOR_LINKS}`);
else {
  const dLink = diff(links, snapNames);
  for (const n of dLink.missing) problems.push(`the editor's Details panel has no doc link for "${n}"`);
  for (const n of dLink.extra) problems.push(`the editor links docs for "${n}", which is not a component`);
}

// The strongest check, where a built SDK makes it possible.
let deep = 'names only (no built SDK)';
if (existsSync(SDK_DIST)) {
  const fresh = await snapshotFromSdk();
  const a = JSON.stringify(fresh.components), b = JSON.stringify(snap.components);
  if (a !== b) {
    const byName = new Map(snap.components.map((c) => [c.name, JSON.stringify(c)]));
    for (const c of fresh.components) {
      const was = byName.get(c.name);
      if (was && was !== JSON.stringify(c)) problems.push(`"${c.name}" changed — run --update`);
    }
    if (!problems.length) problems.push('the reference snapshot is stale — run --update');
  }
  deep = 'names and field data';
}

if (problems.length) {
  console.error(`component-reference: ${problems.length} problem(s) (checked ${deep})`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\n  refresh with:  pnpm --filter ./sdk exec rollup -c && node tools/component-reference.mjs --update');
  process.exit(1);
}
console.log(`component-reference: ${snapNames.length} components clean (checked ${deep}).`);
