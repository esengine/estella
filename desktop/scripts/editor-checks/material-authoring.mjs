// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  material-authoring — a driver can make a shader, not only look at one.
 *
 * Three separate holes made this one path unwalkable, and each looked fine on
 * its own. `.esmatgraph` was typed only by the renderer's Content-Browser table,
 * so the create door — which derives an extension from the SHARED meta table —
 * answered "unknown asset type" for the one type it was being asked for. Opening
 * an asset editor did not wait for the file to be read, so the very next call
 * could be told nothing was open. And there was no save for these documents at
 * all: `project.save` routes by whichever dock panel the user last clicked, so
 * driven from outside it wrote the scene, or nothing.
 *
 * A material graph is the case that proves all three, because its file is not
 * the whole asset: saving it must also recompile the sibling `.esshader` that
 * every material on it reads. A graph that saves without that is an edit that
 * appears to land and still renders the old thing — which no unit test on the
 * document can see, since the compile happens on the way to disk.
 */
import path from 'node:path';
import { cp } from 'node:fs/promises';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [
    {
      id: 0, name: 'Camera', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
        { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
      ],
    },
  ],
}, null, 1);

/** A texture sampled through a colour param — small, and it compiles. */
const GRAPH = JSON.stringify({
  name: 'Fire',
  output: 'out',
  nodes: [
    { id: 'tint', type: 'constColor', x: 60, y: 60, params: { name: 'u_tint', value: [1, 0, 0, 1] } },
    { id: 'tex', type: 'textureSample', x: 60, y: 200, params: { name: 'u_albedo', default: 'white' } },
    { id: 'mul', type: 'multiply', x: 260, y: 130, inputs: { a: 'tex', b: 'tint' } },
    { id: 'out', type: 'output', x: 460, y: 130, inputs: { color: 'mul' } },
  ],
}, null, 2);

export const name = 'material-authoring';
export const describes = 'a driver creates a material graph, edits it, and saves BOTH it and its shader';

export async function run(ed) {
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');

  // A BARE name: the extension comes from the type, which is the half that was
  // missing. Passing "Fire.esmatgraph" would have worked all along.
  const graphPath = await ed.json('create_asset', {
    destDir: 'assets/fx', baseName: 'Fire', content: GRAPH, type: 'materialgraph',
  }, 60000);
  if (!check(graphPath === 'assets/fx/Fire.esmatgraph', `create_asset named it ${graphPath}`)) {
    return check.failures;
  }

  await ed.call('open_asset', { path: graphPath }, 60000);
  // Straight after the open, with no settle: the point is that open_asset does
  // not return until the document is bound.
  const doc = await ed.json('get_asset_document', {});
  if (!check(doc?.asset?.output === 'out', `the graph did not open as a document: ${JSON.stringify(doc)?.slice(0, 200)}`)) {
    return check.failures;
  }
  check(doc.docId === 'materialgraph', `it opened as "${doc.docId}"`);

  // Rename the colour param. It is a compiled-in name, so the shader beside the
  // graph either follows or it does not — no interpretation needed.
  await ed.call('edit_asset_document', {
    changes: [{ path: 'nodes.0.params.name', value: 'u_flame' }],
    label: 'Rename param',
  });
  const saved = await ed.json('save_asset_document', {});
  check(saved?.saved === true, `save_asset_document reported ${JSON.stringify(saved)}`);

  const onDisk = await ed.json('read_project_file', { path: graphPath });
  check(String(onDisk).includes('u_flame'), 'the graph file still holds the old param name');

  const shaderPath = 'assets/fx/Fire.esshader';
  let shader = null;
  try {
    shader = await ed.json('read_project_file', { path: shaderPath });
  } catch (err) {
    check(false, `${shaderPath} was never written — saving a graph must compile it: ${err.message}`);
  }
  if (shader != null) {
    check(String(shader).includes('u_flame'), `${shaderPath} does not mention u_flame — it was not recompiled`);
    check(!String(shader).includes('u_tint'), `${shaderPath} still carries the pre-edit param name`);
  }

  // The shader is an asset like any other: a material can name it, which is the
  // whole point of the graph having a sibling.
  const assets = await ed.json('list_assets', { match: 'Fire' });
  const paths = (assets?.assets ?? []).map((a) => a.path);
  check(paths.includes(graphPath), `the graph is not in the registry (${paths.join(', ')})`);

  return check.failures;
}
