// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    component.ts
 * @brief   Component definition and builtin components
 */

import { Entity, Vec2, Vec3, Color, Quat } from '../types';
import { deepClone } from '../util/deepClone';
import { COMPONENT_META, type AssetFieldMeta, type SkeletalFieldMeta } from './component.generated';
// C++-backed component data shapes, generated from the ES_COMPONENT structs (single
// source — a TS field can no longer drift from C++). Re-exported below so the public
// `esengine` import site is unchanged; Camera/ParticleEmitter add TS-only fields by
// extending the generated base.
import type {
    TransformData, SpriteData, ShapeRendererData, Light2DData, ShadowCaster2DData,
    CanvasData, VelocityData, ParentData, ChildrenData, SpineAnimationData, DragonBonesAnimationData,
    TilemapLayerData, BitmapTextData, TrailRendererData, ParticleForceFieldData,
    CameraData as CameraDataCpp, ParticleEmitterData as ParticleEmitterDataCpp,
    Mesh2DData as Mesh2DDataCpp,
} from './component.generated';
// Builtin enums whose values come from C++ ES_ENUMs — imported from the generated
// module (single source) and re-exported below, so a TS const cannot drift from the
// C++ enum and the editor dropdowns derive from the same values. ScaleMode's
// canonical values come from CanvasScaleMode (only its Cocos-compat aliases
// ShowAll/NoBorder are TS-side).
import { ProjectionType, ClearFlags, EmitterShape, SimulationSpace, SubEmitterTrigger, ForceFieldType, Light2DType, CanvasScaleMode, ShapeType, ParticleEasing } from '../wasm/wasm.generated';
import { BlendMode } from '../render/blend';
import { getDefaultContext } from './context';
import type {
    RigidBodyData, BoxColliderData, CircleColliderData, CapsuleColliderData,
} from '../physics/PhysicsComponents';

// =============================================================================
// Self-Describing Component Types
// =============================================================================

export interface AssetRef {
    type: string;
    path: string;
}

/**
 * Per-field editor presentation metadata — the engine's UPROPERTY analog. A
 * component declares it once at its definition site; the editor's inspector reads
 * it via {@link getComponentFieldMeta} and renders the matching control, falling
 * back to value-shape inference for any field without metadata. None of this is
 * read by the runtime (which stores raw values); it is purely authoring policy
 * co-located with the component so the inspector and the data never diverge.
 */
export interface FieldMeta {
    /** Render as a dropdown of these options; the stored value is the option's int. */
    enum?: ReadonlyArray<{ label: string; value: number }>;
    /**
     * Render as a dropdown whose options are resolved by the editor from a named
     * source (e.g. project sorting layers) — falls back to a plain number when the
     * source yields none, so free-int editing survives a project with no named set.
     */
    enumSource?: string;
    /** Render as a bitmask multi-select; each option is a single bit. */
    flags?: ReadonlyArray<{ label: string; value: number }>;
    /** Render as a color-gradient editor (the field value is `{ stops: [...] }`). */
    gradient?: boolean;
    /** Render as a scalar over-life curve editor (the field value is `{ keys: [...] }`). */
    curve?: boolean;
    /** Render as a key→value string map editor (the field value is `Record<string,string>`)
     *  — arbitrary user properties (e.g. a Marker's gameplay data), like Tiled's custom
     *  properties. Value-shape inference can't tell a property map from any other object,
     *  so a field must opt in here. */
    map?: boolean;
    /**
     * Render as a bitmask whose bit LABELS are resolved by the editor (e.g. named
     * collision layers from project settings) rather than fixed here. `bits` is the
     * count (default 32); `source` names the editor's label provider.
     */
    bitmask?: { bits?: number; source?: string };
    /** Hard numeric range — clamps both typed entry and drag-scrub. */
    min?: number;
    max?: number;
    /** Scrub/step granularity (per pixel for drag, per arrow for the input). */
    step?: number;
    /** Render the number as a slider; requires a finite {@link min}/{@link max}. */
    slider?: boolean;
    /** Unit shown after the resting value (e.g. '°', 'px', '%'). */
    unit?: string;
    /** Human label / tooltip overriding the key-derived ones. */
    label?: string;
    tooltip?: string;
    /** Group under a category header; `advanced` tucks the field behind a fold. */
    category?: string;
    advanced?: boolean;
}

export interface ComponentMetadata {
    assetFields?: AssetFieldMeta[];
    skeletalFields?: SkeletalFieldMeta;
    entityFields?: string[];
    /** Per-field editor presentation policy, keyed by field name. */
    fields?: Record<string, FieldMeta>;
    /** Keyframeable fields (Sequencer tracks); auto-derived from numeric fields if omitted. */
    animatableFields?: string[];
    /**
     * Fields the network replication layer syncs (RC11). Whole-field granularity;
     * omitted = the component never replicates. Builtins author this at the C++
     * ES_PROPERTY site (`replicated`) instead — same single-source rule as fieldMeta.
     */
    replicatedFields?: string[];
    /**
     * Engine-COMPUTED output fields (Transform's world-space fields), authored
     * `readonly` at the C++ ES_PROPERTY site. Never authoring inputs — the editor
     * must not project them into the World (it clobbers the composed value).
     */
    readonlyFields?: string[];
    /**
     * Custom asset discovery for scene preload. Authoritative when present:
     * `assetFields` are NOT walked for discovery (they still drive editor
     * pickers/ref rewrites), so the callback can exclude values that are not
     * asset refs (e.g. code-registered FSM/BT names).
     */
    discoverAssets?: (data: Record<string, unknown>) => AssetRef[];
    /**
     * Runtime-only state that must never persist: a transient component is
     * skipped by {@link serializeScene} (e.g. per-frame pointer/drag/hover state
     * that its driving system rebuilds each frame). Systems still
     * read/write it normally; only scene save omits it.
     *
     * Builtins author this at the C++ `ES_COMPONENT(transient)` site — same
     * single-source rule as fieldMeta.
     */
    transient?: boolean;
    /**
     * The name of the bool field that gates this component's part in an entity's
     * visibility — set it and {@link setEntityVisible}, the editor's eye and scene
     * sleep/wake all reach this component. Omitted = the component draws nothing.
     * Builtins author it at the C++ `ES_COMPONENT(renderable=<field>)` site.
     */
    renderableField?: string;
}

