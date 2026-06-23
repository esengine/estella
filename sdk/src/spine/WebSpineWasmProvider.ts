// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WebSpineWasmProvider.ts
 * @brief   Browser SpineWasmProvider — fetches the per-version spine side
 *          modules (spine38.js/.wasm, spine41.js/.wasm, …) served alongside the
 *          engine wasm, so the web runtime can run 3.8/4.1 assets and not only
 *          the engine-linked 4.2. Wire it into createWebApp via the wasmBaseUrl
 *          option (or pass an instance as spineProvider). WeChat uses its own
 *          factory path (config.spineFactories), not this fetch-based provider.
 */
import type { SpineWasmProvider } from './SpineModuleLoader';

export class WebSpineWasmProvider implements SpineWasmProvider {
    private readonly baseUrl_: string;

    /**
     * @param baseUrl Directory the `spine{NN}.js`/`.wasm` files are served from —
     *   typically the same directory as esengine.wasm. A trailing slash is optional.
     */
    constructor(baseUrl: string) {
        this.baseUrl_ = baseUrl.replace(/\/+$/, '');
    }

    /** Built artifacts are `spine38`/`spine41`/`spine42` (no separator). */
    private url(version: string, ext: 'js' | 'wasm'): string {
        return `${this.baseUrl_}/spine${version.replace('.', '')}.${ext}`;
    }

    async loadJs(version: string): Promise<string> {
        const url = this.url(version, 'js');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`spine: failed to fetch ${url} (${res.status})`);
        return res.text();
    }

    async loadWasm(version: string): Promise<ArrayBuffer> {
        const url = this.url(version, 'wasm');
        const res = await fetch(url);
        if (!res.ok) throw new Error(`spine: failed to fetch ${url} (${res.status})`);
        return res.arrayBuffer();
    }
}
