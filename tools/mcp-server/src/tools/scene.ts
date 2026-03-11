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

    server.tool(
        'create_entity',
        'Create a new entity in the scene, optionally with components',
        {
            name: z.string().optional().describe('Entity name (default: "Entity")'),
            parent: z.union([z.number(), z.string()]).optional().describe('Parent entity ID or name'),
            components: z.array(z.object({
                type: z.string().describe('Component type (e.g., "Transform", "Sprite")'),
                data: z.record(z.unknown()).optional().describe('Component data overrides'),
            })).optional().describe('Components to add (defaults are auto-filled)'),
        },
        async (args: { name?: string; parent?: number | string; components?: Array<{ type: string; data?: Record<string, unknown> }> }) => {
            const result = await bridge.post('/scene/create-entity', args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'delete_entity',
        'Delete an entity from the scene',
        {
            entity: z.union([z.number(), z.string()]).describe('Entity ID or name'),
        },
        async (args: { entity: number | string }) => {
            const body = typeof args.entity === 'number' ? { id: args.entity } : { name: args.entity };
            const result = await bridge.post('/scene/delete-entity', body);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'rename_entity',
        'Rename an entity',
        {
            entity: z.union([z.number(), z.string()]).describe('Entity ID or current name'),
            newName: z.string().describe('New name for the entity'),
        },
        async (args: { entity: number | string; newName: string }) => {
            const body = typeof args.entity === 'number'
                ? { id: args.entity, newName: args.newName }
                : { name: args.entity, newName: args.newName };
            const result = await bridge.post('/scene/rename-entity', body);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'reparent_entity',
        'Move an entity under a new parent (or to root if newParent is null)',
        {
            entity: z.union([z.number(), z.string()]).describe('Entity ID or name'),
            newParent: z.union([z.number(), z.string()]).nullable().describe('New parent entity ID/name, or null for root'),
        },
        async (args: { entity: number | string; newParent: number | string | null }) => {
            const body: Record<string, unknown> = { newParent: args.newParent };
            if (typeof args.entity === 'number') body.id = args.entity;
            else body.name = args.entity;
            const result = await bridge.post('/scene/reparent-entity', body);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'add_component',
        'Add a component to an entity (defaults are auto-filled)',
        {
            entity: z.union([z.number(), z.string()]).describe('Entity ID or name'),
            component: z.string().describe('Component type (e.g., "Transform", "Sprite", "RigidBody")'),
            data: z.record(z.unknown()).optional().describe('Component data overrides'),
        },
        async (args: { entity: number | string; component: string; data?: Record<string, unknown> }) => {
            const body: Record<string, unknown> = { component: args.component };
            if (typeof args.entity === 'number') body.id = args.entity;
            else body.name = args.entity;
            if (args.data) body.data = args.data;
            const result = await bridge.post('/scene/add-component', body);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'remove_component',
        'Remove a component from an entity',
        {
            entity: z.union([z.number(), z.string()]).describe('Entity ID or name'),
            component: z.string().describe('Component type to remove'),
        },
        async (args: { entity: number | string; component: string }) => {
            const body: Record<string, unknown> = { component: args.component };
            if (typeof args.entity === 'number') body.id = args.entity;
            else body.name = args.entity;
            const result = await bridge.post('/scene/remove-component', body);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'duplicate_entity',
        'Duplicate an entity with all its components',
        {
            entity: z.union([z.number(), z.string()]).describe('Entity ID or name to duplicate'),
        },
        async (args: { entity: number | string }) => {
            const body = typeof args.entity === 'number' ? { id: args.entity } : { name: args.entity };
            const result = await bridge.post('/scene/duplicate-entity', body);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'instantiate_prefab',
        'Instantiate a prefab into the scene',
        {
            path: z.string().describe('Prefab asset path (relative or UUID)'),
            parent: z.union([z.number(), z.string()]).optional().describe('Parent entity ID or name'),
        },
        async (args: { path: string; parent?: number | string }) => {
            const result = await bridge.post('/scene/instantiate-prefab', args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'new_scene',
        'Create a new empty scene (discards current scene)',
        {},
        async () => {
            const result = await bridge.post('/scene/new', {});
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'open_scene',
        'Open a scene file by path',
        {
            path: z.string().describe('Scene file path (e.g., "assets/scenes/main.esscene")'),
        },
        async (args: { path: string }) => {
            const result = await bridge.post('/scene/open', { path: args.path });
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'toggle_entity_visibility',
        'Toggle an entity\'s visibility in the editor',
        {
            entity: z.union([z.number(), z.string()]).describe('Entity ID or name'),
        },
        async (args: { entity: number | string }) => {
            const body = typeof args.entity === 'number' ? { id: args.entity } : { name: args.entity };
            const result = await bridge.post('/scene/toggle-visibility', body);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );
}
