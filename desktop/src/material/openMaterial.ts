// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openMaterial.ts
 * @brief   Open / create a `.esmaterial` from the Content Browser. Mirrors openTileset.ts
 *          (open + create + .meta + registry re-scan). A new material is born from a
 *          built-in shader template (Unlit / Lit); a material instance writes only its
 *          parent ref (UE MIC).
 */
import { builtinShaderTemplate, type MaterialAssetData } from 'esengine';
import { newMaterialDocument } from './shaderCatalog';
import { ProjectStore } from '@/project/ProjectStore';
import { AssetRegistry } from '@/project/AssetRegistry';
import { dockApi } from '@/layout/dockApi';
import { useSelection } from '@/store/selectionStore';
import { baseName } from '@/project/assetMeta';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';
import { MaterialDocument } from './MaterialDocument';

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
  for (let n = 1; AssetRegistry.assetRef(rel); n++) rel = `${dir}${base}-${n}.esmaterial`;
  return rel;
}

async function writeMeta(rel: string): Promise<void> {
  await window.estella.fs.write(
    rel + '.meta',
    JSON.stringify({ uuid: crypto.randomUUID(), version: '1.0', type: 'material', importer: {} }, null, 2) + '\n',
  );
}

/**
 * Create a new base material referencing a built-in shader by id (`builtin:<id>`) — no per-material
 * `.esshader` file is spawned (that was an invisible, name-coupled copy; a stock effect is shared by
 * reference, like Unity's built-in shaders). Editing the shader source is an explicit opt-in later
 * via "Convert to Unique Shader". Then open it.
 */
export async function createMaterial(dir: string, templateId = 'sprite-unlit'): Promise<void> {
  const template = builtinShaderTemplate(templateId);
  const asset = newMaterialDocument(templateId);
  if (!template || !asset) {
    Toasts.push(t('mat.unknownTemplate', { id: templateId }), 'error');
    return;
  }
  const folder = dir ? (dir.endsWith('/') ? dir : `${dir}/`) : '';
  const matRel = uniqueMaterialPath(folder, `New${template.label}Material`);

  try {
    await window.estella.fs.write(matRel, JSON.stringify(asset, null, 2) + '\n');
    await writeMeta(matRel);
  } catch (e) {
    Toasts.push(t('mat.createFailed', { error: String(e) }), 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(t('mat.created', { name: baseName(matRel) }), 'info');
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
    Toasts.push(t('mat.createInstanceFailed', { error: String(e) }), 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(t('mat.createdInstance', { name: baseName(matRel) }), 'info');
  openMaterial(matRel);
}

// Pick a `<base>.esshader` name in @p dir that no tracked asset already uses. A refreshAssets scan
// then adopts the file (mints its `.meta` uuid/type — see EXT_TO_TYPE) so it becomes pickable.
function uniqueShaderPath(dir: string, base: string): string {
  let rel = `${dir}${base}.esshader`;
  for (let n = 1; AssetRegistry.assetRef(rel); n++) rel = `${dir}${base}-${n}.esshader`;
  return rel;
}

/**
 * Extract a material's built-in shader into an editable project `.esshader` beside it and re-point
 * the material at the file — the escape hatch for hand-editing a stock effect's source (UE's "make
 * unique"). The only door that turns a shared `builtin:` ref into a per-material file. Parameters
 * carry over unchanged (the template *is* the shader the material already used).
 */
export async function convertShaderToUnique(matPath: string, builtinId: string): Promise<void> {
  const template = builtinShaderTemplate(builtinId);
  if (!template) {
    Toasts.push(t('mat.unknownTemplate', { id: builtinId }), 'error');
    return;
  }
  const folder = matPath.includes('/') ? matPath.slice(0, matPath.lastIndexOf('/') + 1) : '';
  const matBase = baseName(matPath).replace(/\.esmaterial$/, '');
  const shaderRel = uniqueShaderPath(folder, matBase);
  try {
    await window.estella.fs.write(shaderRel, template.source);
  } catch (e) {
    Toasts.push(t('mat.convertFailed', { error: String(e) }), 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  // Re-point the live document (one undo step, dirty until saved), same-folder → bare ref.
  MaterialDocument.edit('Convert to Unique Shader', (d) => {
    d.shader = baseName(shaderRel);
  });
  Toasts.push(t('mat.convertedShader', { name: baseName(shaderRel) }), 'info');
}

/**
 * Create a standalone project `.esshader` from a built-in template — for authoring a shareable
 * shader from scratch; materials point at it through the inspector's Shader picker.
 */
export async function createShaderAsset(dir: string, templateId = 'sprite-unlit'): Promise<void> {
  const template = builtinShaderTemplate(templateId);
  if (!template) {
    Toasts.push(t('mat.unknownTemplate', { id: templateId }), 'error');
    return;
  }
  const folder = dir ? (dir.endsWith('/') ? dir : `${dir}/`) : '';
  const shaderRel = uniqueShaderPath(folder, `New${template.label}Shader`);
  try {
    await window.estella.fs.write(shaderRel, template.source);
  } catch (e) {
    Toasts.push(t('mat.createShaderFailed', { error: String(e) }), 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(t('mat.createdShader', { name: baseName(shaderRel) }), 'info');
  useSelection.getState().selectAsset(shaderRel);
}
