// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  toolRegistry.ts
 * @brief Contributed viewport tools — the third tool family beside the built-in
 *        transform and tile tools, and the only one that is open-ended.
 *
 * A contributed tool IS an {@link EditorTool}: it takes a stroke by returning true
 * from onPointerDown and owns the stroke's move/up, exactly like the built-ins, so
 * the Viewport stays a router with no idea a plugin is involved.
 *
 * Activation is EXCLUSIVE and lives here rather than in a store of its own: at most
 * one contributed tool is armed, and arming one is what makes it beat the built-in
 * resolution. Keeping the active id next to the registry means retracting a tool
 * (plugin unload) can disarm it in the same place — a dangling active id would send
 * strokes to a tool that no longer exists.
 */
import { ContributionRegistry, type Disposable, type Owner } from '@/contrib/ContributionRegistry';
import type { EditorTool } from './EditorTool';

export interface ToolContribution extends EditorTool {
  /** Namespaced id, e.g. `acme.measure`. Also the activation command's id. */
  readonly id: string;
  /** Shown in the viewport toolbar / palette row for the tool. */
  readonly title: string;
  /** Restrict to these editor modes (omitted ⇒ every mode). */
  readonly modes?: readonly string[];
}

const contrib = new ContributionRegistry<ToolContribution>('viewport tool');
const listeners = new Set<() => void>();
let activeId: string | null = null;

const changed = (): void => {
  for (const fn of listeners) fn();
};

export const toolRegistry = {
  register(owner: Owner, tool: ToolContribution): Disposable {
    const handle = contrib.register(owner, tool);
    changed();
    return {
      dispose: () => {
        // Disarm before retracting, so no stroke can route to a gone tool.
        if (activeId === tool.id) activeId = null;
        handle.dispose();
        changed();
      },
    };
  },

  disposeOwner(owner: Owner): void {
    for (const tool of contrib.byOwner(owner)) if (activeId === tool.id) activeId = null;
    contrib.disposeOwner(owner);
    changed();
  },

  all(): readonly ToolContribution[] {
    return contrib.all();
  },

  get(id: string): ToolContribution | undefined {
    return contrib.get(id);
  },

  /** Arm a contributed tool (null disarms). Unknown ids are ignored. */
  activate(id: string | null): void {
    if (id !== null && !contrib.get(id)) return;
    activeId = id;
    changed();
  },

  activeId(): string | null {
    return activeId;
  },

  /** The armed tool, if it's allowed in `mode`. */
  activeFor(mode: string): ToolContribution | undefined {
    if (activeId === null) return undefined;
    const tool = contrib.get(activeId);
    if (!tool) return undefined;
    return !tool.modes || tool.modes.includes(mode) ? tool : undefined;
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    const off = contrib.subscribe(fn);
    return () => {
      listeners.delete(fn);
      off();
    };
  },
};
