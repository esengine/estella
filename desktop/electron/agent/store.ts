// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    store.ts
 * @brief   Agent conversations on disk, under `<root>/.esengine/agent/`.
 *
 * A conversation used to live only in main's memory: quitting the editor threw
 * away everything that had been said, and there was no way back to yesterday's
 * work. It is project-local for the same reason autosave is — what was asked and
 * what it did are about THIS project — and it sits beside the other things in
 * `.esengine`, which is a build artifact directory nobody commits.
 *
 * TWO THINGS ARE SAVED, and the difference matters. The EVENT STREAM is what the
 * window replays to draw the transcript. The MEMORY is what the model needs to
 * carry on, in the provider's own format. Saving only the first would give you a
 * conversation you can read and cannot continue — the transcript would say the
 * agent knows what you discussed, and it would not.
 *
 * Screenshots are dropped on the way to disk. A frame the agent looked at is
 * hundreds of kilobytes of base64, and a run with a few of them would dominate
 * the file; what it SAW is worth much less afterwards than what it did, which
 * the tool result already says. The row keeps its result and loses its picture.
 */
import { writeFile, readFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_DIR } from '../../../pipeline/src/project/format';
import type { AgentEvent } from './types';

const AGENT_SUBDIR = 'agent';
const FORMAT = 1;

/** One conversation as it sits on disk. */
export interface StoredConversation {
  v: number;
  id: string;
  startedAt: number;
  updatedAt: number;
  /** What was asked first — the conversation's name in a list. */
  title: string;
  /**
   * Which model and endpoint this memory was produced by. A memory belongs to
   * its author: reasoning blocks go back to the model that wrote them. Resuming
   * under a different one is refused rather than attempted.
   */
  model: string;
  endpoint: string;
  events: AgentEvent[];
  /** Opaque provider state — see AgentSession.serialize. */
  memory: unknown;
}

/** A conversation without its contents, for listing. */
export type ConversationSummary = Pick<
  StoredConversation, 'id' | 'startedAt' | 'updatedAt' | 'title' | 'model'
> & { turns: number };

const dirFor = (root: string): string => path.join(root, WORKSPACE_DIR, AGENT_SUBDIR);
const fileFor = (root: string, id: string): string => path.join(dirFor(root), `${id}.json`);

/** Ids are ours, but they name a file — so anything that could leave the
 *  directory is refused rather than sanitised into something else's path. */
const isSafeId = (id: string): boolean => /^[A-Za-z0-9_-]{1,64}$/.test(id);

/**
 * The event stream as it should be kept: without the frames.
 *
 * `image` is the only field that carries bulk, and it is on tool_end, whose
 * `summary` already says what the call answered.
 */
function withoutImages(events: readonly AgentEvent[]): AgentEvent[] {
  return events.map((e) => {
    if (e.type !== 'tool_end' || !e.image) return e;
    const { image, ...rest } = e;
    void image;
    return rest as AgentEvent;
  });
}

/** The first thing the person asked, clipped to something a list can show. */
function titleOf(events: readonly AgentEvent[]): string {
  for (const e of events) {
    if (e.type === 'turn_start' && e.prompt.trim()) {
      const one = e.prompt.trim().replace(/\s+/g, ' ');
      return one.length > 80 ? `${one.slice(0, 79)}…` : one;
    }
  }
  return '';
}

const countTurns = (events: readonly AgentEvent[]): number =>
  events.reduce((n, e) => n + (e.type === 'turn_start' ? 1 : 0), 0);

/** Write a conversation, replacing whatever was under that id. */
export async function saveConversation(
  root: string,
  conversation: Omit<StoredConversation, 'v' | 'title' | 'updatedAt' | 'events'>
    & { events: readonly AgentEvent[] },
): Promise<void> {
  if (!isSafeId(conversation.id)) return;
  const stored: StoredConversation = {
    ...conversation,
    v: FORMAT,
    title: titleOf(conversation.events),
    updatedAt: Date.now(),
    events: withoutImages(conversation.events),
  };
  await mkdir(dirFor(root), { recursive: true });
  await writeFile(fileFor(root, conversation.id), `${JSON.stringify(stored)}\n`, 'utf8');
}

/** One conversation in full, or null when it is absent or unreadable. */
export async function loadConversation(
  root: string,
  id: string,
): Promise<StoredConversation | null> {
  if (!isSafeId(id)) return null;
  try {
    const parsed = JSON.parse(await readFile(fileFor(root, id), 'utf8')) as StoredConversation;
    // A file written by a newer editor is not something this one can read
    // halfway: refusing leaves it intact for the editor that can.
    return parsed?.v === FORMAT ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Every conversation this project has, newest first.
 *
 * Reads each file to summarise it. That is fine at this scale — a project
 * accumulates conversations at human speed — and it keeps the directory itself
 * the index, so a file deleted by hand is simply gone rather than a dangling row.
 */
export async function listConversations(root: string): Promise<ConversationSummary[]> {
  let names: string[];
  try {
    names = await readdir(dirFor(root));
  } catch {
    return [];
  }
  const out: ConversationSummary[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const stored = await loadConversation(root, name.slice(0, -5));
    if (!stored) continue;
    out.push({
      id: stored.id,
      startedAt: stored.startedAt,
      updatedAt: stored.updatedAt,
      title: stored.title,
      model: stored.model,
      turns: countTurns(stored.events),
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Forget one. Missing is success — the caller wanted it gone. */
export async function deleteConversation(root: string, id: string): Promise<void> {
  if (!isSafeId(id)) return;
  await rm(fileFor(root, id), { force: true });
}

/** Whether this project has any saved conversation at all. */
export async function hasConversations(root: string): Promise<boolean> {
  try {
    return (await stat(dirFor(root))).isDirectory() && (await readdir(dirFor(root))).length > 0;
  } catch {
    return false;
  }
}
