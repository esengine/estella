import type { BridgeClient } from './bridge.js';
import { SDK_API_REFERENCE } from './sdk-reference.js';

export function registerResources(
    server: { resource: Function; prompt: Function },
    bridge: BridgeClient,
): void {
    server.resource(
        'editor://sdk-api',
        'editor://sdk-api',
        { description: 'ESEngine SDK API reference: defineComponent, defineSystem, Query, Schedule, built-in components, script template' },
        async () => ({
            contents: [{
                uri: 'editor://sdk-api',
                text: SDK_API_REFERENCE,
                mimeType: 'text/markdown',
            }],
        }),
    );

    server.resource(
        'editor://components',
        'editor://components',
        { description: 'All registered component types grouped by category' },
        async () => {
            const result = await bridge.get('/components/list');
            return {
                contents: [{
                    uri: 'editor://components',
                    text: JSON.stringify(result, null, 2),
                    mimeType: 'application/json',
                }],
            };
        },
    );

    server.resource(
        'editor://assets',
        'editor://assets',
        { description: 'All project assets with UUIDs, paths, and types' },
        async () => {
            const result = await bridge.get('/assets/list');
            return {
                contents: [{
                    uri: 'editor://assets',
                    text: JSON.stringify(result, null, 2),
                    mimeType: 'application/json',
                }],
            };
        },
    );

    server.prompt(
        'create-game-object',
        'Guide: create a game entity with components and script',
        [],
        async () => ({
            messages: [{
                role: 'user' as const,
                content: {
                    type: 'text' as const,
                    text: 'I want to create a new game object. Please:\n' +
                        '1. Read editor://sdk-api resource to understand the API\n' +
                        '2. Use list_components to see available component types\n' +
                        '3. Use create_entity with the appropriate components\n' +
                        '4. If custom behavior is needed, use create_script to write a script\n' +
                        '5. Use reload_scripts after creating scripts\n' +
                        '6. Use set_property to configure component values\n' +
                        '7. Use save_scene to persist changes',
                },
            }],
        }),
    );

    server.prompt(
        'inspect-ui',
        'Inspect UI: capture screenshot, get selection, entity data, and console logs',
        [],
        async () => ({
            messages: [{
                role: 'user' as const,
                content: {
                    type: 'text' as const,
                    text: 'Please inspect the current UI state. Use these tools in order:\n' +
                        '1. capture_editor - take a screenshot\n' +
                        '2. get_selection - see what is selected\n' +
                        '3. get_entity_data - get selected entity details\n' +
                        '4. get_console_logs - check for errors\n\n' +
                        'Then provide analysis and suggestions.',
                },
            }],
        }),
    );

    server.prompt(
        'review-layout',
        'Review layout: capture screenshot, get panel layout, and render stats',
        [],
        async () => ({
            messages: [{
                role: 'user' as const,
                content: {
                    type: 'text' as const,
                    text: 'Please review the editor layout. Use these tools:\n' +
                        '1. capture_editor - take a screenshot\n' +
                        '2. get_panel_layout - get panel positions\n' +
                        '3. get_render_stats - check performance\n\n' +
                        'Then analyze the layout and suggest improvements.',
                },
            }],
        }),
    );
}
