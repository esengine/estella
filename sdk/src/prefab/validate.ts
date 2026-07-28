// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type {
    PrefabData,
    PrefabEntityData,
    PrefabEntityId,
    PrefabOverride,
} from './types';
import { PREFAB_ADDRESS_SEP } from './types';
import { getComponent } from '../ecs/component';

export interface StaleOverride {
    override: PrefabOverride;
    reason: string;
    /** Where in the prefab the override lives. */
    site: 'variant' | 'nested' | 'instance';
    /** For nested sites, the nested prefab's entity id whose overrides list it came from. */
    nestedAt?: PrefabEntityId;
}

export interface ValidateResult {
    stale: StaleOverride[];
    /**
     * Entity ids mentioned in the prefab's own `children` lists that have
     * no corresponding entity entry. Surfaces corruption from third-party
     * editing tools; flatten also fails hard on this, so this is a softer
     * diagnostic the editor can surface before flatten.
     */
    orphanedChildren: PrefabEntityId[];
    /**
     * Entity ids that appear on more than one entry. Identity must be unique
     * within a prefab or overrides/diff address the wrong target; the editor
     * must never mint a colliding id (it uses UUIDs).
     */
    duplicateIds: PrefabEntityId[];
    /**
     * Entity ids containing the reserved address separator (`/`). Flatten
     * composes `slot/localId` addresses with it, so an authored id must not
     * contain it — flatten rejects these hard; this is the soft pre-check.
     */
    invalidIds: PrefabEntityId[];
}

/**
 * Find overrides pointing at entities or components that no longer exist.
 *
 * The check is structural (no flatten). For nested-prefab site validation
 * pass a loader via `options.loadPrefab`; without it, nested overrides are
 * skipped (treated as "cannot verify").
 *
 * Used by the editor on scene open + on Apply-to-Source to warn the user
 * before stale overrides silently disappear.
 */
export function validateOverrides(
    prefab: PrefabData,
    options?: {
        /** Overrides applied at instance site, e.g. `prefab:overrides` metadata. */
        instanceOverrides?: readonly PrefabOverride[];
        loadPrefab?: (path: string) => PrefabData | null;
    },
): ValidateResult {
    const stale: StaleOverride[] = [];
    const orphanedChildren: PrefabEntityId[] = [];
    const duplicateIds: PrefabEntityId[] = [];
    const invalidIds: PrefabEntityId[] = [];

    const byId = new Map<PrefabEntityId, PrefabEntityData>();
    const seenIds = new Set<PrefabEntityId>();
    for (const e of prefab.entities) {
        if (e.prefabEntityId.includes(PREFAB_ADDRESS_SEP)) invalidIds.push(e.prefabEntityId);
        if (seenIds.has(e.prefabEntityId)) duplicateIds.push(e.prefabEntityId);
        else seenIds.add(e.prefabEntityId);
        byId.set(e.prefabEntityId, e);
    }

    for (const e of prefab.entities) {
        for (const childId of e.children) {
            if (!byId.has(childId)) orphanedChildren.push(childId);
        }
    }

    const checkAgainst = (
        overrides: readonly PrefabOverride[],
        target: PrefabData,
        site: StaleOverride['site'],
        nestedAt?: PrefabEntityId,
    ): void => {
        const map = new Map<PrefabEntityId, PrefabEntityData>();
        for (const e of target.entities) map.set(e.prefabEntityId, e);
        for (const o of overrides) {
            const entity = map.get(o.prefabEntityId);
            if (!entity) {
                stale.push({
                    override: o,
                    reason: `entity "${o.prefabEntityId}" not found in "${target.name}"`,
                    site,
                    ...(nestedAt !== undefined ? { nestedAt } : {}),
                });
                continue;
            }
            const reason = reasonForOverride(o, entity);
            if (reason) {
                stale.push({
                    override: o,
                    reason,
                    site,
                    ...(nestedAt !== undefined ? { nestedAt } : {}),
                });
            }
        }
    };

    if (prefab.overrides) {
        checkAgainst(prefab.overrides, prefab, 'variant');
    }
    if (options?.instanceOverrides) {
        checkAgainst(options.instanceOverrides, prefab, 'instance');
    }

    if (options?.loadPrefab) {
        const loader = options.loadPrefab;
        for (const e of prefab.entities) {
            if (!e.nestedPrefab) continue;
            const nested = loader(e.nestedPrefab.prefabPath);
            if (!nested) continue;
            checkAgainst(e.nestedPrefab.overrides, nested, 'nested', e.prefabEntityId);
        }
    }

    return { stale, orphanedChildren, duplicateIds, invalidIds };
}

