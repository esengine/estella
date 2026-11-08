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
import { IMPORTED_MATERIAL_IMAGE_SLOTS, type ImportedImageRef, type ImportedMaterial, type ModelImportResult } from './modelImport';

type ImageSlot = typeof IMPORTED_MATERIAL_IMAGE_SLOTS[number];

/** Slots whose texels are numbers, not colour: sampled through sRGB decode they bend. */
// Specular/glossiness shares the Model shader's packed-map unit. Its RGB is
// decoded explicitly there, while alpha stays linear.
const DATA_SLOTS = new Set<ImageSlot>(['normalTexture', 'occlusionTexture', 'metallicRoughnessTexture', 'specularGlossinessTexture', 'flowTexture', 'shiftTexture']);

interface Pixels { width: number; height: number; rgba: Uint8Array }

/** Above this many texels a single colour is worth saying: the file costs what a constant would not. */
const CONSTANT_NOTICE_TEXELS = 16;

/** A share of see-through texels below this is compression noise, not an alpha channel. */
const ALPHA_USED_SHARE = 0.005;

/**
 * What a base colour's alpha says the surface is. Mostly clear where it is not
 * solid is a cutout (a leaf card); mostly in between is a see-through surface
 * (glass). Clear below 16, solid from 240.
 */
function alphaUse(p: Pixels): 'opaque' | 'cutout' | 'blend' {
    let clear = 0, partial = 0;
    for (let i = 3; i < p.rgba.length; i += 4) {
        const a = p.rgba[i]!;
        if (a < 16) clear++;
        else if (a < 240) partial++;
    }
    const texels = p.width * p.height;
    if ((clear + partial) / texels < ALPHA_USED_SHARE) return 'opaque';
    return clear >= partial ? 'cutout' : 'blend';
}

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

/**
 * A cut-out's colour carried into its clear texels: each texel's colour is pulled toward that of the solid texels nearest it, as far as it is
 * clear (push-pull over a pyramid of alpha-weighted colour). What a painter leaves under alpha 0 is usually whatever was behind the strokes,
 * a skin tone under eyelashes, white under a leaf; a mip averages it in with the strands, and seen from a distance the card drew a veil of
 * that colour over what it covers (the render lab's probe eye came out pink). A texel that is solid keeps its colour exactly.
 */
