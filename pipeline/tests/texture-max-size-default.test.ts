// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { importerDefaults, readTextureCookSettings } from '../src/project/importSettings';

describe('the size a texture ships at when nobody said', () => {
    it('is its own: a new texture starts at Source size', () => {
        expect(importerDefaults('texture').maxSize).toBe(0);
    });

    it('is its own for a picture and for data whose .meta says nothing of it', () => {
        expect(readTextureCookSettings(undefined).maxSize).toBe(0);
        expect(readTextureCookSettings({ use: 'colour' }).maxSize).toBe(0);
        expect(readTextureCookSettings({ use: 'data' }).maxSize).toBe(0);
    });

    it('is what the .meta or a platform override states, where one does', () => {
        expect(readTextureCookSettings({ maxSize: 2048 }).maxSize).toBe(2048);
        const mobile = { maxSize: 0, overrides: { wechat: { enabled: true, maxSize: 1024 } } };
        expect(readTextureCookSettings(mobile, 'wechat').maxSize).toBe(1024);
        expect(readTextureCookSettings(mobile, 'web').maxSize).toBe(0);
    });
});
