// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What an endpoint can DO, from the row that declares it to the endpoint
 *        main builds.
 *
 *        Sight used to be read off the address — no baseUrl, therefore the
 *        vendor's own API, therefore it can see — which is a statement about
 *        WHERE an endpoint is and not about what it accepts. Every gateway was
 *        blind with no way to say otherwise, and the whole consequence was
 *        silent: the agent was told each turn that screenshots could not reach
 *        it, asked for `format: 'grid'` instead, and nobody could tell that
 *        apart from a preference.
 *
 *        The wire halves live with their protocols (agent-dialect, agent-openai);
 *        what is checked here is that the facts travel.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '@/settings';
import { useSettings } from '@/store/settingsStore';
import { useAgent, syncAgentEndpoint, agentAcceptsImages } from '@/store/AgentStore';
import { agentProvider, CUSTOM_PROVIDER } from '@/agent/providers';
import {
  AGENT_PROVIDERS_SETTING, syncUserProviders, type UserProviderRow,
} from '@/agent/userProviders';

interface Endpoint {
  vision?: boolean; baseUrl?: string; protocol?: string; contextWindow?: number;
  reasoningEffort?: boolean;
}

let sent: Endpoint[];

/** A row as the settings table stores one. */
const row = (over: Partial<UserProviderRow> = {}): Record<string, unknown> => ({
  id: 'custom-1',
  label: 'Local llama',
  protocol: 'openai',
  baseUrl: 'http://localhost:11434/v1',
  models: 'llama-4',
  vision: false,
  contextWindow: 0,
  reasoningEffort: true,
  ...over,
} as unknown as Record<string, unknown>);

/** Put rows in the table and select the first — what picking one in the composer does. */
const configure = (...rows: Record<string, unknown>[]) => {
  useSettings.getState().setValue(AGENT_PROVIDERS_SETTING, rows);
  syncUserProviders();
  const first = rows[0];
  useAgent.setState({
    selection: { providerId: String(first.id), model: String(first.models).split(',')[0].trim() },
  });
};

beforeEach(() => {
  sent = [];
  (globalThis as { window?: unknown }).window = {
    estella: { agent: { setEndpoint: async (patch: Endpoint) => { sent.push(patch); } } },
  };
  useAgent.setState({ selection: null });
  useSettings.getState().setValue(AGENT_PROVIDERS_SETTING, []);
  syncUserProviders();
});

afterEach(() => {
  useSettings.getState().setValue(AGENT_PROVIDERS_SETTING, []);
  syncUserProviders();
  delete (globalThis as { window?: unknown }).window;
});

describe('what a shipped provider declares', () => {
  it('says so where it is true, rather than leaving it to the address', () => {
    expect(agentProvider('anthropic')?.vision).toBe(true);
    expect(agentProvider('openai')?.vision).toBe(true);
  });

  // The two mistakes are not symmetrical: claiming sight an endpoint lacks
  // spends the turn on a refused request, withholding it costs a text grid.
  it('withholds it from a provider we have not confirmed', () => {
    expect(agentProvider('deepseek')?.vision).toBeUndefined();
  });
});

describe('an endpoint the person described', () => {
  it('is blind until they say otherwise', () => {
    configure(row());
    expect(agentAcceptsImages()).toBe(false);
  });

  it('can be declared sighted, and the endpoint hears about it', () => {
    configure(row({ vision: true }));
    syncAgentEndpoint();
    expect(agentAcceptsImages()).toBe(true);
    expect(sent.at(-1)).toMatchObject({ vision: true, baseUrl: 'http://localhost:11434/v1' });
  });

  // A gateway address is not an answer to this question — that reading is the
  // bug. What matters is that the two facts travel separately.
  it('carries the declaration alongside the address, not derived from it', () => {
    configure(row({ vision: true }));
    sent.length = 0;
    syncAgentEndpoint();
    expect(sent).toHaveLength(1);
    expect([sent[0].baseUrl, sent[0].vision]).toEqual(['http://localhost:11434/v1', true]);
  });

  // Compaction at three quarters of a window that is not this endpoint's folds
  // a conversation that had room, or fails one that did not.
  it('says how much room it has, instead of being assumed small', () => {
    configure(row({ contextWindow: 1_000_000 }));
    syncAgentEndpoint();
    expect(sent.at(-1)?.contextWindow).toBe(1_000_000);
  });

  // An endpoint that has never heard of the argument refuses the whole call.
  it('can refuse the reasoning-depth argument without losing every turn', () => {
    configure(row({ reasoningEffort: false }));
    syncAgentEndpoint();
    expect(sent.at(-1)?.reasoningEffort).toBe(false);
  });
});

describe('a provider that ships its own answer', () => {
  it('travels without the person configuring anything', () => {
    useAgent.setState({ selection: { providerId: 'anthropic', model: 'claude-opus-5' } });
    syncAgentEndpoint();
    expect(sent.at(-1)).toMatchObject({ vision: true, reasoningEffort: true });
    expect(agentAcceptsImages()).toBe(true);
  });

  it('and a shipped gateway that has not claimed sight stays blind', () => {
    useAgent.setState({ selection: { providerId: 'deepseek', model: 'deepseek-v4-pro' } });
    syncAgentEndpoint();
    expect(sent.at(-1)?.vision).toBe(false);
    expect(agentAcceptsImages()).toBe(false);
  });
});