function reasonForOverride(
    override: PrefabOverride,
    entity: PrefabEntityData,
): string | null {
    switch (override.type) {
        case 'property':
        case 'component_removed': {
            const type = override.componentType;
            if (!type) return 'missing componentType';
            const exists = entity.components.some(c => c.type === type);
            return exists ? null : `component "${type}" not present on "${entity.prefabEntityId}"`;
        }
        case 'component_replaced':
        case 'component_added':
            // Both are upserts; they can't be stale by definition.
            return null;
        case 'metadata_removed': {
            const key = override.metadataKey;
            if (!key) return 'missing metadataKey';
            const present = entity.metadata && Object.prototype.hasOwnProperty.call(entity.metadata, key);
            return present ? null : `metadata key "${key}" not present on "${entity.prefabEntityId}"`;
        }
        case 'metadata_set':
        case 'name':
        case 'visibility':
        case 'parent':
            // A re-parent's target-existence is a topology concern the strict
            // validator's parent/child passes cover; nothing entity-local is stale.
            return null;
    }
}

// ── Unified strict validator ────────────────────────────────────────────────
// `validateOverrides` above is the editor's focused stale-override check.
// `validatePrefab` is the ONE comprehensive asset validator meant to run at
// every gate (editor open/save, runtime load, cook, CI). It never throws — it
// returns structured diagnostics so each caller decides how to surface them.

export type PrefabDiagnosticSeverity = 'error' | 'warning';

/** One structured problem found in a prefab asset. */
export interface PrefabDiagnostic {
    /** Stable machine code (kebab-case), e.g. `duplicate-id`, `parent-cycle`. */
    code: string;
    severity: PrefabDiagnosticSeverity;
    /** One-line human-readable explanation. */
    message: string;
    /** The entity the problem is on, when applicable. */
    entityId?: PrefabEntityId;
    /** The component type / `Comp.field` / metadata key involved, when applicable. */
    field?: string;
}

export interface ValidatePrefabOptions {
    /** Resolver for nested / variant dependency + nested-override checks. */
    loadPrefab?: (path: string) => PrefabData | null;
    /** Instance-site overrides (a scene instance's delta) to validate too. */
    instanceOverrides?: readonly PrefabOverride[];
}

/**
 * Validate a prefab asset end-to-end and return every problem found. Errors mean
 * the prefab is structurally broken (flatten would misbehave or throw); warnings
 * are suspicious but loadable (stale overrides, dangling refs). Pure + total.
 */
