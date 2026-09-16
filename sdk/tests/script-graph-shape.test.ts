// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    script-graph-shape.test.ts
 * @brief   What a node's pins are, and which wires are legal.
 *
 * Both answers have two readers — the interpreter and the canvas — and the
 * point of pinning them here is that neither reader gets to hold its own copy.
 */
import { describe, it, expect } from 'vitest';
import { AiRegistry } from '../src/ai/fsm/registry';
import {
    describeNode, scriptCatalog, signatureOf, BUILTIN_NODE_KINDS,
    type ScriptGraphSignature, type ScriptVerbCatalog,
} from '../src/logic/nodes';
import { canConnect, coerceValue, emptyScriptGraph, type ScriptGraph } from '../src/logic/types';

/** The verbs, plus whatever graphs a caller is told about. */
const catalog = (graphs?: ReadonlyMap<string, ScriptGraphSignature>): ScriptVerbCatalog => {
    const reg = new AiRegistry<unknown>();
    reg.registerAction('demo.move', {
        params: [{ name: 'speed', type: 'number' }, { name: 'mode', type: 'enum' }],
        run: () => {},
    });
    reg.registerValue('demo.distance', {
        params: [{ name: 'to', type: 'number' }],
        outputs: [{ name: 'meters', type: 'number' }],
        evaluate: (_c, _b, _p, out) => { out.meters = 1; },
    });
    return scriptCatalog(reg, graphs);
};

const graph = (over: Partial<ScriptGraph> = {}): ScriptGraph => ({ ...emptyScriptGraph(), ...over });

describe('a call node takes its pins from what the name declared', () => {
    it('turns declared parameters into inputs and declared outputs into outputs', () => {
        const shape = describeNode({ id: 'n', kind: 'call', ref: 'demo.move' }, graph(), catalog());
        expect(shape?.inputs).toEqual([
            { name: 'speed', type: 'number', label: undefined },
            // An `enum` is a choice of strings: a control kind, not a wire type.
            { name: 'mode', type: 'string', label: undefined },
        ]);
        expect(shape?.execIn).toBe(true);
        expect(shape?.execOut).toEqual(['then']);
        expect(shape?.pure).toBe(false);
    });

    it('gives a pure name no exec pins at all', () => {
        const shape = describeNode({ id: 'n', kind: 'call', ref: 'demo.distance' }, graph(), catalog());
        expect(shape?.pure).toBe(true);
        expect(shape?.execIn).toBe(false);
        expect(shape?.execOut).toEqual([]);
        expect(shape?.outputs).toEqual([{ name: 'meters', type: 'number', label: undefined }]);
    });

    it('is null for a name nothing registered — an unknown node is not an empty one', () => {
        expect(describeNode({ id: 'n', kind: 'call', ref: 'demo.nope' }, graph(), catalog())).toBeNull();
        expect(describeNode({ id: 'n', kind: 'no.such.kind' }, graph(), catalog())).toBeNull();
    });
});

describe('the built-in kinds', () => {
    it('all describe themselves', () => {
        for (const kind of BUILTIN_NODE_KINDS) {
            expect(describeNode({ id: 'n', kind }, graph(), catalog()), kind).not.toBeNull();
        }
    });

    it('sizes flow.sequence from its authored pin count, not from its wires', () => {
        const shape = (count?: number) => describeNode(
            { id: 'n', kind: 'flow.sequence', ...(count === undefined ? {} : { literals: { count } }) },
            graph(), catalog(),
        );
        expect(shape()?.execOut).toEqual(['0', '1']);
        expect(shape(4)?.execOut).toEqual(['0', '1', '2', '3']);
        // A pin count out of range is clamped, never zero pins or a runaway.
        expect(shape(0)?.execOut).toEqual(['0']);
        expect(shape(999)?.execOut).toHaveLength(16);
    });

    it('types a variable pin from the declaration, and `any` without one', () => {
        const g = graph({ variables: [{ name: 'hp', type: 'number' }] });
        const get = describeNode({ id: 'n', kind: 'var.get', literals: { name: 'hp' } }, g, catalog());
        expect(get?.outputs).toEqual([{ name: 'value', type: 'number' }]);
        const missing = describeNode({ id: 'n', kind: 'var.get', literals: { name: 'gone' } }, g, catalog());
        expect(missing?.outputs).toEqual([{ name: 'value', type: 'any' }]);
    });
});

describe('canConnect', () => {
    it('keeps the exec wire to itself', () => {
        expect(canConnect('exec', 'exec')).toBe(true);
        expect(canConnect('exec', 'number')).toBe(false);
        expect(canConnect('number', 'exec')).toBe(false);
    });

    it('widens only where the reading side cannot be surprised', () => {
        expect(canConnect('number', 'string')).toBe(true);
        expect(canConnect('bool', 'number')).toBe(true);
        expect(canConnect('entity', 'number')).toBe(true);
        expect(canConnect('string', 'number')).toBe(false);
        expect(canConnect('number', 'entity')).toBe(false);
    });

    it('lets `any` meet anything, in both directions', () => {
        expect(canConnect('any', 'number')).toBe(true);
        expect(canConnect('string', 'any')).toBe(true);
    });
});

describe('coerceValue is the runtime half of canConnect', () => {
    it('converts what canConnect allows', () => {
        expect(coerceValue(3, 'string')).toBe('3');
        expect(coerceValue(true, 'number')).toBe(1);
        expect(coerceValue(0, 'bool')).toBe(false);
        expect(coerceValue('nonsense', 'number')).toBe(0);
    });

    it('leaves null alone — an unset port is not a zero anyone wrote', () => {
        expect(coerceValue(null, 'number')).toBeNull();
    });
});

describe('a graph.call node takes its pins from the graph it names', () => {
    const called = { ...emptyScriptGraph(), inputs: [{ name: 'speed', type: 'number' as const }], outputs: [{ name: 'ok', type: 'bool' as const }] };
    const known = new Map([['moves.esgraph', signatureOf(called)]]);

    it('mirrors the callee signature, with an exec pin of its own', () => {
        const shape = describeNode(
            { id: 'n', kind: 'graph.call', literals: { graph: 'moves.esgraph' } },
            graph(), catalog(known),
        );
        expect(shape?.inputs).toEqual([{ name: 'speed', type: 'number', label: undefined }]);
        expect(shape?.outputs).toEqual([{ name: 'ok', type: 'bool', label: undefined }]);
        expect(shape?.execIn).toBe(true);
        expect(shape?.execOut).toEqual(['then']);
        // Never pure: a graph runs statements, so it sequences like one.
        expect(shape?.pure).toBe(false);
    });

    it('is null for a graph this build was told nothing about', () => {
        expect(describeNode(
            { id: 'n', kind: 'graph.call', literals: { graph: 'gone.esgraph' } },
            graph(), catalog(known),
        )).toBeNull();
    });

    it('gives the entry and exit nodes the pins the graph declares', () => {
        const inShape = describeNode({ id: 'in', kind: 'graph.input' }, graph(called), catalog());
        expect(inShape?.outputs).toEqual([{ name: 'speed', type: 'number', label: undefined }]);
        // A call arrives here; no occasion lights it, so it takes no exec wire.
        expect(inShape?.execIn).toBe(false);

        const outShape = describeNode({ id: 'out', kind: 'graph.output' }, graph(called), catalog());
        expect(outShape?.inputs).toEqual([{ name: 'ok', type: 'bool', label: undefined }]);
        // Control stops here: what runs next belongs to the caller.
        expect(outShape?.execOut).toEqual([]);
    });
});
