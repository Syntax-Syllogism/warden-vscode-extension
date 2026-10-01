import * as vscode from 'vscode';
import { loadWardenCore } from './core/load';
import { createOrgService } from './core/orgService';
import { createVsCodeInputApi, gatherInputs } from './input/gatherInputs';
import { buildCommands } from './registry/commands';
import { createCommandRunner } from './runner/commandRunner';
import { WardenCommandsProvider } from './tree/wardenCommandsProvider';
import { LastValueStore } from './util/memento';

const commandIds = ['provision', 'access', 'strip', 'freeze', 'unfreeze', 'snapshot', 'restore', 'diff'] as const;

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Warden');
	const store = new LastValueStore(context.workspaceState);
	const orgs = createOrgService();
	const provider = new WardenCommandsProvider([]);
	const commandsPromise = loadWardenCore().then((core) => {
		const commands = buildCommands(core);
		provider.refresh(commands);
		return { core, commands };
	});
	const runner = createCommandRunner({
		output, orgs, core: loadWardenCore,
		withProgress: vscode.window.withProgress,
		showInformationMessage: vscode.window.showInformationMessage,
		showWarningMessage: vscode.window.showWarningMessage,
		showErrorMessage: vscode.window.showErrorMessage,
		workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
	});
	context.subscriptions.push(output, vscode.window.registerTreeDataProvider('wardenCommands', provider));
	for (const id of commandIds) {
		context.subscriptions.push(vscode.commands.registerCommand(`warden.${id}`, async () => {
			try {
				const { core, commands } = await commandsPromise;
				const orgChoices = await orgs.listOrgs();
				if (!orgChoices.length) {
					const action = await vscode.window.showWarningMessage('No authenticated Salesforce orgs found.', 'Log in to an org');
					if (action === 'Log in to an org') {
						const terminal = vscode.window.createTerminal('Salesforce login');
						terminal.show();
						terminal.sendText('sf org login web');
					}
					return;
				}
				const command = commands.find((candidate) => candidate.coreId === id);
				if (!command) { return; }
				const inputs = await gatherInputs(command, store, core, createVsCodeInputApi(orgs));
				if (inputs) { await runner.run(command, inputs); }
			} catch (error) {
				output.appendLine(error instanceof Error ? error.stack ?? error.message : String(error));
				vscode.window.showErrorMessage('Unable to start Warden. See the Warden output channel.');
			}
		}));
	}
}

export function deactivate(): void {}
