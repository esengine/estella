// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The web, headless and native runtimes are three slices of ONE plugin list.
// Before that, each factory kept its own: the presentation plugins were listed in
// the web factory only, so a device ran a game's logic and none of its tilemaps,
// particles, trails, meshes or post-process volumes — and nothing said so.
//
// These pin the slices against each other, so adding a plugin to the web stack
// forces a decision about the other two instead of silently skipping them.
import { describe, it, expect } from 'vitest';
import {
    simulationBasePlugins, presentationBasePlugins, webBasePlugins,
} from '../src/app/pluginSets';

const names = (plugins: { name: string }[]): string[] => plugins.map((p) => p.name).sort();

describe('plugin sets', () => {
    it('the web stack is exactly simulation + presentation', () => {
        expect(names(webBasePlugins()))
            .toEqual(names([...simulationBasePlugins(), ...presentationBasePlugins()]));
    });

    it('nothing is in both halves', () => {
        const sim = new Set(names(simulationBasePlugins()));
        const both = names(presentationBasePlugins()).filter((n) => sim.has(n));
        expect(both).toEqual([]);
    });

    it('each half is free of duplicates', () => {
        for (const set of [simulationBasePlugins(), presentationBasePlugins()]) {
            expect(names(set)).toEqual([...new Set(names(set))]);
        }
    });

    it('the lists hand out the same plugin instances every call', () => {
        // They are module singletons holding per-app state keyed by App, so two
        // factories in one process must not build two copies.
        expect(webBasePlugins()[0]).toBe(webBasePlugins()[0]);
    });
});
