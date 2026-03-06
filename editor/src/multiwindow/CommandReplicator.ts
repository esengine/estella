import type { EditorStore } from '../store/EditorStore';
import type { Command } from '../commands/Command';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
    CHANNEL_CMD_EXECUTED,
    CHANNEL_CMD_REQUEST,
    CHANNEL_CMD_SNAPSHOT,
    type CmdExecutedMessage,
    type CmdRequestMessage,
    type CmdSnapshotMessage,
} from './protocol';
import { CommandRegistry } from '../commands/Command';

export class CommandReplicator {
    private version_ = 0;
    private store_: EditorStore;
    private unlisteners_: UnlistenFn[] = [];
    private started_ = false;
    private originalExecuteCommand_: ((cmd: Command) => void) | null = null;

    constructor(store: EditorStore) {
        this.store_ = store;
    }

    async start(): Promise<void> {
        if (this.started_) return;
        this.started_ = true;

        this.originalExecuteCommand_ = this.store_.executeCommand.bind(this.store_);
        this.store_.executeCommand = (cmd: Command) => {
            this.originalExecuteCommand_!(cmd);
            this.broadcastCommand(cmd);
        };

        const unlistenRequest = await listen<CmdRequestMessage>(CHANNEL_CMD_REQUEST, (event) => {
            this.handleCommandRequest(event.payload);
        });

        const unlistenSnapshot = await listen<string>(CHANNEL_CMD_SNAPSHOT + ':request', () => {
            this.sendSnapshot();
        });

        this.unlisteners_.push(unlistenRequest, unlistenSnapshot);
    }

    private broadcastCommand(cmd: Command): void {
        const serialized = cmd.serialize();
        if (!serialized) {
            this.version_++;
            this.sendSnapshot();
            return;
        }

        this.version_++;
        const msg: CmdExecutedMessage = {
            version: this.version_,
            serialized,
        };
        emit(CHANNEL_CMD_EXECUTED, msg);
    }

    private handleCommandRequest(payload: CmdRequestMessage): void {
        const cmd = CommandRegistry.deserialize(
            payload.serialized,
            this.store_.scene,
            this.store_.entityMap_,
        );
        if (cmd) {
            this.originalExecuteCommand_!(cmd);
            this.broadcastCommand(cmd);
        }
    }

    private sendSnapshot(): void {
        const msg: CmdSnapshotMessage = {
            scene: JSON.parse(JSON.stringify(this.store_.scene)),
            selectedEntities: Array.from(this.store_.selectedEntities),
            version: this.version_,
        };
        emit(CHANNEL_CMD_SNAPSHOT, msg);
    }

    dispose(): void {
        if (this.originalExecuteCommand_) {
            this.store_.executeCommand = this.originalExecuteCommand_;
            this.originalExecuteCommand_ = null;
        }
        for (const unlisten of this.unlisteners_) {
            unlisten();
        }
        this.unlisteners_ = [];
        this.started_ = false;
    }
}
