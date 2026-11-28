// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Backend } from './Backend';
import type { AssetPackRef, ManifestModel } from './AddressableManifest';
import { physicalAssetFiles } from './physicalAssetFiles';

interface Pack {
    members: Set<string>;
    pending?: { bytes: Promise<ArrayBuffer>; unread: Set<string> };
}

interface FileLayout {
    model: ManifestModel;
    groups: Map<string, string>;
    packs: Map<string, Pack>;
}

function sameMember(before: ManifestModel, after: ManifestModel, path: string): boolean {
    const old = before.packOf(path), next = after.packOf(path);
    return !!old && !!next && old.file === next.file && old.offset === next.offset && old.size === next.size
        && before.assetByPath(path)?.contentHash === after.assetByPath(path)?.contentHash;
}

/** One manifest's physical files, including inputs read by host decoders outside the byte backend. */
function indexFiles(model: ManifestModel, inner: Backend, previous?: FileLayout) {
    const groups = new Map<string, string>();
    for (const group of model.groupsByMode('lazy')) {
        for (const asset of model.assetsInGroup(group)) {
            groups.set(asset.path, group);
            for (const file of physicalAssetFiles(asset)) groups.set(file.path, group);
        }
    }
    const packs = new Map<string, Pack>();
    const paths = new Set(groups.keys());
    for (const [file, members] of model.packMembers()) {
        for (const path of members) paths.add(path);
        // A label edit can finish a pack already in use. A different delivery group
        // or byte layout starts a separate read even when the filename is reused.
        const old = previous?.packs.get(file);
        const reuse = previous && old?.pending && previous.groups.get(file) === groups.get(file)
            && old.members.size === members.size && [...members].every(path => sameMember(previous.model, model, path));
        packs.set(file, reuse ? old : { members });
    }
    const urls = new Map<string, string>();
    const remaining = paths.values();
    const pathFor = (asked: string): string => {
        if (paths.has(asked)) return asked;
        const known = urls.get(asked);
        if (known !== undefined) return known;
        // Most calls supply the staged path. Index transport URLs on demand,
        // skipping entries a custom transport declines to resolve.
        for (const path of remaining) {
            let url: string;
            try { url = inner.resolveUrl(path); } catch { continue; }
            if (url !== path) urls.set(url, path);
            if (url === asked) return path;
        }
        return asked;
    };

    const readPack = async (path: string, pack: AssetPackRef): Promise<ArrayBuffer> => {
        const source = packs.get(pack.file)!;
        const pending = source.pending ??= { bytes: inner.fetchBinary(pack.file), unread: new Set(source.members) };
        try {
            const buffer = await pending.bytes;
            if (pack.offset + pack.size > buffer.byteLength) {
                throw new Error(`${path}: ${pack.file} holds ${buffer.byteLength} bytes, the manifest puts it at ${pack.offset}+${pack.size}`);
            }
            pending.unread.delete(path);
            return buffer.slice(pack.offset, pack.offset + pack.size);
        } catch (error) {
            if (source.pending === pending) source.pending = undefined;
            throw error;
        } finally {
            if (!pending.unread.size && source.pending === pending) source.pending = undefined;
        }
    };
    return { model, groups, packs, pathFor, readPack };
}

/** Route loose files, streamed previews and packed members through the manifest active when a read starts. */
export function manifestBackend(
    inner: Backend, manifest: () => ManifestModel | null, mount: (group: string) => Promise<void>,
    stagedPaths?: ReadonlyMap<string, string>,
): Backend {
    let index: ReturnType<typeof indexFiles> | undefined;
    const locate = (asked: string) => {
        const model = manifest() ?? undefined;
        if (model !== index?.model) index = model ? indexFiles(model, inner, index) : undefined;
        if (!index) return;
        const path = stagedPaths?.get(asked) ?? index.pathFor(asked);
        const group = index.groups.get(path);
        return { files: index, path, ready: group === undefined ? undefined : mount(group) };
    };

    const read = async (asked: string): Promise<ArrayBuffer | null> => {
        const file = locate(asked);
        if (!file) return null;
        const { files, path, ready } = file;
        if (ready) await ready;
        const pack = files.model.packOf(path);
        return pack ? files.readPack(path, pack) : null;
    };

    return {
        async fetchBinary(path) { return (await read(path)) ?? inner.fetchBinary(path); },
        async fetchText(path) {
            const bytes = await read(path);
            return bytes ? new TextDecoder().decode(bytes) : inner.fetchText(path);
        },
        prepareFile(path) {
            const ready = locate(path)?.ready;
            if (!ready) return inner.prepareFile?.(path);
            return inner.prepareFile ? ready.then(() => inner.prepareFile!(path)) : ready;
        },
        resolveUrl: path => inner.resolveUrl(path),
        ...(inner.setBaseUrl && {
            setBaseUrl(url: string, isLocalFile?: (path: string) => boolean) { inner.setBaseUrl!(url, isLocalFile); index = undefined; },
        }),
    };
}
