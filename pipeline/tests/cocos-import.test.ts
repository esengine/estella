// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What taking a Cocos project over must keep true.
 *
 * The fixture is a project written out by the test, small enough that every
 * expectation can be checked by eye. The claims that carry the importer:
 *
 *  - the source is never written to;
 *  - a nested prefab stays nested, and the engine's own `flattenPrefab` expands
 *    the converted files to the same entities the Cocos instance has — that is
 *    the test of the override diff, which has no table of its own to be checked
 *    against;
 *  - what is not mapped is counted, not dropped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { COCOS_IMPORT_REVISION, cocosImportIsCurrent, importCocosProject } from '../src/import/cocos';

const IMG = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const PANEL = '33333333-3333-4333-8333-333333333333';
const FONT = '44444444-4444-4444-8444-444444444444';
const MAT = '66666666-6666-4666-8666-666666666666';
const EFFECT = '77777777-7777-4777-8777-777777777777';

const vec = (x: number, y: number, z = 0) => ({ __type__: 'cc.Vec3', x, y, z });
const ident = { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 };
const one = vec(1, 1, 1);

function node(name: string, parent: number | null, children: number[], components: number[], prefab: number, pos = vec(0, 0)): object {
    return {
        __type__: 'cc.Node', _name: name, _parent: parent === null ? null : { __id__: parent },
        _children: children.map((__id__) => ({ __id__ })), _active: true,
        _components: components.map((__id__) => ({ __id__ })), _prefab: { __id__: prefab },
        _lpos: pos, _lrot: ident, _lscale: one, _layer: 33554432,
    };
}
const uiT = (n: number, c: number, w: number, h: number) =>
    [{ __type__: 'cc.UITransform', node: { __id__: n }, _enabled: true, __prefab: { __id__: c }, _contentSize: { width: w, height: h }, _anchorPoint: { x: 0.5, y: 0.5 } },
        { __type__: 'cc.CompPrefabInfo', fileId: `ut${n}` }];

/** item.prefab: root "Item" (sprite 100x40, tinted white) with a Label child. */
const itemPrefab = [
    { __type__: 'cc.Prefab', _name: 'item', data: { __id__: 1 } },
    node('Item', null, [2], [4, 6], 8, vec(5, 6)),                                              // 1
    node('Caption', 1, [], [9, 11], 13),                                                        // 2
    { __type__: 'cc.Node', _name: 'unused' },                                                    // 3 (keeps ids stable)
    ...uiT(1, 5, 100, 40),                                                                       // 4,5
    { __type__: 'cc.Sprite', node: { __id__: 1 }, _enabled: true, __prefab: { __id__: 7 }, _color: { r: 255, g: 255, b: 255, a: 255 }, _spriteFrame: { __uuid__: `${IMG}@f9941` }, _type: 0 }, // 6
    { __type__: 'cc.CompPrefabInfo', fileId: 'spr' },                                            // 7
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'itemRoot', instance: null },       // 8
    { __type__: 'cc.UITransform', node: { __id__: 2 }, _enabled: true, __prefab: { __id__: 10 }, _contentSize: { width: 80, height: 20 }, _anchorPoint: { x: 0.5, y: 0.5 } }, // 9
    { __type__: 'cc.CompPrefabInfo', fileId: 'ut2' },                                            // 10
    { __type__: 'cc.Label', node: { __id__: 2 }, _enabled: true, __prefab: { __id__: 12 }, _string: 'hello', _fontSize: 20, _lineHeight: 24, _color: { r: 255, g: 0, b: 0, a: 255 }, _horizontalAlign: 1, _verticalAlign: 1, _isSystemFontUsed: false, _font: { __uuid__: FONT }, _customMaterial: { __uuid__: MAT }, _overflow: 0, _enableWrapText: true }, // 11
    { __type__: 'cc.CompPrefabInfo', fileId: 'lab' },                                            // 12
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'capt', instance: null },          // 13
];

