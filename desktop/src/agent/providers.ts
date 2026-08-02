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

export interface AgentProviderDef {
  id: string;
  label: string;
  /**
   * Empty means the Anthropic API itself. Anything else is an
   * Anthropic-COMPATIBLE gateway, and its presence is what drops the request to
   * the core wire format (electron/agent/anthropic.ts).
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
  /** Filled in from settings rather than shipped — see {@link CUSTOM_PROVIDER}. */
  userDefined?: boolean;
}

export { DEFAULT_CONTEXT_WINDOW } from '@/settings/agentIds';

/** The id a provider's key is stored under (electron/secrets.ts). */
export const agentKeyId = (providerId: string): string => `agents.key.${providerId}`;

export const CUSTOM_PROVIDER = 'custom';

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
  // The escape hatch. Its endpoint and model list come from settings, because a
  // provider we have not heard of is exactly the one we cannot ship a list for.
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

/** Split the custom provider's model list — one per line or comma-separated,
 *  because a person pasting three model names should not have to guess which. */
export const parseModelList = (raw: string): string[] =>
  raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
