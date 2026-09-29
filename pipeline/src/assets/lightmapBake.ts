// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    lightmapBake.ts
 * @brief   A scene's surfaces and lights become the atlas a `MeshLightmap` reads.
 *
 * The same shape as the environment import: the computation lives here and the
 * caller only writes files. What arrives is already placed — the editor holds
 * the world the transforms come from, and this holds the meshes they name.
 */
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { bakeLightmapSteps, bakeRunner, lightmapImage, decodeMesh, unwrapLightmapUV, builtinMeshTemplate, MeshChannel,
         type MeshData, type BakeSurface, type BakeLight, type BakeOptions,
         type BakeStep, type CapturedPanorama, type ProbeGrid } from 'esengine';
import { encodeRgbaPng } from './png';
import { adoptOrphan } from './assetMeta';
import { META_EXT } from './contentPolicy';

export { BakeKernelExecutor } from './lightmapKernel';
import { bakeSceneReflections, bakeSky, irradianceSky, type BakeEnvironment,
         type ReflectionBakeResult } from './reflectionBake';

// What a collector needs to describe a surface, re-exported so the CLI reaches
// them through the one module it loads. composeTRS especially: a second
// implementation would put the two doors a rounding error apart.
export { bakeHoldsStill, bakeFingerprint, bakeLightOf, composeTRS, BAKE_DEFAULTS,
         type BakeMobility, type BakeInputs } from 'esengine';

/** One placed object, as the editor's world describes it. */
export interface SceneBakeSurface {
    /** Absolute path of the `.esmesh` this object draws, or '' when
     *  {@link builtinRef} names the geometry instead. */
    meshFile: string;
    /** `builtin:<id>` for stock geometry, which is built from code and has no
     *  file to read a UV set out of. */
    builtinRef?: string;
    /** How it is named where a warning has to be readable. */
    label: string;
    /** Column-major 4x4 world transform. */
    transform: number[];
    /**
     * The surface's base colour factor — for an imported model this IS the
     * material's `baseColorFactor`, which the import writes onto the component.
     */
    baseColor?: [number, number, number];
    /** Absolute path of the base colour texture, whose average completes the
     *  albedo. A bounce off a red wall has to arrive red, and the colour is in
     *  the texture as often as it is in the factor. */
    baseColorTexture?: string;
    /** False where the simulation moves this object — see `bakeHoldsStill`. It
     *  takes a probe volume's light instead of an atlas patch, because a bake
     *  writes light into a place and this one will not be there. Absent = yes. */
    holdsStill?: boolean;
    /** True where the renderer is `lit`: the frame adds the lamps to it, so its
     *  patch holds only the indirect light. */
    realtimeDirect?: boolean;
    /** The renderer draws both faces (`cullBackfaces` off). */
    twoSided?: boolean;
    /** Absolute path of the `.esmaterial` it draws with, whose alpha cutoff says
     *  how much of it a ray finds there. */
    material?: string;
}

/** One box of probes to solve, as the editor's world describes it. */
export interface SceneProbeVolume {
    /** How it is named where a warning has to be readable. */
    label: string;
    /** The entity's world position; the box is axis-aligned around it. */
    center: [number, number, number];
    halfExtents: [number, number, number];
    /** World units between probes the author asked for. */
    spacing: number;
}

/** A solved grid, as an `.esprobes` document. */
export interface ProbeVolumeDocument {
    version: number;
    resolution: [number, number, number];
    irradiance: number[];
}

export interface SceneBakeInput {
    surfaces: SceneBakeSurface[];
    lights: BakeLight[];
    probeVolumes?: SceneProbeVolume[];
    /** Where reflections are captured from, in the order their atlas columns are
     *  numbered — column 0 being the sky, a probe's is its index plus one. */
    reflectionProbes?: SceneReflectionProbe[];
    /** The environment the scene is lit by: what a captured ray that escapes
     *  brings back, and the format the reflection atlas adopts. */
    environment?: BakeEnvironment | null;
    options?: BakeOptions;
}

