# Estella Editor

A purpose-built visual editor for the Estella 2D WASM engine — Electron + React +
TypeScript, with a UE5-style dockable workspace.

> **Status:** a working visual editor. The engine runs live in the viewport, scenes
> load from and save to disk, the inspector is driven by engine reflection, you can
> play-in-editor in an isolated realm, and the specialized asset editors — Sequencer,
> tilemap painter, tileset, material graph, and the FSM / behavior-tree graphs — are wired.

## Stack

| Concern        | Choice                          |
| -------------- | ------------------------------- |
| Desktop shell  | Electron (Node main process reuses the engine's Node build tooling) |
| UI             | React 19 + TypeScript + Vite    |
| Docking        | [dockview](https://dockview.dev) — dockable / floating / tabbed panels, serializable layout |
| State          | Zustand                         |
| Fonts          | Inter (UI) + JetBrains Mono (live data) bundled offline via `@fontsource` |

## Run

```bash
pnpm install          # from the repo root (workspace)
pnpm --filter @estella/editor dev      # launches the Electron window with HMR
pnpm --filter @estella/editor build    # type-check + production bundle
```

## Layout

```
MenuBar      File · Edit · … + project / scene
Toolbar      Save │ Select Move Rotate Scale │ Snap Grid │ [Play Pause Stop] │ Build
┌───────────┬───────────────────────────┬───────────┐
│ World     │        Viewport           │  Details  │
│ Outliner  │  (live WebGL engine        │ (inspector│
│           │   canvas mounts here)      │  driven by│
│           │                            │  schema)  │
├───────────┴───────────────────────────┴───────────┤
│ Content Browser  ·  Output Log   (tabbed bottom dock)│
└──────────────────────────────────────────────────┘
StatusBar    Edit Mode · selection · cursor · fps · draw calls · engine version
```

Panel arrangement is dockable and persisted to `localStorage` (`estella.editor.layout.v1`).

## Source map

```
electron/        main process + preload bridge (privileged IPC surface)
src/
  theme/         design tokens, global reset, dockview theme, app styles
  layout/        MenuBar · Toolbar · StatusBar · DockLayout (dockview wiring)
  panels/        Viewport · Outliner · Details · ContentBrowser · OutputLog · Sequencer · node-graph editors
  launcher/      project launcher (recents + new-from-template)
  project/       ProjectStore, on-disk .esproject format, fs watch
  engine/        runtime boot + EditorControlSurface + history
  commands/      the editor command registry (labels, shortcuts, handlers)
  settings/      editor + project settings registry (incl. Project Settings)
  tools/         viewport transform gizmos, marquee, tile tools
  store/         Zustand editor state (selection, tool, play, overlays)
  components/    shared bits (menus, popovers, icon maps)
  types.ts       editor domain types — mirror the engine bridge contract
public/          wasm runtime, bundled SDK, example projects (served at web root)
```

## How it works

- **Runtime** — the SDK + `esengine.wasm` boot into a `<canvas>` in `Viewport`; the
  editor drives the world through `EditorControlSurface` (also exposed to headless
  automation and AI agents over an MCP server: `pnpm editor:mcp`, see
  `scripts/editor-mcp.mjs`; mutating tools need `ESTELLA_MCP_ALLOW_WRITES=1`).
- **Scenes & assets** — `ProjectStore` opens a project from disk and the Electron main
  process watches it (`fs` + `chokidar`); the `ContentBrowser` browses and creates assets.
- **Inspector** — `Details` is generated from the engine's reflection metadata:
  component list plus typed fields with ranges, units, and enums.
- **Play-in-editor** — the toolbar Play controls run the game in an **isolated realm**
  (the same runtime that ships the game), so play never mutates the edit-mode scene.
```
