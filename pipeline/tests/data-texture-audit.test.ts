// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Textures a material's shader reads as numbers, still marked sRGB, are found.
 */
import { describe, it, expect } from 'vitest';
import { dataTexturesMarkedColour } from '../src/assets/dataTextureAudit';

function project(files: Record<string, unknown>, importers: Record<string, Record<string, unknown>>) {
    const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
    return {
        materials: Object.keys(files).filter((p) => p.endsWith('.esmaterial')),
        readText: async (p: string) => (p in files ? text(files[p]) : null),
        resolveRef: (ref: string) => {
            const path = ref.startsWith('@uuid:') ? { '@uuid:n1': 'assets/m/n.png' }[ref] ?? null : ref.replace(/^\//, '');
            return path && (path in importers || path in files) ? path : null;
        },
        importer: (p: string) => importers[p],
    };
}

describe('textures read as data but marked colour', () => {
    it('finds a normal and a packed map bound to the model shader, and leaves colour and cleared ones alone', async () => {
        const found = await dataTexturesMarkedColour(project({
            'assets/m/a.esmaterial': { shader: 'builtin:model', properties: {
                u_normalMap: 'n.png', u_metallicRoughnessMap: '/assets/m/orm.png',
                u_emissiveMap: 'glow.png', u_occlusionMap: 'ao.png' } },
            'assets/m/b.esmaterial': { shader: 'builtin:model', properties: { u_normalMap: '@uuid:n1' } },
        }, {
            'assets/m/n.png': { sRGB: true }, 'assets/m/orm.png': {}, 'assets/m/glow.png': {},
            'assets/m/ao.png': { sRGB: false },
        }));
        expect(found).toEqual([
            { texture: 'assets/m/n.png', readBy: [
                { material: 'assets/m/a.esmaterial', param: 'u_normalMap' },
                { material: 'assets/m/b.esmaterial', param: 'u_normalMap' }] },
            { texture: 'assets/m/orm.png', readBy: [{ material: 'assets/m/a.esmaterial', param: 'u_metallicRoughnessMap' }] },
        ]);
    });

    it('asks a project shader which params hold data, and an instance its parent', async () => {
        const shader = '#pragma param u_bump texture default(flatnormal) texel(data)\n#pragma param u_tex texture default(white)\n';
        const found = await dataTexturesMarkedColour(project({
            'assets/s/bump.esshader': shader,
            'assets/s/base.esmaterial': { shader: 'bump.esshader', properties: { u_bump: 'flatnormal', u_tex: 'b.png' } },
            'assets/s/child.esmaterial': { instanceOf: 'base.esmaterial', properties: { u_bump: 'b.png' } },
        }, { 'assets/s/b.png': {} }));
        // `flatnormal` is an engine stand-in, not a file, so the parent binds no data texture.
        expect(found).toEqual([{ texture: 'assets/s/b.png', readBy: [{ material: 'assets/s/child.esmaterial', param: 'u_bump' }] }]);
    });
});
