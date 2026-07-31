// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    McpStore.ts
 * @brief   The editor's MCP endpoint, as the UI sees it.
 *
 *          Main owns the endpoint itself (electron/mcpEndpoint.ts) — it holds the
 *          listener, the token and the discovery file. This is a read model of it:
 *          the settings row renders from here, and the setting's `effect` drives
 *          the toggle through it, so the two never disagree about whether an agent
 *          can currently attach.
 *
 *          A vanilla store, not a hook: the settings registry is plain data and its
 *          `status` hook is read outside React (SettingsDialog subscribes it to a
 *          row through useSyncExternalStore).
 */
import { createStore } from 'zustand/vanilla';
import type { McpEndpointStatus } from '../../electron/mcpEndpoint';

export type { McpEndpointStatus };

/** Before main has answered, "off" is the honest reading — nothing is listening
 *  that we know of, and the first refresh is one IPC round-trip away. */
const UNKNOWN: McpEndpointStatus = {
  running: false, port: null, discoveryFile: null, forced: false, error: null,
};

interface McpState {
  status: McpEndpointStatus;
}

const store = createStore<McpState>(() => ({ status: UNKNOWN }));

/** The endpoint's state as last read from main. */
export const mcpStatus = (): McpEndpointStatus => store.getState().status;

/** Re-render on any change (useSyncExternalStore / plain subscriber). */
export const subscribeMcp = (fn: () => void): (() => void) => store.subscribe(fn);

/** Ask main what the endpoint is doing and adopt the answer. */
export async function refreshMcpStatus(): Promise<McpEndpointStatus> {
  const status = await window.estella.mcp.status();
  store.setState({ status });
  return status;
}

/**
 * Open or close the endpoint. Resolves with the resulting status — including a
 * refused start, which comes back as `error` rather than a rejection, so a
 * settings toggle can report it without a try/catch around the whole effect.
 */
export async function setMcpEnabled(on: boolean): Promise<McpEndpointStatus> {
  const status = await window.estella.mcp.setEnabled(on);
  store.setState({ status });
  return status;
}
