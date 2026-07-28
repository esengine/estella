// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Live re-theming: switchTheme re-resolves every ThemeStyle-tagged entity's
 *        role bindings onto its UIVisual / Text / `$interaction` colour gear, so
 *        already-built widgets restyle — not just future ones.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    createButton,
    switchTheme,
    applyThemeToWorld,
    markThemed,
    ThemeStyle,
    UIVisual,
    UIVisualType,
    Text,
    UIGear,
    DARK_TOKENS,
    LIGHT_TOKENS,
    setTheme,
    type UIGearData,
    type GearValue,
} from '../src/ui';
import type { Entity } from '../src/types';
import type { World } from '../src/ecs/world';

// A generic mock world: stores any component def per entity + supports the
// getEntitiesWithComponents query applyThemeToWorld needs.
function mockWorld() {
    const comps = new Map<number, Map<object, unknown>>();
    let next = 1;
    const w = {
        spawn(): Entity { const e = next++; comps.set(e, new Map()); return e as Entity; },
        valid(e: Entity) { return comps.has(e as number); },
        setParent() {},
        onDespawn() { return () => {}; },
        has(e: Entity, c: object) { return comps.get(e as number)?.has(c) ?? false; },
        get(e: Entity, c: object) { return comps.get(e as number)?.get(c); },
        insert(e: Entity, c: object, data: unknown) { comps.get(e as number)?.set(c, data); },
        getEntitiesWithComponents(cs: object[]): Entity[] {
            const out: Entity[] = [];
            for (const [e, m] of comps) if (cs.every((c) => m.has(c))) out.push(e as Entity);
            return out;
        },
    };
    return w as unknown as World;
}

const noEvents = { on: () => {} } as never;

describe('live re-theming', () => {
    afterEach(() => setTheme(DARK_TOKENS));

    it('applyThemeToWorld recolors a UIVisual role, preserving alpha', () => {
        const w = mockWorld();
        const e = w.spawn();
        w.insert(e, UIVisual, { visualType: UIVisualType.SolidColor, color: { r: 1, g: 1, b: 1, a: 0.3 } });
        markThemed(w, e, { visual: 'primary' });

        setTheme(LIGHT_TOKENS);
        applyThemeToWorld(w);
        const v = w.get(e, UIVisual) as { color: { r: number; g: number; b: number; a: number } };
        expect(v.color).toMatchObject({ ...LIGHT_TOKENS.colors.primary, a: 0.3 }); // hue swaps, alpha kept
    });

    it('applyThemeToWorld recolors a Text role', () => {
        const w = mockWorld();
        const e = w.spawn();
        w.insert(e, Text, { content: 'x', color: { r: 1, g: 1, b: 1, a: 1 } });
        markThemed(w, e, { text: 'text' });

        setTheme(LIGHT_TOKENS);
        applyThemeToWorld(w);
        const t = w.get(e, Text) as { color: { r: number } };
        expect(t.color.r).toBeCloseTo(LIGHT_TOKENS.colors.text.r);
    });

    const colorPages = (w: World, e: Entity): Record<string, GearValue> =>
        (w.get(e, UIGear) as UIGearData).bindings.find((b) => b.property === 'color')!.pages;

    it('switchTheme restyles an already-built button (gear pages + label)', () => {
        const w = mockWorld();
        const { entity: btn } = createButton({ world: w, events: noEvents, text: 'OK' });
        // Built under the default dark theme.
        expect((colorPages(w, btn).normal as { r: number }).r).toBeCloseTo(DARK_TOKENS.colors.control.r);

        switchTheme(w, LIGHT_TOKENS);

        const pages = colorPages(w, btn);
        expect(pages.normal).toMatchObject(LIGHT_TOKENS.colors.control);
        expect(pages.hover).toMatchObject(LIGHT_TOKENS.colors.controlHover);
        // The dimmed 'disabled' page keeps its half alpha; only the hue re-themes.
        const disabled = pages.disabled as { r: number; a: number };
        expect(disabled.a).toBeCloseTo(DARK_TOKENS.colors.control.a * 0.5);
        expect(disabled.r).toBeCloseTo(LIGHT_TOKENS.colors.control.r);
    });

    it('does not clobber a button whose states the caller supplied', () => {
        const w = mockWorld();
        const { entity: btn } = createButton({
            world: w, events: noEvents,
            states: { normal: { color: { r: 0.5, g: 0.1, b: 0.9, a: 1 } } },
        });
        expect(w.has(btn, ThemeStyle)).toBe(false); // untagged → not theme-managed
        switchTheme(w, LIGHT_TOKENS);
        expect(colorPages(w, btn).normal).toMatchObject({ r: 0.5, g: 0.1, b: 0.9 }); // caller's color survives
    });
});
