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
   * Whether a rendered frame can reach this endpoint's models at all.
   *
   * DECLARED, never inferred. It was inferred once — "no baseUrl, therefore the
   * vendor's own API, therefore it can see" — which is only a statement about
   * the address, and it made every gateway blind with no way to say otherwise.
   *
   * Per provider rather than per model, for {@link contextWindow}'s reason: a
   * table with a row per model goes stale a model at a time. Absent means NO,
   * deliberately — the two mistakes are not symmetrical. Claiming sight an
   * endpoint lacks spends the turn on a request it refuses; withholding it costs
   * `screenshot`'s coarse text grid instead of a picture, which still answers
   * "did anything draw at all".
   */
  vision?: boolean;
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
  /**
   * Send the reasoning-depth parameter with each request.
   *
   * Only the OpenAI protocol carries it as a named argument (`reasoning_effort`),
   * and an endpoint that has never heard of one refuses the whole request rather
   * than ignoring the field — so for a gateway this has to be a switch, not an
   * assumption. Absent means yes, which is right for every endpoint that
   * implements the parameter and is the behaviour that predates the field.
   */
  reasoningEffort?: boolean;
  /**
   * This def came from the person's own table rather than from this file.
   *
   * Every OTHER field means the same thing whichever way it arrived — that is
   * the point of projecting the table into this registry instead of keeping it
   * beside it. This one exists so a reader that must not offer to edit a shipped
   * provider can tell the two apart.
   */
  userDefined?: boolean;
}

export { DEFAULT_CONTEXT_WINDOW } from '@/settings/agentIds';

/** The id a provider's key is stored under (electron/secrets.ts). */
export const agentKeyId = (providerId: string): string => `agents.key.${providerId}`;

/**
 * The id the ONE custom provider had, back when there could only be one.
 *
 * Kept because a key is filed under its provider's id: the row that setup
 * becomes on upgrade has to carry this id, or the credential already sealed on
 * the machine belongs to a provider that no longer exists (agent/userProviders.ts).
 */
export const CUSTOM_PROVIDER = 'custom';

/** Who owns the providers the person typed — see {@link setUserProviders}. */
export const USER_OWNER = 'user';

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
    vision: true,
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
    // Its models are typed, so this is a claim about the ENDPOINT: it carries
    // image parts. A text-only model named into that box is the same staleness
    // `contextWindow` accepts, and it degrades the same way — the model is told
    // a picture it cannot see was attached.
    vision: true,
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

/**
 * Replace the set of providers the person defined themselves.
 *
 * They arrive as a SET rather than one at a time because that is how they are
 * edited — a table, rewritten whole on each keystroke — and because the removals
 * matter as much as the additions: a provider deleted from the table must stop
 * being offered in the picker, and dispose-then-register is the only way to say
 * that without diffing. Everything downstream reads them through the same door
 * as the shipped ones; nothing but this function knows they were typed.
 *
 * Kept here, taking finished defs, so this module stays free of the settings
 * store — the projection from one to the other lives in agent/userProviders.ts.
 */
export function setUserProviders(defs: readonly AgentProviderDef[]): void {
  registry.disposeOwner(USER_OWNER);
  registry.registerAll(USER_OWNER, defs.map((d) => ({ ...d, userDefined: true })));
}

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
