// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
import { build, type Plugin } from 'esbuild';
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
 * Anchor for resolving the bare `esengine` specifier. This file lives inside the
 * desktop package (which depends on `esengine`), so esbuild walks up from here to
 * `desktop/node_modules/esengine` no matter where the project itself lives — a
 * project under /tmp has no esengine in its own node_modules (cf. build-scripts).
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
  /** Per-field editor metadata (enum + numeric range/unit), keyed by field name. */
  fields?: Record<string, SerializedFieldMeta>;
}

/** The serialized editor metadata of one component field. */
export interface SerializedFieldMeta {
  enum?: Array<{ label: string; value: number }>;
  min?: number;
  max?: number;
  step?: number;
  slider?: boolean;
  unit?: string;
  advanced?: boolean;
  category?: string;
}

export interface ExtractSchemasResult {
  ok: boolean;
  /** Absolute path to the written schemas.json, or null on failure. */
  outputPath: string | null;
  /** The extracted schemas (also written to outputPath). */
  schemas: ComponentSchema[];
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
function writeSchemas(root: string, schemas: ComponentSchema[]): string {
  const outputPath = path.join(root, CACHE_DIR, OUTPUT);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(schemas, null, 2) + '\n');
  return outputPath;
}

/**
 * Extract the project's component schemas from `<root>/<entry>` (project-relative,
 * default `src/components.ts`) → `<root>/.esengine/cache/schemas.json`. Never
 * throws — failures come back as `{ ok:false, errors }`.
 *
 * A missing entry: if `required` (the manifest explicitly named it) it's an
 * error; otherwise the project simply has no custom components → an empty
 * artifact is written and `ok:true` returned.
 */
export async function extractProjectSchemas(
  root: string,
  opts?: { entry?: string; required?: boolean },
): Promise<ExtractSchemasResult> {
  const declPath = path.join(root, opts?.entry ?? DEFAULT_DECL_ENTRY);
  if (!existsSync(declPath)) {
    if (opts?.required) {
      return { ok: false, outputPath: null, schemas: [], errors: [`declaration entry not found: ${declPath}`], warnings: [] };
    }
    return { ok: true, outputPath: writeSchemas(root, []), schemas: [], errors: [], warnings: [] };
  }

  // Generated entry: install a fresh context FIRST (top-level, so it runs before
  // any project code), then defer the declaration's `defineComponent` side
  // effects to a dynamic import inside __extract() and hand back the registry.
  const entry =
    `import { AppContext, setDefaultContext, getUserComponents } from 'esengine';\n` +
    `setDefaultContext(new AppContext());\n` +
    `export async function __extract() {\n` +
    `  await import(${JSON.stringify(declPath)});\n` +
    `  return getUserComponents();\n` +
    `}\n`;

  const tmp = mkdtempSync(path.join(tmpdir(), 'estella-schema-'));
  const bundlePath = path.join(tmp, 'extract.mjs');
  const warnings: string[] = [];
  try {
    const result = await build({
      stdin: { contents: entry, resolveDir: ANCHOR_DIR, loader: 'ts', sourcefile: 'extract-entry.ts' },
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node18',
      outfile: bundlePath,
      write: true,
      sourcemap: false,
      logLevel: 'silent',
      plugins: [esengineAnchor()],
    });
    warnings.push(...result.warnings.map((w) => w.text));

    const mod: { __extract(): Promise<Map<string, unknown>> } = await import(pathToFileURL(bundlePath).href);
    const registry = await mod.__extract();
    const schemas = [...registry.values()]
      .map(toSchema)
      .sort((a, b) => a.name.localeCompare(b.name)); // deterministic output

    return { ok: true, outputPath: writeSchemas(root, schemas), schemas, errors: [], warnings };
  } catch (err) {
    const e = err as { errors?: { text: string }[]; warnings?: { text: string }[]; message?: string };
    return {
      ok: false,
      outputPath: null,
      schemas: [],
      errors: e.errors?.map((x) => x.text) ?? [String(e.message ?? err)],
      warnings: e.warnings?.map((x) => x.text) ?? warnings,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** A user ComponentDef carries the field metadata; see sdk component.ts. */
interface UserComponentDef {
  _name: string;
  _default?: Record<string, unknown>;
  colorKeys?: readonly string[];
  assetFields?: readonly unknown[];
  spineFields?: unknown;
  entityFields?: readonly string[];
  fieldMeta?: Record<string, SerializedFieldMeta & { advanced?: boolean; category?: string }>;
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
    if (meta.min != null) m.min = meta.min;
    if (meta.max != null) m.max = meta.max;
    if (meta.step != null) m.step = meta.step;
    if (meta.slider != null) m.slider = meta.slider;
    if (meta.unit != null) m.unit = meta.unit;
    if (meta.advanced != null) m.advanced = meta.advanced;
    if (meta.category != null) m.category = meta.category;
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
  };
  if (d.spineFields) schema.spineFields = d.spineFields;
  const fields = pickFieldMeta(d.fieldMeta);
  if (fields) schema.fields = fields;
  return schema;
}
