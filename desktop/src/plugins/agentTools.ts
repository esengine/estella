// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    agentTools.ts
 * @brief   Tools a plugin lends to the built-in agent.
 *
 * A plugin already extends what a PERSON can do here — a command, a panel, a
 * viewport tool. This is the same extension aimed at the other operator: the
 * agent's whole vocabulary is the tool catalog, so a plugin that adds a
 * capability the agent cannot name has added it for half the editor.
 *
 * The handler stays in this window, because that is where the plugin lives. All
 * that crosses to main is what a session needs in order to DESCRIBE the tool to
 * a model — name, description, schema, effect — and the kernel dispatches every
 * one of them back through a single door on the editor surface rather than
 * inventing a transport per plugin.
 *
 * The effect a plugin declares is taken at its word, and that is not a gap: a
 * plugin runs in this renderer with the whole editor surface in reach, so it
 * could do the same work through a command without declaring anything. The
 * boundary is the trust prompt at install, not this field. What the field buys
 * is the CONFIRM GATE working correctly for an honest plugin.
 */
import { ContributionRegistry, type Owner, type Disposable } from '@/contrib/ContributionRegistry';
import type { AgentToolContribution } from './types';

/** The registry keys by `id`; a tool's id IS its name — the model addresses it
 *  by that and nothing else, so a second identifier could only disagree. */
type RegisteredTool = AgentToolContribution & { id: string };

const registry = new ContributionRegistry<RegisteredTool>('agent tool');

/**
 * Why this tool cannot be offered, or null.
 *
 * The name has to be namespaced with the plugin's id for the reason every other
 * contribution point says so — but here it also stops a plugin from being able
 * to define `delete_entity`, which a model would then call believing it knows
 * what it does.
 */
export function agentToolProblem(pluginId: string, tool: AgentToolContribution): string | null {
    if (!tool.name) return 'an agent tool needs a `name`';
    if (!tool.name.startsWith(`${pluginId}.`)) {
        return `\`name\` must start with "${pluginId}." — an un-namespaced tool can shadow a built-in one`;
    }
    // The model addresses tools by name on the wire; the API's own constraint.
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(tool.name)) {
        return '`name` may contain only letters, digits, `_`, `.` and `-`';
    }
    if (!tool.description) {
        return 'an agent tool needs a `description` — it is the only thing the model reads to decide whether to call it';
    }
    if (typeof tool.run !== 'function') return 'an agent tool needs a `run(input)`';
    return null;
}

export const registerAgentTool = (tool: AgentToolContribution, owner: Owner): Disposable =>
    registry.register(owner, { ...tool, id: tool.name });

/** Everything contributed, in registration order. */
export const agentToolContributions = (): AgentToolContribution[] => [...registry.all()];

export const subscribeAgentTools = (fn: () => void): (() => void) => registry.subscribe(fn);

/** Run one by name. The door `window.__estellaEditor.runPluginTool` opens. */
export async function runContributedTool(name: string, input: unknown): Promise<unknown> {
    const tool = registry.all().find((t) => t.name === name);
    // Named, because the alternative is a model retrying a tool that will never
    // exist: the plugin that offered it was unloaded mid-conversation.
    if (!tool) throw new Error(`no such plugin tool: ${name} (was its plugin unloaded?)`);
    return tool.run(input);
}

/**
 * Tell main what is on offer, as metadata only.
 *
 * Pushed on every change rather than asked for: main reads the list when it
 * builds a session, which is synchronous, and a round trip cannot happen there.
 */
export function publishAgentTools(): void {
    void window.estella?.agent?.setTools(
        agentToolContributions().map((t) => ({
            name: t.name,
            description: t.description,
            schema: t.schema ?? { type: 'object' },
            effect: t.effect ?? 'read',
        })),
    );
}
