// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Project component-schema extractor (REARCH_EDITOR_REALM.md Phase P2).
 *
 * Builds `.esengine/cache/schemas.json` — the field schema of a project's own
 * components — so the editor's MAIN realm can give unknown/project components a
 * real inspector WITHOUT executing any project code (schema-as-artifact).
 *
 * How: esbuild-bundle the project's DECLARATION entry (`src/components.ts`) with
 * the SDK (`esengine`) inlined, run it in a FRESH `AppContext`, read
 * `getUserComponents()`, and serialize each component's `{name,isTag,default,
 * colorKeys,assetFields,spineFields,entityFields}`.
 *
 * Zero wasm: `defineComponent`/`AppContext`/`createComponentDef` are pure JS and
 * systems are only queued (never run). The fresh context isolates the project's
 * components from the SDK's own `defineComponent` ones (Name/SceneOwner/…), so
 * those — and the C++ builtins — never leak into schemas.json.
 *
 * Pure Node (esbuild + fs/path/url), no Electron imports → unit-testable and
 * reusable; the IPC wiring lives in main.ts.
 */
import type { Plugin } from 'esbuild';
import { loadEsbuild } from '../../pipeline/src/bundle/esbuildRuntime';
import { esengineAlias } from '../../pipeline/src/bundle/esengineResolve';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Default pure declaration module (only defineComponent/defineTag, no startup). */
const DEFAULT_DECL_ENTRY = 'src/components.ts';
/** Local, gitignored cache inside the project (next to workspace.json). */
const CACHE_DIR = '.esengine/cache';
const OUTPUT = 'schemas.json';

/**
 * Anchor for resolving the bare `esengine` specifier when no `sdkDir` is given.
 * This file lives inside the desktop package (which depends on `esengine`), so
 * esbuild walks up from here to `desktop/node_modules/esengine` no matter where
 * the project itself lives — a project under /tmp has no esengine in its own
 * node_modules (cf. build-scripts).
 *
 * Walking up only works when this file sits on the REAL filesystem. Once packaged
 * it does not: it lives inside app.asar, which Node reads through a patched fs but
 * esbuild — a native subprocess — cannot see into at all. That is why callers in
 * the app pass `sdkDir` (main.ts SDK_DIST, retargeted to the app.asar.unpacked
 * twin); the walk-up stays for tests and any consumer running from source.
 *
 * It is the plugin's anchor and nothing else's — never the generated entry's
 * `resolveDir`, which must be a directory esbuild can actually see (see below).
 */
const ANCHOR_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The serialized field schema of one project component. */
export interface ComponentSchema {
  name: string;
  /** True for `defineTag` components (no data fields). */
  isTag: boolean;
  /** Default field values — the inspector infers controls from these. */
  default: Record<string, unknown>;
  /** Field keys whose value is an {r,g,b,a} color (render as a color picker). */
  colorKeys: string[];
  /** Asset-reference field metadata (e.g. textures). */
  assetFields: unknown[];
  /** Spine field metadata, when present. */
  spineFields?: unknown;
  /** Field keys that hold an Entity handle. */
  entityFields: string[];
  /** Keyframeable field paths (Sequencer tracks). */
  animatableFields: string[];
  /** Per-field editor metadata (enum + numeric range/unit), keyed by field name. */
  fields?: Record<string, SerializedFieldMeta>;
}

/** The serialized editor metadata of one component field. */
export interface SerializedFieldMeta {
  enum?: Array<{ label: string; value: number }>;
  enumSource?: string;
  flags?: Array<{ label: string; value: number }>;
  bitmask?: { bits?: number; source?: string };
  gradient?: boolean;
  curve?: boolean;
  min?: number;
  max?: number;
  step?: number;
  slider?: boolean;
  unit?: string;
  advanced?: boolean;
  category?: string;
  tooltip?: string;
  label?: string;
}

/**
 * A project-registered action, as the editor's palettes need it: the name, and
 * (when it declared them) the parameters that decide which controls to render.
 * The editor's own realm never runs project code, so this artifact is the only
 * way a game's `registerAction('game.startRun', …)` can appear in a dropdown.
 */
export interface ProjectActionSchema {
  name: string;
  /** Declared parameters, verbatim from the registry (see sdk registry.ts). */
  params?: unknown[];
  /** Separator of the canonical string form, when not the default ':'. */
  separator?: string;
}

/** The whole artifact: what the editor knows about a project's declarations. */
export interface SchemasArtifact {
  components: ComponentSchema[];
  actions: ProjectActionSchema[];
  conditions: string[];
}

export interface ExtractSchemasResult {
  ok: boolean;
  /** Absolute path to the written schemas.json, or null on failure. */
  outputPath: string | null;
  /** The extracted component schemas (also written to outputPath). */
  schemas: ComponentSchema[];
  /** The project's own registered actions / conditions (same artifact). */
  actions: ProjectActionSchema[];
  conditions: string[];
  errors: string[];
  warnings: string[];
}

/**
 * Force every `esengine` (and `esengine/*`) import — from the generated entry
 * AND from the project's own modules — to resolve from {@link ANCHOR_DIR} and be
 * inlined, instead of from the importer's location (which, for a /tmp project,
 * has no esengine). Anchoring all of them at one path also guarantees a SINGLE
 * SDK instance, so the registry the entry reads is the one the project wrote.
 */
