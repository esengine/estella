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
import {
  agentProviders, agentProvider, agentKeyId, parseModelList, protocolOf, asProtocol, CUSTOM_PROVIDER,
  setUserProviders,
} from '@/agent/providers';

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

  // Its address and protocol are knowable; its model NAMES are not, and shipping
  // a wrong one is not an error — it is a gateway serving something smaller for
  // the rest of the session.
  it('ships OpenAI on its own protocol, and leaves its model names to be typed', () => {
    const openai = agentProvider('openai');
    expect(openai?.baseUrl).toBe('');
    expect(protocolOf(openai)).toBe('openai');
    expect(openai?.typedModels).toBe(true);
    expect(openai?.models).toEqual([]);
    // Still a shipped provider: it keeps its own key row, unlike a typed one.
    expect(openai?.userDefined).toBeUndefined();
  });

  // There is no reserved slot for "the custom one": a person has as many as
  // they have endpoints.
  it('ships no placeholder for the providers a person types', () => {
    expect(agentProviders().every((p) => !p.userDefined)).toBe(true);
    expect(agentProvider(CUSTOM_PROVIDER)).toBeUndefined();
  });
});

/**
 * They arrive as a SET, because the removals matter as much as the additions:
 * one deleted from the table must stop being offered.
 */
describe('the providers a person defined', () => {
  const def = (id: string, over = {}) => ({ id, label: id, baseUrl: `http://${id}/v1`, models: ['m'], ...over });

  it('joins the shipped ones, marked as theirs, and leaves when withdrawn', () => {
    setUserProviders([def('mine-a'), def('mine-b')]);
    expect(agentProvider('mine-a')?.userDefined).toBe(true);
    expect(agentProviders().map((p) => p.id)).toEqual(
      expect.arrayContaining(['anthropic', 'deepseek', 'openai', 'mine-a', 'mine-b']),
    );

    setUserProviders([def('mine-a')]);
    expect(agentProvider('mine-b')).toBeUndefined();
    expect(agentProvider('mine-a')).toBeDefined();

    setUserProviders([]);
    expect(agentProviders().every((p) => !p.userDefined)).toBe(true);
  });

  // Shipped first: the picker reads top to bottom, and the vendor rows are what
  // a person who has typed nothing is looking for.
  it('lists after the shipped ones', () => {
    setUserProviders([def('mine-a')]);
    const ids = agentProviders().map((p) => p.id);
    expect(ids.indexOf('mine-a')).toBeGreaterThan(ids.indexOf('openai'));
    setUserProviders([]);
  });

  it('cannot take an id the editor already ships', () => {
    setUserProviders([def('anthropic', { label: 'Impostor' })]);
    expect(agentProvider('anthropic')?.label).toBe('Anthropic');
    setUserProviders([]);
  });
});

/**
 * Which wire format an endpoint speaks is not a detail: the two differ in every
 * message they send, so a def that got it wrong would send a perfectly formed
 * request in the wrong shape.
 */
describe('the protocol a provider speaks', () => {
  // Every def predates the field, and every one of them was the Messages API.
  it('reads a def without one as Anthropic', () => {
    expect(protocolOf(agentProvider('anthropic'))).toBe('anthropic');
    expect(protocolOf(agentProvider('deepseek'))).toBe('anthropic');
    expect(protocolOf(undefined)).toBe('anthropic');
  });

  // A settings file is one a person can edit, and Chat Completions is what most
  // endpoints — and every local runner — implement.
  it('narrows a stored value, defaulting a custom endpoint to Chat Completions', () => {
    expect(asProtocol('anthropic')).toBe('anthropic');
    expect(asProtocol('openai')).toBe('openai');
    expect(asProtocol('gemini')).toBe('openai');
    expect(asProtocol(undefined)).toBe('openai');
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
