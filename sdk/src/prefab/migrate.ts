import type { PrefabData, PrefabEntityData, PrefabOverride } from './types';

/**
 * Result of a migration pass over a prefab JSON blob. `migrated` is true
 * when at least one field was upgraded; callers can choose to log/warn so
 * users know to re-save in the new format.
 */
export interface MigrationResult {
    data: PrefabData;
    migrated: boolean;
    fromVersion: string;
    toVersion: string;
}

export const PREFAB_FORMAT_VERSION = '2';

/**
 * Upgrade a parsed `.esprefab` JSON value to the current format.
 *
 * The historical format used numeric entity ids; current format uses
 * opaque strings (UUIDs for editor-authored prefabs). Numeric ids are
 * stringified with `String(n)` so cross-references — `parent`, `children`,
 * `rootEntityId`, `PrefabOverride.prefabEntityId`, `nestedPrefab.overrides`
 * — remain consistent.
 *
 * The function is total: it accepts already-migrated data and returns it
 * with `migrated: false`. Throws on shapes that can't be reconciled.
 */
export function migratePrefabData(raw: unknown): MigrationResult {
    if (typeof raw !== 'object' || raw === null) {
        throw new Error('Prefab data must be an object');
    }
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj['entities'])) {
        throw new Error('Prefab data must have an "entities" array');
    }
    if (typeof obj['rootEntityId'] !== 'string' && typeof obj['rootEntityId'] !== 'number') {
        throw new Error('Prefab data must have a "rootEntityId" string or number');
    }

    const fromVersion = typeof obj['version'] === 'string' ? obj['version'] : '1.0';
    const isLegacy = needsMigration(obj);

    if (!isLegacy) {
        return {
            data: obj as unknown as PrefabData,
            migrated: false,
            fromVersion,
            toVersion: fromVersion,
        };
    }

    const upgraded = upgradeNumericIds(obj);
    upgraded.version = PREFAB_FORMAT_VERSION;
    return {
        data: upgraded,
        migrated: true,
        fromVersion,
        toVersion: PREFAB_FORMAT_VERSION,
    };
}

function needsMigration(obj: Record<string, unknown>): boolean {
    if (typeof obj['rootEntityId'] === 'number') return true;
    const entities = obj['entities'] as unknown[];
    for (const e of entities) {
        if (typeof e !== 'object' || e === null) continue;
        const er = e as Record<string, unknown>;
        if (typeof er['prefabEntityId'] === 'number') return true;
        if (typeof er['parent'] === 'number') return true;
        const children = er['children'];
        if (Array.isArray(children) && children.some(c => typeof c === 'number')) return true;
    }
    const overrides = obj['overrides'];
    if (Array.isArray(overrides)) {
        for (const o of overrides) {
            if (typeof o !== 'object' || o === null) continue;
            const or = o as Record<string, unknown>;
            if (typeof or['prefabEntityId'] === 'number') return true;
        }
    }
    return false;
}

function upgradeNumericIds(obj: Record<string, unknown>): PrefabData {
    const stringify = (v: unknown): string => {
        if (typeof v === 'string') return v;
        if (typeof v === 'number') return String(v);
        throw new Error(`Cannot stringify prefab id of type ${typeof v}`);
    };

    const entities = (obj['entities'] as unknown[]).map((e): PrefabEntityData => {
        const er = e as Record<string, unknown>;
        const out: PrefabEntityData = {
            prefabEntityId: stringify(er['prefabEntityId']),
            name: typeof er['name'] === 'string' ? er['name'] : '',
            parent: er['parent'] === null || er['parent'] === undefined
                ? null
                : stringify(er['parent']),
            children: Array.isArray(er['children'])
                ? (er['children'] as unknown[]).map(stringify)
                : [],
            components: Array.isArray(er['components'])
                ? (er['components'] as PrefabEntityData['components'])
                : [],
            visible: er['visible'] !== false,
        };
        if (er['metadata'] && typeof er['metadata'] === 'object') {
            out.metadata = er['metadata'] as Record<string, unknown>;
        }
        if (er['nestedPrefab'] && typeof er['nestedPrefab'] === 'object') {
            const np = er['nestedPrefab'] as Record<string, unknown>;
            out.nestedPrefab = {
                prefabPath: typeof np['prefabPath'] === 'string' ? np['prefabPath'] : '',
                overrides: Array.isArray(np['overrides'])
                    ? upgradeOverrides(np['overrides'])
                    : [],
            };
        }
        return out;
    });

    const result: PrefabData = {
        version: PREFAB_FORMAT_VERSION,
        name: typeof obj['name'] === 'string' ? obj['name'] : '',
        rootEntityId: stringify(obj['rootEntityId']),
        entities,
    };
    if (typeof obj['basePrefab'] === 'string') {
        result.basePrefab = obj['basePrefab'];
    }
    if (Array.isArray(obj['overrides'])) {
        result.overrides = upgradeOverrides(obj['overrides']);
    }
    return result;
}

function upgradeOverrides(raw: unknown[]): PrefabOverride[] {
    return raw.map((o): PrefabOverride => {
        const or = o as Record<string, unknown>;
        const id = or['prefabEntityId'];
        const upgraded: PrefabOverride = {
            ...(or as unknown as PrefabOverride),
            prefabEntityId: typeof id === 'number' ? String(id) : (id as string),
        };
        return upgraded;
    });
}