/**
 * The reason the table exists: a person has more than one of these, and the
 * shape it replaced could only hold one — configuring a second overwrote the
 * first, credential included.
 */
describe('more than one of them', () => {
  it('keeps both, each with its own key id and its own capabilities', () => {
    configure(
      row({ id: 'custom-1', label: 'Local llama', vision: false }),
      row({ id: 'custom-2', label: 'Work gateway', baseUrl: 'https://gw.corp/v1', models: 'gpt-x', vision: true }),
    );
    const a = agentProvider('custom-1');
    const b = agentProvider('custom-2');
    expect([a?.label, a?.vision, a?.baseUrl]).toEqual(['Local llama', false, 'http://localhost:11434/v1']);
    expect([b?.label, b?.vision, b?.baseUrl]).toEqual(['Work gateway', true, 'https://gw.corp/v1']);
  });

  it('stops offering one that was deleted', () => {
    configure(row({ id: 'custom-1' }), row({ id: 'custom-2' }));
    expect(agentProvider('custom-2')).toBeDefined();
    useSettings.getState().setValue(AGENT_PROVIDERS_SETTING, [row({ id: 'custom-1' })]);
    syncUserProviders();
    expect(agentProvider('custom-2')).toBeUndefined();
    expect(agentProvider('custom-1')).toBeDefined();
  });

  // The registry is the one door: a shipped provider and a typed one are the
  // same kind of thing to everything downstream of it.
  it('does not let a typed row displace a shipped provider', () => {
    configure(row({ id: 'anthropic', label: 'Impostor', baseUrl: 'http://evil/v1' }));
    expect(agentProvider('anthropic')?.label).toBe('Anthropic');
  });
});

/**
 * A key is filed under its provider's id and lives outside the list, so the two
 * ends of a row's life both have to account for it: a deleted row's credential
 * must go, and a new row must never be handed an id that could still have one.
 */
describe('the credential a row owns', () => {
  it('goes when the row does, under the id it was filed against', async () => {
    const cleared: string[] = [];
    (globalThis as { window?: unknown }).window = {
      estella: { secrets: { clear: async (id: string) => { cleared.push(id); return undefined; } } },
    };
    const { forgetProviderSecret } = await import('@/agent/userProviders');
    forgetProviderSecret(row({ id: 'custom-2' }));
    await Promise.resolve();
    expect(cleared).toEqual(['agents.key.custom-2']);
  });

  // An id that came back around would inherit whatever is still sealed under it.
  it('never re-uses an id, even after the rows between are gone', async () => {
    const { newProviderRow } = await import('@/agent/userProviders');
    expect(newProviderRow([]).id).toBe('custom-1');
    expect(newProviderRow([row({ id: 'custom-1' }), row({ id: 'custom-2' })]).id).toBe('custom-3');
    // custom-2 was deleted; the next row must not step into its place.
    expect(newProviderRow([row({ id: 'custom-3' })]).id).toBe('custom-4');
    // The migrated singleton carries a non-numbered id and must not confuse it.
    expect(newProviderRow([row({ id: CUSTOM_PROVIDER })]).id).toBe('custom-1');
  });
});

/**
 * A key is filed under its provider's id, and main never hands a sealed one
 * back — so an id that does not carry over is a credential the person has to
 * find again. This is the one migration step that cannot be repaired by hand.
 */
describe('a setup made before the table existed', () => {
  it('keeps the id its key is filed under', async () => {
    const { migrateLegacyCustomProvider } = await import('@/agent/userProviders');
    useSettings.setState({
      values: {
        'agents.customProtocol': 'anthropic',
        'agents.customBaseUrl': 'https://gateway.example/anthropic',
        'agents.customModels': 'some-model',
        'agents.customVision': true,
      },
    });
    migrateLegacyCustomProvider();
    syncUserProviders();

    const def = agentProvider(CUSTOM_PROVIDER);
    expect(def).toBeDefined();
    expect([def?.protocol, def?.baseUrl, def?.vision]).toEqual([
      'anthropic', 'https://gateway.example/anthropic', true,
    ]);
    expect(def?.models).toEqual(['some-model']);
    // And the shape it replaced is gone from the file rather than left to be
    // puzzled over by whoever opens it next.
    expect(useSettings.getState().values['agents.customBaseUrl']).toBeUndefined();
  });

  it('leaves a table the person has already emptied alone', async () => {
    const { migrateLegacyCustomProvider } = await import('@/agent/userProviders');
    useSettings.setState({
      values: {
        [AGENT_PROVIDERS_SETTING]: [],
        'agents.customBaseUrl': 'https://gateway.example/anthropic',
      },
    });
    migrateLegacyCustomProvider();
    expect(useSettings.getState().getValue(AGENT_PROVIDERS_SETTING)).toEqual([]);
  });
});
