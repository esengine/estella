import { z } from 'zod';
import type { BridgeClient } from '../bridge.js';

export function registerStateTools(
    server: { tool: Function },
    bridge: BridgeClient,
): void {
    server.tool(
        'get_console_logs',
        'Get recent console logs from the editor',
        {
            count: z.number().optional().describe('Number of log entries (default 50)'),
            level: z.string().optional().describe('Filter by level: stdout|stderr|error|success|command'),
        },
        async (args: { count?: number; level?: string }) => {
            const params = new URLSearchParams();
            if (args.count != null) params.set('count', String(args.count));
            if (args.level) params.set('level', args.level);
            const query = params.toString();
            const result = await bridge.get(`/state/logs${query ? '?' + query : ''}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'get_panel_layout',
        'Get the list of editor panels and their positions',
        {},
        async () => {
            const result = await bridge.get('/state/layout');
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'get_project_settings',
        'Get project settings (all non-default values, or specific keys)',
        {
            keys: z.array(z.string()).optional().describe('Specific setting keys to retrieve'),
        },
        async (args: { keys?: string[] }) => {
            const query = args.keys ? `?keys=${args.keys.join(',')}` : '';
            const result = await bridge.get(`/state/settings${query}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'get_build_status',
        'Get recent build history entries',
        {},
        async () => {
            const result = await bridge.get('/state/build');
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'get_render_stats',
        'Get current frame timing and system performance data',
        {},
        async () => {
            const result = await bridge.get('/state/render-stats');
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'list_assets',
        'List all assets in the project, optionally filtered by type',
        {
            type: z.string().optional().describe('Filter by asset type (e.g., "texture", "scene", "script", "audio")'),
        },
        async (args: { type?: string }) => {
            const query = args.type ? `?type=${encodeURIComponent(args.type)}` : '';
            const result = await bridge.get(`/assets/list${query}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'get_asset_info',
        'Get detailed information about a specific asset by UUID or path',
        {
            uuid: z.string().optional().describe('Asset UUID'),
            path: z.string().optional().describe('Asset relative path'),
        },
        async (args: { uuid?: string; path?: string }) => {
            const params = args.uuid ? `uuid=${args.uuid}` : `path=${encodeURIComponent(args.path!)}`;
            const result = await bridge.get(`/assets/info?${params}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'get_timeline_data',
        `Get timeline asset data. Returns { duration, wrapMode, tracks[] }.
Use list_assets with type="timeline" to find timeline UUIDs, or get_entity_data to read TimelinePlayer.timeline field.`,
        {
            uuid: z.string().optional().describe('Timeline asset UUID'),
            path: z.string().optional().describe('Timeline asset relative path'),
        },
        async (args: { uuid?: string; path?: string }) => {
            const params = args.uuid ? `uuid=${args.uuid}` : `path=${encodeURIComponent(args.path!)}`;
            const result = await bridge.get(`/timeline/data?${params}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'update_timeline_data',
        `Update a .estimeline asset file. Provide uuid/path plus any top-level fields to patch (tracks, duration, wrapMode).

IMPORTANT: "tracks" replaces the full array — always read first with get_timeline_data, modify, then write back.

## How timeline works
- An entity needs a TimelinePlayer component with "timeline" field set to the .estimeline asset UUID.
- The entity also needs the target components (Transform, Sprite, SpriteAnimator, etc.) that the tracks animate.
- To control esanim: add a spriteAnim track referencing the .esanim asset UUID. The entity must also have a SpriteAnimator component.
- Use set_property to change TimelinePlayer fields (wrapMode, playing, speed) on the entity.

## Track type schemas

### property — animate component fields with keyframes
{ type: "property", name: string, component: "Transform"|"Sprite"|"UIRect"|..., childPath: "" (or "ChildName/GrandChild"),
  channels: [{ property: "position.x"|"scale.y"|"color.r"|...,
    keyframes: [{ time: number, value: number, inTangent: 0, outTangent: 0, interpolation: "linear"|"easeIn"|"easeOut"|"easeInOut"|"step"|"hermite" }] }] }

### spine — play spine animations on SpineAnimation component
{ type: "spine", name: string, childPath: "",
  clips: [{ start: number, duration: number, animation: "idle"|..., speed: 1, loop: true }], blendIn: 0 }

### spriteAnim — trigger a SpriteAnimator clip (esanim). Entity must have SpriteAnimator component.
{ type: "spriteAnim", name: string, childPath: "",
  clip: "<esanim-asset-UUID-or-path>", startTime: 0 }

### audio — play audio clips
{ type: "audio", name: string, childPath: "",
  events: [{ time: number, clip: "<audio-asset-UUID>", volume: 1 }] }

### activation — show/hide entity in time ranges
{ type: "activation", name: string, childPath: "",
  ranges: [{ start: number, end: number }] }

### marker — named time markers (no runtime effect, for editor use)
{ type: "marker", name: string, childPath: "",
  markers: [{ time: number, name: string }] }

### customEvent — custom events with payload
{ type: "customEvent", name: string, childPath: "",
  events: [{ time: number, name: string, payload: {} }] }

## Example: add a spriteAnim track to play idle.esanim at t=0
1. get_timeline_data({ uuid: "..." })  →  read existing tracks
2. Append: { type: "spriteAnim", name: "Idle", childPath: "", clip: "<idle.esanim-uuid>", startTime: 0 }
3. update_timeline_data({ uuid: "...", tracks: [...existing, newTrack] })
4. Ensure the entity has SpriteAnimator component: add_component({ entity: id, component: "SpriteAnimator", data: { clip: "<idle.esanim-uuid>" } })
5. Set loop playback: set_property({ entity: id, component: "TimelinePlayer", field: "wrapMode", value: "loop" })`,
        {
            uuid: z.string().optional().describe('Timeline asset UUID'),
            path: z.string().optional().describe('Timeline asset relative path'),
            tracks: z.array(z.record(z.unknown())).optional().describe('Full tracks array to replace (read first, modify, write back)'),
            duration: z.number().optional().describe('Timeline duration in seconds'),
            wrapMode: z.string().optional().describe('Wrap mode: once, loop, pingPong'),
        },
        async (args: { uuid?: string; path?: string; tracks?: Record<string, unknown>[]; duration?: number; wrapMode?: string }) => {
            const result = await bridge.post('/timeline/update', args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'get_asset_meta',
        'Get full asset meta: UUID, importer settings, labels, address, group, platform overrides',
        {
            uuid: z.string().optional().describe('Asset UUID'),
            path: z.string().optional().describe('Asset relative path'),
        },
        async (args: { uuid?: string; path?: string }) => {
            const params = args.uuid ? `uuid=${args.uuid}` : `path=${encodeURIComponent(args.path!)}`;
            const result = await bridge.get(`/assets/meta?${params}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'update_asset_meta',
        'Update asset meta: labels, address, group, importer settings, platform overrides',
        {
            uuid: z.string().describe('Asset UUID'),
            labels: z.array(z.string()).optional().describe('Asset labels'),
            address: z.string().nullable().optional().describe('Addressable name (unique) or null to clear'),
            group: z.string().optional().describe('Asset group name'),
            importer: z.record(z.unknown()).optional().describe('Importer settings (type-specific)'),
            platformOverrides: z.record(z.record(z.unknown())).optional().describe('Platform-specific importer overrides'),
        },
        async (args: { uuid: string; labels?: string[]; address?: string | null; group?: string; importer?: Record<string, unknown>; platformOverrides?: Record<string, Record<string, unknown>> }) => {
            const result = await bridge.post('/assets/meta/update', args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'ensure_asset_meta',
        'Generate .meta file for an asset if it does not exist, returns the UUID',
        {
            path: z.string().describe('Asset relative path (e.g., "assets/textures/player.png")'),
        },
        async (args: { path: string }) => {
            const result = await bridge.post('/assets/meta/ensure', args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'create_asset',
        'Create a new asset file with default content and auto-generate .meta',
        {
            type: z.enum(['material', 'scene', 'shader', 'anim-clip', 'timeline', 'bitmap-font']).describe('Asset type'),
            name: z.string().describe('Asset file name (extension auto-added if missing)'),
            dir: z.string().optional().describe('Directory relative to project root (default: "assets")'),
        },
        async (args: { type: string; name: string; dir?: string }) => {
            const result = await bridge.post('/assets/create', args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'delete_asset',
        'Delete an asset file and its .meta file',
        {
            uuid: z.string().optional().describe('Asset UUID'),
            path: z.string().optional().describe('Asset relative path'),
        },
        async (args: { uuid?: string; path?: string }) => {
            const result = await bridge.post('/assets/delete', args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'rename_asset',
        'Rename an asset file and update its .meta file',
        {
            uuid: z.string().optional().describe('Asset UUID'),
            path: z.string().optional().describe('Asset relative path'),
            newName: z.string().describe('New file name (e.g., "player_idle.png")'),
        },
        async (args: { uuid?: string; path?: string; newName: string }) => {
            const result = await bridge.post('/assets/rename', args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        },
    );

    server.tool(
        'list_components',
        'List all available component types grouped by category (builtin, ui, physics, script, tag)',
        {},
        async () => {
            const result = await bridge.get('/components/list');
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'get_component_schema',
        'Get detailed schema for a component: fields, types, defaults, ranges, and constraints',
        {
            name: z.string().describe('Component type name (e.g., "Transform", "Sprite", "RigidBody")'),
        },
        async (args: { name: string }) => {
            const result = await bridge.get(`/components/schema?name=${encodeURIComponent(args.name)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'list_menus',
        'List all editor menu items with IDs, labels, shortcuts, and enabled state',
        {},
        async () => {
            const result = await bridge.get('/menus/list');
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    server.tool(
        'get_scene_metadata',
        'Get current scene info: name, file path, dirty state, design resolution, undo/redo status',
        {},
        async () => {
            const result = await bridge.get('/scene/metadata');
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );
}
