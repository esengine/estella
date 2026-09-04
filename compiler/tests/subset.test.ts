// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    subset.test.ts
 * @brief   What the subset must REFUSE, and how it says so.
 *
 * @details A checker that accepts everything is not a checker. Each case pins
 *          one rule of the subset and asserts the refusal names a line and a
 *          reason — coverage that stalls low is a diagnostics problem first.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brokenPromises, lowerProgram } from '../src/frontend';
import { verifySystem } from '../src/verify';
import { builtinShapes } from '../src/builtins';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const OUTSIDE = resolve(HERE, 'fixtures/outside-subset.ts');
const DYNAMIC = resolve(HERE, 'fixtures/dynamic-component.ts');

const result = lowerProgram([OUTSIDE], builtinShapes());
const diagOf = (system: string) => result.diagnostics.find((d) => d.system === system);
const compiled = (system: string) => result.module.systems.some((s) => s.name === system);

describe('the subset refuses, and says why', () => {
    it('saw every system in the file, compiled or not', () => {
        expect(result.seen).toEqual([
            'FixtureLooping', 'FixtureTypo', 'FixtureTrig', 'FixtureCalling',
            'FixtureWritesReadOnly', 'FixtureWritesConst',
            'FixturePromised', 'FixturePromiseKept', 'FixtureIntegerField',
        ]);
    });

    it.each([
        ['FixtureLooping', /WhileStatement is not a statement/],
        ['FixtureTypo', /has no field 'valeu'/],
        ['FixtureTrig', /Math\.sin is implementation-defined.*call exact\.sin instead/],
        ['FixtureCalling', /'damp' cannot be lowered: parameter 'v' needs a type annotation/],
        ['FixtureWritesConst', /'LIMIT' is a constant and cannot be assigned/],
        ['FixtureIntegerField', /'Camera\.priority' is stored as i32, and this subset has no integer type/],
    ])('refuses %s', (name, why) => {
        const d = diagOf(name);
        expect(d, `${name} compiled when it should not have`).toBeDefined();
        expect(d!.message).toMatch(why);
        expect(d!.line).toBeGreaterThan(0);
        expect(d!.file).toContain('outside-subset');
        expect(compiled(name)).toBe(false);
    });

    it('lowers a write to a component the query did not ask to write…', () => {
        // The frontend has no reason to refuse this — it is well-formed TS and a
        // well-formed place. Which is exactly why the verifier must catch it.
        expect(diagOf('FixtureWritesReadOnly')).toBeUndefined();
        expect(compiled('FixtureWritesReadOnly')).toBe(true);
    });

    it('…and the verifier refuses it on the IR alone', () => {
        const sys = result.module.systems.find((s) => s.name === 'FixtureWritesReadOnly')!;
        const errors = verifySystem(sys, result.module.comps, result.module.fns);
        expect(errors).toHaveLength(1);
        expect(errors[0]!.message).toMatch(/is written but the query asks for 'Transform' without Mut/);
    });

    it('refuses a defineComponent whose shape is not a literal', () => {
        const dyn = lowerProgram([DYNAMIC], builtinShapes());
        expect(dyn.module.comps.has('FixtureDynamic')).toBe(false);
        expect(dyn.diagnostics).toHaveLength(1);
        // The message names the COMPONENT and what is wrong with it: the call
        // shape was almost never the problem, and "needs an object literal"
        // sent readers looking at a line that already had one.
        expect(dyn.diagnostics[0]!.message)
            .toMatch(/defineComponent\('FixtureDynamic'\) has a default that is not a literal/);
    });
});

/**
 * `@compiled` does not change what the subset takes; it changes who has to act.
 * An unmarked refusal is the design. A marked one is a build error.
 */
describe('a promise the author wrote down', () => {
    it('sees the marker, and only where it was written', () => {
        expect(result.required).toEqual(['FixturePromised', 'FixturePromiseKept']);
    });

    it('makes the same refusal an error, with the same reason and line', () => {
        const promised = diagOf('FixturePromised')!;
        const unmarked = diagOf('FixtureTrig')!;
        expect(promised.severity).toBe('error');
        expect(unmarked.severity).toBe('note');
        // The marker is not a second rule: both are refused for the same reason.
        expect(promised.message).toMatch(/Math\.cos is implementation-defined.*call exact\.cos instead/);
        expect(promised.kind).toBe(unmarked.kind);
        expect(promised.line).toBeGreaterThan(0);
    });

    it('a kept promise is not a broken one', () => {
        expect(compiled('FixturePromiseKept')).toBe(true);
        expect(brokenPromises(result).map((d) => d.system)).toEqual(['FixturePromised']);
    });
});

/**
 * `defineEvent<T>` erases T, so a payload declared only as a type leaves the
 * layout compiled code baked in unnameable at run time — and the two halves of
 * the project handshake then range over different fields. The subset asks for
 * the value, the way a component and a resource already carry theirs.
 */
describe('an event a compiled system uses carries its payload as a value', () => {
    const NO_PAYLOAD = resolve(HERE, 'fixtures/event-no-payload.ts');
    const lowered = lowerProgram([NO_PAYLOAD], builtinShapes());
    const broken = brokenPromises(lowered);
    const about = (system: string) => broken.find((d) => d.system === system);

    it('refuses a reader of one that does not, with a line and the fix', () => {
        const found = about('ReadsSilent');
        expect(found, 'ReadsSilent was not refused').toBeDefined();
        expect(found!.line).toBeGreaterThan(0);
        expect(found!.message).toMatch(/declared without a payload value/);
        expect(found!.message).toMatch(/defineEvent<\.\.\.>\('NoPayloadSilent', \{ \.\.\. \}\)/);
    });

    it('refuses a writer of one too — the layout is the same contract', () => {
        expect(about('WritesSilent'), 'WritesSilent was not refused').toBeDefined();
    });

    /** The value and the type are two statements of one layout, so the compiler
     *  holds them together — a payload declared in another order is every field
     *  at another position, and the runtime would read the value's. */
    it('refuses one whose declared value and type disagree, naming both', () => {
        const said = lowered.diagnostics.find((d) => /NoPayloadCrossed/.test(d.message));
        expect(said, 'the disagreement was not reported').toBeDefined();
        expect(said!.message).toMatch(/declares the payload \[second, first\]/);
        expect(said!.message).toMatch(/type says \[first, second\]/);
        expect(said!.line).toBeGreaterThan(0);
        // And the system that reads it does not compile against a layout the
        // two halves cannot agree on.
        expect(about('ReadsCrossed'), 'ReadsCrossed was not refused').toBeDefined();
    });

    it('and compiles the one whose event carries its payload', () => {
        expect(about('ReadsLoud')).toBeUndefined();
        expect(lowered.module.systems.some((s) => s.name === 'ReadsLoud')).toBe(true);
    });
});