/**
 * Build dropdown options from an enum const, so the labels derive from the same
 * definition the runtime uses (no hand-mirrored value→label drift). `only` curates
 * the member set when an enum carries alias entries that share a value (e.g.
 * ScaleMode); otherwise duplicate values are dropped, keeping the first label.
 */
export function enumOptions(
    obj: Record<string, unknown>,
    only?: readonly string[],
): ReadonlyArray<{ label: string; value: number }> {
    const seen = new Set<number>();
    const out: { label: string; value: number }[] = [];
    for (const [k, v] of Object.entries(obj)) {
        // A TS numeric `enum` also carries reverse (value→name) entries; only the
        // name→number direction is a real option.
        if (typeof v !== 'number') continue;
        if (only ? !only.includes(k) : seen.has(v)) continue;
        seen.add(v);
        out.push({ label: k, value: v });
    }
    return out;
}

// =============================================================================
// Component Definition
// =============================================================================

export interface ComponentDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _default: T;
    readonly _builtin: false;
    readonly assetFields: readonly AssetFieldMeta[];
    readonly skeletalFields?: SkeletalFieldMeta;
    readonly entityFields: readonly string[];
    readonly colorKeys: readonly string[];
    readonly animatableFields: readonly string[];
    /** Fields the replication layer syncs; empty = never replicates. See {@link ComponentMetadata.replicatedFields}. */
    readonly replicatedFields: readonly string[];
    /** Engine-computed output fields the editor must never write back. See {@link ComponentMetadata.readonlyFields}. */
    readonly readonlyFields: readonly string[];
    readonly fieldMeta: Readonly<Record<string, FieldMeta>>;
    readonly discoverAssets?: (data: Record<string, unknown>) => AssetRef[];
    /** Runtime-only: omitted from scene serialization. See {@link ComponentMetadata.transient}. */
    readonly transient: boolean;
    /** Bool field gating this component's visibility, or null if it draws nothing.
     *  See {@link ComponentMetadata.renderableField}. */
    readonly renderableField: string | null;
    create(data?: Partial<T>): T;
}

function classifyKeys(obj: object): { flatKeys: string[]; objectKeys: string[]; arrayKeys: string[] } | null {
    const flatKeys: string[] = [];
    const objectKeys: string[] = [];
    const arrayKeys: string[] = [];
    let hasNested = false;
    for (const key in obj) {
        const val = (obj as Record<string, unknown>)[key];
        if (val !== null && typeof val === 'object') {
            hasNested = true;
            if (Array.isArray(val)) {
                arrayKeys.push(key);
            } else {
                objectKeys.push(key);
            }
        } else {
            flatKeys.push(key);
        }
    }
    return hasNested ? { flatKeys, objectKeys, arrayKeys } : null;
}

// User component identity is interned by name: the same name always maps to the same
// _id symbol, module-globally (like builtins, which are defined once at load). The
// World keys storage/queries/change-tracking by _id, so a stable-by-name id lets a
// re-imported project bundle (hot reload) resolve to the live World's existing
// component storage instead of minting a fresh identity that silently misses every
// existing entity. Component DATA stays isolated per-App at the World/storage layer,
// not at the id, so sharing ids by name across contexts is safe — the same reason
// builtins share one global id across every App. See docs/REARCH_HOT_RELOAD.md §3.
const componentIdRegistry = new Map<string, symbol>();
function componentId(name: string): symbol {
    let id = componentIdRegistry.get(name);
    if (id === undefined) {
        id = Symbol(`Component_${name}`);
        componentIdRegistry.set(name, id);
    }
    return id;
}

