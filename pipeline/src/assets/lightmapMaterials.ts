// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { assetRefId } from '../../../sdk/src/asset/AssetRegistry';
import { builtinRefId, resolveIndexedSiblingRef } from '../../../sdk/src/asset/documentRef';
import { FOLIAGE_SHADER_TEMPLATE } from '../../../sdk/src/foliage/foliageShader';
import { builtinShaderTemplate } from '../../../sdk/src/render/builtinShaders';
import { reflectEsshader } from '../../../sdk/src/render/shaderReflect';
import { resolveInside } from '../fs/pathSandbox';
import type { SceneBakeInput, SceneBakeSurface } from './lightmapBake';

interface FileRef { ref: string; owner: string }
interface BakeMaterial {
    shader?: FileRef;
    cutoff?: number;
    useTexture?: number;
    albedo?: FileRef | 0;
}

export interface BakeSurfaceTexture {
    file?: string;
    cutoff: number;
}

interface MaterialSampling extends BakeSurfaceTexture {
    usesAlbedo?: boolean;
}

const finite = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Find the texture the bake samples, preserving the document that authored each inherited ref. */
export function surfaceTextureReader(project: SceneBakeInput['materialProject']): (surface: SceneBakeSurface) => BakeSurfaceTexture {
    const assets = project?.assets;
    const byId = new Map(assets?.map(({ uuid, path }) => [uuid.toLowerCase(), path]));
    const indexed = new Set(byId.values());
    const materialsByRoot = new Map<string, Map<string, BakeMaterial>>();
    const shaderParams = new Map<string, ReturnType<typeof reflectEsshader>['params']>();
    const materialSampling = new WeakMap<BakeMaterial, MaterialSampling>();
    const surfaces = new WeakMap<SceneBakeSurface, BakeSurfaceTexture>();

    function resolveRef(root: string, { ref, owner }: FileRef): string | undefined {
        const ownerPath = path.relative(root, owner).split(path.sep).join('/');
        const isKnown = (candidate: string) => {
            if (assets) return indexed.has(candidate);
            try { return statSync(resolveInside(root, candidate, 'bake project'), { throwIfNoEntry: false })?.isFile() ?? false; }
            catch { return false; }
        };
        const id = assetRefId(ref);
        const resolved = id !== null ? byId.get(id) : resolveIndexedSiblingRef(ownerPath, ref, isKnown);
        if (!resolved || /^(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i.test(resolved)) return undefined;
        try { return resolveInside(root, resolved.replace(/^\//, ''), 'bake project'); }
        catch { return undefined; }
    }

    function materialOf(root: string, file: string): BakeMaterial {
        let cache = materialsByRoot.get(root);
        if (!cache) materialsByRoot.set(root, cache = new Map());
        const saved = cache.get(file);
        if (saved) return saved;
        const chain = new Map<string, BakeMaterial>();
        let inherited: BakeMaterial = {};
        try {
            let current: string | undefined = resolveInside(root, path.relative(root, file), 'bake project');
            while (current && !chain.has(current)) {
                const cached = cache.get(current);
                if (cached) { inherited = cached; break; }
                const doc = JSON.parse(readFileSync(current, 'utf8').replace(/^\uFEFF/, '')) as {
                    properties?: Record<string, unknown>; shader?: unknown; instanceOf?: unknown;
                };
                const own: BakeMaterial = {};
                const props = doc.properties;
                const cutoff = finite(props?.u_alphaCutoff), useTexture = finite(props?.u_useTexture);
                if (cutoff !== undefined) own.cutoff = cutoff;
                if (useTexture !== undefined) own.useTexture = useTexture;
                if (props?.u_albedo === 0) own.albedo = 0;
                else if (typeof props?.u_albedo === 'string' && props.u_albedo) own.albedo = { ref: props.u_albedo, owner: current };
                chain.set(current, own);
                if (typeof doc.instanceOf === 'string' && doc.instanceOf) {
                    current = resolveRef(root, { ref: doc.instanceOf, owner: current });
                } else {
                    if (typeof doc.shader === 'string' && doc.shader) own.shader = { ref: doc.shader, owner: current };
                    break;
                }
            }
        } catch { /* Keep the explicit overrides when the rest of the chain is unavailable. */ }
        for (const [owner, own] of [...chain].reverse()) {
            inherited = { ...inherited, ...own };
            cache.set(owner, inherited);
        }
        cache.set(file, inherited);
        return inherited;
    }

    function paramsOf(root: string, shader: FileRef) {
        const id = builtinRefId(shader.ref);
        const key = id === null ? resolveRef(root, shader) : shader.ref;
        if (!key) return [];
        let params = shaderParams.get(key);
        if (!params) {
            let source: string | undefined;
            try {
                source = id === null ? readFileSync(key, 'utf8')
                    : (id === 'foliage' ? FOLIAGE_SHADER_TEMPLATE : builtinShaderTemplate(id))?.source;
            } catch { /* Keep the component texture when a shader cannot be read. */ }
            params = source ? reflectEsshader(source).params : [];
            shaderParams.set(key, params);
        }
        return params;
    }

    function samplingOf(root: string, material: BakeMaterial): MaterialSampling {
        const cached = materialSampling.get(material);
        if (cached) return cached;
        let sampling: MaterialSampling = { cutoff: Math.max(0, material.cutoff ?? 0) };
        // Most mesh shaders take their color texture from the renderer. A material-owned
        // albedo needs a declared slot. Foliage uses that slot even when it is left at its default.
        if (material.shader && (material.albedo !== undefined || material.shader.ref === 'builtin:foliage')) {
            const params = paramsOf(root, material.shader);
            if (params.some(param => param.name === 'u_albedo' && param.type === 'texture')) {
                const gate = params.find(param => param.name === 'u_useTexture' && param.type === 'float');
                const enabled = !gate || (material.useTexture ?? gate.default[0] ?? 0) > 0.5;
                const fallback = params.find(param => param.name === 'u_alphaCutoff' && param.type === 'float')?.default[0] ?? 0;
                sampling = {
                    usesAlbedo: true,
                    file: enabled && material.albedo ? resolveRef(root, material.albedo) : undefined,
                    cutoff: enabled ? Math.max(0, material.cutoff ?? fallback) : 0,
                };
            }
        }
        materialSampling.set(material, sampling);
        return sampling;
    }

    return surface => {
        const cached = surfaces.get(surface);
        if (cached) return cached;
        let file = surface.baseColorTexture;
        let cutoff = 0;
        if (surface.material) {
            const materialFile = path.resolve(surface.material);
            const root = project?.root ?? path.dirname(materialFile);
            const sampling = samplingOf(root, materialOf(root, materialFile));
            cutoff = sampling.cutoff;
            if (sampling.usesAlbedo) file = sampling.file;
        }
        const result = { file, cutoff };
        surfaces.set(surface, result);
        return result;
    };
}

/** Refine the scene fingerprint with the texture bytes and cutoff the solve samples. */
export async function bakeTextureFingerprint(sceneFingerprint: string,
    input: Pick<SceneBakeInput, 'surfaces' | 'materialProject'>): Promise<string> {
    const textureOf = surfaceTextureReader(input.materialProject);
    const hashes = new Map<string, string>();
    const rows: string[] = [];
    const logicalPath = (file: string) =>
        path.relative(input.materialProject?.root ?? path.dirname(file), file).split(path.sep).join('/');
    for (const surface of input.surfaces) {
        if (surface.holdsStill === false) continue;
        const { file, cutoff } = textureOf(surface);
        if (!file) continue;
        let digest = hashes.get(file);
        if (digest === undefined) {
            try {
                const hash = createHash('sha256');
                for await (const bytes of createReadStream(file)) hash.update(bytes);
                digest = hash.digest('hex');
            } catch { digest = 'missing'; }
            hashes.set(file, digest);
        }
        rows.push(JSON.stringify([surface.transform, surface.baseColor, surface.builtinRef ?? logicalPath(surface.meshFile),
            surface.material && logicalPath(surface.material), logicalPath(file), cutoff, digest]));
    }
    if (rows.length === 0) return sceneFingerprint;
    const textures = createHash('sha256').update(rows.sort().join('\n')).digest('hex');
    return `${sceneFingerprint}:${textures}`;
}
