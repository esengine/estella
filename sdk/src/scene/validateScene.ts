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
import { sceneDocumentShapeIssue } from './sceneFormat';

/** A scene entity as the shared checks read it. */
const sceneNode = (e: SceneEntityData): DocumentNode => ({
    id: e.id,
    parent: e.parent ?? null,
    children: e.children ?? [],
    components: isPrefabEntry(e) ? [] : e.components,
});

/**
 * Validate a scene's record shapes before checking its IDs, topology, and references.
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

    const issue = sceneDocumentShapeIssue(scene);
    if (issue) {
        push(issue.code, 'error', issue.message, issue.entityId);
        return diags;
    }

    const nodes = scene.entities.map(sceneNode);
    const byId = checkDocumentIds(nodes, push);
    checkDocumentTopology(nodes, byId, push);
    checkParentCycle(nodes, byId, push);
    // A scene's ids are numbers, and 0 is how an unset reference is written.
    checkEntityRefs(nodes, byId, push, (v) => v === INVALID_ENTITY || typeof v !== 'number');

    return diags;
}
