// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  UIPlugin composes eleven sub-plugin builds; App.quit only calls
 *        cleanup() on *installed* plugins, so the composed plugin must forward
 *        teardown to its sub-plugins or their cleanups are unreachable.
 */
import { describe, it, expect, vi } from 'vitest';
import { App } from '../src/app';
import { uiPlugin } from '../src/ui/ui-plugin';
import { safeAreaPlugin } from '../src/ui/layout/safe-area';
import { textInputPlugin, TextInputPlugin } from '../src/ui/text/text-input-plugin';
import { AppContext, setDefaultContext } from '../src/context';
import { setEditorMode, setPlayMode } from '../src/env';
import { createMockModule } from './mocks/wasm';
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';

describe('UIPlugin teardown', () => {
    it('forwards cleanup to sub-plugins in reverse build order', () => {
        expect(typeof uiPlugin.cleanup).toBe('function');

        const order: string[] = [];
        const tiSpy = vi.spyOn(textInputPlugin, 'cleanup').mockImplementation(() => { order.push('textInput'); });
        const saSpy = vi.spyOn(safeAreaPlugin, 'cleanup').mockImplementation(() => { order.push('safeArea'); });

        uiPlugin.cleanup!(App.new());

        expect(order).toEqual(['textInput', 'safeArea']);
        tiSpy.mockRestore();
        saSpy.mockRestore();
    });

    it('SafeAreaPlugin removes its window resize listener on cleanup', () => {
        const added: EventListener[] = [];
        const removed: EventListener[] = [];
        const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, fn) => {
            if (type === 'resize') added.push(fn as EventListener);
        });
        const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation((type, fn) => {
            if (type === 'resize') removed.push(fn as EventListener);
        });

        safeAreaPlugin.build(App.new());
        expect(added.length).toBe(1);

        safeAreaPlugin.cleanup?.();
        expect(removed).toEqual(added);

        addSpy.mockRestore();
        removeSpy.mockRestore();
    });

    it('TextInputPlugin.cleanup removes the hidden textarea from the DOM', () => {
        setDefaultContext(new AppContext());
        setEditorMode(false);
        setPlayMode(false);
        // The field is edited through the platform's text-editing surface, which
        // on the web IS that hidden textarea (platform/webTextEditor.ts).
        setPlatform(webAdapter);
        const app = App.new();
        const module = createMockModule();
        app.connectCpp(module.getRegistry(), module);
        const before = document.querySelectorAll('textarea').length;

        const plugin = new TextInputPlugin();
        plugin.build(app);
        expect(document.querySelectorAll('textarea').length).toBe(before + 1);

        plugin.cleanup();
        expect(document.querySelectorAll('textarea').length).toBe(before);
    });
});
