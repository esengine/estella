// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ProviderBackend.ts
 * @brief   Adapts a RuntimeAssetProvider to the canonical `Backend` interface so
 *          the runtime scene loader can drive the single `Assets` channel with a
 *          platform's existing fetch (WeChat filesystem / `estella://` / inlined
 *          data-URLs) instead of a parallel per-type loader implementation.
 *
 * The provider already resolves refs internally (`readText/readBinary` call
 * `resolvePath`), and `resolvePath` is idempotent across all providers, so it is
 * safe to feed an already-resolved path back through these methods.
 */
import type { Backend } from './Backend';
import type { RuntimeAssetProvider } from '../runtimeAssets';

export class ProviderBackend implements Backend {
    constructor(private readonly provider: RuntimeAssetProvider) {}

    async fetchBinary(path: string): Promise<ArrayBuffer> {
        const view = await this.provider.readBinary(path);
        // Return a standalone ArrayBuffer of exactly these bytes. A provider may
        // hand back a Uint8Array that views into a larger/pooled buffer; the asset
        // loaders assume the whole buffer is the asset.
        if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
            return view.buffer as ArrayBuffer;
        }
        return view.slice().buffer as ArrayBuffer;
    }

    async fetchText(path: string): Promise<string> {
        return this.provider.readText(path);
    }

    resolveUrl(path: string): string {
        return this.provider.resolvePath(path);
    }
}
