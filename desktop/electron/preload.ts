import { contextBridge, ipcRenderer } from 'electron';
import type { OpenedProject, WorkspaceState, DirEntry, RecentEntry, TemplateEntry } from '../src/project/format';
import type { BuildScriptsResult } from './buildScripts';
import type { ExtractSchemasResult } from './extractSchemas';

// The privileged bridge the renderer is allowed to touch. Keep this surface small
// and explicit — anything the editor needs from the OS or Node goes through here.
// `fs.*` paths are project-relative; main sandboxes them to the open project root.
const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getPlatform: (): Promise<NodeJS.Platform> => ipcRenderer.invoke('app:platform'),
  // Surfaces engine lifecycle in the main-process log (useful for headless checks).
  reportEngineStatus: (status: string): void => ipcRenderer.send('engine:status', status),

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
