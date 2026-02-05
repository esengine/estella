/**
 * @file    BuildPipeline.ts
 * @brief   Parallel build task execution with dependency management
 */

import { BuildProgressReporter } from './BuildProgress';

// =============================================================================
// Types
// =============================================================================

export interface BuildTask {
    id: string;
    name: string;
    dependencies: string[];
    execute: () => Promise<void>;
    weight: number;
}

export interface TaskResult {
    id: string;
    success: boolean;
    error?: string;
    duration: number;
}

export interface PipelineResult {
    success: boolean;
    results: TaskResult[];
    totalDuration: number;
}

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

interface TaskState {
    task: BuildTask;
    status: TaskStatus;
    result?: TaskResult;
}

// =============================================================================
// BuildPipeline Class
// =============================================================================

export class BuildPipeline {
    private tasks_: Map<string, TaskState>;
    private progress_: BuildProgressReporter | null;
    private totalWeight_: number;
    private completedWeight_: number;
    private aborted_: boolean;

    constructor(progress?: BuildProgressReporter) {
        this.tasks_ = new Map();
        this.progress_ = progress || null;
        this.totalWeight_ = 0;
        this.completedWeight_ = 0;
        this.aborted_ = false;
    }

    addTask(task: BuildTask): void {
        this.tasks_.set(task.id, {
            task,
            status: 'pending',
        });
        this.totalWeight_ += task.weight;
    }

    addTasks(tasks: BuildTask[]): void {
        for (const task of tasks) {
            this.addTask(task);
        }
    }

    abort(): void {
        this.aborted_ = true;
    }

    private canExecute(taskId: string): boolean {
        const state = this.tasks_.get(taskId);
        if (!state || state.status !== 'pending') {
            return false;
        }

        for (const depId of state.task.dependencies) {
            const depState = this.tasks_.get(depId);
            if (!depState || depState.status !== 'completed') {
                return false;
            }
        }

        return true;
    }

    private getExecutableTasks(): string[] {
        const executable: string[] = [];
        for (const [id] of this.tasks_) {
            if (this.canExecute(id)) {
                executable.push(id);
            }
        }
        return executable;
    }

    private hasFailed(): boolean {
        for (const [, state] of this.tasks_) {
            if (state.status === 'failed') {
                return true;
            }
        }
        return false;
    }

    private hasBlockedTasks(): boolean {
        for (const [, state] of this.tasks_) {
            if (state.status === 'pending') {
                const canRun = this.canExecute(state.task.id);
                if (!canRun) {
                    const blockedByFailed = state.task.dependencies.some(depId => {
                        const depState = this.tasks_.get(depId);
                        return depState?.status === 'failed';
                    });
                    if (blockedByFailed) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private allCompleted(): boolean {
        for (const [, state] of this.tasks_) {
            if (state.status !== 'completed' && state.status !== 'failed') {
                return false;
            }
        }
        return true;
    }

    private updateProgress(): void {
        if (!this.progress_) return;

        const percentage = this.totalWeight_ > 0
            ? (this.completedWeight_ / this.totalWeight_) * 100
            : 0;

        this.progress_.setCurrentTask('Executing tasks...', percentage);
    }

    async execute(): Promise<PipelineResult> {
        const startTime = Date.now();
        const results: TaskResult[] = [];

        this.validateDependencies();

        while (!this.allCompleted() && !this.aborted_) {
            const executableIds = this.getExecutableTasks();

            if (executableIds.length === 0) {
                if (this.hasFailed() || this.hasBlockedTasks()) {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 10));
                continue;
            }

            const promises = executableIds.map(async (taskId) => {
                const state = this.tasks_.get(taskId)!;
                state.status = 'running';

                this.progress_?.log('info', `Starting: ${state.task.name}`);

                const taskStart = Date.now();

                try {
                    await state.task.execute();
                    const duration = Date.now() - taskStart;

                    state.status = 'completed';
                    state.result = {
                        id: taskId,
                        success: true,
                        duration,
                    };

                    this.completedWeight_ += state.task.weight;
                    this.updateProgress();

                    this.progress_?.log('info', `Completed: ${state.task.name} (${duration}ms)`);
                    results.push(state.result);
                } catch (err) {
                    const duration = Date.now() - taskStart;
                    const errorMsg = err instanceof Error ? err.message : String(err);

                    state.status = 'failed';
                    state.result = {
                        id: taskId,
                        success: false,
                        error: errorMsg,
                        duration,
                    };

                    this.progress_?.log('error', `Failed: ${state.task.name} - ${errorMsg}`);
                    results.push(state.result);
                }
            });

            await Promise.all(promises);
        }

        const totalDuration = Date.now() - startTime;
        const success = !this.hasFailed() && !this.aborted_ && this.allCompleted();

        return {
            success,
            results,
            totalDuration,
        };
    }

    private validateDependencies(): void {
        for (const [id, state] of this.tasks_) {
            for (const depId of state.task.dependencies) {
                if (!this.tasks_.has(depId)) {
                    throw new Error(`Task '${id}' depends on unknown task '${depId}'`);
                }
            }
        }

        this.detectCycles();
    }

    private detectCycles(): void {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const dfs = (taskId: string): boolean => {
            visited.add(taskId);
            recursionStack.add(taskId);

            const state = this.tasks_.get(taskId);
            if (state) {
                for (const depId of state.task.dependencies) {
                    if (!visited.has(depId)) {
                        if (dfs(depId)) return true;
                    } else if (recursionStack.has(depId)) {
                        return true;
                    }
                }
            }

            recursionStack.delete(taskId);
            return false;
        };

        for (const [id] of this.tasks_) {
            if (!visited.has(id)) {
                if (dfs(id)) {
                    throw new Error('Circular dependency detected in build tasks');
                }
            }
        }
    }

    getTaskIds(): string[] {
        return Array.from(this.tasks_.keys());
    }

    getTaskStatus(taskId: string): TaskStatus | undefined {
        return this.tasks_.get(taskId)?.status;
    }
}

// =============================================================================
// Task Builder Helpers
// =============================================================================

export function createTask(
    id: string,
    name: string,
    execute: () => Promise<void>,
    options?: { dependencies?: string[]; weight?: number }
): BuildTask {
    return {
        id,
        name,
        execute,
        dependencies: options?.dependencies || [],
        weight: options?.weight || 1,
    };
}

export function createPlayableTasks(
    loadSdk: () => Promise<void>,
    compileScripts: () => Promise<void>,
    collectAssets: () => Promise<void>,
    loadScene: () => Promise<void>,
    assembleHtml: () => Promise<void>,
    writeOutput: () => Promise<void>
): BuildTask[] {
    return [
        createTask('loadSdk', 'Load SDK', loadSdk, { weight: 1 }),
        createTask('compileScripts', 'Compile Scripts', compileScripts, { weight: 3 }),
        createTask('collectAssets', 'Collect Assets', collectAssets, { weight: 2 }),
        createTask('loadScene', 'Load Scene', loadScene, { weight: 1 }),
        createTask('assembleHtml', 'Assemble HTML', assembleHtml, {
            dependencies: ['loadSdk', 'compileScripts', 'collectAssets', 'loadScene'],
            weight: 2,
        }),
        createTask('writeOutput', 'Write Output', writeOutput, {
            dependencies: ['assembleHtml'],
            weight: 1,
        }),
    ];
}
