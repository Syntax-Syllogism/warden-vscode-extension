import * as path from 'path';
import spawn = require('cross-spawn');
import * as vscode from 'vscode';
import type { FlagDef } from '../registry/types';
import { showWorkspaceQuickPick, type WorkspaceQuickPickItem } from './workspaceQuickPick';

export interface PickDefFileOptions {
	flag: FlagDef;
	label: string;
	lastValue?: string;
	includeGitIgnored?: boolean;
}

const MAX_JSON_CANDIDATES = 200;
const JSON_EXCLUDE_GLOB = '**/{.git,.sf,.sfdx,.vscode,node_modules,dist,out,coverage}/**';

export async function pickDefFile(options: PickDefFileOptions): Promise<string | undefined> {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspaceRoot) {
		return undefined;
	}

	const uris = await vscode.workspace.findFiles('**/*.json', JSON_EXCLUDE_GLOB, MAX_JSON_CANDIDATES);
	const relativePaths = uris
		.map((uri) => relativeWorkspacePath(workspaceRoot, uri.fsPath))
		.filter((value): value is string => value !== undefined);
	const visiblePaths = options.includeGitIgnored ? relativePaths : await filterGitIgnoredPaths(workspaceRoot, relativePaths);
	const items = visiblePaths
		.sort((left, right) => left.localeCompare(right))
		.map((value) => defFileItem(value));

	const existingLastValue = await existingWorkspaceFile(workspaceRoot, options.lastValue);
	const [lastValue] = existingLastValue
		? options.includeGitIgnored ? [existingLastValue] : await filterGitIgnoredPaths(workspaceRoot, [existingLastValue])
		: [];
	return showWorkspaceQuickPick({
		items,
		lastValue,
		placeHolder: options.label,
		matchOnDescription: true,
		createLastValueItem: (value) => defFileItem(value, true),
	});
}

function defFileItem(value: string, lastUsed = false): WorkspaceQuickPickItem {
	const parent = parentDescription(value);
	return {
		label: path.basename(value),
		description: lastUsed ? `Last used • ${parent}` : parent,
		value,
	};
}

function parentDescription(value: string): string {
	const parent = normalizeWorkspacePath(path.dirname(value));
	return parent === '.' ? '.' : parent;
}

function relativeWorkspacePath(workspaceRoot: string, fsPath: string): string | undefined {
	const relative = normalizeWorkspacePath(path.relative(workspaceRoot, fsPath));
	if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
		return undefined;
	}
	return relative;
}

async function existingWorkspaceFile(workspaceRoot: string, value?: string): Promise<string | undefined> {
	if (!value) {
		return undefined;
	}

	const absolute = path.resolve(workspaceRoot, value);
	const relative = relativeWorkspacePath(workspaceRoot, absolute);
	if (!relative) {
		return undefined;
	}

	try {
		const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absolute));
		return stat.type === vscode.FileType.Directory ? undefined : relative;
	} catch {
		return undefined;
	}
}

async function filterGitIgnoredPaths(workspaceRoot: string, values: readonly string[]): Promise<string[]> {
	if (values.length === 0) {
		return [];
	}

	const ignored = await gitIgnoredPaths(workspaceRoot, values);
	return values.filter((value) => !ignored.has(normalizeWorkspacePath(value)));
}

async function gitIgnoredPaths(workspaceRoot: string, values: readonly string[]): Promise<ReadonlySet<string>> {
	return new Promise((resolve) => {
		const child = spawn('git', ['check-ignore', '--stdin', '-z'], { cwd: workspaceRoot, stdio: ['pipe', 'pipe', 'ignore'] });
		const chunks: Buffer[] = [];
		child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
		child.stdin?.on('error', () => undefined);
		child.on('error', () => resolve(new Set()));
		child.on('close', () => {
			const ignored = new Set(
				Buffer.concat(chunks)
					.toString('utf8')
					.split('\0')
					.filter(Boolean)
					.map(normalizeWorkspacePath),
			);
			resolve(ignored);
		});
		child.stdin?.end(`${values.map(normalizeWorkspacePath).join('\0')}\0`);
	});
}

function normalizeWorkspacePath(value: string): string {
	return value.replaceAll(path.sep, '/');
}
