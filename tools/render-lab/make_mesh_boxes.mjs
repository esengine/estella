// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The GI lab's boxes as meshes with the files the dynamic GI reads beside them: for each box in <boxes.json>, `assets/meshes/box_<i>.esmesh`
 * (the built-in cube scaled to the box), `.esmeshsdf` and `.esmeshcards` — what an import with `dynamicGI` on writes.
 *
 *   node tools/render-lab/make_mesh_boxes.mjs <projectDir> <boxes.json>      boxes.json: [{ size: [x, y, z], colour: [r, g, b], emissive: [r, g, b] }]
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '../..');
const [project, boxesFile] = process.argv.slice(2);
const boxes = JSON.parse(readFileSync(boxesFile, 'utf8'));

// Beside the pipeline, whose node_modules resolve `esengine`; removed once loaded.
const out = path.join(root, 'pipeline', '.make-boxes.mjs');
await build({
    stdin: {
        contents: `
            export { builtinMeshTemplate } from ${JSON.stringify(path.join(root, 'sdk/src/asset/builtinMeshes.ts'))};
            export { encodeMesh } from ${JSON.stringify(path.join(root, 'sdk/src/asset/meshFormat.ts'))};
            export { bakeMeshSdf, encodeMeshSdf } from ${JSON.stringify(path.join(root, 'pipeline/src/assets/meshSdf.ts'))};
            export { bakeMeshCards } from ${JSON.stringify(path.join(root, 'pipeline/src/assets/meshCards.ts'))};
            export { encodeMeshCards } from ${JSON.stringify(path.join(root, 'sdk/src/gi/cardFormat.ts'))};
        `,
        resolveDir: root, loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', outfile: out, external: ['esengine'], logLevel: 'error',
});
const T = await import(pathToFileURL(out).href);
rmSync(out, { force: true });

const dir = path.join(project, 'assets', 'meshes');
mkdirSync(dir, { recursive: true });
boxes.forEach((b, i) => {
    const cube = T.builtinMeshTemplate('builtin:cube').build();
    const view = new DataView(cube.vertices.buffer, cube.vertices.byteOffset, cube.vertices.byteLength);
    const position = cube.channels.find((c) => c.semantic === 0);
    // The built-in cube is 100 across; the box is its size, so the vertices are scaled by size / 100 about the origin.
    for (let v = 0; v < cube.vertexCount; v++) {
        for (let k = 0; k < 3; k++) {
            const at = v * cube.vertexStride + position.offset + k * 4;
            view.setFloat32(at, view.getFloat32(at, true) * (b.size[k] / 100), true);
        }
    }
    cube.aabbMin = b.size.map((s) => -s / 2);
    cube.aabbMax = b.size.map((s) => s / 2);
    const name = `box_${i}`;
    writeFileSync(path.join(dir, `${name}.esmesh`), T.encodeMesh(cube));
    writeFileSync(path.join(dir, `${name}.esmeshsdf`), T.encodeMeshSdf(T.bakeMeshSdf(cube, { cellSize: 10 })));
    writeFileSync(path.join(dir, `${name}.esmeshcards`), T.encodeMeshCards(T.bakeMeshCards(cube, { cell: 25, maxResolution: 24, baseColor: b.colour, emissive: b.emissive })));
});
