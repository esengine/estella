// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    shaderCatalog.ts
 * @brief   Every shader a material can be bound to, with the parameters each one
 *          takes — the list the material picker shows, as data.
 *
 * The stock templates exist only as runtime values and shader source, so nothing
 * about them reaches a project's staged `.d.ts`: their ids and their `#pragma
 * param` declarations cannot be found by reading types or grepping the project.
 * Reflection is the SAME call the inspector makes, so there is no second list.
 */
import {
  BUILTIN_SHADER_TEMPLATES, builtinShaderTemplate, reflectEsshader,
  type MaterialAssetData, type ShaderParam,
} from 'esengine';
import { BUILTIN_SHADER_PREFIX } from './materialInspectorModel';

/**
 * A new material bound to a stock template, as the file would be written. Null
 * for an id no template answers to. The New-Material flow and the catalog an
 * agent reads both come through here, so what it is told to write is what the
 * menu would have written.
 */
export function newMaterialDocument(templateId: string): MaterialAssetData | null {
  const template = builtinShaderTemplate(templateId);
  if (!template) return null;
  return {
    version: '1.0',
    type: 'material',
    shader: `${BUILTIN_SHADER_PREFIX}${templateId}`,
    blendMode: 0,
    depthTest: false,
    depthWrite: true,
    cull: 0,
    properties: structuredClone(template.defaults) as MaterialAssetData['properties'],
  };
}

/** One parameter of a shader, as a caller needs it to write a material. */
export interface ShaderParamInfo {
  name: string;
  type: string;
  /** Default components, 1–4 of them; empty for a texture parameter. */
  default: number[];
  defaultTexture?: string;
  range?: { min: number; max: number };
}

/** One entry of the picker: what to write as the material's `shader`, and what
 *  that shader then takes. */
export interface ShaderCatalogEntry {
  /** Exactly what goes in a material's `shader` field. */
  ref: string;
  label: string;
  description: string;
  source: 'builtin' | 'project';
  params: ShaderParamInfo[];
  /** A whole `.esmaterial` bound to it, ready to write. Absent for a project
   *  shader, whose defaults are its own file's to declare. */
  material?: MaterialAssetData;
}

const info = (p: ShaderParam): ShaderParamInfo => ({
  name: p.name,
  type: p.type,
  default: [...p.default],
  ...(p.defaultTexture === undefined ? {} : { defaultTexture: p.defaultTexture }),
  ...(p.range === undefined ? {} : { range: { ...p.range } }),
});

/** The stock templates. Pure — the project half is added by the caller that can
 *  read files. */
export function builtinShaderCatalog(): ShaderCatalogEntry[] {
  return BUILTIN_SHADER_TEMPLATES.map((t) => ({
    ref: `${BUILTIN_SHADER_PREFIX}${t.id}`,
    label: t.label,
    description: t.description,
    source: 'builtin' as const,
    params: reflectEsshader(t.source).params.map(info),
    material: newMaterialDocument(t.id) ?? undefined,
  }));
}

/** A project's own `.esshader`, read the same way. Its ref is the path itself. */
export function projectShaderEntry(path: string, source: string): ShaderCatalogEntry {
  return {
    ref: path,
    label: path.split('/').pop() ?? path,
    description: '',
    source: 'project',
    params: reflectEsshader(source).params.map(info),
  };
}
