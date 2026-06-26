// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openMaterial.ts
 * @brief   Open / create a `.esmaterial` from the Content Browser. Mirrors openTileset.ts
 *          (open + create + .meta + registry re-scan). A new material is born with its own
 *          default unlit `.esshader` (a `u_tint` color param) so it renders and is editable
 *          immediately; a material instance writes only its parent ref (UE MIC).
 */
import type { MaterialAssetData } from 'esengine';
import { ProjectStore } from '@/project/ProjectStore';
import { dockApi } from '@/layout/dockApi';
import { useSelection } from '@/store/selectionStore';
import { baseName } from '@/project/assetMeta';
import { Toasts } from '@/store/Toasts';

// Default material shader: the batch vertex layout + an unlit fragment that tints the sampled
// texture by the per-instance color and a `u_tint` material param (the auto-generated
// MaterialConstants block supplies u_tint). Gives a new material a visible, editable param.
const DEFAULT_MATERIAL_SHADER = `#pragma shader "Material"
#pragma version 300 es
#pragma domain Unlit2D
#pragma param u_tint color default(1,1,1,1)

#pragma vertex
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec2 a_texCoord;
layout(location = 3) in float a_texIndex;

layout(std140) uniform FrameConstants {
    mat4 u_projection;
};

out vec4 v_color;
out vec2 v_texCoord;

void main() {
    gl_Position = u_projection * vec4(a_position, 0.0, 1.0);
    v_color = a_color;
    v_texCoord = a_texCoord;
}
#pragma end

#pragma fragment
precision mediump float;

in vec4 v_color;
in vec2 v_texCoord;

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    fragColor = texture(u_textures[0], v_texCoord) * v_color * u_tint;
}
#pragma end
`;

/**
 * Open a `.esmaterial` for editing: select it so the unified Details inspector edits it inline
 * (reflection-driven Parameters + Render State), and reveal the Details panel. There is no
 * separate material panel — the asset inspector loads + previews the selected material.
 */
export function openMaterial(path: string): void {
  useSelection.getState().selectAsset(path);
  dockApi.reveal('details');
}

// Pick a `<base>.esmaterial` name in @p dir that no tracked asset already uses.
function uniqueMaterialPath(dir: string, base: string): string {
  let rel = `${dir}${base}.esmaterial`;
  for (let n = 1; ProjectStore.assetRef(rel); n++) rel = `${dir}${base}-${n}.esmaterial`;
  return rel;
}

async function writeMeta(rel: string): Promise<void> {
  await window.estella.fs.write(
    rel + '.meta',
    JSON.stringify({ uuid: crypto.randomUUID(), version: '1.0', type: 'material', importer: { autoMigrate: true } }, null, 2) + '\n',
  );
}

/** Create a new base material (+ its own default shader) in @p dir, then open it. */
export async function createMaterial(dir: string): Promise<void> {
  const folder = dir ? (dir.endsWith('/') ? dir : `${dir}/`) : '';
  const matRel = uniqueMaterialPath(folder, 'NewMaterial');
  const base = baseName(matRel).replace(/\.esmaterial$/, '');
  const shaderRel = `${folder}${base}.esshader`;

  const asset: MaterialAssetData = {
    version: '1.0',
    type: 'material',
    shader: `${base}.esshader`,
    blendMode: 0,
    depthTest: false,
    depthWrite: true,
    cull: 0,
    properties: { u_tint: { r: 1, g: 1, b: 1, a: 1 } },
  };

  try {
    await window.estella.fs.write(shaderRel, DEFAULT_MATERIAL_SHADER);
    await window.estella.fs.write(matRel, JSON.stringify(asset, null, 2) + '\n');
    await writeMeta(matRel);
  } catch (e) {
    Toasts.push(`创建材质失败：${String(e)}`, 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(`已创建材质：${baseName(matRel)}`, 'info');
  openMaterial(matRel);
}

/** Create a material instance of @p parentPath (UE MIC): only the parent ref, no overrides yet. */
export async function createMaterialInstance(parentPath: string): Promise<void> {
  const dir = parentPath.includes('/') ? parentPath.slice(0, parentPath.lastIndexOf('/') + 1) : '';
  const parentBase = baseName(parentPath).replace(/\.esmaterial$/, '');
  const matRel = uniqueMaterialPath(dir, `${parentBase} Instance`);

  const asset: MaterialAssetData = {
    version: '1.0',
    type: 'material',
    shader: '',
    instanceOf: baseName(parentPath), // relative to the same folder
    properties: {},
  };

  try {
    await window.estella.fs.write(matRel, JSON.stringify(asset, null, 2) + '\n');
    await writeMeta(matRel);
  } catch (e) {
    Toasts.push(`创建材质实例失败：${String(e)}`, 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(`已创建材质实例：${baseName(matRel)}`, 'info');
  openMaterial(matRel);
}
