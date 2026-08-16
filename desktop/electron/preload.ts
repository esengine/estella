// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { OpenedProject, WorkspaceState, DirEntry, RecentEntry, TemplateEntry, ExportPlatform } from '../../pipeline/src/project/format';
import type { BuildScriptsResult } from '../../pipeline/src/bundle/buildScripts';
import type { ExtractSchemasResult } from './extractSchemas';
import type { ScaffoldScriptResult, ScriptKind } from './scriptScaffold';
import type { ScanAssetsResult, AssetIndex, IncrementalScanResult } from '../../pipeline/src/assets/assetDb';
import type { CookResult } from '../../pipeline/src/assets/cookAssets';
import type { ExportGameResult } from '../../pipeline/src/export/exportGame';
import type { RevertResult } from './fileJournal';
import type {
  PlatformStatus, CreatePlatformResult, PlayableNetworkOption, ProjectPlatformKind,
} from '../../pipeline/src/export/platformCatalog';
import type { PlayRealmResult } from './buildPlayRealm';
import type { AvailableUpdate, DownloadProgress, UpdateStatus } from './autoUpdate';
import type { LaunchError } from './externalProgram';
import type { DetectedEditor } from './editorCatalog';
import type { DiscoveredPlugin, CompiledPlugin } from './pluginHost';
import type { ScaffoldPluginOptions, ScaffoldPluginResult } from './pluginScaffold';
import type { PluginPackageInfo, InstallPluginResult } from './pluginPackage';
import type { NativeTemplateEntry, InstallResult } from '../../pipeline/src/export/nativeTemplates';
import type { McpEndpointStatus } from './mcpEndpoint';
import type { SecretStatus } from './secrets';
import type { AgentStatus, AgentMessage } from './agent/host';
import type { AgentEvent, ConfirmAnswer, UserImage } from './agent/types';
import type { ConversationSummary } from './agent/store';
import type { TemplatePlatform } from '../../pipeline/src/project/platforms';

