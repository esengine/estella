// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    bundle.ts
 * @brief   Collect every registered section into one document.
 *
 * @details The exporter knows no section names — it walks the registry. A
 *          section that throws is named in `failedSections` and the rest are
 *          still collected: during an incident a bundle that is mostly present
 *          beats no bundle, and a collector that fails is itself a finding.
 */
import { diagnosticsRegistry } from './registry';
import { resolve, type DetailLevel } from './redact';

/** Bump when the shape changes, so a reader can tell what it is looking at. */
export const BUNDLE_FORMAT = 1;

export interface DiagnosticBundle {
    kind: 'estella-diagnostic-bundle';
    formatVersion: number;
    createdAt: string;
    /** Whether the user's own content travels with it — see redact.ts. */
    detail: DetailLevel;
    sections: Record<string, unknown>;
    /** Sections whose collector threw, with the message. Absent facts, not empty ones. */
    failedSections: Record<string, string>;
}

export function collectBundle(detail: DetailLevel, nowIso: string): DiagnosticBundle {
    const sections: Record<string, unknown> = {};
    const failedSections: Record<string, string> = {};
    for (const section of diagnosticsRegistry.all()) {
        try {
            const raw = section.collect();
            // Null means "nothing to say", which is not the same as an empty
            // object and is left out rather than written as one.
            if (raw !== null && raw !== undefined) sections[section.id] = resolve(raw, detail);
        } catch (err) {
            failedSections[section.id] = err instanceof Error ? err.message : String(err);
        }
    }
    return {
        kind: 'estella-diagnostic-bundle',
        formatVersion: BUNDLE_FORMAT,
        createdAt: nowIso,
        detail,
        sections,
        failedSections,
    };
}

/** The document, as it is written to disk or pasted into an issue. */
export function serializeBundle(bundle: DiagnosticBundle): string {
    return JSON.stringify(bundle, null, 2);
}

/** `estella-diagnostics-2026-08-08T21-30-00.json` — sorts by time, no colons
 *  (Windows rejects them in a filename). */
export function bundleFileName(nowIso: string): string {
    return `estella-diagnostics-${nowIso.replace(/[:.]/g, '-').replace(/Z$/, '')}.json`;
}
