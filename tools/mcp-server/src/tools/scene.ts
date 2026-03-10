import { z } from 'zod';
import type { BridgeClient } from '../bridge.js';

export function registerSceneTools(
    server: { tool: Function },
    bridge: BridgeClient,
): void {
    server.tool(
        'get_scene_tree',
        'Get the entity hierarchy of the current scene',
        { depth: z.number().optional().describe('Max tree depth') },
        async (args: { depth?: number }) => {
            const query = args.depth != null ? `?depth=${args.depth}` : '';
            const result = await bridge.get(`/scene/tree${query}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'get_entity_data',
        'Get all component data for an entity by ID or name',
        {
            entity: z.union([z.number(), z.string()]).describe('Entity ID (number) or name (string)'),
        },
        async (args: { entity: number | string }) => {
            const param = typeof args.entity === 'number' ? `id=${args.entity}` : `name=${encodeURIComponent(args.entity)}`;
            const result = await bridge.get(`/scene/entity?${param}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'get_selection',
        'Get currently selected entities and asset in the editor',
        {},
        async () => {
            const result = await bridge.get('/scene/selection');
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'find_entities',
        'Find entities by name (fuzzy match) or component type (exact match)',
        { query: z.string().describe('Search query: entity name or component type') },
        async (args: { query: string }) => {
            const result = await bridge.get(`/scene/find?query=${encodeURIComponent(args.query)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );
}
