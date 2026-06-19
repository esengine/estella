# Estella Editor

A purpose-built visual editor for the Estella 2D WASM engine — Electron + React +
TypeScript, with a UE5-style dockable workspace.

> **Status:** static UI foundation. Every panel renders against the real domain
> types with mock data; no engine is wired yet. This is the base to build features on.

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
│ Outliner  │  (engine canvas mounts    │ (inspector│
│           │   here — currently a       │  driven by│
│           │   placeholder stage)       │  schema)  │
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
  panels/        Outliner · Viewport · Details · ContentBrowser · OutputLog
  store/         Zustand editor state (selection, tool, play, overlays)
  components/    shared bits (icon maps)
  mock/          placeholder scene / components / assets / logs
  types.ts       editor domain types — mirror the engine bridge contract
public/          wasm runtime, bundled SDK, example projects (served at web root)
```

## Wiring the engine (next steps)

The mock layer is deliberately shaped like the real contract, so going live means
swapping data sources, not rewriting panels:

1. **Boot the runtime** — load `public/wasm/esengine.js` + `.wasm` into a `<canvas>`
   inside `Viewport`, via the SDK's `CoreApiBridge` / `WasmBridge`.
2. **Scene tree** — replace `MOCK_SCENE` with a live entity list from the bridge;
   selection already flows through `editorStore`.
3. **Inspector** — drive `Details` from the generated `EditorAPI` schema
   (`tools/eht/generators/editor_api.py`): component list, property get/set by path.
4. **Assets** — point `ContentBrowser` at the project's content directory (Electron
   main process: `fs` + `chokidar` watch).
5. **Play-in-editor** — `Toolbar` play controls drive the engine's run loop.
```
