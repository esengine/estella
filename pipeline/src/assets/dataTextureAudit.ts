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
import { DATA_TEXTURE_FIELDS } from '../../../sdk/src/asset/textureUse';
import { textureUse } from '../project/importSettings';

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

export interface NumberTextureAuditSource {
    /** Project paths of every scene and prefab. */
    documents: Iterable<string>;
    readText(path: string): Promise<string | null>;
    resolveRef(ref: string): string | null;
    importer(path: string): Record<string, unknown> | undefined;
}

export interface NumberTextureFinding {
    texture: string;
    /** Every component field that reads it as numbers. */
    readBy: Array<{ document: string; component: string; field: string }>;
}

/**
 * Every texture a component reads as numbers (DATA_TEXTURE_FIELDS: a Terrain's heightmap) whose Use is still Colour, in path
 * order. A build caps such a texture at its Max Size and takes a picture's liberties with it; marked Data it keeps its samples.
 */
export async function numberTexturesMarkedColour(src: NumberTextureAuditSource): Promise<NumberTextureFinding[]> {
    const found = new Map<string, NumberTextureFinding['readBy']>();
    for (const document of src.documents) {
        const text = await src.readText(document);
        if (text === null) continue;
        let parsed: { entities?: Array<{ components?: Array<{ type?: string; data?: Record<string, unknown> }> }> };
        try { parsed = JSON.parse(text); } catch { continue; }
        for (const entity of parsed.entities ?? []) {
            for (const component of entity.components ?? []) {
                for (const field of DATA_TEXTURE_FIELDS[component.type ?? ''] ?? []) {
                    const ref = component.data?.[field];
                    if (typeof ref !== 'string' || ref === '' || builtinRefId(ref) !== null) continue;
                    const texture = refFrom({ ...src, materials: [] }, document, ref);
                    if (texture === null || textureUse(src.importer(texture)?.use) === 'data') continue;
                    const readBy = found.get(texture) ?? [];
                    readBy.push({ document, component: component.type!, field });
                    found.set(texture, readBy);
                }
            }
        }
    }
    return [...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([texture, readBy]) => ({ texture, readBy }));
}
