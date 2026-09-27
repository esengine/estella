// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  modelImages.ts — what a model's images need before a project takes them:
 *        DDS turned into PNG, and maps whose pixels contradict their slot called out.
 *
 * Runs once over a reader's result, so every source format and both import doors
 * get the same treatment. Only pixels this side can read are checked (DDS, PNG);
 * a KTX2 goes through as it is.
 */
import { PNG } from 'pngjs';
import { decodeDds, isDds } from './ddsDecode';
import { encodeRgbaPng } from './png';
import type { ImportedImageRef, ImportedMaterial, ModelImportResult } from './modelImport';

type ImageSlot = 'baseColorTexture' | 'normalTexture' | 'emissiveTexture'
    | 'occlusionTexture' | 'metallicRoughnessTexture';
const SLOTS: ImageSlot[] = ['baseColorTexture', 'normalTexture', 'emissiveTexture',
    'occlusionTexture', 'metallicRoughnessTexture'];

interface Pixels { width: number; height: number; rgba: Uint8Array }

/** Above this many texels a single colour is worth saying: the file costs what a constant would not. */
const CONSTANT_NOTICE_TEXELS = 16;

const isDdsName = (file: string): boolean => /\.dds$/i.test(file);
const baseName = (file: string): string => file.split(/[\\/]/).pop() ?? file;

function readPng(bytes: Uint8Array): Pixels | null {
    try {
        const png = PNG.sync.read(Buffer.from(bytes));
        return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
    } catch {
        return null;
    }
}

/** The one colour every texel has, or null. */
function constantColor(p: Pixels): number[] | null {
    const d = p.rgba;
    for (let i = 4; i < d.length; i += 4) {
        if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) return null;
    }
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0];
}

function redIsZero(p: Pixels): boolean {
    for (let i = 0; i < p.rgba.length; i += 4) if (p.rgba[i] !== 0) return false;
    return true;
}

/**
 * Converts the result's DDS images to PNG and checks the images it can read,
 * editing `result` in place.
 *
 * @param read Resolves an external uri the way the reader's own buffers were.
 */
export function prepareModelImages(result: ModelImportResult,
                                   read?: (uri: string) => Uint8Array | null): void {
    const embedded = new Map(result.textures.map(t => [t.name, t]));
    // Per source file: its pixels and the ref it becomes, or null once it has failed.
    const seen = new Map<string, { pixels: Pixels | null; ref: ImportedImageRef | null }>();

    const load = (ref: ImportedImageRef, label: string) => {
        const key = `${ref.external ? 'x' : 'e'}:${ref.file}`;
        const hit = seen.get(key);
        if (hit) return hit;
        const bytes = ref.external ? read?.(ref.file) ?? null : embedded.get(ref.file)?.bytes ?? null;
        let entry: { pixels: Pixels | null; ref: ImportedImageRef | null };
        if (!isDdsName(ref.file) && !(bytes && isDds(bytes))) {
            entry = { pixels: bytes && /\.png$/i.test(ref.file) ? readPng(bytes) : null, ref };
        } else if (!bytes) {
            result.warnings.push(`${label}: ${ref.file} could not be read — skipped`);
            entry = { pixels: null, ref: null };
        } else {
            try {
                const dds = decodeDds(bytes);
                const name = `${baseName(ref.file).replace(/\.dds$/i, '')}.png`;
                if (!embedded.has(name)) {
                    const texture = { name, bytes: encodeRgbaPng(dds.width, dds.height, dds.rgba) };
                    result.textures.push(texture);
                    embedded.set(name, texture);
                }
                entry = { pixels: dds, ref: { file: name, external: false } };
            } catch (error) {
                result.warnings.push(`${label}: ${ref.file}: ${(error as Error).message} — skipped`);
                entry = { pixels: null, ref: null };
            }
        }
        seen.set(key, entry);
        return entry;
    };

    const noticed = new Set<string>();
    const materials = new Set<ImportedMaterial>();
    for (const mesh of result.meshes) if (mesh.material) materials.add(mesh.material);
    for (const material of materials) {
        const label = `material "${material.name}"`;
        for (const slot of SLOTS) {
            const ref = material[slot];
            if (!ref) continue;
            const { pixels, ref: converted } = load(ref, label);
            if (!converted) {
                delete material[slot];
                continue;
            }
            // The sampler settings ride the reference, not the file.
            material[slot] = ref.settings ? { ...converted, settings: ref.settings } : converted;
            if (!pixels) continue;
            if (slot === 'occlusionTexture' && redIsZero(pixels)) {
                // Occlusion 0 is "no ambient light reaches here": taken literally, the
                // surface goes black. A map that says it everywhere is a packing mistake.
                result.warnings.push(`${label}: its occlusion map ${ref.file} is zero in every texel`
                    + ' — not imported (the surface would lose all ambient light)');
                delete material[slot];
                delete material.occlusionStrength;
                continue;
            }
            const color = pixels.width * pixels.height > CONSTANT_NOTICE_TEXELS ? constantColor(pixels) : null;
            if (color && !noticed.has(ref.file)) {
                noticed.add(ref.file);
                result.warnings.push(`${ref.file} is one colour (${color.join(', ')}) across`
                    + ` ${pixels.width}x${pixels.height} — a material constant would say the same`);
            }
        }
    }

    const converted = new Set([...seen.entries()].filter(([k]) => k.startsWith('x:') && isDdsName(k.slice(2)))
        .map(([k]) => k.slice(2)));
    result.externalFiles = result.externalFiles.filter(uri => !converted.has(uri));
    result.textures = result.textures.filter(t => !isDdsName(t.name));
}
