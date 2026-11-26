// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { bench, describe } from 'vitest';
import { LocalizationAPI, localeCatalogsFor, type LocaleTableAsset } from '../src/i18n/Localization';

const keys = Array.from({ length: 5360 }, (_, i) => `label.${i}`);
const visible = keys.slice(0, 48);
const options = { time: 250, warmupTime: 100 };

// Start at the asset loader's publication step. Both revisions are decoded before timing, excluding I/O and parsing.
function project(shards: number, changedLocale = 'en') {
    const service = new LocalizationAPI('en', 'en');
    const catalogs = localeCatalogsFor(service);
    const owner = {};
    const files = new Map<string, LocaleTableAsset>();
    for (const locale of ['en', 'de']) {
        const tables = Array.from({ length: shards }, (): LocaleTableAsset => ({ version: 1, locale, entries: {} }));
        keys.forEach((key, i) => { tables[i % shards].entries[key] = `${locale} translation ${i}`; });
        tables.forEach((table, i) => files.set(`${locale}/${i}.eslocale`, table));
    }
    catalogs.setProject(owner, [...files.keys()]);
    for (const [ref, table] of files) catalogs.usePublished(owner, ref, table);

    const ref = `${changedLocale}/0.eslocale`;
    const original = files.get(ref)!;
    const edited = { ...original, entries: { ...original.entries, [keys[0]]: 'Updated label' } };
    let previous = original;
    function reload() {
        const next = previous === original ? edited : original;
        catalogs.refreshPublished(owner, ref, previous, next);
        previous = next;
    }
    return { service, reload };
}

function read(service: LocalizationAPI, labels: readonly string[]): void {
    for (const key of labels) service.t(key);
}

for (const shards of [4, 42]) {
    describe(`Locale catalogs with ${shards} files per language`, () => {
        for (const locale of ['en', 'de']) {
            const labels = project(shards, locale);
            read(labels.service, visible);
            bench(`reload ${locale}, read 48 English labels`, () => {
                labels.reload();
                read(labels.service, visible);
            }, options);
        }

        const cold = project(shards);
        bench('reload English, read all 5,360 keys', () => {
            cold.reload();
            read(cold.service, keys);
        }, options);

        const warmed = project(shards);
        read(warmed.service, keys);
        bench('reread all 5,360 keys', () => read(warmed.service, keys), options);
    });
}
