import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import { getRecentProjects } from '../launcher/ProjectService';
import { EXAMPLE_PROJECTS } from '../types/ProjectTypes';

interface McpRequest {
    id: string;
    method: string;
    params: Record<string, unknown>;
}

export interface LauncherBridgeCallbacks {
    onOpenProject: (projectPath: string) => void;
}

export class LauncherBridge {
    private unlisten_: UnlistenFn | null = null;
    private callbacks_: LauncherBridgeCallbacks;

    constructor(callbacks: LauncherBridgeCallbacks) {
        this.callbacks_ = callbacks;
        this.setup_();
    }

    dispose(): void {
        if (this.unlisten_) {
            this.unlisten_();
            this.unlisten_ = null;
        }
    }

    private async setup_(): Promise<void> {
        this.unlisten_ = await listen<McpRequest>('mcp-request', (event) => {
            this.handleRequest_(event.payload);
        });
    }

    private async handleRequest_(req: McpRequest): Promise<void> {
        const { id, method, params } = req;
        try {
            const result = await this.dispatch_(method, params);
            await emit(`mcp-response-${id}`, { ok: true, data: result });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await emit(`mcp-response-${id}`, { ok: false, error: msg });
        }
    }

    private async dispatch_(method: string, params: Record<string, unknown>): Promise<unknown> {
        switch (method) {
            case 'getEditorStatus':
                return { mode: 'launcher' };

            case 'listRecentProjects':
                return getRecentProjects();

            case 'listExamples':
                return EXAMPLE_PROJECTS.map(e => ({
                    id: e.id,
                    name: e.name,
                    description: e.description,
                    category: e.category,
                }));

            case 'openProject': {
                const path = params.path as string;
                if (!path) throw new Error('Missing "path" parameter');
                this.callbacks_.onOpenProject(path);
                return { success: true };
            }

            case 'createFromExample': {
                const { createFromExample } = await import('../launcher/ProjectService');
                const exampleId = params.example as string;
                const name = params.name as string;
                const location = params.location as string;
                if (!exampleId || !name || !location) {
                    throw new Error('Missing required parameters: example, name, location');
                }
                const example = EXAMPLE_PROJECTS.find(e => e.id === exampleId);
                if (!example) throw new Error(`Unknown example: ${exampleId}`);
                const result = await createFromExample({ name, location, example });
                if (!result.success) throw new Error(result.error);
                this.callbacks_.onOpenProject(result.data!);
                return { success: true, projectPath: result.data };
            }

            default:
                throw new Error(`Unknown method in launcher mode: ${method}. Open a project first to access editor tools.`);
        }
    }
}
