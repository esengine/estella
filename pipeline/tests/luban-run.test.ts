// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installTool, toolStatus } from '../src/tools/externalTools';
import { lubanErrors, runLuban } from '../src/tools/lubanRun';
import { LUBAN_DEFAULTS, parseProjectTools, type LubanSetting } from '../src/tools/projectTools';

// What Luban's own error lines look like, and what the runner makes of them: always checked.
describe('reading Luban\'s output', () => {
    it('keeps the error lines and drops the timestamp, the level and the closing banner', () => {
        const out = [
            '2026/10/27 03:18:02.908|INFO|  Luban is developed by …',
            '2026/10/27 03:18:02.908|ERROR|记录 TbSite["clinic"].item = "gold" (来自文件:Sheet1@a.xlsx) 在引用表:TbItem 中不存在',
            '2026/10/27 03:18:02.908|ERROR|===> "behaviour:nope 类型:IDataTarget 不存在"',
            '2026/10/27 03:18:02.909|ERROR|运行失败!!!',
        ].join('\r\n');
        expect(lubanErrors(out)).toEqual([
            '记录 TbSite["clinic"].item = "gold" (来自文件:Sheet1@a.xlsx) 在引用表:TbItem 中不存在',
            'behaviour:nope 类型:IDataTarget 不存在',
        ]);
        expect(lubanErrors('all fine')).toEqual([]);
    });
});

describe('the project setting', () => {
    it('is off until named, fills in the defaults, and refuses a path that leaves the project', () => {
        expect(parseProjectTools(undefined)).toBeUndefined();
        expect(parseProjectTools({})).toBeUndefined();
        expect(parseProjectTools({ luban: {} })!.luban).toEqual({ enabled: false, ...LUBAN_DEFAULTS });
        expect(parseProjectTools({ luban: { enabled: true, dataDir: './assets\\tables/' } })!.luban).toMatchObject({ enabled: true, dataDir: 'assets/tables' });
        for (const bad of ['../outside', '/abs', 'C:\\x', 'a//b', '']) {
            expect(() => parseProjectTools({ luban: { codeDir: bad } }), bad).toThrow(/inside the project/);
        }
        expect(() => parseProjectTools({ luban: { enabled: 'yes' } })).toThrow(/true or false/);
        expect(() => parseProjectTools({ luban: { target: 'a b' } })).toThrow(/must be a name/);
        expect(() => parseProjectTools({ luban: { target: 'x; rm -rf /' } })).toThrow(/must be a name/);
    });
});

describe('Luban missing', () => {
    it('says what to run, and does not try', async () => {
        const root = mkdtempSync(path.join(tmpdir(), 'estella-luban-proj-'));
        const store = mkdtempSync(path.join(tmpdir(), 'estella-luban-store-'));
        try {
            let ran = false;
            const result = await runLuban({
                projectDir: root, store, platform: 'win-x64',
                setting: { enabled: true, ...LUBAN_DEFAULTS },
                run: async () => { ran = true; return { code: 0, output: '' }; },
            });
            expect(ran).toBe(false);
            expect(result).toMatchObject({ ok: false, reason: 'missing-tool' });
            expect(result.errors[0]).toMatch(/\.NET runtime 8\.0\.33 and Luban 5\.1\.0 are not installed.*estella tools install luban/);
        } finally {
            rmSync(root, { recursive: true, force: true });
            rmSync(store, { recursive: true, force: true });
        }
    });
});

