// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readdir } from 'node:fs/promises';
import { resolveInside } from '../fs/pathSandbox';
import { savedMeshGIRefs, siblingMeshGIRefs, type MeshGIRefs } from '../../../sdk/src/gi/meshGIAssets';
import { encodeMeshCards } from '../../../sdk/src/gi/cardFormat';
import { bakeMeshSdf, encodeMeshSdf } from './meshSdf';
import { bakeMeshCards } from './meshCards';
import { META_EXT } from './contentPolicy';
import { adoptOrphan, metaUuidOf } from './assetMeta';
import { readImportJson, setImportMeta } from './importMeta';
import type { ImportedMesh } from './modelImport';
import type { sourceProductWriter, SourceFileLocation } from './sourceProducts';

type Binding = false | (MeshGIRefs & { active?: false });
type Writer = Awaited<ReturnType<typeof sourceProductWriter>>;
type DiskProduct = { name: string; uuid: string | null; source: string | null; type: unknown; mesh: string | null };
// The project index also accepts names minted by older import tools as asset IDs.
const assetId = (ref: unknown): string | null => typeof ref === 'string' && ref ? ref.replace(/^@uuid:/, '').toLowerCase() : null;
const importerOf = (meta: Record<string, unknown> | null) => (meta?.importer ?? {}) as Record<string, unknown>;
const inactive = (refs: MeshGIRefs | null): Binding => refs ? { ...refs, active: false } : false;

async function publish(abs: string, meshGI: Binding): Promise<void> {
    await setImportMeta(abs, meta => ({ ...meta, importer: { ...importerOf(meta), meshGI } }));
}

