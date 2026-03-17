import { z } from 'zod';
import { resolveEntityRef } from './entity-ref.js';
export function registerSceneTools(server, bridge) {
    server.tool('get_scene_tree', 'Get the entity hierarchy of the current scene', { depth: z.number().optional().describe('Max tree depth') }, async (args) => {
        const query = args.depth != null ? `?depth=${args.depth}` : '';
        const result = await bridge.get(`/scene/tree${query}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    server.tool('get_entity_data', 'Get all component data for an entity by ID or name', {
        entity: z.union([z.number(), z.string()]).describe('Entity ID (number) or name (string)'),
    }, async (args) => {
        const ref = resolveEntityRef(args.entity);
        const param = 'id' in ref ? `id=${ref.id}` : `name=${encodeURIComponent(ref.name)}`;
        const result = await bridge.get(`/scene/entity?${param}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    server.tool('get_selection', 'Get currently selected entities and asset in the editor', {}, async () => {
        const result = await bridge.get('/scene/selection');
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    server.tool('find_entities', 'Find entities by name (fuzzy match) or component type (exact match)', { query: z.string().describe('Search query: entity name or component type') }, async (args) => {
        const result = await bridge.get(`/scene/find?query=${encodeURIComponent(args.query)}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    server.tool('create_entity', 'Create a new entity in the scene, optionally with components', {
        name: z.string().optional().describe('Entity name (default: "Entity")'),
        parent: z.union([z.number(), z.string()]).optional().describe('Parent entity ID or name'),
        components: z.array(z.object({
            type: z.string().describe('Component type (e.g., "Transform", "Sprite")'),
            data: z.record(z.unknown()).optional().describe('Component data overrides'),
        })).optional().describe('Components to add (defaults are auto-filled)'),
    }, async (args) => {
        const result = await bridge.post('/scene/create-entity', args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    server.tool('delete_entity', 'Delete an entity from the scene', {
        entity: z.union([z.number(), z.string()]).describe('Entity ID or name'),
    }, async (args) => {
        const body = resolveEntityRef(args.entity);
        const result = await bridge.post('/scene/delete-entity', body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
    server.tool('rename_entity', 'Rename an entity', {
        entity: z.union([z.number(), z.string()]).describe('Entity ID or current name'),
        newName: z.string().describe('New name for the entity'),
    }, async (args) => {
        const body = { ...resolveEntityRef(args.entity), newName: args.newName };
        const result = await bridge.post('/scene/rename-entity', body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
    server.tool('reparent_entity', 'Move an entity under a new parent (or to root if newParent is null)', {
        entity: z.union([z.number(), z.string()]).describe('Entity ID or name'),
        newParent: z.union([z.number(), z.string()]).nullable().describe('New parent entity ID/name, or null for root'),
    }, async (args) => {
        const body = { newParent: args.newParent };
        Object.assign(body, resolveEntityRef(args.entity));
        const result = await bridge.post('/scene/reparent-entity', body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
    server.tool('add_component', `Add a component to an entity (defaults are auto-filled). Use list_components to see available types.
Key components for animation:
- TimelinePlayer: { timeline: "<.estimeline UUID>", playing: false, speed: 1, wrapMode: "once" }
- SpriteAnimator: { clip: "<.esanim UUID>", playing: false }
To play esanim via timeline: entity needs both TimelinePlayer and SpriteAnimator, and the timeline must have a spriteAnim track referencing the esanim asset.`, {
        entity: z.union([z.number(), z.string()]).describe('Entity ID or name'),
        component: z.string().describe('Component type (e.g., "Transform", "Sprite", "RigidBody")'),
        data: z.record(z.unknown()).optional().describe('Component data overrides'),
    }, async (args) => {
        const body = { component: args.component };
        Object.assign(body, resolveEntityRef(args.entity));
        if (args.data)
            body.data = args.data;
        const result = await bridge.post('/scene/add-component', body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
    server.tool('remove_component', 'Remove a component from an entity', {
        entity: z.union([z.number(), z.string()]).describe('Entity ID or name'),
        component: z.string().describe('Component type to remove'),
    }, async (args) => {
        const body = { component: args.component };
        Object.assign(body, resolveEntityRef(args.entity));
        const result = await bridge.post('/scene/remove-component', body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
    server.tool('duplicate_entity', 'Duplicate an entity with all its components', {
        entity: z.union([z.number(), z.string()]).describe('Entity ID or name to duplicate'),
    }, async (args) => {
        const body = resolveEntityRef(args.entity);
        const result = await bridge.post('/scene/duplicate-entity', body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
    server.tool('instantiate_prefab', 'Instantiate a prefab into the scene', {
        path: z.string().describe('Prefab asset path (relative or UUID)'),
        parent: z.union([z.number(), z.string()]).optional().describe('Parent entity ID or name'),
    }, async (args) => {
        const result = await bridge.post('/scene/instantiate-prefab', args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
    server.tool('new_scene', 'Create a new empty scene (discards current scene)', { force: { type: 'boolean', description: 'Skip save confirmation dialog (default: true)' } }, async ({ force = true }) => {
        const result = await bridge.post('/scene/new', { force });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
    server.tool('open_scene', 'Open a scene file by path', {
        path: z.string().describe('Scene file path (e.g., "assets/scenes/main.esscene")'),
    }, async (args) => {
        const result = await bridge.post('/scene/open', { path: args.path });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
    server.tool('toggle_entity_visibility', 'Toggle an entity\'s visibility in the editor', {
        entity: z.union([z.number(), z.string()]).describe('Entity ID or name'),
    }, async (args) => {
        const body = resolveEntityRef(args.entity);
        const result = await bridge.post('/scene/toggle-visibility', body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
}
