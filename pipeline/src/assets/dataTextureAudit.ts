// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  dataTextureAudit.ts — textures a material reads as numbers while their
 *        settings still call them colour.
 *
 * Under the linear pipeline an sRGB texture is decoded as colour on the way in,
 * which bends a normal map and packed roughness. Which texture param holds
 * numbers is the shader's to say (`texel(data)` on its `#pragma param`), so this
 * asks every material's shader rather than guessing from names.
 */
import { reflectEsshader } from '../../../sdk/src/render/shaderReflect';
import { builtinShaderTemplate } from '../../../sdk/src/render/builtinShaders';
import { builtinRefId, resolveDocumentRef } from '../../../sdk/src/asset/documentRef';

export interface DataTextureAuditSource {
    /** Project paths of every `.esmaterial`. */
    materials: Iterable<string>;
    readText(path: string): Promise<string | null>;
    /** A ref as a project path: `@uuid:…` looked up, a path passed through; null if unknown. */
    resolveRef(ref: string): string | null;
    /** A texture's import settings (its `.meta` importer block). */
    importer(path: string): Record<string, unknown> | undefined;
}

export interface DataTextureFinding {
    texture: string;
    /** Every material that reads it as data, and through which param. */
    readBy: Array<{ material: string; param: string }>;
}

interface MaterialDoc { shader?: unknown; instanceOf?: unknown; properties?: Record<string, unknown> }

const withoutLeadingSlash = (p: string): string => (p.startsWith('/') ? p.slice(1) : p);

/** A ref a document carries, as a project path: a uuid names the asset itself, anything else sits beside the document. */
function refFrom(src: DataTextureAuditSource, documentPath: string, ref: string): string | null {
    const path = src.resolveRef(ref.startsWith('@uuid:') ? ref : resolveDocumentRef(documentPath, ref));
    return path === null ? null : withoutLeadingSlash(path);
}

/** Every texture read as data by some material and still marked sRGB, in path order. */
export async function dataTexturesMarkedColour(src: DataTextureAuditSource): Promise<DataTextureFinding[]> {
    const dataParams = new Map<string, string[]>();
    const paramsOf = async (materialPath: string, shaderRef: string): Promise<string[]> => {
        const builtin = builtinRefId(shaderRef);
        const key = builtin !== null ? shaderRef : refFrom(src, materialPath, shaderRef);
        if (key === null) return [];
        let params = dataParams.get(key);
        if (!params) {
            const source = builtin !== null
                ? builtinShaderTemplate(builtin)?.source ?? null
                : await src.readText(key);
            params = source ? reflectEsshader(source).params.filter((p) => p.texel === 'data').map((p) => p.name) : [];
            dataParams.set(key, params);
        }
        return params;
    };
    const readDoc = async (path: string): Promise<MaterialDoc | null> => {
        const text = await src.readText(path);
        if (!text) return null;
        try { return JSON.parse(text) as MaterialDoc; } catch { return null; }
    };

    const found = new Map<string, DataTextureFinding>();
    for (const materialPath of src.materials) {
        const doc = await readDoc(materialPath);
        if (!doc) continue;
        // An instance takes its parent's shader; its own properties are what it binds.
        let shader = typeof doc.shader === 'string' ? doc.shader : null;
        if (!shader && typeof doc.instanceOf === 'string') {
            const parentPath = refFrom(src, materialPath, doc.instanceOf);
            const parent = parentPath ? await readDoc(parentPath) : null;
            shader = typeof parent?.shader === 'string' ? parent.shader : null;
        }
        if (!shader) continue;
        for (const param of await paramsOf(materialPath, shader)) {
            const value = doc.properties?.[param];
            if (typeof value !== 'string') continue;
            const path = refFrom(src, materialPath, value);
            if (!path) continue;
            if (src.importer(path)?.sRGB === false) continue;
            const finding = found.get(path) ?? { texture: path, readBy: [] };
            finding.readBy.push({ material: materialPath, param });
            found.set(path, finding);
        }
    }
    return [...found.values()].sort((a, b) => a.texture.localeCompare(b.texture));
}
