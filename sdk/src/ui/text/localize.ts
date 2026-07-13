// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/localize.ts
 * @brief   The Text ↔ Localization binding: a Text whose `i18nKey` is set gets
 *          its `content` written from the app's Localization catalogs.
 *
 * Runs as a frame system (TextPlugin registers it, gated on the Localization
 * resource being present — the plugin is opt-in). A frame-scan with a
 * diff-write is deliberately the whole design: UI labels number in the tens,
 * a no-param `t()` is one map lookup, and writing only on change keeps the
 * text renderer's caches cold — while `setLocale`/`addCatalog` re-flow every
 * bound label on the very next frame with zero extra bookkeeping.
 */
import type { Entity } from '../../types';
import type { LocalizationApi } from '../../i18n/Localization';
import { Text, type TextData } from '../core/text';

/** The slice of World the binding needs — mirrors FsmWorldView so tests can
 *  drive it with an in-memory fake. */
export interface TextWorldView {
    getEntitiesWithComponents(components: unknown[]): readonly number[];
    get(entity: Entity, component: unknown): unknown;
    insert(entity: Entity, component: unknown, data: unknown): void;
}

/**
 * Resolve every bound Text once: non-empty `i18nKey` → `t(key)` → write
 * `content` when it differs (missing keys resolve to the key itself — the
 * catalogs' visible, greppable fallback). Returns how many contents changed.
 */
export function applyTextLocalization(world: TextWorldView, i18n: LocalizationApi): number {
    let changed = 0;
    for (const e of world.getEntitiesWithComponents([Text])) {
        const entity = e as Entity;
        const text = world.get(entity, Text) as TextData;
        if (!text.i18nKey) continue;
        const resolved = i18n.t(text.i18nKey);
        if (resolved === text.content) continue;
        text.content = resolved;
        world.insert(entity, Text, text);
        changed++;
    }
    return changed;
}
