// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  playEdits.ts — what a person changed while the game was running.
 *
 * A play session's edits are thrown away at Stop, which is the right default and
 * a famous way to lose an afternoon of tuning. The scene document is never
 * destroyed here, so the work does not have to be: this remembers what was
 * touched and offers it back.
 *
 * It records the WRITES, not a diff of the world. A diff cannot tell a value a
 * person dragged from one a system writes every frame — a bobbing sprite's y
 * changes constantly and nobody asked for it — so the only honest source is the
 * op layer every deliberate edit already passes through.
 *
 * What is recorded is the ADDRESS, not the value: the value is read from the
 * running world at Stop, so keeping an edit keeps what is on screen when you
 * press it rather than an intermediate frame of a drag.
 */
import type { EntityId } from '@/types';
import { PlayRealm } from './PlayRealm';
import { PlayInspect } from './PlayInspect';
import { SceneCommands } from './SceneCommands';
import { SceneModel } from './SceneModel';
import { refKey, srcIdOf, type EntityRef } from './entityRef';
import { Toasts } from '@/store/Toasts';
import { LogStore } from '@/store/LogStore';
import { t } from '@/i18n';

/** One thing a person aimed at: a component field, or the entity's visibility. */
interface Touch {
  ref: EntityRef;
  /** null = the editor's show/hide bit rather than a component field. */
  field: { comp: string; key: string } | null;
}

/** A touched address resolved against the running world — ready to write back. */
export interface PendingEdit {
  /** The document row it lands on. */
  src: EntityId;
  /** "Sprite0 · Transform.position" — what the offer lists. */
  label: string;
  /** The value as the running world holds it, rendered for the log. */
  shown: string;
  apply: () => void;
}

/** What a harvest found, including what it could not offer. */
export interface HarvestResult {
  edits: PendingEdit[];
  /** Edits to entities the game spawned — no document row to keep them on. */
  spawned: number;
}

const addressOf = (t: Touch): string =>
  `${refKey(t.ref)}|${t.field ? `${t.field.comp}.${t.field.key}` : ':visible'}`;

/** A model value as a short human string — the log line, not a round-trip. */
function show(value: unknown): string {
  if (value == null) return String(value);
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
  if (typeof value !== 'object') return String(value);
  const obj = value as Record<string, unknown>;
  const parts = Object.keys(obj)
    .filter((k) => typeof obj[k] === 'number')
    .map((k) => `${k} ${show(obj[k])}`);
  return parts.length ? parts.join(', ') : JSON.stringify(value);
}

class PlayEditsImpl {
  private touched = new Map<string, Touch>();

  /** Forget everything (a fresh play session starts owing nothing). */
  clear(): void {
    this.touched.clear();
  }

  count(): number {
    return this.touched.size;
  }

  /** A component field was written on the running entity. */
  record(ref: EntityRef, comp: string, key: string): void {
    const touch: Touch = { ref, field: { comp, key } };
    this.touched.set(addressOf(touch), touch);
  }

  /** The running entity was shown or hidden. */
  recordVisibility(ref: EntityRef): void {
    const touch: Touch = { ref, field: null };
    this.touched.set(addressOf(touch), touch);
  }

  /**
   * Read the current value of everything touched, while the realm is still up.
   * Call before tearing it down — afterwards there is nothing left to ask.
   */
  async harvest(): Promise<HarvestResult> {
    const touches = [...this.touched.values()];
    if (touches.length === 0) return { edits: [], spawned: 0 };

    const keepable = touches.filter((t) => srcIdOf(t.ref) != null);
    const spawned = touches.length - keepable.length;

    // Resolve identity BEFORE the first await: the mapping belongs to a live
    // session, and the teardown this runs alongside is entitled to drop it.
    const liveOf = new Map(keepable.map((t) => [t, PlayInspect.liveIdOf(t.ref)] as const));
    // One tree sample answers every visibility touch; component data has to be
    // asked for per entity, so ask once per entity rather than once per field.
    const wantsTree = keepable.some((t) => t.field === null);
    const liveIds = [...new Set([...liveOf.values()].filter((id): id is EntityId => id != null))];
    const [tree, ...details] = await Promise.all([
      wantsTree ? PlayRealm.snapshot(null, { tree: true }).then((s) => s?.tree ?? null) : Promise.resolve(null),
      ...liveIds.map((id) => PlayRealm.snapshot(id, { tree: false }).then((s) => s?.selected ?? null)),
    ]);
    const dataOf = new Map(liveIds.map((id, i) => [id, details[i]]));

    const edits: PendingEdit[] = [];
    for (const touch of keepable) {
      const src = srcIdOf(touch.ref)!;
      const live = liveOf.get(touch) ?? null;
      const name = SceneModel.entityBySource(src)?.name ?? `#${src}`;
      if (live == null) continue; // destroyed before Stop — nothing to read

      if (touch.field === null) {
        const row = tree?.entities.find((e) => e.id === live) as { hidden?: boolean } | undefined;
        if (!row) continue;
        const visible = !row.hidden;
        edits.push({
          src,
          label: `${name} · ${visible ? 'visible' : 'hidden'}`,
          shown: String(visible),
          apply: () => SceneCommands.setEntityVisible(src, visible),
        });
        continue;
      }

      const { comp, key } = touch.field;
      const data = dataOf.get(live)?.components.find((c) => c.type === comp)?.data as Record<string, unknown> | undefined;
      if (!data || !(key in data)) continue;
      const value = data[key];
      edits.push({
        src,
        label: `${name} · ${comp}.${key}`,
        shown: show(value),
        apply: () => SceneCommands.setFieldValue(src, comp, key, value),
      });
    }
    return { edits, spawned };
  }

  /** Write every kept edit to the document as ONE undo step. */
  applyAll(edits: readonly PendingEdit[], label: string): void {
    SceneCommands.transact(label, () => {
      for (const edit of edits) edit.apply();
    });
  }
}

export const PlayEdits = new PlayEditsImpl();

/**
 * Offer back whatever the play session changed. A sticky toast, not a dialog:
 * Stop must not wait on an answer, and a modal in an automated run is a hang.
 *
 * Resolves once the running world has been read — the caller tears the realm
 * down after that, not before.
 */
export async function offerToKeepPlayEdits(): Promise<void> {
  if (PlayEdits.count() === 0) return;
  const { edits, spawned } = await PlayEdits.harvest().catch(() => ({ edits: [], spawned: 0 }));
  PlayEdits.clear();
  if (spawned > 0) LogStore.push('info', 'Play', t('play.keep.spawnedDropped', { n: spawned }));
  if (edits.length === 0) return;

  for (const edit of edits) LogStore.push('info', 'Play', `${edit.label} = ${edit.shown}`);
  Toasts.push(
    t('play.keep.offer', { n: edits.length }),
    'info',
    0, // sticky: the answer is the user's, and it is not urgent
    {
      label: t('play.keep.action'),
      run: () => {
        PlayEdits.applyAll(edits, t('play.keep.undoLabel'));
        Toasts.push(t('play.keep.kept', { n: edits.length }), 'success');
      },
    },
  );
}