const instOverrides = (extra: object[]) => extra;
/** panel.prefab: root "Panel" holding two instances of item, the second repositioned, tinted and renamed. */
const panelPrefab = [
    { __type__: 'cc.Prefab', _name: 'panel', data: { __id__: 1 } },
    node('Panel', null, [2, 6], [], 10),                                                         // 1
    { __type__: 'cc.Node', _objFlags: 0, _parent: { __id__: 1 }, _prefab: { __id__: 3 } },       // 2  (instance A, untouched)
    { __type__: 'cc.PrefabInfo', root: { __id__: 2 }, asset: { __uuid__: ITEM }, fileId: 'itemRoot', instance: { __id__: 4 } }, // 3
    { __type__: 'cc.PrefabInstance', fileId: 'instA', prefabRootNode: { __id__: 1 }, mountedChildren: [], mountedComponents: [{ __id__: 18 }], propertyOverrides: [], removedComponents: [] }, // 4
    { __type__: 'cc.Node', _name: 'pad' },                                                       // 5
    { __type__: 'cc.Node', _objFlags: 0, _parent: { __id__: 1 }, _prefab: { __id__: 7 } },       // 6  (instance B)
    { __type__: 'cc.PrefabInfo', root: { __id__: 6 }, asset: { __uuid__: ITEM }, fileId: 'itemRoot', instance: { __id__: 8 } }, // 7
    { __type__: 'cc.PrefabInstance', fileId: 'instB', prefabRootNode: { __id__: 1 }, mountedChildren: [], mountedComponents: [], removedComponents: [],
        propertyOverrides: [{ __id__: 11 }, { __id__: 13 }, { __id__: 15 }, { __id__: 17 }] },   // 8
    { __type__: 'cc.Node', _name: 'pad' },                                                       // 9
    { __type__: 'cc.PrefabInfo', root: { __id__: 1 }, asset: { __id__: 0 }, fileId: 'panelRoot', instance: null }, // 10
    { __type__: 'CCPropertyOverrideInfo', targetInfo: { __id__: 12 }, propertyPath: ['_name'], value: 'second' },       // 11
    { __type__: 'cc.TargetInfo', localID: ['itemRoot'] },                                        // 12
    { __type__: 'CCPropertyOverrideInfo', targetInfo: { __id__: 12 }, propertyPath: ['_lpos'], value: vec(0, -50) },   // 13
    { __type__: 'cc.TargetInfo', localID: ['spr'] },                                             // 14
    { __type__: 'CCPropertyOverrideInfo', targetInfo: { __id__: 14 }, propertyPath: ['_color'], value: { __type__: 'cc.Color', r: 0, g: 255, b: 0, a: 255 } }, // 15
    { __type__: 'cc.TargetInfo', localID: ['lab'] },                                             // 16
    { __type__: 'CCPropertyOverrideInfo', targetInfo: { __id__: 16 }, propertyPath: ['_string'], value: 'changed' },   // 17
    // instance A carries a component its file mounted on the item's root: a component the item prefab itself does not have
    { __type__: 'cc.MountedComponentsInfo', targetInfo: { __id__: 19 }, components: [{ __id__: 20 }] },               // 18
    { __type__: 'cc.TargetInfo', localID: ['itemRoot'] },                                        // 19
    { __type__: 'cc.Button', node: { __id__: 2 }, _enabled: true, __prefab: { __id__: 21 }, _interactable: true, _transition: 0 }, // 20
    { __type__: 'cc.CompPrefabInfo', fileId: 'mountedButton' },                                  // 21
];
void instOverrides;

