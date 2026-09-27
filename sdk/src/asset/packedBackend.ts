// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  packedBackend.ts — reading an asset out of the pack an export put it in.
 *
 * A network build with thousands of small assets spends its load on requests,
 * not bytes: a browser holds six connections to an origin, and Bistro's 1505
 * meshes queued behind them. The export packs local assets into a few files;
 * this reads one member by fetching its pack once and slicing it. Which pack
 * holds what is asked of the manifest in force at the time, not fixed at boot.
 */
import type { Backend } from './Backend';
import type { AssetPackRef, ManifestModel } from './AddressableManifest';

/**
 * `inner`, reading packed assets out of their packs. A pack's bytes are held
 * until every asset in it has been read once, then let go: a later read (a
 * device-loss rebuild) fetches the pack again.
 */
export function packedBackend(inner: Backend, manifest: () => ManifestModel | null): Backend {
    const fetched = new Map<string, Promise<ArrayBuffer>>();
    const unread = new Map<string, Set<string>>();
    let urlToPath: Map<string, string> | null = null;
    let indexedFor: ManifestModel | null = null;

    // Loaders ask by build path or by the url it resolves to; both must find the pack.
    const lookup = (asked: string): { path: string; pack: AssetPackRef } | null => {
        const model = manifest();
        if (!model) return null;
        if (indexedFor !== model) {
            indexedFor = model;
            urlToPath = new Map();
            unread.clear();
            for (const [file, paths] of model.packMembers()) {
                unread.set(file, new Set(paths));
                for (const p of paths) urlToPath.set(inner.resolveUrl(p), p);
            }
        }
        const direct = model.packOf(asked);
        if (direct) return { path: asked, pack: direct };
        const path = urlToPath!.get(asked);
        const pack = path ? model.packOf(path) : null;
        return path && pack ? { path, pack } : null;
    };

    const read = async (asked: string): Promise<ArrayBuffer | null> => {
        const hit = lookup(asked);
        if (!hit) return null;
        const { path, pack } = hit;
        let bytes = fetched.get(pack.file);
        if (!bytes) {
            bytes = inner.fetchBinary(pack.file);
            fetched.set(pack.file, bytes);
            // A failed fetch is not kept: the next read asks again.
            bytes.catch(() => fetched.delete(pack.file));
        }
        const buffer = await bytes;
        if (pack.offset + pack.size > buffer.byteLength) {
            throw new Error(`${path}: ${pack.file} holds ${buffer.byteLength} bytes, the manifest puts it at ${pack.offset}+${pack.size}`);
        }
        const left = unread.get(pack.file);
        left?.delete(path);
        if (left && left.size === 0) {
            fetched.delete(pack.file);
            unread.set(pack.file, new Set(manifest()?.packMembers().get(pack.file) ?? []));
        }
        return buffer.slice(pack.offset, pack.offset + pack.size);
    };

    return {
        async fetchBinary(path: string): Promise<ArrayBuffer> {
            return (await read(path)) ?? inner.fetchBinary(path);
        },
        async fetchText(path: string): Promise<string> {
            const bytes = await read(path);
            return bytes ? new TextDecoder().decode(bytes) : inner.fetchText(path);
        },
        resolveUrl: (path: string) => inner.resolveUrl(path),
        ...(inner.setBaseUrl ? {
            setBaseUrl: (url: string) => {
                inner.setBaseUrl!(url);
                indexedFor = null;
            },
        } : {}),
    };
}
