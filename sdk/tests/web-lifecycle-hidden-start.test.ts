// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A page that starts in a background tab knows it is in the background:
 *        the browser sends no visibilitychange for the state a page is born in.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { App } from '../src/app/app';
import { Lifecycle, LifecyclePlugin } from '../src/ecs/lifecycle';
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';

const setHidden = (v: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => v });

afterEach(() => { delete (document as { hidden?: boolean }).hidden; });

describe('a page started in a background tab', () => {
    it('is not visible and is paused until it is shown', () => {
        setPlatform(webAdapter);
        setHidden(true);
        const app = App.new();
        app.addPlugin(new LifecyclePlugin());
        expect(app.getResource(Lifecycle).visible).toBe(false);
        expect(app.isPaused()).toBe(true);

        setHidden(false);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(app.getResource(Lifecycle).visible).toBe(true);
        expect(app.isPaused()).toBe(false);
    });
});
