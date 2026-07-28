import type { ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawnSf } from './sfProcess';
import * as vscode from 'vscode';
import type { CommandDef } from '../registry/types';
import type { GatheredInputs } from '../input/gatherInputs';
import { stripAnsi } from './ansi';

export interface CommandRunner {
	run(command: CommandDef, inputs: GatheredInputs): Promise<void>;
}

export interface RunnerDeps {
	output: vscode.OutputChannel;
	spawnProcess: SpawnProcess;
	withProgress: typeof vscode.window.withProgress;
	showInformationMessage: typeof vscode.window.showInformationMessage;
	showWarningMessage: typeof vscode.window.showWarningMessage;
	showErrorMessage: typeof vscode.window.showErrorMessage;
	executeCommand?: typeof vscode.commands.executeCommand;
	workspaceFolder?: string;
}

export type SpawnProcess = (file: string, args: readonly string[], options: { cwd?: string; env: NodeJS.ProcessEnv }) => ChildProcessWithoutNullStreams;

interface RunResult {
	code: number | null;
	stdout: string;
	stderr: string;
	cancelled: boolean;
}

interface SfCommandResult {
	cancelled: boolean;
	succeeded: boolean;
	message?: string;
}

interface ExecutionStrategy {
	run(command: CommandDef, inputs: GatheredInputs): Promise<void>;
}

export function createCommandRunner(deps: RunnerDeps): CommandRunner {
	const adapter = new SfCliAdapter(deps);
	return {
		async run(command, inputs): Promise<void> {
			return strategyFor(command, deps, adapter).run(command, inputs);
		},
	};
}

export function buildCliArgs(command: CommandDef, inputArgs: readonly string[]): string[] {
	return [...command.cliId.split(' '), ...inputArgs, ...internalFlags(command, inputArgs)];
}

export function buildDisplayArgs(command: CommandDef, displayInputArgs: readonly string[]): string[] {
	return [...command.cliId.split(' '), ...displayInputArgs];
}

function strategyFor(command: CommandDef, deps: RunnerDeps, adapter: SfCliAdapter): ExecutionStrategy {
	return command.destructive ? new DestructiveCommandStrategy(deps, adapter) : new StandardCommandStrategy(deps, adapter);
}

class StandardCommandStrategy implements ExecutionStrategy {
	public constructor(
		private readonly deps: RunnerDeps,
		private readonly adapter: SfCliAdapter,
	) {}

	public async run(command: CommandDef, inputs: GatheredInputs): Promise<void> {
		const args = buildCliArgs(command, inputs.args);
		if (!await confirmRun(this.deps, command, inputs)) {
			return;
		}
		if (!await prepareOutputFile(this.deps, command, inputs.args)) {
			return;
		}

		await runAndReport(this.deps, this.adapter, command, args);
	}
}

class DestructiveCommandStrategy implements ExecutionStrategy {
	public constructor(
		private readonly deps: RunnerDeps,
		private readonly adapter: SfCliAdapter,
	) {}

	public async run(command: CommandDef, inputs: GatheredInputs): Promise<void> {
		const baseArgs = buildCliArgs(command, inputs.args);
		if (!await confirmRun(this.deps, command, inputs)) {
			return;
		}
		if (!await prepareOutputFile(this.deps, command, inputs.args)) {
			return;
		}

		const dryRun = await this.adapter.run(command, withFlag(baseArgs, '--dry-run'), 'Previewing warden strip changes');
		if (dryRun.cancelled) {
			return;
		}
		if (!dryRun.succeeded) {
			this.deps.showErrorMessage(`${command.title} dry run failed. See the Warden output channel.`);
			this.deps.output.show(true);
			return;
		}

		const apply = await this.deps.showWarningMessage('Apply the strip changes shown in the Warden output channel?', { modal: true }, 'Apply');
		if (apply !== 'Apply') {
			return;
		}

		await runAndReport(this.deps, this.adapter, command, withoutFlag(baseArgs, '--dry-run'));
	}
}

class SfCliAdapter {
	public constructor(private readonly deps: RunnerDeps) {}

