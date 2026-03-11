import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface BridgeInfo {
    port: number;
    pid: number;
    projectPath: string;
}

export class BridgeClient {
    private baseUrl_: string | null = null;

    async discover(projectPath?: string): Promise<boolean> {
        const dir = join(homedir(), '.esengine');
        let files: string[];
        try {
            files = await readdir(dir);
        } catch {
            return false;
        }

        const bridges: BridgeInfo[] = [];
        for (const file of files) {
            if (!file.startsWith('bridge-') || !file.endsWith('.json')) continue;
            try {
                const content = await readFile(join(dir, file), 'utf-8');
                const info = JSON.parse(content) as BridgeInfo;
                if (isProcessAlive(info.pid)) {
                    bridges.push(info);
                }
            } catch {
                continue;
            }
        }

        if (bridges.length === 0) return false;

        if (projectPath) {
            const match = bridges.find(b => b.projectPath === projectPath);
            if (match) {
                this.baseUrl_ = `http://127.0.0.1:${match.port}`;
                return true;
            }
        }

        this.baseUrl_ = `http://127.0.0.1:${bridges[0].port}`;
        return true;
    }

    get connected(): boolean {
        return this.baseUrl_ !== null;
    }

    async get(path: string): Promise<unknown> {
        if (!this.baseUrl_) throw new Error('Editor is not running');
        const res = await fetch(`${this.baseUrl_}${path}`);
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Bridge error (${res.status}): ${body}`);
        }
        return res.json();
    }

    async post(path: string, body: unknown): Promise<unknown> {
        if (!this.baseUrl_) throw new Error('Editor is not running');
        const res = await fetch(`${this.baseUrl_}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Bridge error (${res.status}): ${text}`);
        }
        return res.json();
    }

    async health(): Promise<unknown> {
        return this.get('/health');
    }
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