export function validatePrefab(
    prefab: PrefabData,
    options?: ValidatePrefabOptions,
): PrefabDiagnostic[] {
    const diags: PrefabDiagnostic[] = [];
    const push = (
        code: string,
        severity: PrefabDiagnosticSeverity,
        message: string,
        entityId?: PrefabEntityId,
        field?: string,
    ): void => {
        diags.push({
            code,
            severity,
            message,
            ...(entityId !== undefined ? { entityId } : {}),
            ...(field !== undefined ? { field } : {}),
        });
    };

    // Pass 1: id integrity + per-entity component-type uniqueness.
    const byId = new Map<PrefabEntityId, PrefabEntityData>();
    const seen = new Set<PrefabEntityId>();
    for (const e of prefab.entities) {
        if (e.prefabEntityId.includes(PREFAB_ADDRESS_SEP)) {
            push('invalid-id', 'error', `entity id "${e.prefabEntityId}" contains the reserved separator "${PREFAB_ADDRESS_SEP}"`, e.prefabEntityId);
        }
        if (seen.has(e.prefabEntityId)) {
            push('duplicate-id', 'error', `entity id "${e.prefabEntityId}" appears more than once`, e.prefabEntityId);
        } else {
            seen.add(e.prefabEntityId);
        }
        byId.set(e.prefabEntityId, e);

        const compTypes = new Set<string>();
        for (const c of e.components) {
            if (compTypes.has(c.type)) {
                push('duplicate-component', 'error', `entity "${e.prefabEntityId}" has more than one "${c.type}" component`, e.prefabEntityId, c.type);
            } else {
                compTypes.add(c.type);
            }
        }
    }

    // Pass 2: root existence (exactly one, referenced by rootEntityId).
    if (!byId.has(prefab.rootEntityId)) {
        push('root-missing', 'error', `rootEntityId "${prefab.rootEntityId}" is not an entity in the prefab`, prefab.rootEntityId);
    }

    // Pass 3: topology — parent/children two-way consistency + detached roots.
    for (const e of prefab.entities) {
        if (e.parent === null) {
            if (e.prefabEntityId !== prefab.rootEntityId) {
                push('detached-entity', 'error', `entity "${e.prefabEntityId}" has parent=null but is not the root`, e.prefabEntityId);
            }
        } else {
            const parent = byId.get(e.parent);
            if (!parent) {
                push('missing-parent', 'error', `entity "${e.prefabEntityId}" parent "${e.parent}" does not exist`, e.prefabEntityId);
            } else if (!parent.children.includes(e.prefabEntityId)) {
                push('inconsistent-topology', 'error', `entity "${e.prefabEntityId}" claims parent "${e.parent}" but that parent's children omit it`, e.prefabEntityId);
            }
        }
        for (const childId of e.children) {
            const child = byId.get(childId);
            if (!child) {
                push('missing-child', 'error', `entity "${e.prefabEntityId}" lists child "${childId}" which does not exist`, e.prefabEntityId, childId);
            } else if (child.parent !== e.prefabEntityId) {
                push('inconsistent-topology', 'error', `entity "${e.prefabEntityId}" lists "${childId}" as a child but its parent points elsewhere`, e.prefabEntityId, childId);
            }
        }
    }

    // Pass 4: no parent cycle (report at most one — a cycle spams otherwise).
    detectParentCycle(prefab, byId, push);

    // Pass 5: every entity reachable from the root (via children edges).
    if (byId.has(prefab.rootEntityId)) {
        const reachable = new Set<PrefabEntityId>();
        const queue: PrefabEntityId[] = [prefab.rootEntityId];
        while (queue.length > 0) {
            const cur = queue.shift()!;
            if (reachable.has(cur)) continue;
            reachable.add(cur);
            for (const c of byId.get(cur)?.children ?? []) if (byId.has(c)) queue.push(c);
        }
        for (const e of prefab.entities) {
            if (!reachable.has(e.prefabEntityId)) {
                push('unreachable', 'error', `entity "${e.prefabEntityId}" is not reachable from the root "${prefab.rootEntityId}"`, e.prefabEntityId);
            }
        }
    }

    // Pass 6: entity-ref component fields must resolve within the prefab.
    for (const e of prefab.entities) {
        for (const c of e.components) {
            const def = getComponent(c.type);
            if (!def || def.entityFields.length === 0) continue;
            for (const field of def.entityFields) {
                const v = c.data[field];
                if (typeof v === 'string' && !byId.has(v)) {
                    push('dangling-entity-ref', 'warning', `entity "${e.prefabEntityId}" field "${c.type}.${field}" references "${v}", which is not in the prefab`, e.prefabEntityId, `${c.type}.${field}`);
                }
            }
        }
    }

    // Pass 7: override shape + staleness (variant / instance / nested sites).
    const checkOverrides = (
        overrides: readonly PrefabOverride[],
        target: PrefabData,
        site: string,
    ): void => {
        const map = new Map<PrefabEntityId, PrefabEntityData>();
        for (const x of target.entities) map.set(x.prefabEntityId, x);
        for (const o of overrides) {
            const shape = overrideShapeError(o);
            if (shape) {
                push('invalid-override', 'error', `${site} override on "${o.prefabEntityId}": ${shape}`, o.prefabEntityId);
                continue;
            }
            const entity = map.get(o.prefabEntityId);
            if (!entity) {
                push('stale-override', 'warning', `${site} override targets "${o.prefabEntityId}", not found in "${target.name}"`, o.prefabEntityId);
                continue;
            }
            const reason = reasonForOverride(o, entity);
            if (reason) push('stale-override', 'warning', `${site} override on "${o.prefabEntityId}": ${reason}`, o.prefabEntityId);
        }
    };
    if (prefab.overrides) checkOverrides(prefab.overrides, prefab, 'variant');
    if (options?.instanceOverrides) checkOverrides(options.instanceOverrides, prefab, 'instance');
    if (options?.loadPrefab) {
        const loader = options.loadPrefab;
        for (const e of prefab.entities) {
            if (!e.nestedPrefab) continue;
            const nested = loader(e.nestedPrefab.prefabPath);
            if (nested) checkOverrides(e.nestedPrefab.overrides, nested, `nested@${e.prefabEntityId}`);
        }
        // Pass 8: nested / variant dependency graph must be acyclic.
        detectDependencyCycle(prefab, loader, push);
    }

    return diags;
}