	public async run(command: CommandDef, args: readonly string[], title: string): Promise<SfCommandResult> {
		this.deps.output.show(true);
		this.deps.output.appendLine(`$ sf ${args.join(' ')}`);
		const result = await this.spawnWithProgress(args, title);
		if (result.cancelled) {
			return { cancelled: true, succeeded: false };
		}

		const payload = this.parseJsonEnvelope(result.stdout) ?? this.parseJsonEnvelope(result.stderr);
		return {
			cancelled: false,
			succeeded: payload && typeof payload.status === 'number' ? payload.status === 0 : result.code === 0,
			message: successMessage(command, payload),
		};
	}

	private spawnWithProgress(args: readonly string[], title: string): Promise<RunResult> {
		return Promise.resolve(this.deps.withProgress(
			{ location: vscode.ProgressLocation.Notification, title, cancellable: true },
			(_progress, token) => this.runProcess(args, token),
		));
	}

	private runProcess(args: readonly string[], token: vscode.CancellationToken): Promise<RunResult> {
		return new Promise((resolve) => {
			const child = this.deps.spawnProcess('sf', args, {
				cwd: this.deps.workspaceFolder,
				env: process.env,
			});
			let stdout = '';
			let stderr = '';
			let cancelled = false;

			const cancel = token.onCancellationRequested(() => {
				cancelled = true;
				child.kill();
			});

			child.stdout.on('data', (chunk: Buffer | string) => {
				const text = stripAnsi(String(chunk));
				stdout += text;
				this.deps.output.append(text);
			});
			child.stderr.on('data', (chunk: Buffer | string) => {
				const text = stripAnsi(String(chunk));
				stderr += text;
				this.deps.output.append(text);
			});
			child.on('close', (code) => {
				cancel.dispose();
				resolve({ code, stdout, stderr, cancelled });
			});
		});
	}

