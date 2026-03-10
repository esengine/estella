import type { BridgeClient } from './bridge.js';

export function registerResources(
    server: { resource: Function; prompt: Function },
    bridge: BridgeClient,
): void {
    server.resource(
        'editor://components',
        'editor://components',
        'All registered component schemas and default values',
        async () => {
            const result = await bridge.get('/state/settings');
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
        'Asset inventory with UUIDs, paths, and types',
        async () => {
            const result = await bridge.get('/scene/tree');
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