/** Missing-required-field / wrong-value-type check for a single override. */
function overrideShapeError(o: PrefabOverride): string | null {
    switch (o.type) {
        case 'property':
            if (!o.componentType) return 'missing componentType';
            if (o.propertyName === undefined) return 'missing propertyName';
            return null;
        case 'component_added':
        case 'component_replaced':
            if (!o.componentData || typeof o.componentData.type !== 'string') return 'missing componentData.type';
            if (typeof o.componentData.data !== 'object' || o.componentData.data === null) return 'missing componentData.data';
            return null;
        case 'component_removed':
            return o.componentType ? null : 'missing componentType';
        case 'name':
            return typeof o.value === 'string' ? null : 'name value must be a string';
        case 'visibility':
            return typeof o.value === 'boolean' ? null : 'visibility value must be a boolean';
        case 'parent':
            return typeof o.value === 'string' || o.value === null
                ? null
                : 'parent value must be a stable entity id or null';
        case 'metadata_set':
        case 'metadata_removed':
            return typeof o.metadataKey === 'string' ? null : 'missing metadataKey';
        default:
            return `unknown override type "${(o as { type: string }).type}"`;
    }
}

function detectParentCycle(
    prefab: PrefabData,
    byId: Map<PrefabEntityId, PrefabEntityData>,
    push: (code: string, severity: PrefabDiagnosticSeverity, message: string, entityId?: PrefabEntityId) => void,
): void {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<PrefabEntityId, number>();
    for (const e of prefab.entities) color.set(e.prefabEntityId, WHITE);
    let reported = false;

    const visit = (id: PrefabEntityId, path: PrefabEntityId[]): void => {
        if (reported) return;
        const c = color.get(id);
        if (c === BLACK) return;
        if (c === GRAY) {
            const start = path.indexOf(id);
            const cycle = path.slice(start).concat(id).join(' → ');
            push('parent-cycle', 'error', `parent cycle detected: ${cycle}`, id);
            reported = true;
            return;
        }
        color.set(id, GRAY);
        const e = byId.get(id);
        if (e && e.parent !== null && byId.has(e.parent)) visit(e.parent, [...path, id]);
        color.set(id, BLACK);
    };
    for (const e of prefab.entities) visit(e.prefabEntityId, []);
}

function detectDependencyCycle(
    prefab: PrefabData,
    loadPrefab: (path: string) => PrefabData | null,
    push: (code: string, severity: PrefabDiagnosticSeverity, message: string, entityId?: PrefabEntityId) => void,
): void {
    const stack = new Set<string>();
    let reported = false;

    const depsOf = (p: PrefabData): string[] => {
        const deps: string[] = [];
        if (p.basePrefab) deps.push(p.basePrefab);
        for (const e of p.entities) if (e.nestedPrefab) deps.push(e.nestedPrefab.prefabPath);
        return deps;
    };

    const walk = (p: PrefabData): void => {
        if (reported) return;
        for (const dep of depsOf(p)) {
            if (stack.has(dep)) {
                push('dependency-cycle', 'error', `prefab dependency cycle involving "${dep}"`);
                reported = true;
                return;
            }
            const child = loadPrefab(dep);
            if (!child) continue;
            stack.add(dep);
            walk(child);
            stack.delete(dep);
            if (reported) return;
        }
    };
    walk(prefab);
}
