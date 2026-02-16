import path from 'path';
import { stat, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import * as logger from './utils/logger.js';

export class BuildManifest {
    constructor() {
        this.targets = {};
        this.buildStartTime = Date.now();
        this.buildEndTime = null;
    }

    startTarget(name) {
        this.targets[name] = {
            name,
            startTime: Date.now(),
            endTime: null,
            duration: null,
            outputs: [],
            status: 'building',
        };
    }

    async endTarget(name, buildResult) {
        if (!this.targets[name]) {
            logger.warn(`Target ${name} not found in manifest`);
            return;
        }

        const target = this.targets[name];
        target.endTime = Date.now();
        target.duration = target.endTime - target.startTime;
        target.status = 'success';

        if (buildResult && buildResult.outputDir) {
            await this.collectOutputs(name, buildResult);
        }
    }

    async collectOutputs(targetName, buildResult) {
        const target = this.targets[targetName];
        const { outputDir } = buildResult;

        if (!existsSync(outputDir)) {
            return;
        }

        const outputs = buildResult.outputs || [];
        for (const outputPath of outputs) {
            const fullPath = path.join(outputDir, outputPath);
            if (existsSync(fullPath)) {
                const stats = await stat(fullPath);
                const hash = await this.computeFileHash(fullPath);

                target.outputs.push({
                    path: outputPath,
                    size: stats.size,
                    sizeKB: Math.round(stats.size / 1024),
                    sha256: hash,
                });
            }
        }
    }

    async computeFileHash(filePath) {
        try {
            const content = await readFile(filePath);
            return createHash('sha256').update(content).digest('hex');
        } catch {
            return null;
        }
    }

    markTargetFailed(name, error) {
        if (!this.targets[name]) {
            logger.warn(`Target ${name} not found in manifest`);
            return;
        }

        const target = this.targets[name];
        target.endTime = Date.now();
        target.duration = target.endTime - target.startTime;
        target.status = 'failed';
        target.error = error.message;
    }

    finalize() {
        this.buildEndTime = Date.now();
    }

    async save(outputPath) {
        this.finalize();

        const manifest = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            build: {
                startTime: this.buildStartTime,
                endTime: this.buildEndTime,
                duration: this.buildEndTime - this.buildStartTime,
            },
            targets: Object.values(this.targets),
            summary: {
                total: Object.keys(this.targets).length,
                success: Object.values(this.targets).filter(t => t.status === 'success').length,
                failed: Object.values(this.targets).filter(t => t.status === 'failed').length,
                totalOutputs: Object.values(this.targets).reduce((sum, t) => sum + t.outputs.length, 0),
                totalSize: Object.values(this.targets).reduce(
                    (sum, t) => sum + t.outputs.reduce((s, o) => s + o.size, 0),
                    0
                ),
            },
        };

        try {
            await mkdir(path.dirname(outputPath), { recursive: true });
            await writeFile(outputPath, JSON.stringify(manifest, null, 2), 'utf-8');
            logger.success(`Build manifest saved to ${outputPath}`);
        } catch (err) {
            logger.error(`Failed to save build manifest: ${err.message}`);
        }
    }

    printSummary() {
        const targets = Object.values(this.targets);
        if (targets.length === 0) {
            return;
        }

        logger.info('\n📊 Build Summary:');
        for (const target of targets) {
            const status = target.status === 'success' ? '✓' : '✗';
            const duration = (target.duration / 1000).toFixed(2);
            const totalSize = target.outputs.reduce((sum, o) => sum + o.sizeKB, 0);

            logger.info(`  ${status} ${target.name}: ${duration}s (${target.outputs.length} files, ${totalSize}KB)`);
        }

        const endTime = this.buildEndTime || Date.now();
        const totalDuration = (endTime - this.buildStartTime) / 1000;
        logger.info(`\n⏱️  Total: ${totalDuration.toFixed(2)}s`);
    }
}