/** main.scene: one root node holding an instance of panel whose item B is nudged once more. */
const scene = [
    { __type__: 'cc.SceneAsset', _name: 'main', scene: { __id__: 1 } },
    { __type__: 'cc.Scene', _name: 'main', _children: [{ __id__: 2 }], _globals: { __id__: 5 } },
    { __type__: 'cc.Node', _name: 'Canvas', _parent: { __id__: 1 }, _children: [{ __id__: 3 }], _active: true, _components: [], _prefab: null, _lpos: vec(0, 0), _lrot: ident, _lscale: one, _layer: 33554432, _id: 'canvas' },
    { __type__: 'cc.Node', _objFlags: 0, _parent: { __id__: 2 }, _prefab: { __id__: 4 }, _id: '' },
    { __type__: 'cc.PrefabInfo', root: { __id__: 3 }, asset: { __uuid__: PANEL }, fileId: 'panelRoot', instance: { __id__: 6 } },
    { __type__: 'cc.SceneGlobals', skybox: { __id__: 5 } },
    { __type__: 'cc.PrefabInstance', fileId: 'inst', prefabRootNode: { __id__: 2 }, mountedChildren: [], mountedComponents: [], removedComponents: [], propertyOverrides: [{ __id__: 7 }] },
    { __type__: 'CCPropertyOverrideInfo', targetInfo: { __id__: 8 }, propertyPath: ['_lpos'], value: vec(9, 9) },
    { __type__: 'cc.TargetInfo', localID: ['instB', 'itemRoot'] },
];

const meta = (uuid: string, importer: string, extra: object = {}) => ({ ver: '1', importer, uuid, subMetas: {}, userData: {}, ...extra });
const imageMeta = meta(IMG, 'image', {
    subMetas: { f9941: { importer: 'sprite-frame', uuid: `${IMG}@f9941`, userData: { width: 64, height: 64, rawWidth: 64, rawHeight: 64, borderLeft: 8, borderRight: 8, borderTop: 8, borderBottom: 8 } } },
});

const sha = (f: string): string => createHash('sha1').update(readFileSync(f)).digest('hex');
function* files(dir: string): Generator<string> {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) yield* files(p);
        else yield p;
    }
}

// The engine's own expander, loaded by path: it is the reference the overrides are judged against, and importing it
// statically would put the whole SDK under this package's compiler settings.
type Flatten = (prefab: unknown, overrides: unknown[], ctx: { allocateId: () => number; loadPrefab: (p: string) => unknown }) => { entities: any[] };
const FLATTEN = path.resolve(__dirname, '../../sdk/src/prefab/flatten.ts');
let flattenPrefab: Flatten;
const SDK = path.resolve(__dirname, '../../sdk/src');

type Validate = (name: string, defaults: unknown, data: unknown, assetFields?: unknown) => { field: string; expected: string; value: unknown }[];
let validate: Validate;
let registry: Record<string, any>;

let root: string;
let src: string;
let out: string;
let report: Awaited<ReturnType<typeof importCocosProject>>;
let before: Record<string, string>;

