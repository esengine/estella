// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    initResourceManager,
    shutdownResourceManager,
    setTextureBudget,
} from '../src/resourceManager';

const setBudget = vi.fn();
const mockRm = {
    setTextureBudget: setBudget,
    getTextureDimensions: vi.fn(() => null),
} as any;

beforeEach(() => {
    setBudget.mockClear();
    initResourceManager(mockRm);
});

afterEach(() => {
    shutdownResourceManager();
});

describe('setTextureBudget', () => {
    it('forwards the budget to the C++ ResourceManager', () => {
        setTextureBudget(4 * 1024 * 1024);
        expect(setBudget).toHaveBeenCalledWith(4 * 1024 * 1024);
    });

    it('clamps negative budgets to 0', () => {
        setTextureBudget(-1);
        expect(setBudget).toHaveBeenCalledWith(0);
    });

    it('floors fractional budgets to an integer', () => {
        setTextureBudget(10.9);
        expect(setBudget).toHaveBeenCalledWith(10);
    });

    it('throws if no ResourceManager is initialized', () => {
        shutdownResourceManager();
        expect(() => setTextureBudget(1)).toThrow();
    });
});
