// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    embeddedHost.ts
 * @brief   The single-file (playable-ad) transport: every needed side module's
 *          glue + wasm is inlined by the exporter, so nothing is fetched (ad
 *          networks require a self-contained .html). The exporter decides *which*
 *          modules to embed from a content scan of the scene, so an embedded
 *          registry that lacks a module the scene needs is an export bug, not a
 *          silent runtime degrade.
 *
 *          Bytes arrive DECODED: how they survived the trip inside an HTML file
 *          is the host page's business, and naming an encoding here would put
 *          one page's transport decision in the SDK.
 */
import { createSideModuleHost, instantiateFromGlueText, type SideModuleHost } from './host';
import type { SideModuleId } from './registry';

export interface EmbeddedSideModuleEntry {
    /** The emscripten `<file>.js` glue, as source text. */
    glue: string;
    /** The `<file>.wasm` binary. */
    wasm: Uint8Array;
}

/** Inlined by the playable exporter as a window global, keyed by {@link SideModuleId}. */
export type EmbeddedSideModuleRegistry = Partial<Record<SideModuleId, EmbeddedSideModuleEntry>>;

export function createEmbeddedSideModuleHost(registry: EmbeddedSideModuleRegistry): SideModuleHost {
    return createSideModuleHost(async (descriptor, id) => {
        const entry = registry[id];
        if (!entry) throw new Error(`side module "${id}" (${descriptor.file}) not embedded in this playable`);
        return instantiateFromGlueText(entry.glue, entry.wasm.buffer as ArrayBuffer, descriptor);
    });
}
