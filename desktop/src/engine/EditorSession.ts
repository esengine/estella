// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { SceneModel, SceneModelImpl } from './SceneModel';
import { EditorHistory, EditorHistoryImpl } from './EditorHistory';
import { SceneStore, SceneStoreImpl } from './SceneStore';
import { Reconciler, ReconcilerImpl } from './Reconciler';
import { SceneCommands, SceneCommandsImpl } from './SceneCommands';
import { SceneQuery, SceneQueryImpl } from './SceneQuery';
import { useSelection, createSelectionStore, type SelectionStore } from '@/store/selectionStore';
import { EditorControlSurfaceImpl } from './EditorControlSurface';

/**
 * The single editor boundary. One instance owns
 * the whole editor-state graph — {model, history, store (reactivity), reconciler
 * (model→World), selection, commands, query} — and exposes one façade
 * ({@link EditorControlSurface}) for the UI, the headless host, and the MCP server.
 *
 * Wiring is explicit (constructor injection), not implicit global coupling, so a
 * session is instantiable in isolation: {@link EditorSession.create} builds a
 * fresh, independent graph for a headless host, the MCP server, or a test —
 * without touching the app's default-session singletons.
 *
 * The engine (wasm module / WebGL canvas / one World) is process-level and shared
 * via EngineHost; genuine multi-World sessions await the engine-instancing pillar.
 */
export class EditorSession {
  readonly model: SceneModelImpl;
  readonly history: EditorHistoryImpl;
  readonly store: SceneStoreImpl;
  readonly reconciler: ReconcilerImpl;
  readonly selection: SelectionStore;
  readonly commands: SceneCommandsImpl;
  readonly query: SceneQueryImpl;
  readonly surface: EditorControlSurfaceImpl;

  private constructor(parts: {
    model: SceneModelImpl;
    history: EditorHistoryImpl;
    store: SceneStoreImpl;
    reconciler: ReconcilerImpl;
    selection: SelectionStore;
    commands: SceneCommandsImpl;
    query: SceneQueryImpl;
    surface?: EditorControlSurfaceImpl;
  }) {
    this.model = parts.model;
    this.history = parts.history;
    this.store = parts.store;
    this.reconciler = parts.reconciler;
    this.selection = parts.selection;
    this.commands = parts.commands;
    this.query = parts.query;
    this.surface = parts.surface ?? new EditorControlSurfaceImpl(this);
    // Wire reactivity + projection to this session's model (idempotent — the
    // default session's parts may already be wired by EngineHost boot).
    this.store.install();
    this.reconciler.attach();
  }

  /**
   * Build an isolated session: a fresh model/history/store/reconciler/selection/
   * commands/query graph, independent of the app's default-session singletons.
   * The reconciler still projects to the process-level EngineHost World.
   */
  static create(): EditorSession {
    const model = new SceneModelImpl();
    const history = new EditorHistoryImpl();
    const store = new SceneStoreImpl(model);
    const reconciler = new ReconcilerImpl(model);
    const selection = createSelectionStore(model);
    const commands = new SceneCommandsImpl(model, history);
    const query = new SceneQueryImpl(model, store);
    return new EditorSession({ model, history, store, reconciler, selection, commands, query });
  }

  /** Tear down this session's reconciler subscription (for a disposed session). */
  dispose(): void {
    this.reconciler.detach();
  }

  /** The app's default session — wraps the engine-layer singletons. */
  static readonly default = new EditorSession({
    model: SceneModel,
    history: EditorHistory,
    store: SceneStore,
    reconciler: Reconciler,
    selection: useSelection,
    commands: SceneCommands,
    query: SceneQuery,
  });
}

/** The app's default editor session (the one the UI drives). */
export const defaultSession = EditorSession.default;

/** The app's default-session control surface — the ONE programmatic boundary for
 *  the UI, the headless host, and the MCP server. */
export const EditorControlSurface = defaultSession.surface;
export type { EditorControlSurfaceT } from './EditorControlSurface';
