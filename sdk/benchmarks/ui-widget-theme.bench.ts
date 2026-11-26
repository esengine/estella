// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { bench, describe } from 'vitest';
import { App } from '../src/app/app';
import { UIEventQueue } from '../src/ui/core/events';
import { switchTheme } from '../src/ui/behavior/theme-apply';
import { DARK_TOKENS, LIGHT_TOKENS, getTheme, setTheme } from '../src/ui/theme/tokens';
import { createDropdown } from '../src/ui/widgets/dropdown';
import type { CppRegistry } from '../src/wasm';
import { HAS_WASM, loadWasmModule } from '../tests/helpers/loadWasm';

describe.skipIf(!HAS_WASM)('widget theme on 400 dropdowns', () => {
    let app: App, registry: CppRegistry;
    const setup = async () => {
        const wasm = await loadWasmModule();
        registry = new wasm.Registry();
        app = App.new();
        app.connectCpp(registry, wasm);
        switchTheme(app.world, DARK_TOKENS);
        const events = new UIEventQueue();
        for (let i = 0; i < 400; i++) createDropdown({ world: app.world, events, options: ['Low', 'High'] });
    };
    const teardown = () => {
        app.quit({ keepRenderer: true });
        registry.delete();
        setTheme(DARK_TOKENS);
    };

    bench('reapply the current palette', () => {
        switchTheme(app.world, getTheme(app.world));
    }, { setup, teardown });
    bench('change between light and dark', () => {
        switchTheme(app.world, getTheme(app.world) === DARK_TOKENS ? LIGHT_TOKENS : DARK_TOKENS);
    }, { setup, teardown });
});
