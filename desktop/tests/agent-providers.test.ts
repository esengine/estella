// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The shipped provider catalog. The point of shipping it is that nobody
 *        types an endpoint or a model name from memory — so the values being
 *        RIGHT is the feature, and on a gateway that maps an unrecognised model
 *        to its smallest one, a wrong name is not an error, it is a quietly
 *        worse answer for the rest of the session.
 */
import { describe, it, expect } from 'vitest';
import { agentProviders, agentProvider, agentKeyId, parseModelList, CUSTOM_PROVIDER } from '@/agent/providers';

describe('the shipped providers', () => {
  it('knows DeepSeek without being told', () => {
    const deepseek = agentProvider('deepseek');
    expect(deepseek?.baseUrl).toBe('https://api.deepseek.com/anthropic');
    expect(deepseek?.models).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash']);
  });

  // An empty baseUrl is what selects the native dialect (agent/anthropic.ts);
  // giving Anthropic a URL here would silently strip its own extensions.
  it('leaves Anthropic without an endpoint, which is what picks the native dialect', () => {
    expect(agentProvider('anthropic')?.baseUrl).toBe('');
    expect(agentProvider('anthropic')?.models[0]).toBe('claude-opus-5');
  });

  it('keeps one key per provider, so switching back costs nothing', () => {
    const ids = agentProviders().map((p) => agentKeyId(p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(agentKeyId('deepseek')).toBe('agents.key.deepseek');
  });

  it('ships the custom slot empty — it is the one we cannot know', () => {
    const custom = agentProvider(CUSTOM_PROVIDER);
    expect(custom?.userDefined).toBe(true);
    expect(custom?.models).toEqual([]);
  });
});

// Someone pasting three model names should not have to guess which separator.
describe('the custom model list', () => {
  it('takes commas or newlines, and ignores the gaps', () => {
    expect(parseModelList('a, b,c')).toEqual(['a', 'b', 'c']);
    expect(parseModelList('a\n b \n\nc')).toEqual(['a', 'b', 'c']);
    expect(parseModelList('   ')).toEqual([]);
  });
});