beforeAll(async () => {
    flattenPrefab = (await import(/* @vite-ignore */ FLATTEN)).flattenPrefab as Flatten;
    validate = (await import(/* @vite-ignore */ path.join(SDK, 'util/validation.ts'))).validateComponentData as Validate;
    registry = await import(/* @vite-ignore */ path.join(SDK, 'ecs/component.ts'));
    registry.Text = (await import(/* @vite-ignore */ path.join(SDK, 'ui/core/text.ts'))).Text;
    root = mkdtempSync(path.join(tmpdir(), 'cocos-import-'));
    src = path.join(root, 'creator');
    out = path.join(root, 'estella');
    const put = (rel: string, v: unknown): void => {
        const f = path.join(src, 'assets', rel);
        mkdirSync(path.dirname(f), { recursive: true });
        writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v));
    };
    put('ui/icon.png', 'not really a png');
    put('ui/icon.png.meta', imageMeta);
    put('ui/item.prefab', itemPrefab);
    put('ui/item.prefab.meta', meta(ITEM, 'prefab'));
    put('ui/panel.prefab', panelPrefab);
    put('ui/panel.prefab.meta', meta(PANEL, 'prefab'));
    put('ui/f.fnt', 'info face="f" size=20\ncommon lineHeight=20 base=16 scaleW=64 scaleH=64 pages=1 packed=0\npage id=0 file="f_0.png"\n');
    put('ui/f_0.png', 'page');
    put('ui/f.fnt.meta', meta(FONT, 'bitmap-font'));
    // the outline effect mixes the outline colour in by the red channel; the material that uses it is what marks a font page as baked
    put('ui/font.effect', 'vec4 frag () { float alphaLerp = o.r; return mix(outlineColor, color, alphaLerp); }');
    put('ui/font.effect.meta', meta(EFFECT, 'effect'));
    put('ui/font.mtl', { __type__: 'cc.Material', _effectAsset: { __uuid__: EFFECT } });
    put('ui/font.mtl.meta', meta(MAT, 'material'));
    put('main.scene', scene);
    put('main.scene.meta', meta('55555555-5555-4555-8555-555555555555', 'scene'));
    before = Object.fromEntries([...files(src)].map((f) => [f, sha(f)]));
    report = await importCocosProject({ source: src, out });
});

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const readJson = (rel: string): any => JSON.parse(readFileSync(path.join(out, rel), 'utf8'));

