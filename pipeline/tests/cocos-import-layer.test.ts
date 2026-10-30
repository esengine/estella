// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the importer hands the runtime compatibility layer: UI geometry, alignment, layout, buttons, and the project's own
 *        scripts as components, with their references to other nodes pointing at the entities those nodes became.
 *
 * The scene is built by hand in Cocos's file shape (a flat array of objects pointing at each other by index), because the shape
 * is the thing under test: a script component is named by its script's compressed uuid, and a node is named by an array index.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importCocosProject } from '../src/import/cocos';
import { buildCocosAssetIndex } from '../src/import/cocos/assets';
import { buildScriptIndex, compressUuid } from '../src/import/cocos/scripts';

const HUD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const unit = { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 };
const zero = { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 };
const ident = { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 };

const node = (name: string, parent: number, children: number[], components: number[]): object => ({
    __type__: 'cc.Node', _name: name, _parent: { __id__: parent }, _children: children.map((__id__) => ({ __id__ })), _active: true,
    _components: components.map((__id__) => ({ __id__ })), _prefab: null, _lpos: zero, _lrot: ident, _lscale: unit, _layer: 33554432,
});
const ui = (n: number, w: number, h: number): object =>
    ({ __type__: 'cc.UITransform', node: { __id__: n }, _enabled: true, _contentSize: { width: w, height: h }, _anchorPoint: { x: 0.5, y: 0.5 } });

/** Objects are numbered as the comments say; the references between them are indices into this array. */
const scene = [
    { __type__: 'cc.SceneAsset', _name: 'main', scene: { __id__: 1 } },                                                       // 0
    { __type__: 'cc.Scene', _name: 'main', _children: [{ __id__: 2 }] },                                                      // 1
    node('Canvas', 1, [3, 4, 12], [5, 6]),                                                                                        // 2
    node('Buy', 2, [], [7, 8]),                                                                                               // 3
    node('Hud', 2, [], [9, 11]),                                                                                              // 4
    ui(2, 960, 640),                                                                                                          // 5
    { __type__: 'cc.Widget', node: { __id__: 2 }, _enabled: true, _alignFlags: 45, _left: 10, _right: 10, _top: 5, _bottom: 5, _alignMode: 2, _isAbsLeft: true },
    ui(3, 120, 48),                                                                                                           // 7
    { __type__: 'cc.Button', node: { __id__: 3 }, _enabled: true, _interactable: true, _transition: 3, _zoomScale: 1.1,
        clickEvents: [{ __id__: 10 }], _normalColor: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 } },               // 8
    { __type__: compressUuid(HUD), node: { __id__: 4 }, _enabled: true, speed: 3, label: { __id__: 3 }, all: [{ __id__: 3 }, { __id__: 4 }],
        buttonOf: { __id__: 8 }, icon: { __uuid__: PLAIN }, _hidden: { __id__: 99 } },                                         // 9
    { __type__: 'cc.ClickEvent', target: { __id__: 4 }, component: '', _componentId: compressUuid(HUD), handler: 'onBuy', customEventData: 'gold' }, // 10
    { __type__: 'cc.Layout', node: { __id__: 4 }, _enabled: true, _layoutType: 2, _resizeMode: 1, _spacingY: 8, _paddingTop: 4, _cellSize: { width: 50, height: 60 }, _verticalDirection: 1 }, // 11
    node('Panel', 2, [], [13, 14, 15, 16, 17, 19]),                                                                               // 12
    ui(12, 80, 20),                                                                                                           // 13
    { __type__: 'cc.Toggle', node: { __id__: 12 }, _enabled: true, _isChecked: true, _checkMark: { __id__: 15 }, _interactable: true, _transition: 0,
        clickEvents: [], checkEvents: [{ __id__: 18 }] },                                                                       // 14
    { __type__: 'cc.Sprite', node: { __id__: 12 }, _enabled: true, _color: { r: 255, g: 255, b: 255, a: 255 } },               // 15
    { __type__: 'cc.ScrollView', node: { __id__: 12 }, _enabled: true, _content: { __id__: 3 }, vertical: true, horizontal: false, brake: 0.75, bounceDuration: 0.23, scrollEvents: [] }, // 16
    { __type__: 'cc.ProgressBar', node: { __id__: 12 }, _enabled: true, _barSprite: { __id__: 15 }, _progress: 0.4, _totalLength: 80, _mode: 0 }, // 17
    { __type__: 'cc.ClickEvent', target: { __id__: 4 }, component: '', _componentId: compressUuid(HUD), handler: 'onPicked', customEventData: 'x' }, // 18
    { __type__: 'cc.Mask', node: { __id__: 12 }, _enabled: true, _type: 0 },                                                  // 19
];

