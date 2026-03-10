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
}