function esengineAnchor(): Plugin {
  return {
    name: 'esengine-anchor',
    setup(b) {
      b.onResolve({ filter: /^esengine($|\/)/ }, async (args) => {
        if (args.pluginData === 'anchored') return undefined; // fall through to default resolver
        const r = await b.resolve(args.path, {
          kind: 'import-statement',
          resolveDir: ANCHOR_DIR,
          pluginData: 'anchored',
        });
        if (r.errors.length) return { errors: r.errors };
        return { path: r.path, external: r.external };
      });
    },
  };
}

/** Write the schemas artifact and return its absolute path. */
function writeSchemas(root: string, artifact: SchemasArtifact): string {
  const outputPath = path.join(root, CACHE_DIR, OUTPUT);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(artifact, null, 2) + '\n');
  return outputPath;
}

const EMPTY: SchemasArtifact = { components: [], actions: [], conditions: [] };

/**
 * Extract the project's component schemas from `<root>/<entry>` (project-relative,
 * default `src/components.ts`) → `<root>/.esengine/cache/schemas.json`. Never
 * throws — failures come back as `{ ok:false, errors }`.
 *
 * A missing entry: if `required` (the manifest explicitly named it) it's an
 * error; otherwise the project simply has no custom components → an empty
 * artifact is written and `ok:true` returned.
 *
 * `sdkDir` is the SDK dist esbuild inlines `esengine` from — the same alias every
 * inlined export pipeline uses (esengineResolve.ts). Pass it whenever the caller
 * knows a real-filesystem dist: without it resolution walks up from
 * {@link ANCHOR_DIR}, which a packaged app cannot do.
 */
