// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { OpenedProject, WorkspaceState, DirEntry, RecentEntry, TemplateEntry } from '../src/project/format';
import type { BuildScriptsResult } from './buildScripts';
import type { ExtractSchemasResult } from './extractSchemas';
import type { ScanAssetsResult } from './assetDb';
import type { CookResult } from './cookAssets';
import type { ExportGameResult } from './exportGame';
import type { PlayRealmResult } from './buildPlayRealm';

// The privileged bridge the renderer is allowed to touch. Keep this surface small
// and explicit — anything the editor needs from the OS or Node goes through here.
// `fs.*` paths are project-relative; main sandboxes them to the open project root.
const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getPlatform: (): Promise<NodeJS.Platform> => ipcRenderer.invoke('app:platform'),
  // Surfaces engine lifecycle in the main-process log (useful for headless checks).
  reportEngineStatus: (status: string): void => ipcRenderer.send('engine:status', status),

  // — App lifecycle: the unsaved-changes quit guard. The renderer pushes its dirty
  // state so main can prompt (Save / Don't Save / Cancel) on window close; on Save
  // main asks the renderer to save, which confirms back when done. —
  app: {
    setDirty: (dirty: boolean): void => ipcRenderer.send('app:dirty', dirty),
    /** Absolute path of a dropped OS File (Electron 32+ removed File.path). */
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
    /** Run `cb` (save the scene) when main requests a save-before-quit, then signal done. */
    onSaveBeforeQuit: (cb: () => Promise<void> | void): void => {
      ipcRenderer.removeAllListeners('app:saveBeforeQuit');
      ipcRenderer.on('app:saveBeforeQuit', () => {
        void Promise.resolve(cb()).finally(() => ipcRenderer.send('app:quitConfirmed'));
      });
    },
  },

  // — Project / workspace (RC12 §E7) —
  project: {
    /** Show a directory picker and open the chosen Estella project (null if cancelled). */
    openDialog: (): Promise<OpenedProject | null> => ipcRenderer.invoke('project:openDialog'),
    /** Open a project by absolute root path. */
    open: (root: string): Promise<OpenedProject> => ipcRenderer.invoke('project:open', root),
    /** Show a Save-As dialog; returns a project-relative scene path (null if cancelled). */
    saveSceneDialog: (defaultRel?: string): Promise<string | null> =>
      ipcRenderer.invoke('project:saveDialog', defaultRel),
    /** Copy a template into `<location>/<name>`; returns the new project root. */
    createFromTemplate: (templateDir: string, location: string, name: string): Promise<string> =>
      ipcRenderer.invoke('project:createFromTemplate', templateDir, location, name),
    /** Pick a folder (for the new-project location); returns an absolute path or null. */
    chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('project:chooseDirectory'),
    /** Bundle the open project's scripts (src/main.ts) for the isolated play realm. */
    buildScripts: (): Promise<BuildScriptsResult> => ipcRenderer.invoke('project:buildScripts'),
    /** Extract the project's component field schemas → .esengine/cache/schemas.json. */
    extractSchemas: (): Promise<ExtractSchemasResult> => ipcRenderer.invoke('project:extractSchemas'),
    /** Scan the project's .meta sidecars → the asset index (registry + dep graph). */
    scanAssets: (): Promise<ScanAssetsResult> => ipcRenderer.invoke('project:scanAssets'),
    /** Cook reachable assets for shipping → staged files + runtime manifest in `outDir`. */
    cookAssets: (outDir?: string): Promise<CookResult> => ipcRenderer.invoke('project:cookAssets', outDir),
    /** Export a runnable web build (play==ship) → self-contained `outDir` (default dist-game/). */
    exportGame: (opts?: { outDir?: string; minify?: boolean; sourcemap?: boolean; platform?: 'web' | 'desktop' | 'wechat' | 'playable' }): Promise<ExportGameResult> =>
      ipcRenderer.invoke('project:exportGame', opts),
    /** Subscribe to export build-log phases while a package runs. Returns unsubscribe. */
    onExportProgress: (cb: (p: { phase: string; detail?: string }) => void): (() => void) => {
      const listener = (_e: unknown, p: { phase: string; detail?: string }) => cb(p);
      ipcRenderer.on('project:exportProgress', listener);
      return () => ipcRenderer.removeListener('project:exportProgress', listener);
    },
    /** Stage the isolated play realm (host + SDK + wasm + project bundle) under
     *  `.esengine/play/`; returns the project-relative host page path. */
    preparePlayRealm: (): Promise<PlayRealmResult> => ipcRenderer.invoke('project:preparePlayRealm'),
    /** Show a file picker and import the chosen files into `destDir` (writes .meta);
     *  null if cancelled. */
    importAssets: (destDir: string): Promise<{ imported: string[]; skipped: string[] } | null> =>
      ipcRenderer.invoke('project:importAssets', destDir),
    /** Import already-resolved absolute paths (OS drag-drop) into `destDir`. */
    importFiles: (destDir: string, sources: string[]): Promise<{ imported: string[]; skipped: string[] } | null> =>
      ipcRenderer.invoke('project:importFiles', destDir, sources),
    /** Create a new asset file (+ .meta) from `content`; returns its project path. */
    createAsset: (destDir: string, baseName: string, content: string, type: string): Promise<string> =>
      ipcRenderer.invoke('project:createAsset', destDir, baseName, content, type),
  },
  // New-project templates (launcher New tab).
  templates: {
    list: (): Promise<TemplateEntry[]> => ipcRenderer.invoke('templates:list'),
  },
  // Filesystem, scoped to the open project root (paths are project-relative).
  fs: {
    read: (relPath: string): Promise<string> => ipcRenderer.invoke('fs:read', relPath),
    write: (relPath: string, contents: string): Promise<void> =>
      ipcRenderer.invoke('fs:write', relPath, contents),
    readDir: (relPath: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:readdir', relPath),
    /** Project-relative paths of every browsable file under `relDir`, recursively. */
    listFiles: (relDir: string): Promise<string[]> => ipcRenderer.invoke('fs:listFiles', relDir),
    /** Rename / move; a file's `.meta` sidecar travels with it (identity stable). */
    rename: (fromRel: string, toRel: string): Promise<void> =>
      ipcRenderer.invoke('fs:rename', fromRel, toRel),
    /** Create a folder (refuses if it already exists). */
    mkdir: (relPath: string): Promise<void> => ipcRenderer.invoke('fs:mkdir', relPath),
    /** Duplicate a file/folder next to itself (new uuid); returns the new path. */
    duplicate: (relPath: string): Promise<string> => ipcRenderer.invoke('fs:duplicate', relPath),
    /** Delete to the OS trash (recoverable), sidecar included. */
    trash: (relPath: string): Promise<void> => ipcRenderer.invoke('fs:trash', relPath),
    /** Size + modified time (for the asset tooltip / inspector metadata). */
    stat: (relPath: string): Promise<{ size: number; mtimeMs: number; isDir: boolean }> =>
      ipcRenderer.invoke('fs:stat', relPath),
    /**
     * Subscribe to project file changes (main pushes after on-disk edits, incl.
     * edits made outside the editor). Returns an unsubscribe fn. This is the
     * editor's reusable main→renderer push primitive.
     */
    onChange: (cb: (paths: string[]) => void): (() => void) => {
      const listener = (_e: unknown, payload: { paths: string[] }) => cb(payload.paths);
      ipcRenderer.on('project:fsChanged', listener);
      return () => ipcRenderer.removeListener('project:fsChanged', listener);
    },
  },
  // OS shell integration.
  shell: {
    /** Reveal a project-relative file/folder in Finder / Explorer. */
    showItem: (relPath: string): Promise<void> => ipcRenderer.invoke('shell:showItem', relPath),
    /** Open an absolute path in the OS (e.g. the build output dir). */
    openPath: (absPath: string): Promise<string> => ipcRenderer.invoke('shell:openPath', absPath),
  },
  workspace: {
    save: (ws: WorkspaceState): Promise<void> => ipcRenderer.invoke('workspace:save', ws),
  },
  // Recent projects (launcher), persisted in userData.
  recents: {
    list: (): Promise<RecentEntry[]> => ipcRenderer.invoke('recents:list'),
    add: (root: string, name: string): Promise<void> => ipcRenderer.invoke('recents:add', root, name),
  },
};

contextBridge.exposeInMainWorld('estella', api);

export type EstellaBridge = typeof api;
