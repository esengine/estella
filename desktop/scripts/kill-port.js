#!/usr/bin/env node
/**
 * @file    kill-port.js
 * @brief   Kill process occupying specified port before starting dev server
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PORT = 5173;
const HMR_PORT = 5174;

async function killProcessOnPort(port) {
    try {
        const isWin = process.platform === 'win32';

        if (isWin) {
            const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
            const lines = stdout.trim().split('\n');

            const pids = new Set();
            for (const line of lines) {
                const match = line.match(/LISTENING\s+(\d+)/);
                if (match) {
                    pids.add(match[1]);
                }
            }

            if (pids.size > 0) {
                console.log(`[kill-port] Found ${pids.size} process(es) on port ${port}`);
                for (const pid of pids) {
                    try {
                        await execAsync(`taskkill /PID ${pid} /F`);
                        console.log(`[kill-port] Killed process ${pid} on port ${port}`);
                    } catch (e) {
                        console.warn(`[kill-port] Failed to kill process ${pid}:`, e.message);
                    }
                }
            } else {
                console.log(`[kill-port] Port ${port} is free`);
            }
        } else {
            const { stdout } = await execAsync(`lsof -ti:${port} || true`);
            const pids = stdout.trim().split('\n').filter(Boolean);

            if (pids.length > 0) {
                console.log(`[kill-port] Found ${pids.length} process(es) on port ${port}`);
                for (const pid of pids) {
                    try {
                        await execAsync(`kill -9 ${pid}`);
                        console.log(`[kill-port] Killed process ${pid} on port ${port}`);
                    } catch (e) {
                        console.warn(`[kill-port] Failed to kill process ${pid}:`, e.message);
                    }
                }
            } else {
                console.log(`[kill-port] Port ${port} is free`);
            }
        }
    } catch (error) {
        if (error.message.includes('cannot find')) {
            console.log(`[kill-port] Port ${port} is free`);
        } else {
            console.warn(`[kill-port] Error checking port ${port}:`, error.message);
        }
    }
}

async function main() {
    console.log('[kill-port] Checking ports before starting...');
    await killProcessOnPort(PORT);
    await killProcessOnPort(HMR_PORT);
    console.log('[kill-port] Port check complete\n');
}

main().catch(console.error);
