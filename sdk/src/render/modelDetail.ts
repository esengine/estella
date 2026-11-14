// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The Model shader's repeating detail layer, as the shaders made from Model see it.
 */

/**
 * The Model shader's source without its repeating detail. A shader made from Model that lays materials of its own from the sides of the
 * world (Voxel Ground, Ground Blend) has no use for a second such layer and no texture unit for it: a Lit mesh shader has eight. The
 * Model source marks the layer: a block between `// <detail>` and `// </detail>`, and single lines ending `// <detail/>`.
 */
export function modelWithoutDetail(model: string): string {
    const lines = model.split('\n'), kept: string[] = [];
    let inside = false;
    for (const line of lines) {
        const mark = line.trim();
        if (mark === '// <detail>') { inside = true; continue; }
        if (mark === '// </detail>') { inside = false; continue; }
        if (inside || line.includes('// <detail/>')) continue;
        kept.push(line);
    }
    if (inside || kept.length === lines.length) throw new Error('the Model shader no longer marks its detail layer');
    return kept.join('\n');
}
