// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR, hasSideModule } from './helpers/loadWasm';
import { SpineModuleController } from '../src/spine/SpineController';
import { wrapSpineModule, type SpineWasmModule } from '../src/spine/SpineModuleLoader';

function paddedAtlas(atlas: string, targetChars: number): string {
    let page = '\n填充页.png\nsize: 64,64\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n';
    for (let i = 0; page.length < targetChars; i++) {
        page += `区域名称_${i}_第二块区域\n  rotate: false\n  xy: 0, 0\n  size: 8, 8\n  orig: 8, 8\n  offset: 0, 0\n  index: -1\n`;
    }
    return page + '\n' + atlas;
}

for (const version of ['3.8', '4.2']) {
    const moduleName = 'spine' + version.replace('.', '');
    describe.skipIf(!hasSideModule(moduleName))('Spine ' + version + ' with a large, non-ASCII atlas', () => {
        it('loads an atlas far past the module stack, measured in UTF-8 bytes', async () => {
            const factory = (await import(resolve(WASM_DIR, moduleName + '.js'))).default;
            const raw: SpineWasmModule = await factory({ wasmBinary: readFileSync(resolve(WASM_DIR, moduleName + '.wasm')) });
            const controller = new SpineModuleController(raw, wrapSpineModule(raw));
            const dir = resolve(__dirname, '../../third_party/spine-runtimes-' + version, 'examples/spineboy/export');
            const atlas = paddedAtlas(readFileSync(resolve(dir, 'spineboy.atlas'), 'utf8'), 130000);
            expect(new TextEncoder().encode(atlas).length).toBeGreaterThan(150000);
            const handle = controller.loadSkeleton(new Uint8Array(readFileSync(resolve(dir, 'spineboy-pro.json'))), atlas, false);
            expect(controller.getLastError()).toBe('');
            expect(handle).toBeGreaterThan(0);
            expect(controller.getAtlasPageCount(handle)).toBe(2);
            const id = controller.createInstance(handle);
            expect(controller.play(id, 'walk', true)).toBe(true);
            controller.update(id, 0.25);
            controller.destroyInstance(id);
            controller.unloadSkeleton(handle);
        });
    });
}