/** One reflection probe, as the editor's world describes it. */
export interface SceneReflectionProbe {
    entity: number;
    label: string;
    center: [number, number, number];
}

/**
 * Probes one volume may carry. A grid is written as text, and past this a volume
 * is megabytes of it. The answer is a coarser spacing or a smaller box, and only
 * the author can choose between them — so one that does not fit is REFUSED and
 * named, not quietly thinned.
 */
export const MAX_PROBES_PER_VOLUME = 4096;

/**
 * Probes along one axis, for a half-extent and a spacing.
 *
 * Probes sit on the CORNERS (see `probeAt`), so a span of exactly one spacing is
 * two probes, and a box thinner than half a spacing is one — a constant along
 * that axis, which is what a flat volume means.
 */
export function probeCountFor(half: number, spacing: number): number {
    if (!(half > 0) || !(spacing > 0)) return 1;
    return Math.max(1, Math.round((2 * half) / spacing) + 1);
}

export interface SceneBakeResult {
    atlasBytes: Uint8Array;
    /** Atlas rectangle per surface, in the order they were given — `null` for one
     *  that was skipped, so a caller can line results up with what it sent. */
    scaleOffset: Array<[number, number, number, number] | null>;
    /** Texels the bake actually solved. Zero means nothing was lit. */
    lumels: number;
    size: number;
    /** The `.esprobes` document per requested volume, in order — `null` for one
     *  that was refused, so a caller can line results up with what it sent. */
    probes: Array<ProbeVolumeDocument | null>;
    /** The scene's reflections as one atlas, or null when it declared no probe. */
    reflection: ReflectionBakeResult | null;
    warnings: string[];
}

/** Six significant figures: a grid is hundreds of numbers, and the digits past
 *  these say nothing a bake of it would reproduce anyway. */
const round6 = (v: number): number => Number(v.toPrecision(6));

/**
 * An `.esprobes` document as its file. One line per member, because a grid is
 * hundreds of numbers and a diff of it is worth reading only if they stay put —
 * and ONE writer, so the two bake doors produce the same bytes.
 */
export function probeDocumentText(doc: ProbeVolumeDocument): string {
    return `{\n  "version": ${doc.version},\n`
        + `  "resolution": ${JSON.stringify(doc.resolution)},\n`
        + `  "irradiance": ${JSON.stringify(doc.irradiance)}\n}\n`;
}

/** Stock geometry with a lightmap UV set, unwrapped once per bake. */
function builtinGeometry(ref: string, cache: Map<string, MeshData | null>): MeshData | null {
    if (!cache.has(ref)) {
        const template = builtinMeshTemplate(ref);
        cache.set(ref, template ? unwrapLightmapUV(template.build()).mesh : null);
    }
    return cache.get(ref) ?? null;
}

/**
 * The import settings a bake owns on its atlas, reapplied every bake (uuid kept):
 * irradiance, so neither sRGB nor block-compressed; clamped, so a chart's edge
 * cannot wrap; and never downscaled — that bleeds each patch into its neighbours'.
 */
export async function claimLightmapImage(absFile: string, size: number): Promise<void> {
    const owned = { sRGB: false, compress: false, wrapMode: 'clamp' };
    if (await adoptOrphan(absFile, { ...owned, maxSize: Math.max(2048, size) }) !== 'has-meta') return;
    const metaFile = absFile + META_EXT;
    const meta = JSON.parse(await readFile(metaFile, 'utf8')) as { importer?: Record<string, unknown> };
    const importer = meta.importer ?? {};
    const cap = typeof importer.maxSize === 'number' ? importer.maxSize : 2048;
    const next = { ...importer, ...owned, maxSize: Math.max(cap, size) };
    if (JSON.stringify(next) === JSON.stringify(importer)) return;
    meta.importer = next;
    await writeFile(metaFile, JSON.stringify(meta, null, 2) + '\n');
}

/** sRGB to linear per byte value. A texture stores what a screen shows, and an
 *  average taken before this is decoded is brighter than the surface is. */
