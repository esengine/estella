// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The `.eslocale` string-table pipeline: parseLocaleTable's fail-loud
 * validation, the LocaleAssetLoader registering into the app's Localization,
 * and the Text ↔ Localization binding (applyTextLocalization) that turns an
 * `i18nKey` into live `content` and re-flows it on locale switch.
 */
import { describe, it, expect } from 'vitest';
import { LocalizationAPI, parseLocaleTable, matchLocale } from '../src/i18n/Localization';
import { LocaleAssetLoader } from '../src/asset/loaders/LocaleAssetLoader';
import type { LoadContext } from '../src/asset/AssetLoader';
import { applyTextLocalization, type TextWorldView } from '../src/ui/text/localize';
import { Text, type TextData } from '../src/ui/core/text';
import { sceneUsesI18n } from '../src/runtime/runtimeLoader';
import type { SceneData } from '../src/scene';
import type { Entity } from '../src/types';

// =============================================================================
// parseLocaleTable
// =============================================================================

describe('parseLocaleTable', () => {
    it('accepts a valid table (strings + plural forms)', () => {
        const table = parseLocaleTable(JSON.stringify({
            version: 1,
            locale: 'zh-CN',
            entries: { play: '开始', apples: { other: '{count} 个苹果' } },
        }), 'i18n/zh-CN.eslocale');
        expect(table.locale).toBe('zh-CN');
        expect(Object.keys(table.entries)).toEqual(['play', 'apples']);
    });

    it('accepts a missing version (defaults to current)', () => {
        const table = parseLocaleTable('{"locale":"en","entries":{}}', 'a.eslocale');
        expect(table.version).toBe(1);
    });

    it('names the file on malformed JSON', () => {
        expect(() => parseLocaleTable('{oops', 'bad.eslocale')).toThrow(/bad\.eslocale.*not valid JSON/);
    });

    it('rejects a missing/empty locale', () => {
        expect(() => parseLocaleTable('{"entries":{}}', 'x.eslocale')).toThrow(/'locale' must be a non-empty string/);
        expect(() => parseLocaleTable('{"locale":"","entries":{}}', 'x.eslocale')).toThrow(/'locale'/);
    });

    it('rejects missing or non-object entries', () => {
        expect(() => parseLocaleTable('{"locale":"en"}', 'x.eslocale')).toThrow(/'entries' must be an object/);
        expect(() => parseLocaleTable('{"locale":"en","entries":[1]}', 'x.eslocale')).toThrow(/'entries'/);
    });

    it('rejects an entry that is neither string nor plural-with-other, naming the key', () => {
        expect(() => parseLocaleTable('{"locale":"en","entries":{"bad":42}}', 'x.eslocale')).toThrow(/entry 'bad'/);
        expect(() => parseLocaleTable('{"locale":"en","entries":{"bad":{"one":"x"}}}', 'x.eslocale')).toThrow(/'other' catch-all/);
    });

    it('rejects an unsupported version', () => {
        expect(() => parseLocaleTable('{"version":9,"locale":"en","entries":{}}', 'x.eslocale')).toThrow(/version 9/);
    });
});

// =============================================================================
// matchLocale (platform tag → shipped locale)
// =============================================================================

describe('matchLocale', () => {
    const shipped = ['en', 'zh-CN'];
    it('exact match wins', () => {
        expect(matchLocale('zh-CN', shipped)).toBe('zh-CN');
    });
    it('falls back to the primary language (zh-Hans-CN / zh_CN-normalized → zh-CN)', () => {
        expect(matchLocale('zh-Hans-CN', shipped)).toBe('zh-CN');
        expect(matchLocale('zh', shipped)).toBe('zh-CN');
        expect(matchLocale('en-US', shipped)).toBe('en');
    });
    it('null when nothing ships the language (caller keeps its default)', () => {
        expect(matchLocale('ja-JP', shipped)).toBeNull();
        expect(matchLocale('fr', [])).toBeNull();
    });
});

// =============================================================================
// sceneUsesI18n (the runtime loader's self-gating scan)
// =============================================================================

describe('sceneUsesI18n', () => {
    const scene = (components: Array<{ type: string; data?: unknown }>): SceneData => ({
        version: '1.0',
        name: 's',
        entities: [{ id: 1, name: 'E', parent: null, children: [], components }],
    } as unknown as SceneData);

    it('true only for a Text with a non-empty i18nKey', () => {
        expect(sceneUsesI18n(scene([{ type: 'Text', data: { i18nKey: 'menu.play' } }]))).toBe(true);
        expect(sceneUsesI18n(scene([{ type: 'Text', data: { i18nKey: '' } }]))).toBe(false);
        expect(sceneUsesI18n(scene([{ type: 'Text', data: {} }]))).toBe(false);
        expect(sceneUsesI18n(scene([{ type: 'Sprite', data: { i18nKey: 'x' } }]))).toBe(false);
        expect(sceneUsesI18n(scene([]))).toBe(false);
    });
});