export async function extractProjectSchemas(
  root: string,
  opts?: { entry?: string; required?: boolean; sdkDir?: string },
): Promise<ExtractSchemasResult> {
  const declPath = path.join(root, opts?.entry ?? DEFAULT_DECL_ENTRY);
  if (!existsSync(declPath)) {
    if (opts?.required) {
      return {
        ok: false, outputPath: null, schemas: [], actions: [], conditions: [],
        errors: [`declaration entry not found: ${declPath}`], warnings: [],
      };
    }
    return { ok: true, outputPath: writeSchemas(root, EMPTY), schemas: [], actions: [], conditions: [], errors: [], warnings: [] };
  }

  // Generated entry: install a fresh context FIRST (top-level, so it runs before
  // any project code), then defer the declaration's side effects to a dynamic
  // import inside __extract() and hand back what it declared.
  //
  // It imports the declaration RELATIVE to the project root, and is bundled with
  // `resolveDir` there — like every other generated entry here (exportPlayable /
  // exportMiniGame). esbuild resolves an import against the importer's directory
  // and REFUSES it — an absolute one included — when that directory does not
  // exist; the entry used to sit at ANCHOR_DIR, which packaged is inside
  // app.asar, so no shipped build could resolve the declaration entry at all.
  // A relative specifier also keeps the wrong resolveDir from ever passing
  // silently again: it resolves from the project or not at all.
  //
  // Actions come from the SAME module for the same reason components do: a
  // `registerAction` IS a declaration, and this is the one project module the
  // editor may evaluate. The registry is diffed around the import so only the
  // project's own names are reported — the engine's builtins register when their
  // plugins build, which never happens here, but a diff keeps that an invariant
  // rather than a coincidence.
  const declSpecifier = `./${path.relative(root, declPath).split(path.sep).join('/')}`;
  const entry =
    `import { AppContext, setDefaultContext, getUserComponents, aiRegistry } from 'esengine';\n` +
    `setDefaultContext(new AppContext());\n` +
    `export async function __extract() {\n` +
    `  const before = new Set(aiRegistry.actionNames());\n` +
    `  const beforeConds = new Set(aiRegistry.conditionNames());\n` +
    `  await import(${JSON.stringify(declSpecifier)});\n` +
    `  const actions = aiRegistry.actionNames().filter((n) => !before.has(n)).map((name) => ({\n` +
    `    name,\n` +
    `    params: aiRegistry.getActionParams(name),\n` +
    `    separator: aiRegistry.getActionSeparator(name),\n` +
    `  }));\n` +
    `  const conditions = aiRegistry.conditionNames().filter((n) => !beforeConds.has(n));\n` +
    `  return { components: getUserComponents(), actions, conditions };\n` +
    `}\n`;

  const tmp = mkdtempSync(path.join(tmpdir(), 'estella-schema-'));
  const bundlePath = path.join(tmp, 'extract.mjs');
  const warnings: string[] = [];
  try {
    const { build } = await loadEsbuild();
    const result = await build({
      stdin: { contents: entry, resolveDir: root, loader: 'ts', sourcefile: 'extract-entry.ts' },
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node18',
      outfile: bundlePath,
      write: true,
      sourcemap: false,
      logLevel: 'silent',
      // One strategy or the other, never both: an alias names the SDK's files
      // outright (and so still yields the SINGLE instance the anchor plugin was
      // there to guarantee — every importer lands on the same absolute path).
      ...(opts?.sdkDir
        ? { alias: esengineAlias(opts.sdkDir) }
        : { plugins: [esengineAnchor()] }),
    });
    warnings.push(...result.warnings.map((w) => w.text));

    interface Extracted {
      components: Map<string, unknown>;
      actions: ProjectActionSchema[];
      conditions: string[];
    }
    const mod: { __extract(): Promise<Extracted> } = await import(pathToFileURL(bundlePath).href);
    const declared = await mod.__extract();
    // Deterministic output throughout — the artifact is compared byte-wise by
    // the incremental cache and read by humans in diffs.
    // A declaration whose name is not a string cannot be sorted, serialized or
    // looked up, and the sort is where it used to surface — as
    // "e.name.localeCompare is not a function", a stack away from the call that
    // caused it and naming neither the component nor the mistake. Newer SDKs
    // refuse it at defineComponent; a project pinned to an older one still gets
    // told which declaration is the bad one instead of a stray TypeError.
    const schemas = [...declared.components.values()].map(toSchema);
    const unnamed = schemas.find((s) => typeof s.name !== 'string' || s.name === '');
    if (unnamed) {
      throw new Error(
        `a component was declared without a string name (got ${typeof unnamed.name}). `
        + "defineComponent takes the NAME first and the defaults second — defineComponent('MyThing', "
        + '{ speed: 100 }).',
      );
    }
    schemas.sort((a, b) => a.name.localeCompare(b.name));
    const actions = declared.actions
      .map((a) => normalizeAction(a))
      .sort((a, b) => a.name.localeCompare(b.name));
    const conditions = [...declared.conditions].sort();

    return {
      ok: true,
      outputPath: writeSchemas(root, { components: schemas, actions, conditions }),
      schemas,
      actions,
      conditions,
      errors: [],
      warnings,
    };
  } catch (err) {
    const e = err as { errors?: { text: string }[]; warnings?: { text: string }[]; message?: string };
    return {
      ok: false,
      outputPath: null,
      schemas: [],
      actions: [],
      conditions: [],
      errors: e.errors?.map((x) => x.text) ?? [String(e.message ?? err)],
      warnings: e.warnings?.map((x) => x.text) ?? warnings,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Drop the fields that carry no information, so the artifact stays readable. */
function normalizeAction(a: ProjectActionSchema): ProjectActionSchema {
  const out: ProjectActionSchema = { name: a.name };
  if (a.params && a.params.length) out.params = a.params;
  if (a.separator && a.separator !== ':') out.separator = a.separator;
  return out;
}

/** A user ComponentDef carries the field metadata; see sdk component.ts. */
interface UserComponentDef {
  _name: string;
  _default?: Record<string, unknown>;
  colorKeys?: readonly string[];
  assetFields?: readonly unknown[];
  spineFields?: unknown;
  entityFields?: readonly string[];
  animatableFields?: readonly string[];
  fieldMeta?: Record<string, SerializedFieldMeta & { advanced?: boolean; category?: string; flags?: Array<{ label: string; value: number }> }>;
}

// Keep only fields the inspector actually consumes (enum / numeric range / unit),
// dropping empties so schemas.json doesn't balloon with `{}` per field.
function pickFieldMeta(
  fieldMeta: UserComponentDef['fieldMeta'],
): ComponentSchema['fields'] | undefined {
  if (!fieldMeta) return undefined;
  const out: Record<string, SerializedFieldMeta> = {};
  for (const [key, meta] of Object.entries(fieldMeta)) {
    const m: SerializedFieldMeta = {};
    if (meta.enum && meta.enum.length) m.enum = meta.enum.map((o) => ({ ...o }));
    if (meta.enumSource) m.enumSource = meta.enumSource;
    if (meta.flags && meta.flags.length) m.flags = meta.flags.map((o) => ({ ...o }));
    if (meta.bitmask) m.bitmask = { ...meta.bitmask };
    if (meta.gradient) m.gradient = true;
    if (meta.curve) m.curve = true;
    if (meta.min != null) m.min = meta.min;
    if (meta.max != null) m.max = meta.max;
    if (meta.step != null) m.step = meta.step;
    if (meta.slider != null) m.slider = meta.slider;
    if (meta.unit != null) m.unit = meta.unit;
    if (meta.advanced != null) m.advanced = meta.advanced;
    if (meta.category != null) m.category = meta.category;
    if (meta.tooltip != null) m.tooltip = meta.tooltip;
    if (meta.label != null) m.label = meta.label;
    if (Object.keys(m).length) out[key] = m;
  }
  return Object.keys(out).length ? out : undefined;
}

function toSchema(def: unknown): ComponentSchema {
  const d = def as UserComponentDef;
  const defaults = d._default ?? {};
  const schema: ComponentSchema = {
    name: d._name,
    isTag: Object.keys(defaults).length === 0,
    default: defaults,
    colorKeys: [...(d.colorKeys ?? [])],
    assetFields: [...(d.assetFields ?? [])],
    entityFields: [...(d.entityFields ?? [])],
    animatableFields: [...(d.animatableFields ?? [])],
  };
  if (d.spineFields) schema.spineFields = d.spineFields;
  const fields = pickFieldMeta(d.fieldMeta);
  if (fields) schema.fields = fields;
  return schema;
}
