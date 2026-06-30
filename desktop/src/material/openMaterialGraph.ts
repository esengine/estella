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
import { dockApi } from '@/layout/dockApi';
import { baseName } from '@/project/assetMeta';
import { Toasts } from '@/store/Toasts';

const shaderPathOf = (graphPath: string) => graphPath.replace(/\.esmatgraph$/, '.esshader');

/** Open an existing `.esmatgraph` into the Material Graph editor and reveal the panel. */
export async function openMaterialGraph(path: string): Promise<void> {
  try {
    const text = await window.estella.fs.read(path);
    MaterialGraphDocument.openJson(JSON.parse(text), path);
    dockApi.openDocument('materialgraph', 'materialgraph', 'Material Graph');
  } catch (e) {
    Toasts.push(`无法打开材质图：${String(e)}`, 'error');
  }
}

/** Write the graph + recompile its sibling `.esshader`. Throws on a graph that can't compile. */
export async function saveMaterialGraph(path: string, graph: MaterialGraph): Promise<void> {
  try {
    const shader = compileMaterialGraph(graph); // throws on a broken graph — surfaced below
    await window.estella.fs.write(path, JSON.stringify(graph, null, 2) + '\n');
    await window.estella.fs.write(shaderPathOf(path), shader);
    MaterialGraphDocument.markSaved();
    Toasts.push('Material graph saved', 'info', 1400);
  } catch (e) {
    Toasts.push(`保存材质图失败：${String(e)}`, 'error');
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
    Toasts.push(`创建材质图失败：${String(e)}`, 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(`已创建材质图：${baseName(rel)}`, 'info');
  await openMaterialGraph(rel);
}
