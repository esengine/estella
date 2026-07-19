// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Autosave.ts
 * @brief   Periodic crash-recovery snapshotter for the open project.
 *
 * The editor has no periodic save. It DOES have crash minidump + a render-gone
 * reload — but after either, a session's unsaved edits are gone. This service
 * closes that gap: every {@link AUTOSAVE_INTERVAL_MS} it serializes each dirty
 * document (through the DirtyRegistry's snapshot feed — a snapshot never marks a
 * document saved) into `<project>/.esengine/autosave/`. On project open,
 * {@link Autosave.recover} offers to restore any snapshot newer than its saved
 * file. A real save post-dates its snapshot, so it stops being offered.
 */
import { DirtyRegistry, type DocSnapshot } from './DirtyRegistry';
import { useEditorStore } from '@/store/editorStore';
import { confirm } from '@/components/confirm';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

export const AUTOSAVE_INTERVAL_MS = 60_000;

/** The service's collaborators, injectable so the scheduler is testable without
 *  the fs bridge, real timers, or a live DirtyRegistry. */
export interface AutosaveEnv {
  isDirty(): boolean;
  isPlaying(): boolean;
  snapshotDirty(): Promise<DocSnapshot[]>;
  sync(entries: DocSnapshot[]): Promise<void>;
  clear(): Promise<void>;
}

export class AutosaveService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private wasDirty = false;

  constructor(
    protected readonly env: AutosaveEnv,
    private readonly intervalMs: number = AUTOSAVE_INTERVAL_MS,
  ) {}

  /**
   * The snapshot gate: unsaved changes AND no Play session. A Play session runs
   * in an isolated realm that never mutates the edit model, so there is nothing
   * new to snapshot while it's active — and we don't want to compete with it.
   */
  shouldSnapshot(): boolean {
    return this.env.isDirty() && !this.env.isPlaying();
  }

  /** One scheduler cycle: snapshot the dirty documents when the gate allows. */
  async tick(): Promise<void> {
    if (this.busy || !this.shouldSnapshot()) return;
    this.busy = true;
    try {
      await this.env.sync(await this.env.snapshotDirty());
    } catch (e) {
      console.warn('[autosave] snapshot failed', e);
    } finally {
      this.busy = false;
    }
  }

  /**
   * React to an aggregate dirty-state change: when everything just became saved,
   * drop the recovery snapshots at once rather than waiting for the next interval
   * to prune them — "clear a document's snapshot after its next real save".
   */
  noteDirtyChanged(): void {
    const dirty = this.env.isDirty();
    if (this.wasDirty && !dirty) void this.env.clear();
    this.wasDirty = dirty;
  }

  start(): void {
    if (this.timer) return;
    this.wasDirty = this.env.isDirty();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }
}

type AutosaveBridge = NonNullable<Window['estella']>['autosave'];

function autosaveBridge(): AutosaveBridge | undefined {
  return (globalThis as { window?: Window }).window?.estella?.autosave;
}

const realEnv: AutosaveEnv = {
  isDirty: () => DirtyRegistry.isDirty(),
  isPlaying: () => useEditorStore.getState().isPlaying,
  snapshotDirty: () => DirtyRegistry.snapshotAll(),
  sync: async (entries) => {
    await autosaveBridge()?.sync(entries.map((e) => ({ rel: e.path, contents: e.contents })));
  },
  clear: async () => {
    await autosaveBridge()?.clear();
  },
};

/** The wired singleton: real env + DirtyRegistry change feed + the open-time
 *  recovery prompt. */
class AutosaveWiring extends AutosaveService {
  private unsub: (() => void) | null = null;

  start(): void {
    super.start();
    this.unsub ??= DirtyRegistry.subscribe(() => this.noteDirtyChanged());
  }

  stop(): void {
    super.stop();
    this.unsub?.();
    this.unsub = null;
  }

  /**
   * Offer to recover any snapshot newer than its saved file (a prior session
   * crashed / was reloaded with unsaved edits). Restore copies the snapshots over
   * their real files and reloads the open scene; discard drops them. Runs once
   * per project open, after the shell (hence the confirm host) is mounted.
   */
  async recover(): Promise<'restored' | 'discarded' | 'none'> {
    const bridge = autosaveBridge();
    if (!bridge) return 'none';
    let entries: Awaited<ReturnType<AutosaveBridge['list']>>;
    try {
      entries = await bridge.list();
    } catch {
      return 'none';
    }
    if (entries.length === 0) return 'none';

    const restore = await confirm({
      title: t('autosave.recoverTitle'),
      body: t('autosave.recoverBody', { count: entries.length }),
      confirmLabel: t('autosave.recoverConfirm'),
    });
    if (restore) {
      await bridge.restore(entries.map((e) => e.rel));
      const { ProjectStore } = await import('@/project/ProjectStore');
      await ProjectStore.loadCurrentScene();
      Toasts.push(t('autosave.recovered', { count: entries.length }), 'success');
      return 'restored';
    }
    await bridge.clear();
    return 'discarded';
  }
}

export const Autosave = new AutosaveWiring(realEnv);
