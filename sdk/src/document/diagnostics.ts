// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What is wrong with an authored document, said the same way for all of
 *        them.
 *
 *        A scene and a prefab are the same shape of thing — entities with ids,
 *        a parent/children topology, components, references between them — and
 *        break in the same ways. The checks that find those breaks belong to
 *        neither format: they take a view of the document and return findings,
 *        so every gate that reads one (editor open, runtime load, cook, CI)
 *        judges by the same rules.
 *
 *        Pure and total: nothing here throws. The caller decides what a finding
 *        costs.
 */
import { getComponent } from '../ecs/component';

/** An id as an authored document spells it. Scenes count; prefabs name. */
export type DocumentEntityId = string | number;

export type DocumentDiagnosticSeverity = 'error' | 'warning';

/** One structured problem found in an authored document. */
export interface DocumentDiagnostic {
    /** Stable machine code (kebab-case), e.g. `duplicate-id`, `parent-cycle`. */
    code: string;
    severity: DocumentDiagnosticSeverity;
    /** One-line human-readable explanation. */
    message: string;
    /** The entity the problem is on, when applicable. */
    entityId?: DocumentEntityId;
    /** The component type / `Comp.field` / metadata key involved, when applicable. */
    field?: string;
}

/** How a finding is recorded. Formats pass their own so they can add their own. */
export type DiagnosticSink = (
    code: string,
    severity: DocumentDiagnosticSeverity,
    message: string,
    entityId?: DocumentEntityId,
    field?: string,
) => void;

/** One entity of a document, in the terms every format shares. */
export interface DocumentNode {
    id: DocumentEntityId;
    parent: DocumentEntityId | null;
    children: readonly DocumentEntityId[];
    components: readonly { type: string; data: Record<string, unknown> }[];
}

/** Whether a document names its entities by string or by number, for messages. */
const quote = (id: DocumentEntityId): string => (typeof id === 'string' ? `"${id}"` : String(id));

/**
 * Ids are unique, and no entity carries the same component twice. A repeated id
 * is the finding nothing downstream can work around: a loader keying by id keeps
 * whichever came last, and every reference to it lands elsewhere in silence.
 * Returns the id→node index the later passes read.
 */
export function checkDocumentIds(
    nodes: readonly DocumentNode[],
    push: DiagnosticSink,
): Map<DocumentEntityId, DocumentNode> {
    const byId = new Map<DocumentEntityId, DocumentNode>();
    for (const node of nodes) {
        if (byId.has(node.id)) {
            push('duplicate-id', 'error', `entity id ${quote(node.id)} appears more than once`, node.id);
        } else {
            byId.set(node.id, node);
        }
        const types = new Set<string>();
        for (const c of node.components) {
            if (types.has(c.type)) {
                push('duplicate-component', 'error',
                    `entity ${quote(node.id)} has more than one "${c.type}" component`, node.id, c.type);
            } else {
                types.add(c.type);
            }
        }
    }
    return byId;
}

/**
 * Parent and children agree with each other, and both name entities that exist.
 *
 * `rootIsDetached` decides what a null parent means: a prefab has exactly one
 * root and anything else adrift is broken, while a scene is a forest and a null
 * parent is ordinary.
 */
export function checkDocumentTopology(
    nodes: readonly DocumentNode[],
    byId: ReadonlyMap<DocumentEntityId, DocumentNode>,
    push: DiagnosticSink,
): void {
    for (const node of nodes) {
        if (node.parent !== null) {
            const parent = byId.get(node.parent);
            if (!parent) {
                push('missing-parent', 'error',
                    `entity ${quote(node.id)} parent ${quote(node.parent)} does not exist`, node.id);
            } else if (!parent.children.includes(node.id)) {
                push('inconsistent-topology', 'error',
                    `entity ${quote(node.id)} claims parent ${quote(node.parent)} but that parent's children omit it`, node.id);
            }
        }
        for (const childId of node.children) {
            const child = byId.get(childId);
            if (!child) {
                push('missing-child', 'error',
                    `entity ${quote(node.id)} lists child ${quote(childId)} which does not exist`, node.id, String(childId));
            } else if (child.parent !== node.id) {
                push('inconsistent-topology', 'error',
                    `entity ${quote(node.id)} lists ${quote(childId)} as a child but its parent points elsewhere`, node.id, String(childId));
            }
        }
    }
}

/**
 * No entity is its own ancestor. Reported once: a cycle otherwise names every
 * entity on it, and the reader has to work out that it is one problem.
 */
export function checkParentCycle(
    nodes: readonly DocumentNode[],
    byId: ReadonlyMap<DocumentEntityId, DocumentNode>,
    push: DiagnosticSink,
): void {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<DocumentEntityId, number>();
    for (const node of nodes) color.set(node.id, WHITE);
    let reported = false;

    const visit = (id: DocumentEntityId, path: DocumentEntityId[]): void => {
        if (reported) return;
        const c = color.get(id);
        if (c === BLACK) return;
        if (c === GRAY) {
            const cycle = path.slice(path.indexOf(id)).concat(id).map(String).join(' → ');
            push('parent-cycle', 'error', `parent cycle detected: ${cycle}`, id);
            reported = true;
            return;
        }
        color.set(id, GRAY);
        const node = byId.get(id);
        if (node && node.parent !== null && byId.has(node.parent)) visit(node.parent, [...path, id]);
        color.set(id, BLACK);
    };
    for (const node of nodes) visit(node.id, []);
}

/**
 * Entity-reference fields point at entities of this document.
 *
 * A warning, not an error: a reference to something the author deleted leaves a
 * document that still loads, with one field reading empty.
 */
export function checkEntityRefs(
    nodes: readonly DocumentNode[],
    byId: ReadonlyMap<DocumentEntityId, DocumentNode>,
    push: DiagnosticSink,
    isEmptyRef: (value: DocumentEntityId) => boolean,
): void {
    for (const node of nodes) {
        for (const c of node.components) {
            const def = getComponent(c.type);
            if (!def || def.entityFields.length === 0) continue;
            for (const field of def.entityFields) {
                const v = c.data[field];
                if (typeof v !== 'string' && typeof v !== 'number') continue;
                if (isEmptyRef(v) || byId.has(v)) continue;
                push('dangling-entity-ref', 'warning',
                    `entity ${quote(node.id)} field "${c.type}.${field}" references ${quote(v)}, which is not in the document`,
                    node.id, `${c.type}.${field}`);
            }
        }
    }
}
