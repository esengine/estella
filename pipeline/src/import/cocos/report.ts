// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What an import did and did not carry across.
 *
 *        A converter that only reports success is worse than none: a game that
 *        loads with half its UI missing looks like a runtime bug. Every
 *        component is counted as mapped, partial or unmapped, and every
 *        approximation names itself, so the gap is a list rather than a hunt.
 */

export type MapStatus = 'mapped' | 'partial' | 'unmapped';

export interface ComponentTally { mapped: number; partial: number; unmapped: number }
export interface NoteTally { count: number; examples: string[] }

export interface ImportReportData {
    documents: { converted: number; failed: { file: string; error: string }[] };
    nodes: number;
    prefabInstances: number;
    components: Record<string, ComponentTally>;
    notes: Record<string, NoteTally>;
    assets: { textures: number; missing: string[] };
}

const EXAMPLES = 3;

export class ImportReport {
    documents = { converted: 0, failed: [] as { file: string; error: string }[] };
    nodes = 0;
    prefabInstances = 0;
    private readonly components = new Map<string, ComponentTally>();
    private readonly notes = new Map<string, NoteTally>();
    private readonly missing = new Set<string>();
    textures = 0;

    component(type: string, status: MapStatus): void {
        let t = this.components.get(type);
        if (!t) this.components.set(type, (t = { mapped: 0, partial: 0, unmapped: 0 }));
        t[status]++;
    }

    /** A thing approximated, dropped or not understood, keyed by a stable code. */
    note(code: string, where: string): void {
        let n = this.notes.get(code);
        if (!n) this.notes.set(code, (n = { count: 0, examples: [] }));
        n.count++;
        if (n.examples.length < EXAMPLES && !n.examples.includes(where)) n.examples.push(where);
    }

    missingAsset(uuid: string): void {
        this.missing.add(uuid);
    }

    toJSON(): ImportReportData {
        const byCount = <T>(m: Map<string, T>, size: (v: T) => number): [string, T][] => [...m].sort((a, b) => size(b[1]) - size(a[1]));
        return {
            documents: this.documents,
            nodes: this.nodes,
            prefabInstances: this.prefabInstances,
            components: Object.fromEntries(byCount(this.components, (v) => v.mapped + v.partial + v.unmapped)),
            notes: Object.fromEntries(byCount(this.notes, (v) => v.count)),
            assets: { textures: this.textures, missing: [...this.missing].slice(0, 50) },
        };
    }
}
