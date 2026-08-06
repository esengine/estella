// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    providers.ts — who the built-in agent can talk to.
 *
 * The unit of CONFIGURATION is a provider; the unit of CHOICE is a model. A
 * provider's endpoint, dialect and model list are all knowable in advance, so
 * shipping them means nobody types a URL from memory — and on a gateway that
 * silently downgrades an unrecognised model name, a typo is not an error, it is
 * a quietly worse answer for the rest of the session.
 *
 * The editor already ships this kind of vendor knowledge for export targets
 * (project/platforms.ts), and this is the same shape: a registry, so a plugin
 * can add one without this file knowing it exists.
 *
 * Keys are per provider and all kept at once. Switching back to one you used
 * last week should not mean finding the key again — that is the whole point of
 * supporting more than one.
 */
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';

/**
 * Which wire format an endpoint speaks.
 *
 * Not a vendor and not a dialect: `anthropic` covers the Messages API and every
 * gateway implementing it, `openai` covers Chat Completions and the much larger
 * set that implements THAT. A provider that got this wrong would send a
 * perfectly formed request in the wrong shape, which reads as a 400 about a
 * field nobody wrote.
 */
export type AgentProtocol = 'anthropic' | 'openai';

export interface AgentProviderDef {
  id: string;
  label: string;
  /** The wire format. Absent means `anthropic` — what every def was before
   *  there was a second one. */
  protocol?: AgentProtocol;
  /**
   * Empty means the vendor's own API for that protocol. Anything else is a
   * compatible gateway; for `anthropic` its presence is also what drops the
   * request to the core wire format (electron/agent/anthropic.ts).
   */
  baseUrl: string;
  /** What this provider offers, best-first. */
  models: readonly string[];
  /**
   * How much the conversation may grow before it has to be compacted, in tokens.
   *
   * Per provider rather than per model because one vendor's line sits at one
   * order of magnitude, and a table with a row per model is a table that goes
   * stale a model at a time. Unlike a PRICE — which we deliberately do not ship,
   * because being wrong there means confidently showing someone the wrong amount
   * of money — being wrong here costs a compaction that was not needed yet.
   * Absent means {@link DEFAULT_CONTEXT_WINDOW}: conservative, because guessing
   * high is what makes a turn fail outright.
   */
  contextWindow?: number;
  /**
   * The model list is TYPED, not shipped.
   *
   * A vendor's address and protocol hold still; its model names do not. A list
   * here would be right until the next release and then quietly wrong — and a
   * wrong name is not an error, it is a gateway mapping it to something smaller
   * for the rest of the session. Everything else about the provider is still
   * shipped, including its key row.
   */
  typedModels?: boolean;
  /** Endpoint, protocol AND models all come from settings — see
   *  {@link CUSTOM_PROVIDER}, the one provider we cannot ship anything for. */
  userDefined?: boolean;
}

export { DEFAULT_CONTEXT_WINDOW } from '@/settings/agentIds';

/** The id a provider's key is stored under (electron/secrets.ts). */
export const agentKeyId = (providerId: string): string => `agents.key.${providerId}`;

export const CUSTOM_PROVIDER = 'custom';

/** A provider whose models the user types. Its list is per provider, so two of
 *  them do not share one box. */
export const modelsSettingId = (providerId: string): string => `agents.models.${providerId}`;

const registry = new ContributionRegistry<AgentProviderDef>('agent provider');

registry.registerAll('core', [
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: '',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    contextWindow: 200_000,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    contextWindow: 1_000_000,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: '',
    models: [],
    typedModels: true,
    contextWindow: 400_000,
  },
  // The escape hatch. Its endpoint, protocol and model list come from settings,
  // because a provider we have not heard of is exactly the one we cannot ship
  // a list for — and Chat Completions is what most of those speak.
  {
    id: CUSTOM_PROVIDER,
    label: '',
    baseUrl: '',
    models: [],
    userDefined: true,
  },
]);

export const agentProviders = (): AgentProviderDef[] => [...registry.all()];
export const agentProvider = (id: string): AgentProviderDef | undefined => registry.get(id);
export const subscribeProviders = (fn: () => void): (() => void) => registry.subscribe(fn);
/** Scalar snapshot for useSyncExternalStore — {@link agentProviders} hands back
 *  a fresh array each call, which as a snapshot re-renders forever. */
export const providersRevision = (): number => registry.getRevision();

/** Contribute a provider (a plugin's extension point). */
export const registerAgentProvider = (def: AgentProviderDef, owner: Owner = 'core'): Disposable =>
  registry.register(owner, def);

export const AGENT_PROTOCOLS: readonly AgentProtocol[] = ['openai', 'anthropic'];

/** What an endpoint speaks, defaulting to the format that predates the field. */
export const protocolOf = (def: AgentProviderDef | undefined): AgentProtocol =>
  def?.protocol ?? 'anthropic';

/** A stored value, narrowed — a settings file is one a person can edit, and an
 *  unknown protocol must not reach the wire. Chat Completions is the default
 *  for a custom endpoint because it is what most of them speak. */
export const asProtocol = (value: unknown): AgentProtocol =>
  (AGENT_PROTOCOLS as readonly string[]).includes(String(value)) ? (value as AgentProtocol) : 'openai';

/** Split the custom provider's model list — one per line or comma-separated,
 *  because a person pasting three model names should not have to guess which. */
export const parseModelList = (raw: string): string[] =>
  raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
