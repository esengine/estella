import { getEditorContext } from '../context/EditorContext';
import type { OutputService } from './OutputService';

export class ShellService {
    private projectPath_: string | null;
    private outputService_: OutputService;
    private showPanel_: (id: string) => void;

    constructor(
        projectPath: string | null,
        outputService: OutputService,
        showPanel: (id: string) => void,
    ) {
        this.projectPath_ = projectPath;
        this.outputService_ = outputService;
        this.showPanel_ = showPanel;
    }

    executeCommand(fullCommand: string): void {
        this.executeShellCommand_(fullCommand);
    }

    private async executeShellCommand_(fullCommand: string): Promise<void> {
        if (!this.projectPath_) {
            this.outputService_.appendOutput('Error: No project loaded\n', 'error');
            return;
        }

        const shell = getEditorContext().shell;
        if (!shell) {
            this.outputService_.appendOutput('Error: Shell not available\n', 'error');
            return;
        }

        const projectDir = this.projectPath_.replace(/[/\\][^/\\]+$/, '');

        this.showPanel_('output');

        const parts = fullCommand.split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);

        this.outputService_.appendOutput(`> ${fullCommand}\n`, 'command');

        try {
            const result = await shell.execute(cmd, args, projectDir, (stream: string, data: string) => {
                this.outputService_.appendOutput(data + '\n', stream === 'stderr' ? 'stderr' : 'stdout');
            });

            if (result.code !== 0) {
                this.outputService_.appendOutput(`Process exited with code ${result.code}\n`, 'error');
            } else {
                this.outputService_.appendOutput(`Done.\n`, 'success');
            }
        } catch (err) {
            this.outputService_.appendOutput(`Error: ${err}\n`, 'error');
        }
    }
}