export const TO_LINEAR = Float64Array.from({ length: 256 }, (_, v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** A texture as a bake reads it: its mean colour in linear light, and the share
 *  of it a cutout keeps. */
export interface TextureStats {
    mean: [number, number, number];
    coverage: number;
}

/**
 * The texels past `cutoff` (all of them without one), averaged — the holes of a
 * cutout are not a colour the surface has — and how many of them there are.
 */
export function statsOf(file: string, cutoff: number): TextureStats | null {
    const png = PNG.sync.read(readFileSync(file));
    let r = 0, g = 0, b = 0, kept = 0;
    const pixels = png.width * png.height;
    if (pixels === 0) return null;
    const floor = cutoff > 0 ? cutoff * 255 : -1;
    const data = png.data;
    for (let i = 0; i < pixels; i++) {
        if (data[i * 4 + 3] < floor) continue;
        r += TO_LINEAR[data[i * 4]];
        g += TO_LINEAR[data[i * 4 + 1]];
        b += TO_LINEAR[data[i * 4 + 2]];
        kept++;
    }
    if (kept === 0) return { mean: [0, 0, 0], coverage: 0 };
    return { mean: [r / kept, g / kept, b / kept], coverage: kept / pixels };
}

const statsKey = (file: string, cutoff: number): string => `${file}|${cutoff}`;

/** The alpha cutoff a material document states, or 0. */
function cutoffOf(materialFile: string | undefined, cache: Map<string, number>): number {
    if (!materialFile) return 0;
    if (!cache.has(materialFile)) {
        let cutoff = 0;
        try {
            const doc = JSON.parse(readFileSync(materialFile, 'utf8')) as
                { properties?: { u_alphaCutoff?: unknown } };
            const v = doc.properties?.u_alphaCutoff;
            if (typeof v === 'number' && v > 0) cutoff = v;
        } catch { /* a material this cannot read cuts nothing */ }
        cache.set(materialFile, cutoff);
    }
    return cache.get(materialFile)!;
}

/**
 * What fraction of each channel this surface reflects.
 *
 * The factor and the texture BOTH carry it — a shader multiplies them, and a
 * bounce that used only one would drop the colour whenever the other held it.
 * A surface with neither reflects a neutral grey, which is a guess, so it says so.
 */
function albedoOf(s: SceneBakeSurface, cutoff: number, cache: Map<string, TextureStats | null>,
                  warnings: string[]): { albedo?: [number, number, number]; coverage: number } {
    const factor = s.baseColor;
    if (!s.baseColorTexture) {
        if (!factor) {
            warnings.push(`${s.label}: no base colour, so light bounces off it as neutral grey`);
        }
        return { albedo: factor, coverage: 1 };
    }
    const key = statsKey(s.baseColorTexture, cutoff);
    if (!cache.has(key)) {
        try {
            cache.set(key, statsOf(s.baseColorTexture, cutoff));
        } catch {
            cache.set(key, null);
            warnings.push(`${s.label}: its base colour texture could not be read, so light`
                + ' bounces off it by its colour factor alone');
        }
    }
    const stats = cache.get(key) ?? null;
    if (!stats) return { albedo: factor, coverage: 1 };
    const f = factor ?? [1, 1, 1];
    return { albedo: [stats.mean[0] * f[0], stats.mean[1] * f[1], stats.mean[2] * f[2]],
             coverage: cutoff > 0 ? stats.coverage : 1 };
}

/**
 * Bakes what the caller placed, skipping what cannot receive light and saying so.
 *
 * A mesh with no second UV set is the case an author has to hear about: the bake
 * cannot invent one here (that would split vertices the scene already references)
 * and silently lighting everything else would look like the bake simply missed it.
 */
export function bakeSceneLightmap(input: SceneBakeInput): SceneBakeResult {
    const steps = sceneBakeSteps(input);
    let runner: ReturnType<typeof bakeRunner> | null = null;
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
        runner ??= bakeRunner(next.value.scene);
        runner(next.value.job, 0, next.value.scene.lumels.count);
    }
}

/** What runs each pass of {@link bakeSceneLightmapParallel} over every lumel. */
export interface BakeExecutor {
    run(step: BakeStep): Promise<void>;
    /** {@link statsOf} for many textures at once, through `toLinear`; `undefined`
     *  leaves a file to statsOf, which says why it could not be read. */
    textureStats?(files: readonly string[], cutoffs: readonly number[], toLinear: Float64Array):
        Promise<Array<TextureStats | null | undefined>>;
}

/** {@link bakeSceneLightmap} with each pass run by `executor` across its threads. */
export async function bakeSceneLightmapParallel(input: SceneBakeInput,
                                                executor: BakeExecutor): Promise<SceneBakeResult> {
    const averages = new Map<string, TextureStats | null>();
    const cutoffs = new Map<string, number>();
    if (executor.textureStats) {
        const wanted = new Map<string, { file: string; cutoff: number }>();
        for (const s of input.surfaces) {
            if (!s.baseColorTexture || s.holdsStill === false) continue;
            const cutoff = cutoffOf(s.material, cutoffs);
            wanted.set(statsKey(s.baseColorTexture, cutoff), { file: s.baseColorTexture, cutoff });
        }
        const list = [...wanted];
        const got = await executor.textureStats(list.map(([, w]) => w.file), list.map(([, w]) => w.cutoff),
                                                TO_LINEAR);
        list.forEach(([key], k) => { if (got[k] !== undefined) averages.set(key, got[k]!); });
    }
    const steps = sceneBakeSteps(input, averages, cutoffs);
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
        await executor.run(next.value);
    }
}

