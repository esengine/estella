// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  How hard the model is asked to think.
 *
 * The plumbing for this existed and nothing ever set it, so every turn ran at
 * `xhigh` whatever the task. What is worth pinning now that it is settable is
 * the narrowing: a settings file is a file a person can edit, and an unknown
 * depth must not reach the wire — a request the endpoint rejects for a value we
 * passed through is a turn lost to our own trust.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_EFFORTS, DEFAULT_EFFORT, asEffort } from '../src/settings/agentIds';
import { buildStepRequest } from '../electron/agent/anthropic';
import type { CatalogTool } from '../electron/agent/types';

describe('the depths on offer', () => {
    it('are ordered shallow to deep, and default to the agentic one', () => {
        expect([...AGENT_EFFORTS]).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
        expect(DEFAULT_EFFORT).toBe('xhigh');
    });
});

describe('asEffort', () => {
    it.each(AGENT_EFFORTS)('passes %s through', (v) => {
        expect(asEffort(v)).toBe(v);
    });

    it('falls back for anything a hand-edited settings file might hold', () => {
        for (const junk of ['', 'XHIGH', 'highest', 'ultra', 0, 1, null, undefined, {}, []]) {
            expect(asEffort(junk)).toBe(DEFAULT_EFFORT);
        }
    });
});

describe('the request carries it', () => {
    const TOOLS: CatalogTool[] = [
        { name: 'get_scene_tree', description: 'Read the scene.', schema: { type: 'object' }, effect: 'read' },
    ];
    const req = (effort: string) => buildStepRequest({
        dialect: 'anthropic', model: 'm', effort, system: 's', tools: TOOLS, messages: [{ role: 'user', content: 'hi' }],
    });

    it('puts the chosen depth on the wire', () => {
        expect(req('low').output_config).toEqual({ effort: 'low' });
        expect(req('max').output_config).toEqual({ effort: 'max' });
    });

    it('sends it to a compatible gateway too — it is a hint, not an extension', () => {
        // Unlike thinking/cache_control/fallbacks, a gateway can ignore effort
        // without the response changing shape, so it survives the dialect drop.
        const compatible = buildStepRequest({
            dialect: 'compatible', model: 'm', effort: 'medium', system: 's', tools: TOOLS,
            messages: [{ role: 'user', content: 'hi' }],
        });
        expect(compatible.output_config).toEqual({ effort: 'medium' });
        expect(compatible.thinking).toBeUndefined();
    });
});