// The privileged bridge the renderer is allowed to touch. Keep this surface small
// and explicit — anything the editor needs from the OS or Node goes through here.
// `fs.*` paths are project-relative; main sandboxes them to the open project root.
const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getPlatform: (): Promise<NodeJS.Platform> => ipcRenderer.invoke('app:platform'),
  /** Synchronous platform, so chrome (drag padding, window controls) renders right on first paint. */
  platform: process.platform,
  // Surfaces engine lifecycle in the main-process log (useful for headless checks).
  reportEngineStatus: (status: string): void => ipcRenderer.send('engine:status', status),

  // — Custom window controls (frameless Windows/Linux; macOS has native traffic lights) —
  win: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke('window:toggleMaximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    /** UI zoom, as a factor (1 = 100%). Applied in main so popped-out panels follow. */
    setZoom: (factor: number): Promise<void> => ipcRenderer.invoke('window:setZoom', factor),
    /** Subscribe to maximize/restore; returns an unsubscribe. */
    onMaximizeChange: (cb: (maximized: boolean) => void): (() => void) => {
      const h = (_e: unknown, maximized: boolean) => cb(maximized);
      ipcRenderer.on('window:maximized', h);
      return () => ipcRenderer.removeListener('window:maximized', h);
    },
  },

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
    /** Manual update check (Help menu). Says which of the three things happened —
     *  found one, already current, or nobody answered. */
    checkUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke('app:checkUpdates'),
    /** Startup update notification (main checks once after launch); returns an unsubscribe. */
    onUpdateAvailable: (cb: (release: AvailableUpdate) => void): (() => void) => {
      const h = (_e: unknown, release: AvailableUpdate) => cb(release);
      ipcRenderer.on('app:updateAvailable', h);
      return () => ipcRenderer.removeListener('app:updateAvailable', h);
    },
    /** Download the update the last check found. Only for `selfInstall` updates. */
    downloadUpdate: (): Promise<void> => ipcRenderer.invoke('app:downloadUpdate'),
    /** Quit and let the installer take over; false if no download has finished. */
    installUpdate: (): Promise<boolean> => ipcRenderer.invoke('app:installUpdate'),
    /** Bytes-so-far for the running download; returns an unsubscribe. */
    onUpdateProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
      const h = (_e: unknown, p: DownloadProgress) => cb(p);
      ipcRenderer.on('app:updateProgress', h);
      return () => ipcRenderer.removeListener('app:updateProgress', h);
    },
    /** Open the local diagnostics log folder (main-process errors, crash dumps). */
    openLogs: (): Promise<void> => ipcRenderer.invoke('diagnostics:openLogs'),
    /** Write a bundle the renderer collected; main picks the file, nothing more. */
    saveBundle: (name: string, text: string): Promise<{ ok: boolean; file?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('diagnostics:saveBundle', name, text),
  },

  // — The MCP endpoint an external AI agent attaches to. Off unless asked for:
  // the setting drives it (persisted per user, replayed at boot), and `--mcp`
  // opens it for the whole session regardless (mcpEndpoint.ts). —
  mcp: {
    /** What the endpoint is doing now — port, discovery file, why it failed. */
    status: (): Promise<McpEndpointStatus> => ipcRenderer.invoke('mcp:status'),
    /** Open/close it; resolves with the resulting status (never throws on a bind
     *  failure — the reason comes back in `error`). */
    setEnabled: (on: boolean): Promise<McpEndpointStatus> => ipcRenderer.invoke('mcp:setEnabled', on),
  },

  // — Credentials a setting holds (the built-in agent's API key). The value
  // crosses this bridge ONCE, inbound, when the user types it: main seals it with
  // the OS keychain and hands it only to the client that must send it, and there
  // is no way to read it back (electron/secrets.ts). —
  secrets: {
    /** Whether one is stored under `id`, and what this machine can store it with. */
    status: (id: string): Promise<SecretStatus> => ipcRenderer.invoke('secret:status', id),
    /** Store it; resolves with the resulting status, including a refusal. */
    set: (id: string, value: string): Promise<SecretStatus> => ipcRenderer.invoke('secret:set', id, value),
    clear: (id: string): Promise<SecretStatus> => ipcRenderer.invoke('secret:clear', id),
  },

  // — The built-in agent. Main owns the conversation (electron/agent/host.ts);
  // this is the window's way to talk to it and to hear what it is doing. —
  agent: {
    status: (): Promise<AgentStatus> => ipcRenderer.invoke('agent:status'),
    /** The open conversation's events, for a window that was not there for them. */
    transcript: (): Promise<AgentEvent[]> => ipcRenderer.invoke('agent:transcript'),
    /** Start a turn, with any images the person attached; resolves with the
     *  resulting status, refusals included. */
    send: (text: string, images?: readonly UserImage[]): Promise<AgentStatus> =>
      ipcRenderer.invoke('agent:send', text, images),
    stop: (): Promise<void> => ipcRenderer.invoke('agent:stop'),
    /** Answer the pending confirmation for an irreversible tool. */
    confirm: (callId: string, answer: ConfirmAnswer, declined?: readonly number[]): Promise<void> =>
      ipcRenderer.invoke('agent:confirm', callId, answer, declined),
    /** Answer a claim of that run only a person could settle, by its position
     *  in the run's results. */
    settleClaim: (turn: number, index: number, held: boolean): Promise<void> =>
      ipcRenderer.invoke('agent:settleClaim', turn, index, held),
    /** Put back the project files these runs wrote (their file-journal
     *  transactions) and say what came back. The DOCUMENT half is this window's
     *  own undo — see src/engine/rewind.ts. */
    revertFiles: (txIds: readonly string[]): Promise<RevertResult> =>
      ipcRenderer.invoke('agent:revertFiles', txIds),
    /** The turn was kept — drop the copies held for its revert. */
    keepFiles: (txId: string): Promise<void> => ipcRenderer.invoke('agent:keepFiles', txId),
    /** Drop the conversation and start a new one. */
    reset: (): Promise<AgentStatus> => ipcRenderer.invoke('agent:reset'),
    /** Ask the n-th turn again, discarding it and everything after it. */
    retry: (n: number, text: string): Promise<AgentStatus> => ipcRenderer.invoke('agent:retry', n, text),
    /** Every conversation saved with this project, newest first. */
    conversations: (): Promise<ConversationSummary[]> => ipcRenderer.invoke('agent:conversations'),
    /** Continue a saved one — its transcript and the model's memory of it. */
    resumeConversation: (id: string): Promise<AgentStatus> =>
      ipcRenderer.invoke('agent:resumeConversation', id),
    deleteConversation: (id: string): Promise<void> =>
      ipcRenderer.invoke('agent:deleteConversation', id),
    /** Point the NEXT session at an endpoint/model. Merged, so each settings row
     *  can push its own field. */
    setEndpoint: (patch: { protocol?: string; baseUrl?: string; model?: string; keyId?: string; contextWindow?: number; effort?: string; vision?: boolean; reasoningEffort?: boolean }): Promise<void> =>
      ipcRenderer.invoke('agent:setEndpoint', patch),
    /** Report what loaded plugins contributed for the agent to call. Metadata
     *  only — the handlers stay in this window, reached through the editor
     *  surface like every other tool. Read once per session. */
    setTools: (tools: readonly { name: string; description: string; schema: unknown; effect: string }[]): Promise<void> =>
      ipcRenderer.invoke('agent:setTools', tools),
    /** Transcript events + status changes, in the order they happened; returns
     *  an unsubscribe. One channel because the two must not be reordered. */
    onMessage: (cb: (message: AgentMessage) => void): (() => void) => {
      const h = (_e: unknown, message: AgentMessage) => cb(message);
      ipcRenderer.on('agent:message', h);
      return () => ipcRenderer.removeListener('agent:message', h);
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
    /** Capture a page region (CSS px) and write it as the project's cover (`thumbnail.png`). */
    thumbnail: (rect: { x: number; y: number; width: number; height: number }): Promise<void> =>
      ipcRenderer.invoke('project:thumbnail', rect),
    /** Copy a template into `<location>/<name>`; returns the new project root. */
    createFromTemplate: (templateDir: string, location: string, name: string): Promise<string> =>
      ipcRenderer.invoke('project:createFromTemplate', templateDir, location, name),
    /** Pick a folder (for the new-project location); returns an absolute path or null. */
    chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('project:chooseDirectory'),
    /** Bundle the open project's scripts (src/main.ts) for the isolated play realm. */
    buildScripts: (): Promise<BuildScriptsResult> => ipcRenderer.invoke('project:buildScripts'),
    /** Extract the project's component field schemas → .esengine/cache/schemas.json. */
    extractSchemas: (): Promise<ExtractSchemasResult> => ipcRenderer.invoke('project:extractSchemas'),
    /** Write a new script under the project's source root AND wire it into the entry
     *  its kind belongs to (declaration entry for a component, startup entry for a
     *  system) — an unwired module is one nothing bundles or inspects. */
    createScript: (kind: ScriptKind, name: string, dir?: string): Promise<ScaffoldScriptResult> =>
      ipcRenderer.invoke('project:createScript', kind, name, dir),
    /** Scan the project's .meta sidecars → the asset index (registry + dep graph). */
    scanAssets: (): Promise<ScanAssetsResult> => ipcRenderer.invoke('project:scanAssets'),
    /** The cached asset index (assets.json) without a tree walk, or null — the fast
     *  boot registry, revalidated by a full scanAssets off the critical path. */
    cachedAssetIndex: (): Promise<AssetIndex | null> => ipcRenderer.invoke('project:cachedAssetIndex'),
    /** Fold the watcher's precise changed paths into the cached index incrementally
     *  (no full tree walk); `fullRescan` marks a fallback to a full scan. */
    scanAssetsIncremental: (paths: string[]): Promise<IncrementalScanResult> =>
      ipcRenderer.invoke('project:scanAssetsIncremental', paths),
    /** Cook reachable assets for shipping → staged files + runtime manifest in `outDir`. */
    cookAssets: (outDir?: string): Promise<CookResult> => ipcRenderer.invoke('project:cookAssets', outDir),
    /** The platforms this project can package for — built-ins plus any the project
     *  defines in `.esengine/platforms/` — each with its engine runtime probed. */
    listPlatforms: (): Promise<PlatformStatus[]> => ipcRenderer.invoke('project:listPlatforms'),
    /** The ad networks a playable can target — the editor's plus any the project
     *  defines with `kind: 'playable'`. A profile that failed to load is listed with
     *  its `error` rather than dropped. */
    listPlayableNetworks: (): Promise<PlayableNetworkOption[]> =>
      ipcRenderer.invoke('project:listPlayableNetworks'),
    /** Scaffold a project platform: the packaging profile + the runtime profile it
     *  points at, both written and already joined. */
    createPlatform: (id: string, label: string, kind?: ProjectPlatformKind): Promise<CreatePlatformResult> =>
      ipcRenderer.invoke('project:createPlatform', id, label, kind),
    /** Export a runnable web build (play==ship) → self-contained `outDir` (default dist-game/). */
    exportGame: (opts?: { outDir?: string; minify?: boolean; sourcemap?: boolean; platform?: ExportPlatform; compressTextures?: boolean; compressAudio?: boolean; atlasTextures?: boolean }): Promise<ExportGameResult> =>
      ipcRenderer.invoke('project:exportGame', opts),
    /** Serve a built export dir (web / playable) over loopback http and open it in the
     *  default browser — the build's real deployment surface, so no file:// origin
     *  restrictions apply. Returns the previewed URL. */
    previewExport: (absDir: string): Promise<string> => ipcRenderer.invoke('export:preview', absDir),
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
    /** Re-run a model's import in place: the door an edited source, or an edited
     *  import setting, reaches its products through. */
    reimportModel: (file: string): Promise<{ products: string[]; warnings: string[] }> =>
      ipcRenderer.invoke('project:reimportModel', file),
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
    /** `offset` (1-based line) and `limit` (line count) page a large file; omit
     *  both for the whole thing. */
    read: (relPath: string, offset?: number, limit?: number): Promise<string> =>
      ipcRenderer.invoke('fs:read', relPath, offset, limit),
    /** Read a file that may legitimately not exist (optional project config) —
     *  `null` when it isn't there, so "absent" never travels as a failed IPC call. */
    readOptional: (relPath: string): Promise<string | null> =>
      ipcRenderer.invoke('fs:readOptional', relPath),
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
    /** Delete to the OS trash (recoverable), sidecar included. Returns a token
     *  that `restoreTrashed` accepts to undo the delete. */
    trash: (relPath: string): Promise<string> => ipcRenderer.invoke('fs:trash', relPath),
    /** Undo a trash: rewrite the file/folder (+ `.meta`, uuid intact) from the
     *  pre-trash snapshot named by `token`. */
    restoreTrashed: (relPath: string, token: string): Promise<void> =>
      ipcRenderer.invoke('fs:restoreTrashed', relPath, token),
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
  // Crash-recovery snapshots under `.esengine/autosave/`. The renderer's autosave
  // loop mirrors dirty documents here; on open, `list` surfaces the ones newer
  // than their saved file so the restore prompt can offer them.
  autosave: {
    /** Mirror the current dirty documents into the autosave dir, dropping stale ones. */
    sync: (entries: { rel: string; contents: string }[]): Promise<void> =>
      ipcRenderer.invoke('autosave:sync', entries),
    /** Snapshots newer than (or without) their on-disk file — recovery candidates. */
    list: (): Promise<{ rel: string; snapshotMtimeMs: number; fileMtimeMs: number | null }[]> =>
      ipcRenderer.invoke('autosave:list'),
    /** Copy the named snapshots over their real files, then clear the autosave dir. */
    restore: (rels: string[]): Promise<void> => ipcRenderer.invoke('autosave:restore', rels),
    /** Discard every snapshot. */
    clear: (): Promise<void> => ipcRenderer.invoke('autosave:clear'),
  },
  // OS shell integration.
  shell: {
    /** Reveal a project-relative file/folder in Finder / Explorer. */
    showItem: (relPath: string): Promise<void> => ipcRenderer.invoke('shell:showItem', relPath),
    /** Open an absolute path in the OS (e.g. the build output dir). */
    openPath: (absPath: string): Promise<string> => ipcRenderer.invoke('shell:openPath', absPath),
    /** Show a picker for an external program; absolute path, or null if cancelled. */
    pickProgram: (title: string): Promise<string | null> => ipcRenderer.invoke('external:pick', title),
    pickDirectory: (title: string): Promise<string | null> => ipcRenderer.invoke('external:pickDir', title),
    /** Mirror the chosen browser to main, which opens urls without a call site. */
    setBrowser: (program: string): void => ipcRenderer.send('external:browser', program),
    /** Known code editors actually installed, in preference order. */
    detectEditors: (): Promise<DetectedEditor[]> => ipcRenderer.invoke('external:detect'),
    /** Open a project-relative file for `slot`; empty `program` = auto/OS default. */
    launchProgram: (slot: string, program: string, relPath: string): Promise<LaunchError | null> =>
      ipcRenderer.invoke('external:launch', slot, program, relPath),
  },
  workspace: {
    save: (ws: WorkspaceState): Promise<void> => ipcRenderer.invoke('workspace:save', ws),
  },
  // Editor plugins. Main finds + compiles them and owns the trust record; the
  // renderer decides nothing about trust, it only reports what main says.
  plugins: {
    /** Every plugin on disk (project scope first), each with its manifest or the
     *  reason it failed to load, plus whether the user switched it off. */
    list: (): Promise<(DiscoveredPlugin & { disabled: boolean })[]> => ipcRenderer.invoke('plugins:list'),
    /** Compile a plugin's renderer entry and report whether the user approved this
     *  id+version from this folder. Compiling never runs the plugin. */
    load: (id: string): Promise<CompiledPlugin & { trusted: boolean }> => ipcRenderer.invoke('plugins:load', id),
    /** Whether this entry is approved, without compiling anything — a project
     *  platform profile has no renderer entry to build. */
    trustState: (id: string): Promise<boolean> => ipcRenderer.invoke('plugins:trustState', id),
    /** Record the user's approval; main resolves the version + folder it applies to. */
    trust: (id: string): Promise<void> => ipcRenderer.invoke('plugins:trust', id),
    revokeTrust: (id: string): Promise<void> => ipcRenderer.invoke('plugins:revokeTrust', id),
    setEnabled: (id: string, enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('plugins:setEnabled', id, enabled),
    /** Reveal the plugin's folder in Finder / Explorer. */
    reveal: (id: string): Promise<void> => ipcRenderer.invoke('plugins:reveal', id),
    /** Write a new plugin — manifest, entry, tsconfig, typings sidecar — into the
     *  chosen scope's folder. The caller passes the editor version and the API
     *  typings text, so what is generated matches the editor doing the generating. */
    scaffold: (scope: 'project' | 'user', opts: ScaffoldPluginOptions): Promise<ScaffoldPluginResult> =>
      ipcRenderer.invoke('plugins:scaffold', scope, opts),
    /** Pack a plugin into one `.esplugin` file the user picks a location for. */
    exportPackage: (id: string): Promise<{ ok: boolean; error?: string; canceled?: boolean; file?: string }> =>
      ipcRenderer.invoke('plugins:export', id),
    /** Pick an `.esplugin` and report what is INSIDE it — nothing is written yet.
     *  The two-step exists so the user sees the contents before committing. */
    pickPackage: (): Promise<PluginPackageInfo & { canceled?: boolean; file?: string }> =>
      ipcRenderer.invoke('plugins:pickPackage'),
    /** Install a previewed package. It lands untrusted; approving is separate. */
    installPackage: (file: string, scope: 'project' | 'user'): Promise<InstallPluginResult> =>
      ipcRenderer.invoke('plugins:install', file, scope),
  },
  // The prebuilt engine a mobile target is assembled around. The editor installs
  // one; it never compiles one (see electron/nativeTemplates.ts).
  nativeTemplates: {
    list: (): Promise<NativeTemplateEntry[]> => ipcRenderer.invoke('nativeTemplates:list'),
    /** Pick an archive and install it. Main owns the file dialog, so the renderer
     *  never handles a path it could have made up. */
    install: (): Promise<InstallResult & { canceled?: boolean }> => ipcRenderer.invoke('nativeTemplates:install'),
    remove: (platform: TemplatePlatform, version: string): Promise<boolean> =>
      ipcRenderer.invoke('nativeTemplates:remove', platform, version),
    /** Fetch this editor version's template from the release and install it. */
    download: (platform: TemplatePlatform): Promise<InstallResult> =>
      ipcRenderer.invoke('nativeTemplates:download', platform),
    /** Subscribe to download progress; returns an unsubscribe. */
    onDownloadProgress: (cb: (p: { platform: string; received: number; total: number }) => void): (() => void) => {
      const h = (_e: unknown, p: { platform: string; received: number; total: number }) => cb(p);
      ipcRenderer.on('nativeTemplates:downloadProgress', h);
      return () => ipcRenderer.removeListener('nativeTemplates:downloadProgress', h);
    },
  },
  // Recent projects (launcher), persisted in userData.
  recents: {
    list: (): Promise<RecentEntry[]> => ipcRenderer.invoke('recents:list'),
    add: (root: string, name: string): Promise<void> => ipcRenderer.invoke('recents:add', root, name),
    remove: (root: string): Promise<void> => ipcRenderer.invoke('recents:remove', root),
  },
};

contextBridge.exposeInMainWorld('estella', api);

export type EstellaBridge = typeof api;