describe('importing a Cocos project', () => {
    it('never writes to the source, and refuses an output inside it', async () => {
        expect(Object.fromEntries([...files(src)].map((f) => [f, sha(f)]))).toEqual(before);
        await expect(importCocosProject({ source: src, out: path.join(src, 'out') })).rejects.toThrow(/never written/);
    });

    it('converts every prefab and scene without failures', () => {
        expect(report.documents.failed).toEqual([]);
        expect(report.documents.converted).toBe(3);
        for (const f of ['item.esprefab', 'panel.esprefab', 'main.esscene']) expect(existsSync(path.join(out, 'assets/cocos', f.endsWith('scene') ? f : `ui/${f}`))).toBe(true);
    });

    it('maps a Sprite with its size, anchor, tint, texture and nine-slice border', () => {
        const item = readJson('assets/cocos/ui/item.esprefab');
        const root = item.entities.find((e: any) => e.prefabEntityId === 'itemRoot');
        const sprite = root.components.find((c: any) => c.type === 'Sprite').data;
        expect(sprite).toMatchObject({ size: { x: 100, y: 40 }, pivot: { x: 0.5, y: 0.5 }, texture: 'assets/cocos/ui/icon.png' });
        expect(root.components[0]).toEqual({ type: 'Transform', data: { position: { x: 5, y: 6, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } } });
        expect(existsSync(path.join(out, 'assets/cocos/ui/icon.png'))).toBe(true);
    });

    it('maps a Label to Text with a bitmap font, and carries the font pages along', () => {
        const caption = readJson('assets/cocos/ui/item.esprefab').entities.find((e: any) => e.prefabEntityId === 'capt');
        expect(caption.components.find((c: any) => c.type === 'Text').data).toMatchObject({
            content: 'hello', fontSize: 20, align: 1, verticalAlign: 1, overflow: 0, font: 'assets/cocos/ui/f.fnt',
            // the Label's UITransform becomes its layout box, with the node origin at the anchor
            boxWidth: 80, boxHeight: 20, boxPivot: { x: 0.5, y: 0.5 },
            // no overflow rule: the node grows to its text, so nothing wraps in the box and the run is laid out from the anchor
            wordWrap: false,
        });
        const written = [...files(out)].map((f) => path.relative(out, f).split(path.sep).join('/'));
        expect(written, written.join(',')).toContain('assets/cocos/ui/f_0.png');
    });

    it('declares a font page that its material draws as glyph and outline layers, in BMFont\'s own channel flags', () => {
        const fnt = readFileSync(path.join(out, 'assets/cocos/ui/f.fnt'), 'utf8');
        const common = fnt.split(/\r?\n/).find((l) => l.startsWith('common'))!;
        expect(common).toContain('alphaChnl=2');
        expect(common).toContain('redChnl=0');
        // the rest of the file is as it was
        expect(fnt).toContain('page id=0 file="f_0.png"');
        expect(common).toContain('scaleW=64');
    });

    it('keeps a nested prefab nested, with the instance\'s changes as overrides', () => {
        const panel = readJson('assets/cocos/ui/panel.esprefab');
        const b = panel.entities.find((e: any) => e.prefabEntityId === 'instB');
        expect(b.nestedPrefab.prefabPath).toBe('assets/cocos/ui/item.esprefab');
        const kinds = b.nestedPrefab.overrides.map((o: any) => `${o.type}:${o.prefabEntityId}:${o.componentType ?? ''}.${o.propertyName ?? ''}`);
        expect(kinds).toEqual(expect.arrayContaining([
            'name:itemRoot:.', 'property:itemRoot:Transform.position', 'property:itemRoot:Sprite.color', 'property:capt:Text.content',
        ]));
        // nothing else changed, so nothing else is said
        expect(kinds).toHaveLength(4);
    });

    it("puts a component the instance's file mounted on the prefab it names, as an added component of that instance", () => {
        const panel = readJson('assets/cocos/ui/panel.esprefab');
        const a = panel.entities.find((e: any) => e.prefabEntityId === 'instA');
        const added = a.nestedPrefab.overrides.filter((o: any) => o.type === 'component_added');
        expect(added.map((o: any) => `${o.prefabEntityId}:${o.componentType}`)).toEqual(['itemRoot:Cocos.Button']);
        expect(added[0].componentData.data).toMatchObject({ interactable: true });
    });

    it('expands, through the engine\'s own flatten, to what the Cocos instance has', () => {
        const panel = readJson('assets/cocos/ui/panel.esprefab');
        const item = readJson('assets/cocos/ui/item.esprefab');
        const load = (p: string): any => (p.endsWith('item.esprefab') ? item : null);
        let id = 0;
        const { entities } = flattenPrefab(panel, [], { allocateId: () => ++id, loadPrefab: load });
        const byName = new Map(entities.map((e: any) => [e.name, e]));
        const second = byName.get('second') as any;
        expect(second.components.find((c: any) => c.type === 'Transform').data.position).toEqual({ x: 0, y: -50, z: 0 });
        expect(second.components.find((c: any) => c.type === 'Sprite').data.color).toEqual({ r: 0, g: 1, b: 0, a: 1 });
        const texts = entities.filter((e: any) => e.components.some((c: any) => c.type === 'Text')).map((e: any) => e.components.find((c: any) => c.type === 'Text').data.content);
        expect(texts.sort()).toEqual(['changed', 'hello']);
    });

    it('turns a scene\'s prefab instance into an entry with the overrides it applied', () => {
        const scene = readJson('assets/cocos/main.esscene');
        const entry = scene.entities.find((e: any) => typeof e.prefab === 'string');
        expect(entry).toMatchObject({ prefab: 'assets/cocos/ui/panel.esprefab', parent: 1, added: [], removed: [] });
        // 'instB/itemRoot' addresses the engine's composed id for the nested root: slot / local id
        expect(entry.overrides).toEqual([
            expect.objectContaining({ prefabEntityId: 'instB/itemRoot', type: 'property', componentType: 'Transform', propertyName: 'position', value: { x: 9, y: 9, z: 0 } }),
        ]);
        expect(scene.entities[0].children).toEqual([entry.id]);
        expect(scene.version).toBe(4);
    });

    it('counts what it did not map instead of dropping it', () => {
        expect(report.components['cc.Sprite']).toEqual({ mapped: 1, partial: 0, unmapped: 0 });
        expect(report.components['cc.Label']).toEqual({ mapped: 1, partial: 0, unmapped: 0 });
        expect(report.notes['label-bitmap-font']).toBeUndefined();
        expect(report.notes['scene-globals-dropped']?.count).toBe(1);
        expect(report.prefabInstances).toBe(3);
    });

    it('writes component data the engine accepts: every field has the type its component declares', () => {
        // A string where the engine wants an enum number loads, warns, and falls back to the default — a UI that is
        // wrong everywhere and says so only in a console. The engine's own validator is the judge.
        const docs = ['assets/cocos/ui/item.esprefab', 'assets/cocos/ui/panel.esprefab', 'assets/cocos/main.esscene'].map(readJson);
        const problems: string[] = [];
        let checked = 0;
        for (const doc of docs) {
            for (const e of doc.entities) {
                const all = [...(e.components ?? []), ...(e.nestedPrefab?.overrides ?? e.overrides ?? []).flatMap((o: any) => (o.type === 'property' ? [{ type: o.componentType, data: { [o.propertyName]: o.value } }] : o.componentData ? [o.componentData] : []))];
                for (const c of all) {
                    const def = registry[c.type];
                    if (!def) continue;
                    checked++;
                    for (const err of validate(c.type, def._default, c.data, def.assetFields)) problems.push(`${c.type}.${err.field}: expected ${err.expected}, got ${JSON.stringify(err.value)}`);
                }
            }
        }
        expect(checked).toBeGreaterThan(5);
        expect(problems).toEqual([]);
    });
});