	private parseJsonEnvelope(value: string): SfJsonEnvelope | undefined {
		const trimmed = value.trim();
		if (!looksLikeJsonEnvelope(trimmed)) {
			return undefined;
		}

		try {
			return JSON.parse(trimmed) as SfJsonEnvelope;
		} catch (error) {
			this.deps.output.appendLine(`[debug] Unable to parse Salesforce CLI JSON envelope: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	}
}

interface SfJsonEnvelope {
	status?: number;
	result?: unknown;
	message?: string;
}

async function runAndReport(deps: RunnerDeps, adapter: SfCliAdapter, command: CommandDef, args: readonly string[]): Promise<void> {
	const result = await adapter.run(command, args, `Running ${command.title}`);
	if (result.cancelled) {
		return;
	}

	if (result.succeeded) {
		await reportSuccess(deps, command, inputsFromArgs(command, args), result);
		return;
	}

	deps.showErrorMessage(`${command.title} failed. See the Warden output channel.`);
	deps.output.show(true);
}

async function confirmRun(deps: RunnerDeps, command: CommandDef, inputs: GatheredInputs): Promise<boolean> {
	if (!requiresRunConfirmation(command)) {
		return true;
	}

	const displayCommand = `sf ${buildDisplayArgs(command, inputs.displayArgs).join(' ')}`;
	const runPrompt = command.destructive ? `Preview ${displayCommand}, then confirm before applying changes?` : `Run ${displayCommand}?`;
	const runChoice = await deps.showInformationMessage(runPrompt, { modal: true }, 'Run');
	return runChoice === 'Run';
}

function looksLikeJsonEnvelope(value: string): boolean {
	return value.startsWith('{');
}

function withFlag(args: readonly string[], flag: string): string[] {
	return args.includes(flag) ? [...args] : [...args, flag];
}

function withoutFlag(args: readonly string[], flag: string): string[] {
	return args.filter((arg) => arg !== flag);
}

function internalFlags(command: CommandDef, inputArgs: readonly string[]): string[] {
	const flags = command.supportsNoPrompt ? ['--no-prompt'] : [];
	if (inputArgs.includes('--output-file')) {
		flags.push('--output', 'json');
	}

	return flags;
}

function requiresRunConfirmation(command: CommandDef): boolean {
	return command.supportsNoPrompt === true;
}

function successMessage(command: CommandDef, payload: SfJsonEnvelope | undefined): string {
	if (payload?.message) {
		return payload.message;
	}

	if (payload?.result && typeof payload.result === 'object') {
		const summary = 'summary' in payload.result ? payload.result.summary : undefined;
		if (typeof summary === 'string' && summary.length > 0) {
			return summary;
		}
	}

	return `${command.title} completed.`;
}

async function reportSuccess(deps: RunnerDeps, command: CommandDef, inputArgs: readonly string[], result: SfCommandResult): Promise<void> {
	if (inputArgs.includes('--dry-run')) {
		deps.showInformationMessage(result.message ?? `${command.title} completed.`);
		return;
	}

	const outputDir = outputDirectory(command, inputArgs, deps.workspaceFolder);
	const outputFile = outputFilePath(command, inputArgs, deps.workspaceFolder);
	if (!outputDir && !outputFile) {
		deps.showInformationMessage(result.message ?? `${command.title} completed.`);
		return;
	}

	const action = outputFile ? 'Open File' : 'Open Folder';
	const choice = await deps.showInformationMessage(result.message ?? `${command.title} completed.`, action);
	if (choice === 'Open File' && outputFile) {
		await (deps.executeCommand ?? vscode.commands.executeCommand)('vscode.open', vscode.Uri.file(outputFile));
	} else if (choice === 'Open Folder' && outputDir) {
		await (deps.executeCommand ?? vscode.commands.executeCommand)('revealInExplorer', vscode.Uri.file(outputDir));
	}
}

function inputsFromArgs(command: CommandDef, args: readonly string[]): string[] {
	const prefixLength = command.cliId.split(' ').length;
	return args.slice(prefixLength);
}

function outputDirectory(command: CommandDef, inputArgs: readonly string[], workspaceFolder?: string): string | undefined {
	const outputFlag = command.flags.find((flag) => flag.kind === 'outputDir');
	if (!outputFlag) {
		return undefined;
	}

	const outputPath = flagValue(inputArgs, outputFlag.name) ?? outputFlag.default;
	if (!outputPath) {
		return undefined;
	}

	return path.isAbsolute(outputPath) || !workspaceFolder ? outputPath : path.join(workspaceFolder, outputPath);
}

async function prepareOutputFile(deps: RunnerDeps, command: CommandDef, inputArgs: readonly string[]): Promise<boolean> {
	if (!inputArgs.includes('--output-file')) {
		return true;
	}

	const outputFile = outputFilePath(command, inputArgs, deps.workspaceFolder);
	if (!outputFile) {
		deps.showErrorMessage('Output file must be a non-empty path inside the current workspace.');
		deps.output.show(true);
		return false;
	}

	try {
		await fs.mkdir(path.dirname(outputFile), { recursive: true });
		return true;
	} catch (error) {
		deps.showErrorMessage(`Unable to prepare the output file directory: ${error instanceof Error ? error.message : String(error)}`);
		deps.output.show(true);
		return false;
	}
}

function outputFilePath(command: CommandDef, inputArgs: readonly string[], workspaceFolder?: string): string | undefined {
	const outputFlag = command.flags.find((flag) => flag.kind === 'outputFile');
	if (!outputFlag) {
		return undefined;
	}

	const outputPath = flagValue(inputArgs, outputFlag.name);
	if (!outputPath || !workspaceFolder || path.isAbsolute(outputPath)) {
		return undefined;
	}

	const workspaceRoot = path.resolve(workspaceFolder);
	const resolvedPath = path.resolve(workspaceRoot, outputPath);
	const relativePath = path.relative(workspaceRoot, resolvedPath);
	if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
		return undefined;
	}

	return resolvedPath;
}

function flagValue(args: readonly string[], flagName: string): string | undefined {
	const index = args.indexOf(`--${flagName}`);
	return index >= 0 ? args[index + 1] : undefined;
}

export const defaultSpawnProcess: SpawnProcess = (_file, args, options) => spawnSf(args, options);