function createComponentDef<T extends object>(
    name: string,
    defaults: T,
    metadata?: ComponentMetadata,
): ComponentDef<T> {
    // TypeScript already refuses the wrong shapes — but a project's declarations
    // are BUNDLED, not type-checked, on the path the editor extracts schemas
    // through. So `defineComponent({ name: 'Piece', fields: {...} })`, the shape
    // this reads like, sails through and stores an OBJECT as the component's
    // name. Nothing notices until something sorts by it, a stack away and a
    // second later, as "e.name.localeCompare is not a function" — naming neither
    // the component nor the call. Say it here, where the mistake is.
    if (typeof name !== 'string' || name === '') {
        const got = name === null ? 'null'
            : Array.isArray(name) ? 'an array'
            : typeof name === 'object' ? `an object with keys ${Object.keys(name as object).join(', ')}`
            : `${typeof name} ${JSON.stringify(name)}`;
        throw new Error(
            `defineComponent takes the NAME first and the defaults second — defineComponent('MyThing', `
            + `{ speed: 100 }) — but was given ${got}. Each field's inspector control comes from the TYPE `
            + 'of its default value, so the second argument is real values (speed: 100), not a description '
            + "of them ({ speed: 'number' }).",
        );
    }
    if (defaults === null || typeof defaults !== 'object') {
        throw new Error(
            `Component "${name}": the second argument is the defaults OBJECT — defineComponent('${name}', `
            + `{ speed: 100 }) — but was given ${defaults === undefined ? 'nothing' : JSON.stringify(defaults)}.`,
        );
    }
    const keyInfo = classifyKeys(defaults);
    const defaultsRec = defaults as Record<string, unknown>;
    // A replicated name that matches no field would silently sync nothing — the
    // drift class this metadata exists to kill, so it fails loud (same spirit as
    // EHT rejecting a malformed known annotation).
    for (const f of metadata?.replicatedFields ?? []) {
        if (!(f in defaultsRec)) {
            throw new Error(`Component "${name}": replicatedFields names unknown field "${f}"`);
        }
    }
    // Same reason, and the same check EHT makes for a builtin: a renderableField
    // that names nothing would read as "draws nothing" and quietly stay visible.
    const renderableField = metadata?.renderableField;
    if (renderableField !== undefined && typeof defaultsRec[renderableField] !== 'boolean') {
        throw new Error(
            `Component "${name}": renderableField "${renderableField}" is not a boolean field of its defaults`,
        );
    }
    return {
        _id: componentId(name),
        _name: name,
        _default: defaults,
        _builtin: false as const,
        assetFields: metadata?.assetFields ?? [],
        skeletalFields: metadata?.skeletalFields,
        entityFields: metadata?.entityFields ?? [],
        colorKeys: detectColorKeys(defaults),
        animatableFields: metadata?.animatableFields ?? numericAnimatableFields(defaults),
        replicatedFields: metadata?.replicatedFields ?? [],
        readonlyFields: metadata?.readonlyFields ?? [],
        fieldMeta: metadata?.fields ?? {},
        discoverAssets: metadata?.discoverAssets,
        transient: metadata?.transient ?? false,
        renderableField: renderableField ?? null,
        create(data?: Partial<T>): T {
            if (keyInfo) {
                const result = { ...defaultsRec };
                for (const k of keyInfo.objectKeys) result[k] = { ...(defaultsRec[k] as object) };
                for (const k of keyInfo.arrayKeys) result[k] = (defaultsRec[k] as unknown[]).slice();
                if (data) {
                    const dataRec = data as Record<string, unknown>;
                    for (const k of Object.keys(dataRec)) {
                        if (dataRec[k] !== undefined) {
                            if (keyInfo.objectKeys.includes(k) && typeof dataRec[k] === 'object' && dataRec[k] !== null && !Array.isArray(dataRec[k])) {
                                Object.assign(result[k] as object, dataRec[k]);
                            } else {
                                result[k] = dataRec[k];
                            }
                        }
                    }
                }
                return result as T;
            }
            return data ? { ...defaults, ...data } : { ...defaults };
        }
    };
}

// User components live in the per-app AppContext registry (reset-able). Builtins
// are global and live in `builtinRegistry` (declared further below). The public
// catalogue accessors merge the two — see getComponentRegistry().
function userComponents(): Map<string, AnyComponentDef> {
    return getDefaultContext().componentRegistry as Map<string, AnyComponentDef>;
}

export function defineComponent<T extends object>(
    name: string,
    defaults: T,
    metadata?: ComponentMetadata,
): ComponentDef<T> {
    const existing = userComponents().get(name);
    if (existing) return existing as ComponentDef<T>;

    if (builtinRegistry.has(name)) {
        throw new Error(
            `Component name collision: user component "${name}" conflicts with an existing builtin component of the same name`
        );
    }

    const def = createComponentDef(name, defaults, metadata);
    userComponents().set(name, def);
    componentRegistryVersion_++;
    registerToEditor(name, defaults as Record<string, unknown>, false);
    return def;
}

export function defineTag(name: string): ComponentDef<{}> {
    const existing = userComponents().get(name);
    if (existing) return existing as ComponentDef<{}>;

    if (builtinRegistry.has(name)) {
        throw new Error(
            `Component name collision: tag "${name}" conflicts with an existing builtin component of the same name`
        );
    }

    const def = createComponentDef(name, {});
    userComponents().set(name, def);
    componentRegistryVersion_++;
    registerToEditor(name, {}, true);
    return def;
}

export function getUserComponent(name: string): ComponentDef<any> | undefined {
    return userComponents().get(name) as ComponentDef<any> | undefined;
}

export function clearUserComponents(): void {
    userComponents().clear();
    componentRegistryVersion_++;
}

export function unregisterComponent(name: string): void {
    userComponents().delete(name);
    componentRegistryVersion_++;
}

// The engine's own `defineComponent`s (AI, animation, audio, physics joints, UI
// text, tilemap, timeline…) register at SDK module load into the per-app user
// registry. A hot reload only re-imports the PROJECT bundle — the cached `esengine`
// module does NOT re-run — so `clearUserComponents()` would drop these engine
// components with nothing to put them back. The SDK entry snapshots them once as a
// baseline; the hot-reload probe and app build re-seed it so engine components
// survive a reload (and the hot-swap fast path can match fingerprints).
let engineComponentBaseline_: Map<string, AnyComponentDef> | null = null;