export function bleedCutoutColor(p: Pixels, options?: { clearOnly?: boolean }): Uint8Array {
    // `clearOnly`: only texels with alpha 0 take the neighbourhood's colour. A
    // straight-alpha sprite's partly clear texels (an anti-aliased edge) carry the
    // colour that is SEEN, and pulling them toward a neighbour shifts the edge's hue.
    const clearOnly = options?.clearOnly === true;
    const levels: { w: number; h: number; c: Float32Array; a: Float32Array }[] = [];
    let w = p.width, h = p.height;
    let c = new Float32Array(w * h * 3), a = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const alpha = p.rgba[i * 4 + 3]! / 255;
        a[i] = alpha;
        for (let k = 0; k < 3; k++) c[i * 3 + k] = p.rgba[i * 4 + k]! * alpha;
    }
    levels.push({ w, h, c, a });
    while (w > 1 || h > 1) {
        const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
        const nc = new Float32Array(nw * nh * 3), na = new Float32Array(nw * nh);
        for (let y = 0; y < nh; y++) {
            for (let x = 0; x < nw; x++) {
                const o = y * nw + x;
                for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
                    const sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy);
                    const i = sy * w + sx;
                    na[o] += a[i]!;
                    for (let k = 0; k < 3; k++) nc[o * 3 + k] += c[i * 3 + k]!;
                }
            }
        }
        w = nw; h = nh; c = nc; a = na;
        levels.push({ w, h, c, a });
    }
    const out = new Uint8Array(p.rgba);
    for (let y = 0; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
            const i = y * p.width + x;
            const alpha = p.rgba[i * 4 + 3]! / 255;
            if (alpha >= 1 || (clearOnly && alpha > 0)) continue;
            // The colour of the nearest solid neighbourhood: the first level up whose cell holds any.
            let fill: [number, number, number] | null = null;
            for (let l = 1; l < levels.length; l++) {
                const L = levels[l]!;
                const lx = Math.min(L.w - 1, x >> l), ly = Math.min(L.h - 1, y >> l);
                const o = ly * L.w + lx;
                if (L.a[o]! > 1e-3) {
                    fill = [L.c[o * 3]! / L.a[o]!, L.c[o * 3 + 1]! / L.a[o]!, L.c[o * 3 + 2]! / L.a[o]!];
                    break;
                }
            }
            if (!fill) continue;
            for (let k = 0; k < 3; k++) {
                out[i * 4 + k] = Math.round(p.rgba[i * 4 + k]! * alpha + fill[k]! * (1 - alpha));
            }
        }
    }
    return out;
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
                                   read?: (uri: string) => Uint8Array | null,
                                   options: { alphaFromBaseColor?: boolean } = {}): void {
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

    /**
     * Metalness, roughness and occlusion written as separate images, packed into the one map the engine samples: occlusion in red,
     * roughness in green, metal in blue, each from its source's red channel (roughness inverted when the source gave glossiness).
     * A channel with no image stays at full, so the material's own factor says it. Only PNG and DDS can be read here.
     */
    const packSeparateMaps = (material: ImportedMaterial, label: string): void => {
        const separate = material.separateMaps;
        if (!separate) return;
        delete material.separateMaps;
        const read = (ref: ImportedImageRef | undefined) => (ref ? load(ref, label).pixels : null);
        const metal = read(separate.metalness), rough = read(separate.roughness), occlusion = read(separate.occlusion);
        const wanted = [separate.metalness, separate.roughness].filter(Boolean).length;
        if (wanted === 0 || [metal, rough].filter(Boolean).length < wanted) {
            result.warnings.push(`${label}: its separate metalness/roughness maps could not be packed (only PNG and DDS can be read) —`
                + ` the constants ${(material.metallic ?? 0).toFixed(2)}/${(material.roughness ?? 1).toFixed(2)} are used instead`);
            return;
        }
        const sources = [metal, rough, occlusion].filter((p): p is Pixels => !!p);
        const width = Math.max(...sources.map(p => p.width)), height = Math.max(...sources.map(p => p.height));
        // Nearest-neighbour from each source into the largest's grid: maps of different sizes still line up in uv.
        const sample = (p: Pixels | null, x: number, y: number): number | null => {
            if (!p) return null;
            const sx = Math.min(p.width - 1, Math.floor((x + 0.5) * p.width / width));
            const sy = Math.min(p.height - 1, Math.floor((y + 0.5) * p.height / height));
            return p.rgba[(sy * p.width + sx) * 4]!;
        };
        const packed = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const at = (y * width + x) * 4;
                const ao = sample(occlusion, x, y), r = sample(rough, x, y), m = sample(metal, x, y);
                packed[at] = ao ?? 255;
                packed[at + 1] = r === null ? 255 : separate.roughnessIsGlossiness ? 255 - r : r;
                packed[at + 2] = m ?? 255;
                packed[at + 3] = 255;
            }
        }
        const name = `${material.name.replace(/[^A-Za-z0-9_-]+/g, '_')}_orm.png`;
        const texture = { name, bytes: encodeRgbaPng(width, height, packed) };
        result.textures.push(texture);
        embedded.set(name, texture);
        const ref: ImportedImageRef = { file: name, external: false };
        material.metallicRoughnessTexture = ref;
        if (metal) material.metallic = 1;
        if (rough) material.roughness = 1;
        if (occlusion) { material.occlusionTexture = ref; material.occlusionStrength = 1; }
    };

    const noticed = new Set<string>();
    // Base colours by file: whether every material that reads one cuts it out (only then is its clear colour never seen up close).
    const bases = new Map<string, { pixels: Pixels; ref: ImportedImageRef; cutoutOnly: boolean; users: ImportedMaterial[] }>();
    const materials = new Set<ImportedMaterial>();
    for (const mesh of result.meshes) if (mesh.material) materials.add(mesh.material);
    for (const material of materials) {
        const label = `material "${material.name}"`;
        packSeparateMaps(material, label);
        for (const slot of IMPORTED_MATERIAL_IMAGE_SLOTS) {
            const ref = material[slot];
            if (!ref) continue;
            const { pixels, ref: converted } = load(ref, label);
            if (!converted) {
                delete material[slot];
                continue;
            }
            // The sampler settings ride the reference, not the file.
            const settings = DATA_SLOTS.has(slot) ? { ...ref.settings, sRGB: false } : ref.settings;
            material[slot] = settings ? { ...converted, settings } : converted;
            if (!pixels) continue;
            if (slot === 'baseColorTexture' && converted.external === false) {
                const entry = bases.get(converted.file) ?? { pixels, ref: converted, cutoutOnly: true, users: [] };
                entry.users.push(material);
                bases.set(converted.file, entry);
            }
            // A format with no alpha mode (FBX) leaves the base colour's alpha to say it.
            if (slot === 'baseColorTexture' && options.alphaFromBaseColor
                && material.opaque && material.alphaCutoff === undefined) {
                const use = alphaUse(pixels);
                if (use === 'cutout') material.alphaCutoff = 0.5;
                if (use === 'blend') material.opaque = false;
            }
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
        // A cutout's mips keep the share of texels its cut keeps (mipCoverage: see preserveAlphaCoverage), so cut at the same cutoff on
        // every level it neither thins away nor closes into a sheet when it is seen small.
        const base = material.baseColorTexture;
        if (base && material.alphaCutoff !== undefined && material.alphaCutoff > 0) {
            material.baseColorTexture = { ...base, settings: { ...base.settings, mipCoverage: material.alphaCutoff } };
        }
    }
    for (const entry of bases.values()) {
        entry.cutoutOnly = entry.users.every(m => m.alphaCutoff !== undefined && m.alphaCutoff > 0);
        if (!entry.cutoutOnly) continue;
        const texture = embedded.get(entry.ref.file);
        if (!texture) continue;
        texture.bytes = encodeRgbaPng(entry.pixels.width, entry.pixels.height, bleedCutoutColor(entry.pixels));
    }

    const converted = new Set([...seen.entries()].filter(([k]) => k.startsWith('x:') && isDdsName(k.slice(2)))
        .map(([k]) => k.slice(2)));
    result.externalFiles = result.externalFiles.filter(uri => !converted.has(uri));
    result.textures = result.textures.filter(t => !isDdsName(t.name));
}
