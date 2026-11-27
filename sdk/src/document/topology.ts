// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { DiagnosticSink, DocumentEntityId } from './diagnostics';

export const quoteDocumentId = (id: DocumentEntityId): string => (typeof id === 'string' ? `"${id}"` : String(id));

export const duplicateDocumentIdMessage = (id: DocumentEntityId): string =>
    `entity id ${quoteDocumentId(id)} appears more than once`;

type ParentLink = { parent?: DocumentEntityId | null };

/** Report the first cycle in the authored parent links. */
export function checkParentCycle(
    nodes: readonly (ParentLink & { id: DocumentEntityId })[],
    byId: ReadonlyMap<DocumentEntityId, ParentLink>,
    push: DiagnosticSink,
): void {
    const visitedOn = new Map<DocumentEntityId, number>();
    let walk = 0;
    // A repeated visit in the same walk is a cycle. An earlier walk has already checked its chain.
    for (const node of nodes) {
        if (visitedOn.has(node.id)) continue;
        walk++;
        let id: DocumentEntityId | null | undefined = node.id;
        while (id != null) {
            const previous = visitedOn.get(id);
            if (previous === walk) {
                const cycle = [String(id)];
                const first = byId.get(id)!;
                let link = first.parent!;
                let entry = byId.get(link)!;
                while (entry !== first) {
                    cycle.push(String(link));
                    link = entry.parent!;
                    entry = byId.get(link)!;
                }
                cycle.push(String(id));
                push('parent-cycle', 'error', `parent cycle detected: ${cycle.join(' → ')}`, id);
                return;
            }
            if (previous !== undefined) break;
            const entry = byId.get(id);
            if (!entry) break;
            visitedOn.set(id, walk);
            id = entry.parent;
        }
    }
}