/** Snapshot the currently-registered components as the engine baseline. Called
 *  once from the SDK entry after all engine `defineComponent`s have run and before
 *  any project bundle registers its own. */
export function markEngineComponentBaseline(): void {
    engineComponentBaseline_ = new Map(userComponents());
}

/** Re-add the engine baseline to a registry (only where missing), so a context
 *  that has never re-run the SDK's module-level registrations still has them.
 *  No-op until {@link markEngineComponentBaseline} has run (e.g. unit tests that
 *  never load the SDK entry). */
export function seedEngineComponents(registry: Map<string, AnyComponentDef> = userComponents()): void {
    if (!engineComponentBaseline_) return;
    for (const [name, def] of engineComponentBaseline_) if (!registry.has(name)) registry.set(name, def);
}

function registerToEditor(
    name: string,
    defaults: Record<string, unknown>,
    isTag: boolean
): void {
    getDefaultContext().editorBridge?.registerComponent(name, defaults, isTag);
}

// =============================================================================
// Builtin Component Definition (C++ backed)
// =============================================================================

export interface BuiltinComponentDef<T> {
    readonly _id: symbol;
    readonly _name: string;
    readonly _cppName: string;
    readonly _builtin: true;
    readonly _default: T;
    readonly assetFields: readonly AssetFieldMeta[];
    readonly skeletalFields?: SkeletalFieldMeta;
    readonly entityFields: readonly string[];
    readonly colorKeys: readonly string[];
    readonly animatableFields: readonly string[];
    /** Fields authored `replicated` at the C++ ES_PROPERTY site (via COMPONENT_META). */
    readonly replicatedFields: readonly string[];
    /** Fields authored `readonly` (engine-computed outputs); the editor never writes them back. */
    readonly readonlyFields: readonly string[];
    readonly fieldMeta: Readonly<Record<string, FieldMeta>>;
    readonly discoverAssets?: (data: Record<string, unknown>) => AssetRef[];
    /** Runtime-only: omitted from scene serialization. Authored `ES_COMPONENT(transient)`. */
    readonly transient: boolean;
    /** Bool field gating this component's visibility, or null if it draws nothing.
     *  Authored `ES_COMPONENT(renderable=<field>)`. */
    readonly renderableField: string | null;
}

// =============================================================================
// Component Type Union
// =============================================================================

export type AnyComponentDef = ComponentDef<any> | BuiltinComponentDef<any>;

export function isBuiltinComponent(comp: AnyComponentDef): comp is BuiltinComponentDef<any> {
    return comp._builtin === true;
}

// Global builtin (C++-backed) component types — defined once at module load and
// shared across every context. User components are per-AppContext (see above).
const builtinRegistry = new Map<string, AnyComponentDef>();

export function registerComponent(name: string, def: AnyComponentDef): void {
    builtinRegistry.set(name, def);
}

/** Complete catalogue: global builtins + the current context's user components. */
export function getComponentRegistry(): Map<string, AnyComponentDef> {
    const all = new Map<string, AnyComponentDef>(builtinRegistry);
    for (const [name, def] of userComponents()) all.set(name, def);
    return all;
}

/** Just the current context's user/script components (excludes builtins). */
export function getUserComponents(): Map<string, AnyComponentDef> {
    return userComponents();
}

/**
 * A stable digest of the current context's user component schemas — each component's
 * name plus its default field shape (keys + value types, recursively). The hot-reload
 * fast path compares this across a project-bundle re-import: an unchanged digest means
 * only system logic changed (hot-swap, keep the live World); a changed digest means a
 * component's fields changed and the live data no longer matches the new schema, so the
 * realm must full-reload. Builtins are excluded (their C++-backed shape never changes).
 * Default *values* are intentionally not hashed — only the shape gates a rebuild.
 */
export function getUserComponentFingerprint(): string {
    const comps = userComponents();
    return [...comps.keys()].sort()
        .map((name) => `${name}:${fieldShape(comps.get(name)!._default)}`)
        .join('|');
}

