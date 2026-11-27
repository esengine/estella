// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { DocumentDiagnostic } from '../document/diagnostics';
import { checkParentCycle, duplicateDocumentIdMessage } from '../document/topology';
import type { SceneData } from './scene';

/**
 * Current scene format version, incremented for incompatible migrations.
 * 2 renamed Light2D and Mesh2D, 3 added the 2D suffix to flat physics
 * components, and 4 aligned 2D joint names with their 3D counterparts.
 */
export const SCENE_FORMAT_VERSION = 4;

/** Older dotted strings use their leading integer. Missing or invalid versions are format 1. */
export function parseSceneFormatVersion(version: unknown): number {
    if (typeof version === 'number') return Number.isInteger(version) && version > 0 ? version : 1;
    if (typeof version === 'string') {
        const leading = /^\s*(\d+)/.exec(version);
        if (leading) return Math.max(1, Number(leading[1]));
    }
    return 1;
}

/** Check the version before consuming or replacing the document. */
export function requireSupportedSceneVersion(version: unknown): number {
    const fromVersion = parseSceneFormatVersion(version);
    if (fromVersion > SCENE_FORMAT_VERSION) {
        throw new Error(
            `Scene format version ${fromVersion} is newer than this engine supports ` +
            `(${SCENE_FORMAT_VERSION}); upgrade the engine to load it.`,
        );
    }
    return fromVersion;
}

type SceneShapeIssue = { code: string; message: string; entityId?: number };
const missingEntities = { code: 'malformed', message: 'Scene data must have an "entities" array' };

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isComponentRecord(value: unknown): boolean {
    return isRecord(value) && typeof value.type === 'string' && value.type.length > 0 && isRecord(value.data);
}

function sceneRowsIssue(rows: readonly unknown[]): SceneShapeIssue | undefined {
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!isRecord(row) || typeof row.id !== 'number' || !Number.isSafeInteger(row.id)) {
            return { code: 'malformed-entity', message: `entities[${i}] must be an entity record with an integer ID` };
        }
        const entityId = row.id;
        if (row.parent != null && !Number.isSafeInteger(row.parent)) {
            return { code: 'malformed-entity', entityId, message: `entities[${i}].parent must be an integer ID or null` };
        }
        if (row.children != null && (!Array.isArray(row.children) || !row.children.every(Number.isSafeInteger))) {
            return { code: 'malformed-entity', entityId, message: `entities[${i}].children must be an array of integer IDs` };
        }
        if (typeof row.prefab === 'string') {
            if (!Array.isArray(row.overrides) || !Array.isArray(row.added) || !Array.isArray(row.removed)) {
                return { code: 'malformed-entity', entityId, message: `entities[${i}] must have overrides, added, and removed arrays for a prefab instance` };
            }
            for (let j = 0; j < row.overrides.length; j++) {
                const edit = row.overrides[j];
                if (!isRecord(edit) || typeof edit.type !== 'string' || (edit.componentData != null && !isComponentRecord(edit.componentData))) {
                    return { code: 'malformed-entity', entityId, message: `entities[${i}].overrides[${j}] must be a prefab override record` };
                }
            }
            for (let j = 0; j < row.added.length; j++) {
                const added = row.added[j];
                if (!isRecord(added) || !Array.isArray(added.components) || !added.components.every(isComponentRecord)) {
                    return { code: 'malformed-entity', entityId, message: `entities[${i}].added[${j}] must be a prefab member with valid components` };
                }
            }
            continue;
        }
        if (!Array.isArray(row.components)) {
            return { code: 'malformed-entity', entityId, message: `entities[${i}].components must be an array` };
        }
        for (let j = 0; j < row.components.length; j++) {
            if (!isComponentRecord(row.components[j])) return {
                code: 'malformed-component', entityId,
                message: `entities[${i}].components[${j}] must contain a component type and a data object`,
            };
        }
    }
    return undefined;
}

/** Report the first record that cannot be interpreted by scene readers. */
export function sceneDocumentShapeIssue(input: unknown): SceneShapeIssue | undefined {
    return isRecord(input) && Array.isArray(input.entities) ? sceneRowsIssue(input.entities) : missingEntities;
}

/** Check the shared scene format before interpreting its records. */
export function requireSupportedSceneDocument(input: unknown): number {
    if (!isRecord(input) || !Array.isArray(input.entities)) throw new Error(missingEntities.message);
    const version = requireSupportedSceneVersion(input.version);
    const issue = sceneRowsIssue(input.entities);
    if (issue) throw new Error(issue.message);
    return version;
}

type SceneLoadFinding = Pick<DocumentDiagnostic, 'code' | 'message'>;

export function sceneLoadError(name: string, findings: readonly SceneLoadFinding[]): Error {
    return new Error(
        `Scene "${name}" cannot be loaded as written:\n`
        + findings.map(({ code, message }) => `  ${code}: ${message}`).join('\n'),
    );
}

/** Check authored IDs and parent links before any filtering or prefab expansion. */
export function requireUnambiguousSceneHierarchy(scene: SceneData): void {
    const byId = new Map<number, SceneData['entities'][number]>();
    const findings: SceneLoadFinding[] = [];
    for (const row of scene.entities) {
        if (byId.has(row.id)) findings.push({ code: 'duplicate-id', message: duplicateDocumentIdMessage(row.id) });
        else byId.set(row.id, row);
    }
    if (findings.length === 0) {
        checkParentCycle(scene.entities, byId, (code, _, message) => findings.push({ code, message }));
    }
    if (findings.length > 0) throw sceneLoadError(scene.name, findings);
}
