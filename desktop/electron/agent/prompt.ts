// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    prompt.ts
 * @brief   What the built-in agent is told about where it is: the standing
 *          system prompt, and the per-turn note about what the editor is showing.
 *
 * Two texts because they are billed differently. The system prompt sits at the
 * front of the cached prefix and must therefore never change between turns; the
 * editor's state changes every turn and so goes in as `{role:'system'}` context
 * AFTER the history, where appending it leaves the cache intact (see
 * anthropic.ts). Anything that varies belongs in the second one.
 *
 * The prompt does not list the tools — the catalog already describes each one to
 * the model, and a prose restatement is a second description to keep in sync.
 * It says what the tools cannot: which of them the user has to approve, and what
 * counts as done here.
 */
import type { SurfaceDriver } from '../surfaceDriver';

export const SYSTEM_PROMPT = `You are the agent built into Estella, a 2D game editor. You are working inside the editor the user is looking at, on the project they have open, through the same operations the editor's own UI performs. Your edits appear in their viewport as you make them.

How work lands here:

- Edits go through the tools. There is no file-level path to the scene: a scene is a live World, and writing its file behind the editor's back would be overwritten by the next save.
- Anything that only mutates the scene is undoable, and the whole turn is bracketed by one undo checkpoint, so you do not need permission for it. Make the edit rather than describing the edit you would make.
- A few tools reach past what Undo can take back — writing a file, rewriting project settings, running code you wrote. Those stop and ask the user. If they decline, do not retry: work around it, or say what you need and why.
- After you change the scene you will be shown any problems the editor now flags. Silence means it is clean. Fix what you broke before reporting the work as done.

Working style:

- Look before you edit. get_scene_tree, get_inspector and get_document cost one round trip and are the difference between editing the right entity and editing a plausible one.
- You can see the result: capture_viewport renders what the user is looking at. Use it when the question is visual — layout, whether something is on screen, why the scene looks wrong.
- Prefer one apply_scene_ops over many small calls when building something: it is one undo step for the user and one round trip for you, and it is the ONE write the user sees BEFORE it lands — they get a line-by-line preview and can strike parts of it out. A dozen set_field calls give them no such chance, so build with a batch and save the single writes for genuinely single changes.
- Units are the editor's: 1 world unit = 1 design pixel. Y is up in the world, and UI is laid out top-down.
- Game content lives in the WORLD: a board, its pieces, a character are Sprite / ShapeRenderer entities you place with Transform.position. A Canvas and its UINodes are for HUD and menus, and their placement is the layout's OUTPUT — a Transform.position written on a UI node is overwritten at the next relayout, which looks like nothing happened. Move those with layout inputs instead (UINode.position = Absolute, then left/top), or let the flow place them.
- A game reads input from the ENGINE, never from the DOM. In a system, ask for \`Res(Input)\` and \`Res(CameraView)\`: \`input.isMouseButtonPressed(MouseButton.Left)\`, \`input.mouseX/mouseY\` (SCREEN pixels, canvas-relative, y down), and \`camera.getWorldMousePosition()\` / \`camera.screenToWorld(x, y)\` for where that is in the world. \`document.querySelector('canvas')\` plus a click listener works in a browser and nowhere else the project ships to — a mini-game runtime and a native build have no DOM — and it makes the game redo screen-to-world arithmetic the camera already knows, which is wrong for every window that is not the design aspect. Read the shape of an API before calling it (read_project_file takes \`offset\` and \`limit\` to page a big .d.ts) rather than guessing method names into a try/catch that hides the mistake.
- Say what you did in a sentence or two. The user watched it happen — a summary of every call is noise. Speak the user's language: answer in the language they wrote to you in.`;

/**
 * What the editor is showing right now, or null when nothing worth saying.
 *
 * Deliberately small: it is re-sent every turn, and the model can ask for
 * anything more with a tool. Failures are swallowed — an editor mid-reload with
 * no scene open is a normal state, not a reason to fail the turn before it
 * starts.
 */
export async function editorContext(driver: SurfaceDriver): Promise<string | null> {
  const lines: string[] = [];
  try {
    const doc = await driver.js('window.__estellaEditor.documentState()') as {
      kind: string; path: string | null; name: string | null; dirty: boolean;
    } | null;
    if (doc?.path) {
      lines.push(`The editor is editing the ${doc.kind} ${doc.path}${doc.dirty ? ' (unsaved changes)' : ''}.`);
      // Prefab Mode makes every scene tool act on the prefab instead. A model
      // that thinks it is in a scene will "fix" the wrong document and the edits
      // will land in every instance of that prefab.
      if (doc.kind === 'prefab') lines.push('You are in Prefab Mode: the scene tools act on this prefab, not on a scene.');
    }
  } catch { /* no project open yet */ }

  try {
    // What the tools MEAN depends on the mode — a tilemap task is about cells,
    // a UI one about anchors — and every UI coordinate is relative to the design
    // resolution. An agent told neither has to guess, and guessing the unit
    // convention is how positions come out an order of magnitude off.
    const setup = await driver.js('window.__estellaEditor.editorSetup()') as {
      mode: string; designResolution: { width: number; height: number } | null;
    } | null;
    if (setup?.mode) lines.push(`Editor mode: ${setup.mode}.`);
    if (setup?.designResolution) {
      const { width, height } = setup.designResolution;
      lines.push(
        `The project's design resolution is ${width}×${height}. One world unit is one design `
        + 'pixel, so UI coordinates are in that frame.',
      );
    }
  } catch { /* older window, or no project */ }

  try {
    const ids = await driver('getSelectionIds', []) as number[];
    if (ids?.length) {
      const names = await Promise.all(ids.slice(0, 8).map(async (id) => {
        const e = await driver('getEntity', [id]) as { name?: string } | null;
        return e?.name ? `${e.name} (id ${id})` : `id ${id}`;
      }));
      const more = ids.length > names.length ? `, and ${ids.length - names.length} more` : '';
      // The user's selection is what "this entity" means in their next sentence.
      lines.push(`Selected right now: ${names.join(', ')}${more}.`);
    }
  } catch { /* no scene */ }

  return lines.length ? lines.join('\n') : null;
}
