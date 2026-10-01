import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Connection } from '@salesforce/core';
import type { WardenCore } from '../core/load';
import type { OrgService } from '../core/orgService';
import type { GatheredInputs } from '../input/gatherInputs';
import type { CommandDef } from '../registry/types';
import { planWarnings, previewValue, renderResult } from './render';

export interface RunnerDeps {
	core: () => Promise<WardenCore>;
	orgs: OrgService;
	output: vscode.OutputChannel;
	withProgress: typeof vscode.window.withProgress;
	showInformationMessage: typeof vscode.window.showInformationMessage;
	showWarningMessage: typeof vscode.window.showWarningMessage;
	showErrorMessage: typeof vscode.window.showErrorMessage;
	executeCommand?: typeof vscode.commands.executeCommand;
	workspaceFolder?: string;
}

type Context = { signal: AbortSignal; onProgress: (event: { phase: string; message?: string }) => void };
type ReadCase = { kind: 'read'; descriptor: { optionsSchema: { safeParse: (options: unknown) => { success: boolean; data?: unknown; error?: { issues: unknown[] } } } }; run: (conn: Connection, options: never, ctx: Context) => Promise<unknown> };
type WriteCase = { kind: 'write'; descriptor: ReadCase['descriptor']; plan: (conn: Connection, options: never, ctx: Context) => Promise<unknown>; apply: (conn: Connection, plan: never, ctx: Context) => Promise<unknown> };

export function createCommandRunner(deps: RunnerDeps) {
	return {
		async run(command: CommandDef, inputs: GatheredInputs): Promise<void> {
			const outputPath = inputs.outputFile ? await resolveOutputPath(inputs.outputFile, deps.workspaceFolder) : undefined;
			if (inputs.outputFile && !outputPath) {
				deps.showErrorMessage('Output file must be a non-empty path inside the current workspace.');
				return;
			}
			const core = await deps.core();
			const useCase = core[command.coreId] as unknown as ReadCase | WriteCase;
			if (command.coreId === 'snapshot') { inputs.options.org = await deps.orgs.resolveUsername(inputs.org); }
			const parsed = useCase.descriptor.optionsSchema.safeParse(inputs.options);
			if (!parsed.success) {
				deps.output.appendLine(`Invalid options: ${JSON.stringify(parsed.error?.issues, null, 2)}`);
				deps.output.show(true);
				deps.showErrorMessage('Invalid options');
				return;
			}
			deps.output.show(true);
			deps.output.appendLine(`\n${command.title}\n${inputs.display.join('\n')}`);
			try {
				let conn = await deps.orgs.connect(inputs.org);
				const execute = async <T>(title: string, action: (connection: Connection, ctx: Context) => Promise<T>): Promise<T> => {
					const perform = async (): Promise<T> => deps.withProgress(
						{ location: vscode.ProgressLocation.Notification, title, cancellable: true },
						async (progress, token) => {
							const controller = new AbortController();
							const subscription = token.onCancellationRequested(() => controller.abort());
							if (token.isCancellationRequested) { controller.abort(); }
							try { return await action(conn, { signal: controller.signal, onProgress: (event) => progress.report({ message: event.message ?? event.phase }) }); }
							finally { subscription.dispose(); }
						},
					);
					try { return await perform(); }
					catch (error) {
						if (!isAuthError(error)) { throw error; }
						await deps.orgs.invalidate(inputs.org);
						conn = await deps.orgs.connect(inputs.org);
						return perform();
					}
				};
				let result: unknown;
				if (useCase.kind === 'read') {
					result = await execute(`Running ${command.title}`, (connection, ctx) => useCase.run(connection, parsed.data as never, ctx));
				} else {
					const plan = await execute(`Planning ${command.title}`, (connection, ctx) => useCase.plan(connection, parsed.data as never, ctx));
					const preview = renderResult(command, previewValue(command, plan, core), core, inputs.options, 'human');
					deps.output.appendLine(`\nPreview\n${preview}`);
					for (const warning of planWarnings(plan)) { deps.output.appendLine(`warning: ${warning}`); }
					const prompt = command.destructive ? 'Apply the strip changes shown in the Warden output channel?' : `Apply the ${command.title} changes shown in the Warden output channel?`;
					if (await deps.showWarningMessage(prompt, { modal: true }, 'Apply') !== 'Apply') {
						deps.showInformationMessage('No changes applied.');
						return;
					}
					result = await execute(`Applying ${command.title}`, (connection, ctx) => useCase.apply(connection, plan as never, ctx));
				}
				deps.output.appendLine(`\nResult\n${renderResult(command, result, core, inputs.options, 'human')}`);
				if (outputPath) {
					const content = path.extname(outputPath).toLowerCase() === '.csv'
						? renderResult(command, result, core, inputs.options, 'csv')
						: `${JSON.stringify(result, null, 2)}\n`;
					await fs.mkdir(path.dirname(outputPath), { recursive: true });
					// Re-check after mkdir: a symlink could have appeared since the command started.
					if (await resolveOutputPath(inputs.outputFile!, deps.workspaceFolder) !== outputPath) {
						deps.showErrorMessage('Output file must be a non-empty path inside the current workspace.');
						return;
					}
					await fs.writeFile(outputPath, content, 'utf8');
				}
				const choice = outputPath
					? await deps.showInformationMessage(`${command.title} completed.`, 'Open File')
					: await deps.showInformationMessage(`${command.title} completed.`);
				if (choice === 'Open File' && outputPath) {
					await (deps.executeCommand ?? vscode.commands.executeCommand)('vscode.open', vscode.Uri.file(outputPath));
				}
			} catch (error) {
				if (core.isWardenError(error)) {
					if (error.code === 'cancelled') { deps.showInformationMessage(`${command.title} cancelled.`); return; }
					deps.output.appendLine(`${error.code}: ${JSON.stringify(error.data)}`);
					deps.showErrorMessage(error.message);
				} else if (error instanceof Error && error.name === 'AbortError') {
					deps.showInformationMessage(`${command.title} cancelled.`);
				} else {
					deps.output.appendLine(error instanceof Error ? error.stack ?? error.message : String(error));
					deps.showErrorMessage(`Unexpected error running ${command.title}`);
				}
				deps.output.show(true);
			}
		},
	};
}

export async function resolveOutputPath(outputFile: string, workspaceFolder?: string): Promise<string | undefined> {
	if (!workspaceFolder || !outputFile.trim() || path.isAbsolute(outputFile)) { return undefined; }
	const root = path.resolve(workspaceFolder);
	const resolved = path.resolve(root, outputFile);
	if (!isInside(root, resolved)) { return undefined; }
	// Lexical containment is not enough: a symlinked directory (or file) inside the
	// workspace can point outside it. Resolve the deepest existing part of the path
	// and require its real location to stay under the real workspace root.
	try {
		const realRoot = await fs.realpath(root);
		let existing = resolved;
		while (!(await pathExists(existing))) { existing = path.dirname(existing); }
		return isInside(realRoot, await fs.realpath(existing), true) ? resolved : undefined;
	} catch {
		return undefined;
	}
}

function isInside(root: string, target: string, allowRoot = false): boolean {
	const relative = path.relative(root, target);
	if (!relative) { return allowRoot; }
	return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function pathExists(target: string): Promise<boolean> {
	try {
		await fs.lstat(target);
		return true;
	} catch {
		return false;
	}
}

function isAuthError(error: unknown): boolean {
	const value = error as { code?: string; name?: string };
	return value?.code === 'INVALID_SESSION_ID' || value?.name === 'RefreshTokenAuthError';
}
