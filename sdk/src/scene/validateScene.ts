// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Everything wrong with a scene, in the vocabulary prefabs already speak.
 *
 *        A prefab has been validated at every gate it passes since it got a
 *        format; a scene — the document a game actually ships — was checked
 *        nowhere, and the loader answered a repeated id by keeping whichever
 *        entity came last. Both are entity documents, so both are read by the
 *        shared checks, and a scene only adds what is its own: it is a forest
 *        rather than one rooted tree, and its prefab-instance entries stand in
 *        for entities that are not expanded yet.
 */
import {
    checkDocumentIds,
    checkDocumentTopology,
    checkParentCycle,
    checkEntityRefs,
    type DiagnosticSink,
    type DocumentDiagnostic,
    type DocumentNode,
} from '../document/diagnostics';
import { INVALID_ENTITY } from '../types';
import type { SceneData, SceneEntityData } from './scene';
import { isPrefabEntry } from './sceneEntry';

/** A scene entity as the shared checks read it. */
const sceneNode = (e: SceneEntityData): DocumentNode => ({
    id: e.id,
    parent: e.parent ?? null,
    children: e.children ?? [],
    components: e.components ?? [],
});

/**
 * Validate a scene and return every problem found. Errors mean the scene cannot
 * be loaded into a world that means what the file says; warnings are loadable.
 * Pure + total — nothing here throws, and the caller decides what a finding
 * costs.
 */
export function validateScene(scene: SceneData): DocumentDiagnostic[] {
    const diags: DocumentDiagnostic[] = [];
    const push: DiagnosticSink = (code, severity, message, entityId, field): void => {
        diags.push({
            code,
            severity,
            message,
            ...(entityId !== undefined ? { entityId } : {}),
            ...(field !== undefined ? { field } : {}),
        });
    };

    if (!Array.isArray(scene?.entities)) {
        push('malformed', 'error', 'scene has no "entities" array');
        return diags;
    }

    const nodes = scene.entities.map(sceneNode);
    const byId = checkDocumentIds(nodes, push);
    checkDocumentTopology(nodes, byId, push);
    checkParentCycle(nodes, byId, push);
    // A scene's ids are numbers, and 0 is how an unset reference is written.
    checkEntityRefs(nodes, byId, push, (v) => v === INVALID_ENTITY || typeof v !== 'number');

    for (const e of scene.entities) {
        if (isPrefabEntry(e) || !Array.isArray(e.components)) continue;
        for (const c of e.components) {
            if (typeof c?.type !== 'string' || c.type.length === 0) {
                push('malformed-component', 'error', `entity ${e.id} has a component with no type`, e.id);
            }
        }
    }

    return diags;
}
