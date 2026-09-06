// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the shared setup owes every test: an isolated registry that is
 *        still the engine's.
 *
 * Both halves matter and they pull against each other. Clearing to empty took
 * engine components out too, and nothing re-registers a module body — the
 * result was an identity pose and an unwritten joint, which is what an
 * assertion cannot tell from a correct answer. Not clearing at all would let
 * one test's components decide another's.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, getComponent } from '../src/ecs/component';
// Imported for its module-level registrations, which is the whole point: they
// happen at COLLECTION, after the setup file's own body has already run.
import '../src/animation';

const LEAKED = 'HarnessLeakCanary';

describe('the shared test setup', () => {
    it('leaves engine components registered, because a module body runs once', () => {
        // Marker registers from ecs/component, which the setup file imports
        // itself; Animator from a module only the file under test pulls in. A
        // baseline taken at setup load keeps the first and loses 40 of the other.
        expect(getComponent('Marker')).toBeDefined();
        expect(getComponent('Animator')).toBeDefined();
    });

    it('registers one for the next case to look for', () => {
        defineComponent(LEAKED, { n: 0 });
        expect(getComponent(LEAKED)).toBeDefined();
    });

    it('does not carry one test\'s components into the next', () => {
        expect(getComponent(LEAKED)).toBeUndefined();
    });
});
