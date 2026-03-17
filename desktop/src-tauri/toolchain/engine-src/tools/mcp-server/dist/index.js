#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeClient } from './bridge.js';
import { registerSceneTools } from './tools/scene.js';
import { registerStateTools } from './tools/state.js';
import { registerActionTools } from './tools/actions.js';
import { registerVisualTools } from './tools/visual.js';
import { registerUITools } from './tools/ui.js';
import { registerResources } from './resources.js';
const bridge = new BridgeClient();
const server = new McpServer({
    name: 'esengine-editor',
    version: '0.1.0',
});
registerSceneTools(server, bridge);
registerStateTools(server, bridge);
registerActionTools(server, bridge);
registerVisualTools(server, bridge);
registerUITools(server, bridge);
registerResources(server, bridge);
async function main() {
    const discovered = await bridge.discover();
    if (!discovered) {
        console.error('[MCP] No running ESEngine editor found. Start the editor first.');
    }
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((e) => {
    console.error('[MCP] Fatal error:', e);
    process.exit(1);
});
