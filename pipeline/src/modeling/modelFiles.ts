// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createRequire } from 'node:module';
import { encodeMesh } from 'esengine';
import { encodeRgbaPng } from '../assets/png';
import { bakeModel, modelMaterialDoc, needsPreparing, prepareModeling, renderModelSheet, validateModelSource, type ModelReport } from './index';
import { startNormalBake, type NormalMap } from './normalBake';
import { openProbeCache } from './probeCache';
import { probeCount, runBakeAcross, shadeAcross } from './probeWorkers';

export interface ModelFile {
    name: string;
    bytes: Uint8Array;
    importer?: Record<string, unknown>;
}

export interface ModelFiles {
    report: ModelReport;
    files: ModelFile[];
    renderer: Record<string, unknown>;
    sheet?: Uint8Array;
    probes?: { computed: number; reused: number; jobs: number };
}

export interface ModelFileOptions {
    sheet?: boolean;
    jobs?: number;
    cacheDir?: string;
}

const dataMap = (size: number): Record<string, unknown> => ({ sRGB: false, maxSize: size });

export async function bakeModelFiles(raw: unknown, stem: string, options: ModelFileOptions = {}): Promise<ModelFiles> {
    const source = validateModelSource(raw);
    if (needsPreparing(source.steps)) await prepareModeling(createRequire(import.meta.url).resolve('manifold-3d/manifold.wasm'));
    const baked = bakeModel(source);
    for (const [what, has] of [['a rig', baked.rig], ['shapes', baked.shapes], ['hair cards', baked.hair], ['fractured pieces', baked.shards], ['leaf cards', baked.leaves]] as const) {
        if (has) throw new Error(`bake-model writes a still model's mesh, maps and material; this one has ${what}, which the editor writes`);
    }
    let normal: NormalMap | null = null;
    let probes: ModelFiles['probes'];
    if (baked.detail) {
        const start = startNormalBake(baked);
        await shadeAcross(start, options.jobs ?? 1);
        const plan = start.plan();
        const cache = options.cacheDir ? openProbeCache(options.cacheDir, stem, baked.detail.size, plan.probes) : null;
        const computed = probeCount(plan.probes);
        const jobs = await runBakeAcross(plan, options.jobs ?? 1);
        cache?.save();
        probes = { computed, reused: cache?.reused ?? 0, jobs };
        normal = plan.finish();
    }
    if (normal) {
        baked.report.normalBake = normal.report;
        baked.report.warnings.push(...normal.warnings);
    }
    const names = {
        mesh: `${stem}.esmesh`,
        normal: normal ? `${stem}_normal.png` : null,
        color: normal?.colorRgba ? `${stem}_color.png` : null,
        surface: normal?.surfaceRgba ? `${stem}_surface.png` : null,
        occlusion: normal?.occlusion ? `${stem}_occlusion.png` : null,
        emissive: normal?.emissiveRgba ? `${stem}_emissive.png` : null,
        material: `${stem}.esmaterial`,
    };
    const closed = baked.report.openEdges === 0;
    const material = modelMaterialDoc(source, closed, names);
    const files: ModelFile[] = [{ name: names.mesh, bytes: encodeMesh(baked.data) }];
    if (normal && names.normal) files.push({ name: names.normal, bytes: encodeRgbaPng(normal.size, normal.size, normal.rgba), importer: dataMap(normal.size) });
    if (normal?.colorRgba && names.color) files.push({ name: names.color, bytes: encodeRgbaPng(normal.size, normal.size, normal.colorRgba), importer: dataMap(normal.size) });
    if (normal?.surfaceRgba && names.surface) files.push({ name: names.surface, bytes: encodeRgbaPng(normal.size, normal.size, normal.surfaceRgba), importer: dataMap(normal.size) });
    if (normal?.emissiveRgba && names.emissive) files.push({ name: names.emissive, bytes: encodeRgbaPng(normal.size, normal.size, normal.emissiveRgba), importer: dataMap(normal.size) });
    if (normal?.occlusion && names.occlusion) files.push({ name: names.occlusion, bytes: encodeRgbaPng(normal.occlusion.size, normal.occlusion.size, normal.occlusion.rgba), importer: dataMap(normal.occlusion.size) });
    if (material) files.push({ name: names.material, bytes: new TextEncoder().encode(`${JSON.stringify(material, null, 2)}\n`) });
    const blended = source.material?.alpha === 'blend';
    const renderer = {
        mesh: names.mesh,
        ...(material ? { material: names.material } : names.normal ? { normalMap: names.normal } : {}),
        ...(names.color ? { texture: names.color } : source.material?.texture ? { texture: source.material.texture } : {}),
        lit: true,
        opaque: !blended,
        cullBackfaces: closed && !source.material?.alpha,
    };
    if (!options.sheet) return { report: baked.report, files, renderer, ...(probes ? { probes } : {}) };
    const sheet = renderModelSheet(baked, ['front', 'right', 'top', 'iso'], 512);
    return { report: baked.report, files, renderer, sheet: encodeRgbaPng(sheet.width, sheet.height, sheet.rgba), ...(probes ? { probes } : {}) };
}
