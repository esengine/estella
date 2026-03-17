import { z } from 'zod';
import type { BridgeClient } from '../bridge.js';
import { resolveEntityRef } from './entity-ref.js';

export function registerActionTools(
    server: { tool: Function },
    bridge: BridgeClient,
): void {
    server.tool(
        'select_entity',
        'Select an entity in the editor by ID or name',
        {
            entity: z.union([z.number(), z.string()]).describe('Entity ID (number) or name (string)'),
        },
        async (args: { entity: number | string }) => {
            const ref = resolveEntityRef(args.entity);
            const entity = 'id' in ref ? ref.id : ref.name;
            const result = await bridge.post('/action/select', { entity });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'set_property',
        `Set a component property on an entity (supports undo). IMPORTANT: Changes are NOT auto-saved. Call save_scene after making changes, especially before toggling play mode.
Common component fields:
- Transform: position {x,y,z}, rotation {x,y,z,w}, scale {x,y,z}
- Sprite: texture (UUID), color {r,g,b,a}, size {x,y}, enabled, flipX, flipY
- TimelinePlayer: timeline (asset UUID), playing (bool), speed (number), wrapMode ("once"|"loop"|"pingPong")
- SpriteAnimator: clip (esanim asset UUID or registered name), playing (bool)
- Camera: orthoSize (number)
Use get_component_schema for full field list of any component.`,
        {
            entity: z.union([z.number(), z.string()]).describe('Entity ID or name'),
            component: z.string().describe('Component type (e.g., "Transform", "Sprite")'),
            field: z.string().describe('Property name'),
            value: z.unknown().describe('New value'),
        },
        async (args: { entity: number | string; component: string; field: string; value: unknown }) => {
            const ref = resolveEntityRef(args.entity);
            const entity = 'id' in ref ? ref.id : ref.name;
            const result = await bridge.post('/action/set-property', { entity, component: args.component, field: args.field, value: args.value });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) + '\nRemember to call save_scene to persist changes.' }] };
        },
    );

    server.tool(
        'execute_menu',
        'Execute an editor menu action by dot-separated ID (e.g., "file.save", "edit.undo")',
        {
            id: z.string().describe('Menu item ID (dot-separated, e.g., "file.save")'),
        },
        async (args: { id: string }) => {
            const result = await bridge.post('/action/menu', { id: args.id });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'toggle_play_mode',
        'Toggle between Play and Edit mode in the editor',
        {},
        async () => {
            const result = await bridge.post('/action/play-mode', {});
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'save_scene',
        'Save the current scene',
        {},
        async () => {
            const result = await bridge.post('/action/save-scene', {});
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'reload_scripts',
        'Reload and recompile user scripts',
        {},
        async () => {
            const result = await bridge.post('/action/reload-scripts', {});
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'undo',
        'Undo the last editor action',
        {},
        async () => {
            const result = await bridge.post('/action/undo', {});
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'redo',
        'Redo the last undone editor action',
        {},
        async () => {
            const result = await bridge.post('/action/redo', {});
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'create_script',
        `Create a new TypeScript script file in the project.

IMPORTANT: Read the editor://sdk-api resource FIRST to understand the API patterns.

Key patterns for user scripts:
- Import from 'esengine' (e.g., defineComponent, defineSystem, Query, Commands, etc.)
- Use addSystem/addStartupSystem/addSystemToSchedule to register systems (top-level calls)
- Use Commands() parameter + cmds.insertResource() inside a startup system to register resources
- Export components via defineComponent for editor auto-discovery
- Do NOT use setup() function pattern — use global registration functions`,
        {
            name: z.string().describe('Script name (e.g., "PlayerController")'),
            content: z.string().optional().describe('Script content (default: component template)'),
            dir: z.string().optional().describe('Directory relative to project root (default: "src")'),
        },
        async (args: { name: string; content?: string; dir?: string }) => {
            const result = await bridge.post('/scripts/create', args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );
}
