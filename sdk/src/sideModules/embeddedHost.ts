// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    embeddedHost.ts
 * @brief   The single-file (playable-ad) transport: every needed side module's
 *          glue + wasm is inlined as base64 by the exporter, so nothing is
 *          fetched (ad networks require a self-contained .html). The exporter
 *          decides *which* modules to embed from a content scan of the scene, so
 *          an embedded registry that lacks a module the scene needs is an export
 *          bug, not a silent runtime degrade.
 */
import { createSideModuleHost, instantiateFromGlueText, type SideModuleHost } from './host';
import type { SideModuleId } from './registry';

export interface EmbeddedSideModuleEntry {
    /** base64 of the emscripten `<file>.js` glue text. */
    glueBase64: string;
    /** base64 of the `<file>.wasm` binary. */
    wasmBase64: string;
}

/** Inlined by the playable exporter as a window global, keyed by {@link SideModuleId}. */
export type EmbeddedSideModuleRegistry = Partial<Record<SideModuleId, EmbeddedSideModuleEntry>>;

function decodeBase64ToText(b64: string): string {
    return atob(b64);
}

function decodeBase64ToBytes(b64: string): Uint8Array {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
}

export function createEmbeddedSideModuleHost(registry: EmbeddedSideModuleRegistry): SideModuleHost {
    return createSideModuleHost(async (descriptor, id) => {
        const entry = registry[id];
        if (!entry) throw new Error(`side module "${id}" (${descriptor.file}) not embedded in this playable`);
        const glueText = decodeBase64ToText(entry.glueBase64);
        const wasmBytes = decodeBase64ToBytes(entry.wasmBase64);
        return instantiateFromGlueText(glueText, wasmBytes.buffer as ArrayBuffer, descriptor);
    });
}