describe('importing again over the same project', () => {
    const ITEM_REL = 'assets/cocos/ui/item.esprefab';
    const stateOf = (): { documents: Record<string, string> } => readJson('assets/cocos/.import-state.json');

    it('records the importer revision, so a project written by an older importer is known to need bringing up', () => {
        expect(cocosImportIsCurrent(out)).toBe(true);
        const state = { ...readJson('assets/cocos/.import-state.json') } as { revision?: number };
        expect(state.revision).toBe(COCOS_IMPORT_REVISION);
        const file = path.join(out, 'assets/cocos/.import-state.json');
        const text = readFileSync(file, 'utf8');
        delete state.revision;
        writeFileSync(file, JSON.stringify(state));
        expect(cocosImportIsCurrent(out)).toBe(false);
        writeFileSync(file, text);
        expect(cocosImportIsCurrent(path.join(out, 'nowhere'))).toBe(true);   // not converted: nothing to bring up
    });

    it('finds nothing to do when neither side changed', async () => {
        const again = await importCocosProject({ source: src, out });
        expect(again.sync.added).toBe(0);
        expect(again.sync.updated).toBe(0);
        expect(again.sync.kept).toEqual([]);
        expect(again.sync.unchanged).toBeGreaterThan(0);
    });

    it('brings the Cocos side\'s change into a document nobody edited', async () => {
        // the file as an earlier import wrote it, different from what the source converts to now
        const file = path.join(out, ITEM_REL);
        const stale = `${readFileSync(file, 'utf8').trimEnd()}\n\n`;
        writeFileSync(file, stale);
        const state = stateOf();
        state.documents[ITEM_REL] = createHash('sha1').update(stale).digest('hex');
        writeFileSync(path.join(out, 'assets/cocos/.import-state.json'), JSON.stringify(state));
        const again = await importCocosProject({ source: src, out });
        expect(again.sync.updated).toBe(1);
        expect(readFileSync(file, 'utf8')).not.toBe(stale);
    });

    it('keeps a document that was edited here, and says so', async () => {
        const file = path.join(out, ITEM_REL);
        const mine = `${JSON.stringify({ ...readJson(ITEM_REL), edited: true }, null, 2)}\n`;
        writeFileSync(file, mine);
        const again = await importCocosProject({ source: src, out });
        expect(again.sync.kept).toEqual([ITEM_REL]);
        expect(readFileSync(file, 'utf8')).toBe(mine);
    });
});
