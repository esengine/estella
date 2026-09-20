// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A subsystem installs one plugin however many times it is registered.
 *
 * Both `esengine/spine` and an entry's `installOptionalPlugins()` register it,
 * and a host may evaluate the bundle again — so the count must not follow the
 * number of callers.
 */
import { describe, it, expect } from 'vitest';
import { installOptionalPlugins } from '../src/runtime/optionalPlugins';
import '../src/spine';
import '../src/dragonbones';
import { entryPlugins } from '../src/runtime/entryPlugins';

describe('the plugins an entry installs', () => {
    it('names each subsystem once, however many callers registered it', () => {
        installOptionalPlugins();
        // Twice more: a host may evaluate the bundle again, and nothing should
        // accumulate when it does.
        installOptionalPlugins();
        const names = entryPlugins().map((p) => p.name);
        expect([...new Set(names)]).toEqual(names);
    });
});