describe('importing for the compatibility layer', () => {
    let root: string;
    let scenes: { entities: Array<{ id: number; name: string; components: Array<{ type: string; data: Record<string, any> }> }> };
    let report: Awaited<ReturnType<typeof importCocosProject>>;

    beforeAll(async () => {
        root = mkdtempSync(path.join(tmpdir(), 'cocos-layer-'));
        const put = (rel: string, v: string | object): void => {
            const f = path.join(root, 'creator', 'assets', rel);
            mkdirSync(path.dirname(f), { recursive: true });
            writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v));
        };
        const meta = (uuid: string, importer: string): object => ({ ver: '1', importer, uuid, subMetas: {}, userData: {} });
        put('main.scene', scene);
        put('main.scene.meta', meta('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'scene'));
        put('scripts/Hud.ts', "import { _decorator, Component } from 'cc';\nconst { ccclass } = _decorator;\n@ccclass('Hud')\nexport class Hud extends Component {}\n");
        put('scripts/Hud.ts.meta', meta(HUD, 'typescript'));
        put('scripts/Other.ts', "@ccclass\n@menu('x')\n// a comment between\n@executionOrder(-1)\nexport default class Other extends Component {}\n");
        put('scripts/Other.ts.meta', meta(OTHER, 'typescript'));
        put('scripts/Globals.ts', "// @ts-ignore\nglobalThis.app_config = { area: 2 };\n");
        put('scripts/Globals.ts.meta', meta('99999999-9999-4999-8999-999999999999', 'typescript'));
        put('resources.meta', { ver: '1.2.0', importer: 'directory', uuid: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', userData: { isBundle: true, bundleName: 'resources' } });
        put('resources/cfg/rules.json', '{"a":1}');
        put('resources/cfg/rules.json.meta', meta('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'json'));
        put('resources/ui/icon.png', 'not a png');
        put('resources/ui/icon.png.meta', meta('f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', 'image'));
        put('resources/prefab/thing.prefab', [{ __type__: 'cc.Prefab', _name: 'thing', data: { __id__: 1 } }, { ...node('Thing', 0, [], []), _prefab: { __id__: 2 } }, { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'thingRoot', instance: null }]);
        put('resources/prefab/thing.prefab.meta', meta('f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', 'prefab'));
        put('hero.meta', { ver: '1.2.0', importer: 'directory', uuid: 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4', userData: { isBundle: true, bundleName: 'hero' } });
        put('hero/skin.json', '{}');
        put('hero/skin.json.meta', meta('f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5', 'json'));
        put('art/plain.json', '{}');
        put('art/plain.json.meta', meta(PLAIN, 'json'));
        // the starter project's entry, which the import points at the converted scripts
        mkdirSync(path.join(root, 'out', 'src'), { recursive: true });
        writeFileSync(path.join(root, 'out', 'project.esproject'), JSON.stringify({ formatVersion: '1', name: 'x', defaultScene: 'assets/scenes/main.esscene', designResolution: { width: 800, height: 600 } }));
        mkdirSync(path.join(root, 'creator', 'settings', 'v2', 'packages'), { recursive: true });
        writeFileSync(path.join(root, 'creator', 'settings', 'v2', 'packages', 'project.json'), JSON.stringify({ general: { designResolution: { width: 1080, height: 1920 } } }));
        writeFileSync(path.join(root, 'out', 'src', 'main.ts'), "// Game entry.\nimport './components';\n");
        report = await importCocosProject({ source: path.join(root, 'creator'), out: path.join(root, 'out') });
        scenes = JSON.parse(readFileSync(path.join(root, 'out', 'assets', 'cocos', 'main.esscene'), 'utf8'));
    });
    afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

    const entity = (name: string) => scenes.entities.find((e) => e.name === name)!;
    const comp = (name: string, type: string) => entity(name).components.find((c) => c.type === type)!;

    it('keeps a node\'s rectangle as a component of its own, as well as the size its renderers got', () => {
        expect(comp('Canvas', 'ContentRect').data).toEqual({ size: { x: 960, y: 640 }, pivot: { x: 0.5, y: 0.5 } });
    });

    it('carries a widget\'s and a layout\'s settings under the names the layer uses', () => {
        const w = comp('Canvas', 'Cocos.Widget').data;
        expect([w.alignFlags, w.left, w.right, w.top, w.bottom, w.alignMode, w.enabled]).toEqual([45, 10, 10, 5, 5, 2, true]);
        const l = comp('Hud', 'Cocos.Layout').data;
        expect([l.type, l.resizeMode, l.spacingY, l.paddingTop, l.cellWidth, l.cellHeight, l.verticalDirection]).toEqual([2, 1, 8, 4, 50, 60, 1]);
    });

    it('splits a button\'s handlers into the entity they call and the rest, naming the script class from its uuid', () => {
        const b = comp('Buy', 'Cocos.Button').data;
        expect(b.transition).toBe(3);
        expect(b.zoomScale).toBe(1.1);
        expect(b.clickTargets).toEqual([entity('Hud').id]);   // a node that comes LATER in the file
        expect(b.clickHandlers).toEqual([{ component: 'Hud', handler: 'onBuy', customEventData: 'gold' }]);
    });

    it('turns a script component into Cocos.<class>, with node references pointing at the entities those nodes became', () => {
        const h = comp('Hud', 'Cocos.Hud').data;
        expect(h.speed).toBe(3);
        expect(h.label).toBe(entity('Buy').id);
        expect(h.all).toEqual([entity('Buy').id, entity('Hud').id]);
        // a component reference is its node
        expect(h.buttonOf).toBe(entity('Buy').id);
        // a reference to something that is not in the file is the engine's "no entity", not a stale index
        expect(h._hidden).toBeNull();
        // an asset reference is the copied file's project path
        expect(h.icon).toBe('assets/cocos/art/plain.json');
    });

    it('finds the class of a bare @ccclass among other decorators and comments', () => {
        const classes = buildScriptIndex(buildCocosAssetIndex(path.join(root, 'creator', 'assets')));
        expect(classes.get(compressUuid(OTHER))?.name).toBe('Other');
        expect(report.components['script:Hud']).toEqual({ mapped: 1, partial: 0, unmapped: 0 });
    });

    it('writes the entry that brings the scripts into the bundle, importing them where they are', () => {
        const entry = readFileSync(path.join(root, 'out', 'src', 'cocos-scripts.ts'), 'utf8');
        expect(entry).toContain("import 'esengine/cocos';");
        const line = entry.split('\n').find((l) => l.includes("scripts/Hud'"))!;
        expect(line).toBeDefined();
        // each script loads on its own, so one that throws does not stop the others
        expect(line).toMatch(/^load\(\(\) => require\('/);
        expect(entry).toContain('try {');
        // the path leads back to the Cocos project, which is not copied
        const target = /require\('([^']+)'\)/.exec(line)![1]!;
        expect(path.resolve(root, 'out', 'src', target + '.ts')).toBe(path.join(root, 'creator', 'assets', 'scripts', 'Hud.ts'));
    });

    it('lists what scripts load by path in a manifest, by bundle, and copies those files', () => {
        const manifest = JSON.parse(readFileSync(path.join(root, 'out', 'assets', 'cocos', 'resources.json'), 'utf8'));
        expect(manifest.resources['cfg/rules']).toEqual({ path: 'assets/cocos/resources/cfg/rules.json', kind: 'json' });
        expect(manifest.resources['ui/icon']).toEqual({ path: 'assets/cocos/resources/ui/icon.png', kind: 'texture' });
        expect(manifest.resources['prefab/thing']).toEqual({ path: 'assets/cocos/resources/prefab/thing.esprefab', kind: 'prefab' });
        expect(manifest.hero['skin']).toEqual({ path: 'assets/cocos/hero/skin.json', kind: 'json' });
        expect(readFileSync(path.join(root, 'out', 'assets', 'cocos', 'resources', 'cfg', 'rules.json'), 'utf8')).toBe('{"a":1}');
    });

    it('carries a toggle, a scroll view and a progress bar, with their node and component references mapped', () => {
        const panel = entity('Panel').id;
        const t = comp('Panel', 'Cocos.Toggle').data;
        expect([t.isChecked, t.checkMark]).toEqual([true, panel]);
        expect(t.checkTargets).toEqual([entity('Hud').id]);
        expect(t.checkHandlers).toEqual([{ component: 'Hud', handler: 'onPicked', customEventData: 'x' }]);
        const sv = comp('Panel', 'Cocos.ScrollView').data;
        expect([sv.content, sv.vertical, sv.brake, sv.bounceDuration]).toEqual([entity('Buy').id, true, 0.75, 0.23]);
        const bar = comp('Panel', 'Cocos.ProgressBar').data;
        expect([bar.barSprite, bar.progress_, bar.totalLength]).toEqual([panel, 0.4, 80]);
    });

    it('turns a rectangle mask into the engine UIMask, which clips to the ContentRect beside it', () => {
        expect(comp('Panel', 'UIMask').data).toEqual({ enabled: true, mode: 0, alphaCutoff: 0 });
        expect(comp('Panel', 'ContentRect').data.size).toEqual({ x: 80, y: 20 });
        expect(report.components['cc.Mask']).toEqual({ mapped: 1, partial: 0, unmapped: 0 });
    });

    it('declares the script classes the scenes use for the editor, and starts the project from the scripts themselves', () => {
        const components = readFileSync(path.join(root, 'out', 'src', 'components.ts'), 'utf8');
        expect(components).toContain("import 'esengine/cocos';");
        expect(components).toMatch(/defineComponent\("Cocos\.Hud", \{ enabled: true,/);
        expect(components).toContain('"speed": 0');
        const main = readFileSync(path.join(root, 'out', 'src', 'main.ts'), 'utf8');
        expect(main).toContain("import './cocos-scripts';");
        expect(main).not.toMatch(/import '\.\/components';/);
    });

    it('puts a source image in the project as a link to it, not a second copy, and never writes into it', () => {
        const from = statSync(path.join(root, 'creator', 'assets', 'resources', 'ui', 'icon.png'));
        const to = statSync(path.join(root, 'out', 'assets', 'cocos', 'resources', 'ui', 'icon.png'));
        expect(to.size).toBe(from.size);
        expect(to.ino === from.ino && to.dev === from.dev).toBe(true);
        expect(readFileSync(path.join(root, 'creator', 'assets', 'resources', 'ui', 'icon.png'), 'utf8')).toBe('not a png');
    });

    it('starts the converted project at the scene and design size of the game, not of the starter', () => {
        const manifest = JSON.parse(readFileSync(path.join(root, 'out', 'project.esproject'), 'utf8')) as { defaultScene: string; designResolution: { width: number; height: number } };
        expect(manifest.defaultScene).toBe('assets/cocos/main.esscene');
        expect(manifest.designResolution).toEqual({ width: 1080, height: 1920 });
    });

    it('runs a script that only defines globals before the scripts scenes name', () => {
        const entry = readFileSync(path.join(root, 'out', 'src', 'cocos-scripts.ts'), 'utf8').split('\n');
        const at = (needle: string): number => entry.findIndex((l) => l.startsWith('load(') && l.includes(needle));
        expect(at("scripts/Globals'")).toBeGreaterThan(-1);
        expect(at("scripts/Globals'")).toBeLessThan(at("scripts/Hud'"));
    });

    it('counts the components it maps', () => {
        for (const type of ['cc.Widget', 'cc.Layout', 'cc.Button', 'cc.UITransform']) expect(report.components[type]!.unmapped).toBe(0);
    });
});
