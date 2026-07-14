import * as vscode from 'vscode';
import { gatherInputs } from './input/gatherInputs';
import { commands } from './registry/commands.generated';
import { createCommandRunner, defaultSpawnProcess } from './runner/commandRunner';
import { createSfDetector } from './runner/sfDetect';
import { WardenCommandsProvider } from './tree/wardenCommandsProvider';
import { LastValueStore } from './util/memento';

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Warden');
	const store = new LastValueStore(context.workspaceState);
	const detector = createSfDetector();
	const runner = createCommandRunner({
		output,
		spawnProcess: defaultSpawnProcess,
		withProgress: vscode.window.withProgress,
		showInformationMessage: vscode.window.showInformationMessage,
		showWarningMessage: vscode.window.showWarningMessage,
		showErrorMessage: vscode.window.showErrorMessage,
		workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
	});

	context.subscriptions.push(output);
	context.subscriptions.push(vscode.window.registerTreeDataProvider('wardenCommands', new WardenCommandsProvider(commands)));

	for (const command of commands) {
		context.subscriptions.push(vscode.commands.registerCommand(command.id, async () => {
			if (!await detector.ensureReady()) {
				return;
			}

			const inputs = await gatherInputs(command, store);
			if (!inputs) {
				return;
			}

			await runner.run(command, inputs);
		}));
	}
}

export function deactivate(): void {}