// =============================================================================
// LocaleAssetLoader
// =============================================================================

function loaderCtx(text: string, i18n: LocalizationAPI | null): LoadContext {
    return {
        catalog: { getBuildPath: (p: string) => p },
        loadText: async () => text,
        getLocalization: () => i18n,
    } as unknown as LoadContext;
}

describe('LocaleAssetLoader', () => {
    it('merges the table into the app catalogs and reports locale + key count', async () => {
        const i18n = new LocalizationAPI('en', 'en');
        const loader = new LocaleAssetLoader();
        const result = await loader.load('i18n/zh-CN.eslocale', loaderCtx(JSON.stringify({
            version: 1,
            locale: 'zh-CN',
            entries: { play: '开始', quit: '退出' },
        }), i18n));
        expect(result).toEqual({ locale: 'zh-CN', keyCount: 2 });
        i18n.setLocale('zh-CN');
        expect(i18n.t('play')).toBe('开始');
    });

    it('fails loud without a Localization resource', async () => {
        const loader = new LocaleAssetLoader();
        await expect(loader.load('i18n/en.eslocale', loaderCtx('{"locale":"en","entries":{}}', null)))
            .rejects.toThrow(/localizationPlugin/);
    });

    it('propagates table validation errors (bad content never half-registers)', async () => {
        const i18n = new LocalizationAPI('en', 'en');
        const loader = new LocaleAssetLoader();
        await expect(loader.load('i18n/en.eslocale', loaderCtx('{"entries":{}}', i18n)))
            .rejects.toThrow(/'locale'/);
        expect(i18n.availableLocales()).toEqual([]);
    });
});

// =============================================================================
// applyTextLocalization (the Text ↔ Localization binding)
// =============================================================================

/** Minimal in-memory world with only Text components. */
class FakeWorld implements TextWorldView {
    private texts = new Map<number, TextData>();
    private next = 1;
    inserts = 0;

    spawn(data: Partial<TextData>): Entity {
        const e = this.next++;
        this.texts.set(e, Text.create(data));
        return e as Entity;
    }
    text(e: Entity): TextData {
        return this.texts.get(e as number)!;
    }
    getEntitiesWithComponents(): readonly number[] {
        return [...this.texts.keys()];
    }
    get(entity: Entity): unknown {
        return this.texts.get(entity as number);
    }
    insert(entity: Entity, _c: unknown, data: unknown): void {
        this.texts.set(entity as number, data as TextData);
        this.inserts++;
    }
}

describe('applyTextLocalization', () => {
    function setup() {
        const world = new FakeWorld();
        const i18n = new LocalizationAPI('en', 'en');
        i18n.addCatalog('en', { play: 'Play' });
        i18n.addCatalog('zh-CN', { play: '开始' });
        return { world, i18n };
    }

    it('writes resolved content for a bound key; plain text is untouched', () => {
        const { world, i18n } = setup();
        const bound = world.spawn({ i18nKey: 'play' });
        const plain = world.spawn({ content: 'hand-written' });
        expect(applyTextLocalization(world, i18n)).toBe(1);
        expect(world.text(bound).content).toBe('Play');
        expect(world.text(plain).content).toBe('hand-written');
    });

    it('re-flows on locale switch, and diff-writes (no redundant inserts)', () => {
        const { world, i18n } = setup();
        const e = world.spawn({ i18nKey: 'play' });
        applyTextLocalization(world, i18n);
        expect(world.inserts).toBe(1);

        // Same locale, same key → resolved equals content → zero writes.
        expect(applyTextLocalization(world, i18n)).toBe(0);
        expect(world.inserts).toBe(1);

        i18n.setLocale('zh-CN');
        expect(applyTextLocalization(world, i18n)).toBe(1);
        expect(world.text(e).content).toBe('开始');
    });

    it('a missing key resolves to the key itself (greppable fallback)', () => {
        const { world, i18n } = setup();
        const e = world.spawn({ i18nKey: 'no.such.key', content: 'authored' });
        applyTextLocalization(world, i18n);
        expect(world.text(e).content).toBe('no.such.key');
    });

    it('a late-loaded catalog re-flows already-bound text (the .eslocale flow)', () => {
        const { world, i18n } = setup();
        const e = world.spawn({ i18nKey: 'quit' });
        applyTextLocalization(world, i18n);
        expect(world.text(e).content).toBe('quit'); // not shipped yet → key

        i18n.addCatalog('en', { quit: 'Quit' }); // table lands (LocaleAssetLoader)
        applyTextLocalization(world, i18n);
        expect(world.text(e).content).toBe('Quit');
    });
});