// The real thing: needs the release files built by tools/sync-external-tools.mjs, which are not in the repo.
// ESTELLA_TEST_TOOLS_BASE=output/external-tools runs it.
const base = process.env.ESTELLA_TEST_TOOLS_BASE ? path.resolve(fileURLToPath(new URL('../..', import.meta.url)), process.env.ESTELLA_TEST_TOOLS_BASE) : '';
describe.skipIf(!base || !existsSync(path.join(base, 'external-tools.json')))('Luban, installed from the release files and run for real', () => {
    let store: string;
    let root: string;
    const setting: LubanSetting = { enabled: true, ...LUBAN_DEFAULTS };

    beforeAll(async () => {
        store = mkdtempSync(path.join(tmpdir(), 'estella-luban-store-'));
        root = mkdtempSync(path.join(tmpdir(), 'estella-luban-proj-'));
        const got = await installTool('luban', { store, env: { ESTELLA_TOOLS_BASE: base } as NodeJS.ProcessEnv });
        expect(got.error).toBeUndefined();
        expect(got.ok).toBe(true);
        const conf = path.join(root, 'config/luban');
        mkdirSync(path.join(conf, 'Defines'), { recursive: true });
        mkdirSync(path.join(conf, 'Datas'), { recursive: true });
        writeFileSync(path.join(conf, 'luban.conf'), JSON.stringify({
            groups: [{ names: ['c'], default: true }], schemaFiles: [{ fileName: 'Defines', type: '' }], dataDir: 'Datas',
            targets: [{ name: 'client', manager: 'Tables', groups: ['c'], topModule: 'cfg' }],
        }));
        writeFileSync(path.join(conf, 'Defines/game.xml'), `<module name="">
  <bean name="Item"><var name="id" type="string"/><var name="name" type="string"/></bean>
  <table name="TbItem" value="Item" input="items.csv"/>
  <bean name="Site"><var name="id" type="string"/><var name="item" type="string#ref=TbItem"/><var name="stock" type="int"/></bean>
  <table name="TbSite" value="Site" input="sites.csv"/>
</module>`);
        writeFileSync(path.join(conf, 'Datas/items.csv'), '##var,id,name\n##type,string,string\n##,id,名称\n,water,净水\n,parts,零件\n');
        writeFileSync(path.join(conf, 'Datas/sites.csv'), '##var,id,item,stock\n##type,string,string,int\n##,id,产出,次数\n,workshop,parts,4\n');
    }, 120_000);
    afterAll(() => {
        rmSync(store, { recursive: true, force: true });
        rmSync(root, { recursive: true, force: true });
    });

    const run = (extra: Partial<Parameters<typeof runLuban>[0]> = {}) => runLuban({ projectDir: root, setting, store, ...extra });

    it('is installed whole, with the runtime it needs', () => {
        const status = toolStatus('luban', { store });
        expect(status.installed).toBe(true);
        expect(status.needs[0]).toMatchObject({ id: 'dotnet', installed: true });
    });

    it('writes the JSON and the TypeScript, and a check then finds nothing to do', async () => {
        const first = await run();
        expect(first.errors).toEqual([]);
        expect(first.ok).toBe(true);
        expect(first.changed.sort()).toEqual(['assets/data/tbitem.json', 'assets/data/tbsite.json', 'src/gen/schema.ts']);
        expect(JSON.parse(readFileSync(path.join(root, 'assets/data/tbitem.json'), 'utf8'))).toEqual([{ id: 'water', name: '净水' }, { id: 'parts', name: '零件' }]);
        expect(readFileSync(path.join(root, 'src/gen/schema.ts'), 'utf8')).toMatch(/export class Item/);

        const again = await run();
        expect(again.ok).toBe(true);
        expect(again.changed).toEqual([]);
        expect((await run({ check: true })).ok).toBe(true);
    }, 120_000);

    it('a check finds a hand-edited output, and a run puts it right', async () => {
        writeFileSync(path.join(root, 'assets/data/tbitem.json'), '[]');
        const checked = await run({ check: true });
        expect(checked).toMatchObject({ ok: false, reason: 'drift', changed: ['assets/data/tbitem.json'] });
        expect((await run()).changed).toEqual(['assets/data/tbitem.json']);
        expect((await run({ check: true })).ok).toBe(true);
    }, 120_000);

    it('reports a reference to a record that does not exist, and leaves the files as they were', async () => {
        const before = readFileSync(path.join(root, 'assets/data/tbsite.json'), 'utf8');
        writeFileSync(path.join(root, 'config/luban/Datas/sites.csv'), '##var,id,item,stock\n##type,string,string,int\n##,id,产出,次数\n,workshop,gold,4\n');
        const bad = await run();
        expect(bad.ok).toBe(false);
        expect(bad.reason).toBe('failed');
        expect(bad.errors.join('\n')).toMatch(/TbSite\["workshop"\]\.item = "gold".*TbItem/);
        expect(readFileSync(path.join(root, 'assets/data/tbsite.json'), 'utf8')).toBe(before);
    }, 120_000);

    it('removes what a table that no longer exists used to produce', async () => {
        writeFileSync(path.join(root, 'config/luban/Datas/sites.csv'), '##var,id,item,stock\n##type,string,string,int\n##,id,产出,次数\n,workshop,parts,4\n');
        writeFileSync(path.join(root, 'config/luban/Defines/game.xml'), `<module name="">
  <bean name="Item"><var name="id" type="string"/><var name="name" type="string"/></bean>
  <table name="TbItem" value="Item" input="items.csv"/>
</module>`);
        const got = await run();
        expect(got.errors).toEqual([]);
        expect(existsSync(path.join(root, 'assets/data/tbsite.json'))).toBe(false);
        expect(existsSync(path.join(root, 'assets/data/tbitem.json'))).toBe(true);
    }, 120_000);
});