/**
 * @param averages One decode per texture however many objects share it: a bake
 *        reads these once and a scene reuses the same few across most of its
 *        surfaces. A driver may fill it ahead.
 */
function* sceneBakeSteps(input: SceneBakeInput, averages = new Map<string, TextureStats | null>(),
                         cutoffs = new Map<string, number>()): Generator<BakeStep, SceneBakeResult, void> {
    const warnings: string[] = [];
    const surfaces: BakeSurface[] = [];
    const slot: number[] = [];
    let moving = 0;
    // Stock geometry is rebuilt from code every run, so its lightmap UVs are
    // DERIVED here rather than being an asset: unwrapping an imported mesh
    // rewrites a file the scene already references, and this rewrites nothing.
    const builtins = new Map<string, MeshData | null>();

    for (let i = 0; i < input.surfaces.length; i++) {
        const s = input.surfaces[i];
        let mesh;
        try {
            mesh = s.builtinRef ? builtinGeometry(s.builtinRef, builtins)
                                : decodeMesh(new Uint8Array(readFileSync(s.meshFile)));
        } catch (err) {
            warnings.push(`${s.label}: ${(err as Error).message}`);
            continue;
        }
        if (!mesh) {
            warnings.push(`${s.label}: "${s.builtinRef}" is not stock geometry this build has`);
            continue;
        }
        if (s.holdsStill === false) {
            moving++;
            continue;
        }
        if (!mesh.channels.some((c) => c.semantic === MeshChannel.TexCoord1)) {
            warnings.push(`${s.label}: no second UV set, so it receives no baked light —`
                + ' turn on Generate Lightmap UVs in its model\'s import settings and reimport');
            continue;
        }
        slot.push(i);
        const { albedo, coverage } = albedoOf(s, cutoffOf(s.material, cutoffs), averages, warnings);
        surfaces.push({ mesh, transform: s.transform, albedo, coverage, label: s.label,
                        realtimeDirect: s.realtimeDirect, twoSided: s.twoSided });
    }

    // The volumes, turned from what an author asked for into the grids a solve
    // takes. Refused ones keep their place, so a caller lines results up by index.
    const requested = input.probeVolumes ?? [];
    const grids: ProbeGrid[] = [];
    const gridSlot: number[] = [];
    for (let i = 0; i < requested.length; i++) {
        const v = requested[i];
        const counts = v.halfExtents.map((h) => probeCountFor(h, v.spacing)) as
            [number, number, number];
        const total = counts[0] * counts[1] * counts[2];
        if (total > MAX_PROBES_PER_VOLUME) {
            warnings.push(`${v.label}: ${counts.join('x')} probes is past the ${MAX_PROBES_PER_VOLUME}`
                + ' one volume may carry — raise its spacing or shrink its box');
            continue;
        }
        gridSlot.push(i);
        grids.push({
            min: [v.center[0] - v.halfExtents[0], v.center[1] - v.halfExtents[1],
                  v.center[2] - v.halfExtents[2]],
            max: [v.center[0] + v.halfExtents[0], v.center[1] + v.halfExtents[1],
                  v.center[2] + v.halfExtents[2]],
            resolution: counts,
        });
    }
    if (moving > 0 && grids.length === 0) {
        warnings.push(`${moving} object(s) move, and no probe volume lights them — they take`
            + ' only real-time light. Add a LightProbeVolume covering where they go.');
    }
    const probes: Array<ProbeVolumeDocument | null> = requested.map(() => null);
    // Captured in the light field the surfaces end up in, so a mirror and the
    // wall it mirrors agree; the sky is the environment's where there is one.
    const ambient = input.options?.ambient ?? [0, 0, 0];
    const reflectionProbes = input.reflectionProbes ?? [];
    const reflectionOptions = {
        reflectionProbes: reflectionProbes.map((p) => p.center),
        reflectionSky: bakeSky(input.environment, ambient),
        sky: irradianceSky(input.environment, ambient),
    };
    const packReflections = (panoramas: CapturedPanorama[]): ReflectionBakeResult | null => {
        if (reflectionProbes.length === 0) return null;
        const packed = bakeSceneReflections({ panoramas, environment: input.environment, ambient });
        for (const w of packed.warnings) warnings.push(w);
        return packed;
    };
    const asDocument = (grid: ProbeGrid, sh: Float32Array): ProbeVolumeDocument => ({
        version: 1,
        resolution: [grid.resolution[0], grid.resolution[1], grid.resolution[2]],
        irradiance: Array.from(sh, round6),
    });

    if (surfaces.length === 0) {
        warnings.push('nothing in this scene can receive baked light');
        // The volumes are still solved: a scene whose only light is ambient has
        // nothing to bake into an atlas and still has somewhere to stand.
        const empty = yield* bakeLightmapSteps([], input.lights,
                                               { ...input.options, probeGrids: grids, ...reflectionOptions });
        gridSlot.forEach((at, k) => { probes[at] = asDocument(grids[k], empty.probes[k]); });
        return {
            atlasBytes: encodeRgbaPng(1, 1, new Uint8Array([0, 0, 0, 255])),
            scaleOffset: input.surfaces.map(() => null),
            lumels: 0, size: 1, probes,
            reflection: packReflections(empty.reflections),
            warnings,
        };
    }

    const result = yield* bakeLightmapSteps(surfaces, input.lights,
                                            { ...input.options, probeGrids: grids, ...reflectionOptions });
    result.shared.forEach((share, k) => {
        if (share > 0.25) {
            warnings.push(`${surfaces[k]!.label ?? `surface ${k}`}: its lightmap UVs lay`
                + ` ${Math.round(share * 100)}% of its texels over one another, so those parts share`
                + ' one texel\'s light — turn on Generate Lightmap UVs in its model\'s import settings'
                + ' and reimport');
        }
    });
    const scaleOffset: Array<[number, number, number, number] | null> =
        input.surfaces.map(() => null);
    slot.forEach((at, k) => { scaleOffset[at] = result.scaleOffset[k]; });
    gridSlot.forEach((at, k) => { probes[at] = asDocument(grids[k], result.probes[k]); });

    return {
        atlasBytes: encodeRgbaPng(result.size, result.size, lightmapImage(result.pixels, result.size)),
        scaleOffset,
        lumels: result.lumels,
        size: result.size,
        probes,
        reflection: packReflections(result.reflections),
        warnings,
    };
}
