// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The palette's one branch: type a command, get a command; type a
 *        sentence, the first row becomes "hand it to the agent".
 *
 *        Worth pinning because the failure is silent in one direction. Too
 *        eager, and `save scene` gets narrated at a model instead of saving the
 *        scene — which is why the offer and the DEFAULT are separate decisions,
 *        and only the second one is strict.
 */
import { describe, it, expect } from 'vitest';
import { readsAsSentence, filterPalette } from '@/commands/palette';

describe('when a query reads as a sentence', () => {
  it('takes a space as the signal, since command names have none', () => {
    expect(readsAsSentence('add a pause menu for the player')).toBe(true);
    expect(readsAsSentence('why is nothing showing')).toBe(true);
  });

  // CJK needs no spaces to be a sentence, so the space test alone would never
  // offer the agent to a Chinese user.
  it('takes CJK as the same signal', () => {
    expect(readsAsSentence('给玩家加一个暂停菜单')).toBe(true);
    expect(readsAsSentence('这个场景为什么不显示')).toBe(true);
  });

  it('leaves single command-shaped words alone', () => {
    expect(readsAsSentence('settings')).toBe(false);
    expect(readsAsSentence('undo')).toBe(false);
    expect(readsAsSentence('')).toBe(false);
  });

  // A half-typed word is not a request.
  it('ignores anything too short to be one', () => {
    expect(readsAsSentence('ui ')).toBe(false);
    expect(readsAsSentence('a b')).toBe(false);
    expect(readsAsSentence('新建')).toBe(false);
  });
});

// The offer is generous; the DEFAULT is where the command has to win, and that
// is decided by whether anything matched — so pin the pairing, not just the flag.
describe('what Enter does', () => {
  const COMMANDS = [
    { label: 'Save Scene', category: 'File' },
    { label: 'Toggle Grid', category: 'View' },
  ];
  const wouldHandOff = (query: string) =>
    readsAsSentence(query) && filterPalette(COMMANDS, query).length === 0;

  it('runs the command when the sentence is also a command', () => {
    expect(readsAsSentence('save scene')).toBe(true); // still offered…
    expect(wouldHandOff('save scene')).toBe(false); // …but Enter saves the scene
  });

  it('hands over when nothing in the registry matches', () => {
    expect(wouldHandOff('给玩家加一个暂停菜单')).toBe(true);
    expect(wouldHandOff('add a pause menu for the player')).toBe(true);
  });
});