function fieldShape(value: unknown): string {
    if (value === null || typeof value !== 'object') return typeof value;
    if (Array.isArray(value)) return `[${value.length ? fieldShape(value[0]) : ''}]`;
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((k) => `${k}:${fieldShape(rec[k])}`).join(',')}}`;
}

export function getComponent(name: string): AnyComponentDef | undefined {
    return builtinRegistry.get(name) ?? userComponents().get(name);
}

/** A component's per-field editor presentation metadata (empty if none declared). */
export function getComponentFieldMeta(name: string): Readonly<Record<string, FieldMeta>> {
    return getComponent(name)?.fieldMeta ?? {};
}

/**
 * The fields the replication layer syncs for a component — builtin (C++
 * `replicated` annotation) and user (`replicatedFields` metadata) through one
 * accessor. Empty = the component never replicates.
 */
export function getReplicatedFields(name: string): readonly string[] {
    return getComponent(name)?.replicatedFields ?? [];
}

/** A component that gates its drawing on a bool field, so that field is known. */
export type RenderableComponentDef = AnyComponentDef & { readonly renderableField: string };

/** Bumped by every registry mutation in this module, so the derived views below
 *  can tell "same components as last time" from "looks the same". */
let componentRegistryVersion_ = 0;
let renderableCache_: {
    version: number;
    userMap: Map<string, AnyComponentDef>;
    userSize: number;
    builtinSize: number;
    list: readonly RenderableComponentDef[];
} | null = null;

/**
 * Every registered component taking part in an entity's visibility, with the field
 * that gates each. Derived per call — a project's own component registers long
 * after load. The memo key carries both registry sizes and the context's map
 * identity, so a mutation outside this module (reset, hot reload) still misses it.
 */
export function renderableComponents(): readonly RenderableComponentDef[] {
    const userMap = userComponents();
    const cached = renderableCache_;
    if (cached !== null
        && cached.version === componentRegistryVersion_
        && cached.userMap === userMap
        && cached.userSize === userMap.size
        && cached.builtinSize === builtinRegistry.size) {
        return cached.list;
    }
    const list: RenderableComponentDef[] = [];
    // Both halves directly rather than through getComponentRegistry(), whose
    // merged Map would be allocated and thrown away on every miss. A name cannot
    // be in both: defineComponent and defineBuiltin each refuse the collision.
    for (const def of builtinRegistry.values()) {
        if (def.renderableField !== null) list.push(def as RenderableComponentDef);
    }
    for (const def of userMap.values()) {
        if (def.renderableField !== null) list.push(def as RenderableComponentDef);
    }
    renderableCache_ = {
        version: componentRegistryVersion_,
        userMap,
        userSize: userMap.size,
        builtinSize: builtinRegistry.size,
        list,
    };
    return list;
}

/**
 * Per-field merge of two FieldMeta maps: `override` wins key-by-key *within* a field
 * (not whole-field replacement), so a builtin can author min/tooltip at the C++
 * ES_PROPERTY site (→ `base`) and still add a runtime-only `enum`/`flags` override in
 * TS without dropping the generated keys. See {@link defineBuiltin}.
 */
function mergeFieldMeta(
    base: Record<string, FieldMeta>,
    override: Record<string, FieldMeta>,
): Record<string, FieldMeta> {
    const out: Record<string, FieldMeta> = { ...base };
    for (const k of Object.keys(override)) {
        out[k] = { ...base[k], ...override[k] };
    }
    return out;
}

function detectColorKeys(defaults: unknown): readonly string[] {
    if (defaults === null || typeof defaults !== 'object') return [];
    const keys: string[] = [];
    for (const key of Object.keys(defaults as Record<string, unknown>)) {
        const val = (defaults as Record<string, unknown>)[key];
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            const rec = val as Record<string, unknown>;
            if ('r' in rec && 'g' in rec && 'b' in rec && 'a' in rec) {
                keys.push(key);
            }
        }
    }
    return keys;
}

// Keyframeable fields for a user component (the Sequencer animates one number per
// track): top-level numbers plus one level of nested numbers (vec / color channels
// as dot-paths). So defineComponent('Patrol', { speed: 60 }) is animatable with no
// boilerplate; metadata.animatableFields overrides this.
function numericAnimatableFields(defaults: unknown): string[] {
    if (defaults === null || typeof defaults !== 'object') return [];
    const out: string[] = [];
    for (const [key, val] of Object.entries(defaults as Record<string, unknown>)) {
        if (typeof val === 'number') out.push(key);
        else if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            for (const [sub, sval] of Object.entries(val as Record<string, unknown>)) {
                if (typeof sval === 'number') out.push(`${key}.${sub}`);
            }
        }
    }
    return out;
}

export function defineBuiltin<T>(name: string, defaults: T, metadata?: ComponentMetadata): BuiltinComponentDef<T> {
    const existing = builtinRegistry.get(name) ?? userComponents().get(name);
    if (existing) {
        if (existing._builtin) return existing as BuiltinComponentDef<T>;
        throw new Error(
            `Component name collision: builtin component "${name}" conflicts with an existing user component of the same name`
        );
    }

    const meta = COMPONENT_META[name];
    const def: BuiltinComponentDef<T> = {
        _id: Symbol(`Builtin_${name}`),
        _name: name,
        _cppName: name,
        _builtin: true,
        _default: defaults,
        assetFields: metadata?.assetFields ?? meta?.assetFields ?? [],
        skeletalFields: metadata?.skeletalFields ?? meta?.skeletal,
        entityFields: metadata?.entityFields ?? meta?.entityFields ?? [],
        colorKeys: meta?.colorFields ?? detectColorKeys(defaults),
        animatableFields: meta?.animatableFields ?? [],
        replicatedFields: meta?.replicatedFields ?? [],
        readonlyFields: meta?.readonlyFields ?? [],
        fieldMeta: mergeFieldMeta(meta?.fields ?? {}, metadata?.fields ?? {}),
        discoverAssets: metadata?.discoverAssets,
        transient: metadata?.transient ?? meta?.transient ?? false,
        renderableField: metadata?.renderableField ?? meta?.renderableField ?? null,
    };
    builtinRegistry.set(name, def);
    return def;
}

/**
 * Register every engine component in COMPONENT_META that doesn't already have a
 * typed builtin const below. COMPONENT_META is EHT-generated from the C++
 * `ES_COMPONENT` structs, so it is the single source of truth for *which*
 * components exist; this guarantees each one is registered — and therefore
 * loadable from a scene — even before someone hand-writes its typed
 * `export const`. Without this backstop a newly-added C++ component had metadata
 * + a binding but no registry entry, so `loadSceneData` silently dropped it.
 *
 * Idempotent (defineBuiltin no-ops on an already-registered builtin). The typed
 * consts below remain the ergonomic, type-checked overlay; this only fills gaps.
 * Called once from the package entry (index.ts / index.wechat.ts).
 */
export function ensureBuiltinComponentsRegistered(): void {
    for (const name of Object.keys(COMPONENT_META)) {
        if (!builtinRegistry.has(name)) {
            defineBuiltin(name, metaDefaults<Record<string, unknown>>(name));
        }
    }
}

// =============================================================================
// Camera / Canvas Enums
// =============================================================================

// Single-sourced from C++ ES_ENUMs (see import above). ProjectionType, ClearFlags,
// EmitterShape, SimulationSpace, Light2DType and ShapeType are re-exported from the
// generated module; their values and the editor dropdowns built from them now have
// one source.
export { ProjectionType, ClearFlags, EmitterShape, SimulationSpace, SubEmitterTrigger, ForceFieldType, Light2DType, ShapeType };

// Canonical values single-sourced from the C++ CanvasScaleMode enum (generated);
// ShowAll/NoBorder are Cocos-compat aliases with no C++ member.
export const ScaleMode = {
    FixedWidth: CanvasScaleMode.FixedWidth,
    FixedHeight: CanvasScaleMode.FixedHeight,
    Expand: CanvasScaleMode.Expand,
    Shrink: CanvasScaleMode.Shrink,
    Match: CanvasScaleMode.Match,
    ShowAll: CanvasScaleMode.Expand,
    NoBorder: CanvasScaleMode.Shrink,
} as const;

export type ScaleMode = (typeof ScaleMode)[keyof typeof ScaleMode];

// =============================================================================
// Builtin Component Types
// =============================================================================

// Data shapes whose fields are exactly the C++ struct — re-exported straight from
// the generated module (the single source). Adding/removing a C++ field flows here
// automatically; tsc then enforces every consumer matches.
export type {
    TransformData, SpriteData, ShapeRendererData, Light2DData, ShadowCaster2DData,
    CanvasData, VelocityData, ParentData, ChildrenData, SpineAnimationData, DragonBonesAnimationData,
    TilemapLayerData, BitmapTextData, TrailRendererData, ParticleForceFieldData,
};

export type LocalTransformData = TransformData;
export type WorldTransformData = TransformData;

// Camera = the generated C++ field shape + one editor-only field. `showFrustum`
// drives gizmo rendering and has no C++ Camera member, so it is added here rather
// than in the generated interface (the only hand-written Camera field).
export interface CameraData extends CameraDataCpp {
    showFrustum: boolean;
}

export interface NameData {
    value: string;
}

export interface SceneOwnerData {
    scene: string;
    persistent: boolean;
}

// =============================================================================
// Builtin Component Instances
// =============================================================================

// Creation defaults = C++ ctor values ⊕ `editor_default=` annotation overrides
// (both EHT-generated) ⊕ TS-only-field overrides from the call site. This is the
// single place authoring defaults are assembled — a builtin's _default carries
// the merged result.
function metaDefaults<T>(name: string, overrides?: Partial<T>): T {
    const meta = COMPONENT_META[name];
    return {
        ...meta?.defaults,
        ...meta?.editorDefaults,
        ...overrides,
    } as T;
}

// Field presentation metadata (min/max/tooltip/category/…) is authored at the C++
// ES_PROPERTY site and flows in via COMPONENT_META.fields (RC9-1). Only metadata that
// can't be a static annotation — `enum`/`flags` built from a runtime TS constant, or a
// TS-only field with no C++ backing — stays here as a per-field override (deep-merged
// over the generated base by defineBuiltin).
export const Transform = defineBuiltin<TransformData>('Transform',
    metaDefaults<TransformData>('Transform')
);
export const LocalTransform = Transform;
export const WorldTransform = Transform;

// size's authoring default (100×100 vs the {1,1} ctor value) is authored at the
// C++ ES_PROPERTY site (editor_default=) and merged in by metaDefaults.
export const Sprite = defineBuiltin<SpriteData>('Sprite',
    metaDefaults<SpriteData>('Sprite')
);

// shapeType's dropdown is generated from the C++ ShapeType enum (ES_PROPERTY enum=).
export const ShapeRenderer = defineBuiltin<ShapeRendererData>('ShapeRenderer',
    metaDefaults<ShapeRendererData>('ShapeRenderer')
);

// type's dropdown is generated from the C++ Light2DType enum (ES_PROPERTY enum=).
export const Light2D = defineBuiltin<Light2DData>('Light2D',
    metaDefaults<Light2DData>('Light2D')
);

export const ShadowCaster2D = defineBuiltin<ShadowCaster2DData>('ShadowCaster2D',
    metaDefaults<ShadowCaster2DData>('ShadowCaster2D')
);

// The authoring defaults that differ from the C++ ctor (an active Orthographic
// at orthoSize 540 vs a Perspective/inactive runtime default) are authored at
// the C++ ES_PROPERTY sites (editor_default=) and merged in by metaDefaults.
// Only the TS-only field's default stays here.
export const Camera = defineBuiltin<CameraData>('Camera',
    metaDefaults<CameraData>('Camera', {
        showFrustum: false,
    }),
    {
        fields: {
            // projectionType's dropdown is generated from the C++ ProjectionType enum.
            // clearFlags is a bitmask (ColorAndDepth = Color | Depth) — a curated bit
            // list (the C++ `flags` annotation suppresses the single-choice dropdown).
            clearFlags: { flags: [{ label: 'Color', value: 1 }, { label: 'Depth', value: 2 }] },
            // showFrustum is a TS-only editor field (no C++ Camera member), so its
            // metadata can't come from an annotation.
            showFrustum: { advanced: true },
        },
    }
);

// All Canvas creation defaults (designResolution 1920×1080 / pixelsPerUnit 100 /
// scaleMode FixedHeight) match the C++ ctor, so they come straight from
// COMPONENT_META — no TS override to drift when C++ changes. scaleMode's dropdown
// is likewise generated from the C++ CanvasScaleMode enum.
export const Canvas = defineBuiltin<CanvasData>('Canvas',
    metaDefaults<CanvasData>('Canvas')
);

export const Velocity = defineBuiltin<VelocityData>('Velocity',
    metaDefaults<VelocityData>('Velocity')
);

export const Parent = defineBuiltin<ParentData>('Parent',
    metaDefaults<ParentData>('Parent')
);

export const Children = defineBuiltin<ChildrenData>('Children',
    metaDefaults<ChildrenData>('Children')
);

export const BitmapText = defineBuiltin<BitmapTextData>('BitmapText',
    metaDefaults<BitmapTextData>('BitmapText')
);

export const SpineAnimation = defineBuiltin<SpineAnimationData>('SpineAnimation',
    metaDefaults<SpineAnimationData>('SpineAnimation')
);

export const DragonBonesAnimation = defineBuiltin<DragonBonesAnimationData>('DragonBonesAnimation',
    metaDefaults<DragonBonesAnimationData>('DragonBonesAnimation')
);

/**
 * Local-space geometry of a Mesh2D renderable (triangle list, indexed).
 * `positions` is x,y pairs; `uvs` is u,v pairs (default 0,0); `colors` is r,g,b,a
 * floats (0-1) per vertex (default white). Uploaded via mesh2d_setGeometry, which
 * validates indices engine-side.
 */
export interface Mesh2DGeometry {
    positions: number[];
    uvs?: number[];
    colors?: number[];
    indices: number[];
}

// Mesh2D = the generated C++ field shape + one out-of-band TS-only field: the
// variable-size geometry payload has no fixed ABI offset, so it never crosses as a
// component field — it is uploaded through mesh2d_setGeometry (see mesh2dPlugin's
// scene codec).
export interface Mesh2DData extends Mesh2DDataCpp {
    geometry: Mesh2DGeometry;
}

export const Mesh2D = defineBuiltin<Mesh2DData>('Mesh2D',
    metaDefaults<Mesh2DData>('Mesh2D', { geometry: { positions: [], indices: [] } })
);

// Motion trail. Pure config — the point history is owned by the C++ TrailSystem and
// rendered as a ribbon by TrailPlugin; nothing crosses as a component field.
export const TrailRenderer = defineBuiltin<TrailRendererData>('TrailRenderer',
    metaDefaults<TrailRendererData>('TrailRenderer')
);

// Particle force field. A scene-placed zone (wind, attractor, vortex, drag) that the
// C++ ParticleSystem folds into every nearby world-space particle's integration.
export const ParticleForceField = defineBuiltin<ParticleForceFieldData>('ParticleForceField',
    metaDefaults<ParticleForceFieldData>('ParticleForceField')
);

export const TilemapLayer = defineBuiltin<TilemapLayerData>('TilemapLayer',
    metaDefaults<TilemapLayerData>('TilemapLayer'),
    {
        // A discoverAssets callback is the component's COMPLETE asset manifest
        // (assetFields are not walked for discovery when one is present), so it
        // must list both dependencies:
        // - `tileset`, the legacy copied atlas-texture ref (matches the generated
        //   assetField) — old scenes render from it directly;
        // - `tilesetAsset`, the out-of-band `.estileset` reference (see
        //   tilemapPlugin's scene codec). Preloading it up front lets the tilemap
        //   sync derive the render table, collision AND animation live from the
        //   tileset on the FIRST frame — no lazy-load gap, no baked
        //   `collidableTileIds` snapshot needed. This is the single-source model.
        discoverAssets: (data) => {
            const refs: AssetRef[] = [];
            const texture = data.tileset;
            if (typeof texture === 'string' && texture) refs.push({ type: 'texture', path: texture });
            // `tilesetAssets` (a list of `.estileset` refs) is the multi-tileset model;
            // fall back to the singular `tilesetAsset` for older single-tileset layers.
            const list = (data as { tilesetAssets?: unknown }).tilesetAssets;
            if (Array.isArray(list) && list.length > 0) {
                for (const r of list) if (typeof r === 'string' && r) refs.push({ type: 'tileset', path: r });
            } else {
                const ref = data.tilesetAsset;
                if (typeof ref === 'string' && ref) refs.push({ type: 'tileset', path: ref });
            }
            return refs;
        },
    },
);

// =============================================================================
// ParticleEmitter Enums
// =============================================================================

// EmitterShape, SimulationSpace and ParticleEasing are re-exported from the
// generated module (see the import at the top) — single-sourced from their C++
// ES_ENUMs beside the component fields that serialize them.
export { ParticleEasing };

// =============================================================================
// ParticleEmitter Component
// =============================================================================

// ParticleEmitter = the generated C++ field shape + two out-of-band TS-only fields
// (gradient / curve) that have no C++ member — they are baked to a LUT the sim reads
// (see particlePlugin's scene codec). They live here, not in the generated interface.
export interface ParticleEmitterData extends ParticleEmitterDataCpp {
    /**
     * Color-over-life gradient (authored stops). When it has stops it overrides
     * startColor/endColor + colorEasing. Empty ⇒ start/end fallback.
     */
    colorGradient: { stops: { t: number; color: Color }[] };
    /**
     * Size-over-life curve (a multiplier × start size, keys over [0,1]). When it
     * has keys it overrides startSize/endSize + sizeEasing. Empty ⇒ start/end fallback.
     */
    sizeCurve: { keys: { t: number; v: number }[] };
}

export const ParticleEmitter = defineBuiltin<ParticleEmitterData>('ParticleEmitter',
    metaDefaults<ParticleEmitterData>('ParticleEmitter', { colorGradient: { stops: [] }, sizeCurve: { keys: [] } }),
    {
        // Most field metadata is authored at the C++ ES_PROPERTY site (categories,
        // min/step, and the shape/simulationSpace/easing enum dropdowns via `enum=`).
        // Only what an annotation can't express stays here: the blendMode dropdown
        // (BlendMode is a renderer enum with no component ES_ENUM), and the two
        // TS-only editor fields (sizeCurve / colorGradient have no C++ member).
        fields: {
            blendMode: { enum: enumOptions(BlendMode) },
            sizeCurve: { curve: true, category: 'Size' },
            colorGradient: { gradient: true, category: 'Color' },
        },
    }
);

export const Disabled = defineTag('Disabled');

/**
 * Marks a world-only DERIVED entity — one a system (re)builds from source data
 * (the child layer entities a `Tilemap.source` projects, runtime tile
 * colliders, …). Scene serialization skips tagged entities entirely:
 * persisting one would duplicate it against the next derivation.
 */
export const RuntimeOnly = defineTag('RuntimeOnly');

export const Name = defineComponent<NameData>('Name', { value: '' });

export const SceneOwner = defineComponent<SceneOwnerData>('SceneOwner', {
    scene: '',
    persistent: false,
});

export interface MarkerData {
    /** Gameplay identity — the game queries markers of a given kind (spawn point,
     *  waypoint, pickup, door, trigger …). Free-form: the game defines the vocabulary.
     *  `Query(Marker)` then filters by `type`. */
    type: string;
    /** Arbitrary per-marker gameplay data (team, targetScene, event, …), like Tiled's
     *  custom object properties. Imported `.tmj` object properties land here too. */
    properties: Record<string, string>;
}

/**
 * A named point/region of gameplay interest, placed in the editor as a real entity.
 * On its own (Transform + Marker) it's a spawn point / waypoint / location marker; add a
 * sensor collider (the Trigger Area preset) and it's a trigger zone. Pure ECS — no
 * parallel "object layer" structure — so it serializes, shows in the Inspector, and is
 * `Query`-able like any component. The converged target for imported `.tmj` object groups.
 */
export const Marker = defineComponent<MarkerData>('Marker', { type: '', properties: {} }, {
    // `properties` is an arbitrary string→string map — opt into the map editor (value-shape
    // inference would otherwise drop it as an unknown object).
    fields: { properties: { map: true } },
});

export interface PostProcessVolumeData {
    effects: {
        type: string;
        enabled: boolean;
        uniforms: Record<string, number>;
        /** Texture params (LUTs, masks): sampler uniform -> serialized texture ref. */
        textures?: Record<string, string>;
    }[];
    isGlobal: boolean;
    shape: 'box' | 'sphere';
    size: { x: number; y: number };
    priority: number;
    weight: number;
    blendDistance: number;
}

export const PostProcessVolume = defineComponent<PostProcessVolumeData>('PostProcessVolume', {
    effects: [],
    isGlobal: true,
    shape: 'box',
    size: { x: 5, y: 5 },
    priority: 0,
    weight: 1,
    blendDistance: 0,
}, {
    // The COMPLETE asset manifest for discovery: effect texture params (LUTs,
    // masks) preload with the scene so the volume system's cache lookups hit.
    discoverAssets: (data) => {
        const refs: AssetRef[] = [];
        const effects = data.effects;
        if (Array.isArray(effects)) {
            for (const effect of effects) {
                const textures = (effect as { textures?: Record<string, unknown> }).textures;
                if (!textures) continue;
                for (const ref of Object.values(textures)) {
                    if (typeof ref === 'string' && ref) refs.push({ type: 'texture', path: ref });
                }
            }
        }
        return refs;
    },
});

export type {
    RigidBodyData, BoxColliderData, CircleColliderData, CapsuleColliderData,
};

// =============================================================================
// Type Helpers
// =============================================================================

export type ComponentData<C> =
    C extends BuiltinComponentDef<infer T> ? T :
    C extends ComponentDef<infer T> ? T :
    never;

// =============================================================================
// Component Defaults Registry
// =============================================================================

export function getComponentDefaults(typeName: string): Record<string, unknown> | null {
    const comp = getComponent(typeName);
    if (comp) return deepClone(comp._default);
    return null;
}

