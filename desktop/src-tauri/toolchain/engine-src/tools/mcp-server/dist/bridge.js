import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Agent, fetch as undiciFetch } from 'undici';
const localAgent = new Agent({ connect: { timeout: 5_000 } });
export class BridgeClient {
    baseUrl_ = null;
    async discover(projectPath) {
        const dir = join(homedir(), '.esengine');
        let files;
        try {
            files = await readdir(dir);
        }
        catch {
            console.error(`[MCP] Bridge directory not found: ${dir}`);
            return false;
        }
        const bridgeFiles = files.filter(f => f.startsWith('bridge-') && f.endsWith('.json'));
        if (bridgeFiles.length === 0) {
            console.error(`[MCP] No bridge files in ${dir}`);
            return false;
        }
        const bridges = [];
        for (const file of bridgeFiles) {
            try {
                const content = await readFile(join(dir, file), 'utf-8');
                const info = JSON.parse(content);
                if (isProcessAlive(info.pid)) {
                    bridges.push(info);
                }
                else {
                    console.error(`[MCP] Stale bridge file ${file} (pid ${info.pid} not alive)`);
                }
            }
            catch {
                continue;
            }
        }
        if (bridges.length === 0)
            return false;
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
    get connected() {
        return this.baseUrl_ !== null;
    }
    async get(path) {
        if (!this.baseUrl_)
            throw new Error('Editor is not running');
        const res = await undiciFetch(`${this.baseUrl_}${path}`, { dispatcher: localAgent });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Bridge error (${res.status}): ${body}`);
        }
        return res.json();
    }
    async post(path, body) {
        if (!this.baseUrl_)
            throw new Error('Editor is not running');
        const res = await undiciFetch(`${this.baseUrl_}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            dispatcher: localAgent,
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Bridge error (${res.status}): ${text}`);
        }
        return res.json();
    }
    async health() {
        return this.get('/health');
    }
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        if (e && typeof e === 'object' && 'code' in e && e.code === 'EPERM') {
            return true;
        }
        return false;
    }
}
