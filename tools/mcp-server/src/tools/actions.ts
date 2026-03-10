import { z } from 'zod';
import type { BridgeClient } from '../bridge.js';

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
            const result = await bridge.post('/action/select', { entity: args.entity });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'set_property',
        'Set a component property on an entity (supports undo)',
        {
            entity: z.union([z.number(), z.string()]).describe('Entity ID or name'),
            component: z.string().describe('Component type (e.g., "Transform", "Sprite")'),
            field: z.string().describe('Property name'),
            value: z.unknown().describe('New value'),
        },
        async (args: { entity: number | string; component: string; field: string; value: unknown }) => {
            const result = await bridge.post('/action/set-property', args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
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
}
