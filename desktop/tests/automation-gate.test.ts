// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  When the uncurated automation hook may be published. The regression
 *        this exists for: the endpoint can be opened by a SETTING, long after
 *        the window loaded and with no launch flag in its URL, and the hook has
 *        to appear then too — a listening endpoint against a window that never
 *        published it answers every tool call with a TypeError.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { guardAutomationHook } from '@/engine/automationGate';

describe('the automation hook gate', () => {
  let publish: ReturnType<typeof vi.fn>;
  let retract: ReturnType<typeof vi.fn>;
  let listeners: Array<() => void>;
  let running: boolean;
  let launchFlag: boolean;
  let driving: boolean;

  /** Stands in for McpStore / AgentStore: notify, and the gate re-reads. */
  const subscribe = (fn: () => void) => {
    listeners.push(fn);
    return () => { listeners = listeners.filter((l) => l !== fn); };
  };
  const notify = () => listeners.forEach((l) => l());
  const guard = () => guardAutomationHook(
    () => launchFlag || running || driving, subscribe, publish, retract,
  );

  beforeEach(() => {
    publish = vi.fn();
    retract = vi.fn();
    listeners = [];
    running = false;
    launchFlag = false;
    driving = false;
  });

  it('publishes nothing for an ordinary editor', () => {
    guard();
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes at once when the window was launched for automation', () => {
    launchFlag = true;
    guard();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('publishes when the SETTING opens the endpoint later', () => {
    guard();
    expect(publish).not.toHaveBeenCalled();
    running = true;
    notify();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('publishes when the endpoint is already up before the gate runs', () => {
    // A boot replay of the setting can land before this module evaluates; the
    // gate reads the current answer rather than waiting for the next change.
    running = true;
    guard();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('retracts the hook when the user revokes permission', () => {
    running = true;
    guard();
    running = false;
    notify();
    expect(retract).toHaveBeenCalledTimes(1);
  });

  it('keeps the launch-flag hook published even with no endpoint', () => {
    // Shot mode drives the hook directly and never opens an endpoint at all.
    launchFlag = true;
    guard();
    notify();
    expect(retract).not.toHaveBeenCalled();
  });

  it('acts on transitions only, so a status bump never rebuilds it mid-call', () => {
    running = true;
    guard();
    notify();
    notify();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(retract).not.toHaveBeenCalled();
  });

  // The built-in agent reaches this window through the same hook. A conversation
  // that cannot see it is an agent whose every tool call fails with a TypeError —
  // the exact regression this file exists for, arriving by a third door.
  it('publishes for the built-in agent, with no endpoint listening', () => {
    guard();
    driving = true;
    notify();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('keeps the hook while EITHER a client or the built-in agent is driving', () => {
    running = true;
    guard();
    driving = true;
    notify();
    running = false; // the setting went off mid-conversation
    notify();
    expect(retract).not.toHaveBeenCalled();

    driving = false;
    notify();
    expect(retract).toHaveBeenCalledTimes(1);
  });

  it('stops watching when the realm is torn down', () => {
    const stop = guard();
    stop();
    running = true;
    notify();
    expect(publish).not.toHaveBeenCalled();
  });
});
