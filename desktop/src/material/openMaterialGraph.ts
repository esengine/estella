// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openMaterialGraph.ts
 * @brief   Open / create / save a `.esmatgraph` (the visual Material Graph, P5b).
 * @details A graph is a visual frontend that compiles to a sibling `.esshader` (P5a's
 *          `compileMaterialGraph`); any `.esmaterial` then references that shader like a
 *          hand-written one. Create writes the graph + its compiled shader + .meta; Save
 *          rewrites both so an edit flows to every material on the shader.
 */
import { compileMaterialGraph, newMaterialGraph, type MaterialGraph } from 'esengine';
import { MaterialGraphDocument } from './MaterialGraphDocument';
import { ProjectStore } from '@/project/ProjectStore';
import { confirmDiscardDoc } from '@/project/discardGuard';
import { dockApi } from '@/layout/dockApi';
import { baseName } from '@/project/assetMeta';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

const shaderPathOf = (graphPath: string) => graphPath.replace(/\.esmatgraph$/, '.esshader');

/** Open an existing `.esmatgraph` into the Material Graph editor and reveal the panel. */
export async function openMaterialGraph(path: string): Promise<void> {
  // Already-open file: just front the panel — a reload would clobber unsaved edits.
  if (MaterialGraphDocument.isOpen && MaterialGraphDocument.filePath === path) {
    dockApi.openPanel('materialgraph');
    return;
  }
  if (!(await confirmDiscardDoc(MaterialGraphDocument.dirty, t('discard.openAsset', { name: baseName(path) })))) return;
  try {
    const text = await window.estella.fs.read(path);
    MaterialGraphDocument.openJson(JSON.parse(text), path);
    dockApi.openPanel('materialgraph');
  } catch (e) {
    Toasts.push(t('mat.openGraphFailed', { error: String(e) }), 'error');
  }
}

/**
 * Write the graph + recompile its sibling `.esshader`.
 *
 * A failure both toasts AND rethrows. The toast is for the person who clicked
 * Save; the throw is for everyone who cannot see one — the quit-save, which must
 * not report a clean exit over a graph that never wrote, and a driver calling
 * save_asset_document, which would otherwise be told the save succeeded while
 * the compile that produces the shader had failed.
 */
export async function saveMaterialGraph(path: string, graph: MaterialGraph): Promise<void> {
  try {
    const shader = compileMaterialGraph(graph); // throws on a broken graph — surfaced below
    await window.estella.fs.write(path, JSON.stringify(graph, null, 2) + '\n');
    await window.estella.fs.write(shaderPathOf(path), shader);
    MaterialGraphDocument.markSaved();
    Toasts.push(t('mat.graphSaved'), 'info', 1400);
  } catch (e) {
    Toasts.push(t('mat.saveGraphFailed', { error: String(e) }), 'error');
    throw e;
  }
}

/** Create a new `.esmatgraph` (+ its compiled `.esshader` + .meta) in @p dir, then open it. */
export async function createMaterialGraph(dir: string): Promise<void> {
  const folder = dir ? (dir.endsWith('/') ? dir : `${dir}/`) : '';
  let rel = `${folder}NewGraph.esmatgraph`;
  for (let n = 1; ProjectStore.assetRef(rel); n++) rel = `${folder}NewGraph-${n}.esmatgraph`;

  const graph = newMaterialGraph();
  graph.name = baseName(rel).replace(/\.esmatgraph$/, '');

  try {
    await window.estella.fs.write(rel, JSON.stringify(graph, null, 2) + '\n');
    await window.estella.fs.write(shaderPathOf(rel), compileMaterialGraph(graph));
    await window.estella.fs.write(
      rel + '.meta',
      JSON.stringify({ uuid: crypto.randomUUID(), version: '1.0', type: 'materialgraph', importer: { autoMigrate: true } }, null, 2) + '\n',
    );
  } catch (e) {
    Toasts.push(t('mat.createGraphFailed', { error: String(e) }), 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(t('mat.createdGraph', { name: baseName(rel) }), 'info');
  await openMaterialGraph(rel);
}