/** Reconcile a source's mesh bakes. Detached files remain ordinary assets for existing explicit references. */
export async function modelGIProducts(location: SourceFileLocation, writer: Writer, unit: number, enabled: boolean,
                                      onProduct?: (path: string, detail: string) => void) {
    const { absDir, sourceUuid } = writer;
    const absolute = (name: string) => resolveInside(absDir, name, 'product directory');
    const names = await readdir(absDir);
    const occupied = new Set(names.map(name => name.toLowerCase().replace(/\.meta$/, '')));
    const byName = new Map<string, DiskProduct>(), byUuid = new Map<string, DiskProduct | null>();
    const byMesh = new Map<string, DiskProduct[]>();
    for (const name of new Set(names.map(n => n.replace(/\.meta$/i, '')).filter(n => /\.esmesh(sdf|cards)$/i.test(n)))) {
        let meta: Record<string, unknown> | null;
        try { meta = await readImportJson(absolute(name + META_EXT)); }
        catch (error) { if (error instanceof SyntaxError) continue; throw error; }
        const entry = { name, uuid: assetId(meta?.uuid), type: meta?.type, mesh: assetId(importerOf(meta).giMesh),
            source: typeof meta?.source === 'string' ? meta.source.toLowerCase() : null };
        byName.set(name.toLowerCase(), entry);
        if (entry.mesh) {
            const products = byMesh.get(entry.mesh) ?? [];
            products.push(entry);
            byMesh.set(entry.mesh, products);
        }
        if (entry.uuid) byUuid.set(entry.uuid, byUuid.has(entry.uuid) ? null : entry);
    }
    const written = new Set<string>(), meshes = new Set<string>();
    function legacy(mesh: string): MeshGIRefs | null {
        const refs = siblingMeshGIRefs(mesh)!;
        const owned = (file: string, type: string) => {
            const p = byName.get(file.toLowerCase());
            return sourceUuid && p?.source === sourceUuid && p.type === type ? p.uuid : null;
        };
        const sdf = owned(refs.sdf, 'meshSdf'), cards = owned(refs.cards, 'meshCards');
        return sdf && cards ? { sdf: '@uuid:' + sdf, cards: '@uuid:' + cards } : null;
    }
    function available(name: string, type: string, mesh: string, ref?: string): string {
        const dot = name.lastIndexOf('.'), ext = name.slice(dot);
        const reusable = (p: DiskProduct | null | undefined) => p && p.type === type && p.name.toLowerCase().endsWith(ext)
            && p.uuid && byUuid.get(p.uuid) === p && !written.has(p.name)
            && (!p.mesh || p.mesh === mesh) && (!p.source || p.source === sourceUuid);
        const old = byUuid.get(assetId(ref) ?? '');
        if (old && reusable(old)) return old.name;
        for (const p of byMesh.get(mesh) ?? []) if (reusable(p)) return p.name;
        const sibling = byName.get(name.toLowerCase());
        if (sibling && sourceUuid && sibling.source === sourceUuid && reusable(sibling)) return sibling.name;
        let candidate = name;
        for (let n = 2; occupied.has(candidate.toLowerCase()); n++) candidate = name.slice(0, dot) + '-' + n + ext;
        occupied.add(candidate.toLowerCase());
        return candidate;
    }
    async function product(name: string, type: string, bytes: Uint8Array, mesh: string, old?: string): Promise<string> {
        const file = available(name, type, mesh, old);
        const rel = await writer.write(file, bytes, adoptOrphan, async abs => {
            // A retry after only one half was written can reclaim the reservation even in a standalone output directory.
            await adoptOrphan(abs);
            await setImportMeta(abs, meta => ({ ...meta, importer: { ...importerOf(meta), giMesh: '@uuid:' + mesh } }));
        });
        written.add(file);
        onProduct?.(rel, bytes.length + ' bytes');
        const uuid = await metaUuidOf(absolute(file));
        if (!uuid) throw new Error('Missing GI asset identity for ' + rel);
        return '@uuid:' + uuid;
    }
    function bind(file: string, mesh?: ImportedMesh): (abs: string) => Promise<void> {
        meshes.add(file);
        return async abs => {
            await adoptOrphan(abs);
            const meta = await readImportJson(absolute(file + META_EXT));
            const id = assetId(meta?.uuid);
            if (!id) throw new Error('Missing mesh identity for ' + file);
            const saved = importerOf(meta).meshGI;
            const prior = saved === undefined ? legacy(file) : savedMeshGIRefs(saved);
            let binding = inactive(prior);
            if (mesh && enabled && !mesh.data.inverseBindMatrices && !mesh.data.morph) {
                const field = bakeMeshSdf(mesh.data, { cellSize: 0.1 * unit });
                const material = mesh.material;
                const cards = field && bakeMeshCards(mesh.data, { cell: 0.25 * unit,
                    baseColor: material ? [material.baseColor[0], material.baseColor[1], material.baseColor[2]] : undefined,
                    emissive: material?.emissive });
                if (field && cards) {
                    const names = siblingMeshGIRefs(file)!;
                    binding = { sdf: await product(names.sdf, 'meshSdf', encodeMeshSdf(field), id, prior?.sdf),
                                cards: await product(names.cards, 'meshCards', encodeMeshCards(cards), id, prior?.cards) };
                }
            }
            await publish(abs, binding);
        };
    }
    async function finish(): Promise<void> {
        const retired = [...byName.values()].filter(p => sourceUuid && p.source === sourceUuid && !written.has(p.name));
        if (!retired.length) return;
        for (const name of names.filter(n => /\.esmesh$/i.test(n) && !meshes.has(n))) {
            const meta = await readImportJson(absolute(name + META_EXT));
            if (typeof meta?.source !== 'string' || meta.source.toLowerCase() !== sourceUuid) continue;
            const saved = importerOf(meta).meshGI;
            const prior = saved === undefined ? legacy(name) : savedMeshGIRefs(saved);
            if (!prior) continue;
            await location.beforeWrite?.(location.destDir ? location.destDir + '/' + name : name);
            await publish(absolute(name), inactive(prior));
        }
        for (const p of retired) await writer.release(p.name);
    }
    return { bind, finish };
}
