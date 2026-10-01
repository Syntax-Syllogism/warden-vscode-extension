import * as path from 'path';
import * as vscode from 'vscode';
import type { InputDef } from '../registry/types';
import { showWorkspaceQuickPick } from './workspaceQuickPick';

export interface PickDefFileOptions {
	flag: InputDef;
	label: string;
	lastValue?: string;
	includeGitIgnored?: boolean;
}

export async function pickDefFile(options: PickDefFileOptions): Promise<string | undefined> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) { return undefined; }
	const glob = options.flag.fileFilter === 'csv' ? '**/*.csv' : options.flag.fileFilter === 'json-or-csv' ? '**/*.{json,csv}' : '**/*.json';
	const uris = options.includeGitIgnored
		? await listRestoreFiles(vscode.Uri.file(root))
		: await vscode.workspace.findFiles(glob, '**/{.git,.sf,.sfdx,.vscode,node_modules,dist,out,coverage}/**', 200);
	const paths = uris.map((uri) => path.relative(root, uri.fsPath)).filter((value) => value && !value.startsWith('..') && !path.isAbsolute(value));
	const items = paths.sort().map((value) => ({ label: path.basename(value), description: path.dirname(value), value }));
	return showWorkspaceQuickPick({ items, lastValue: options.lastValue, placeHolder: options.label, matchOnDescription: true, createLastValueItem: (value) => ({ label: path.basename(value), description: 'Last used', value }) });
}

async function listRestoreFiles(root: vscode.Uri): Promise<vscode.Uri[]> {
	const files: vscode.Uri[] = [];
	const excluded = new Set(['.git', '.sf', '.sfdx', '.vscode', 'node_modules', 'dist', 'out', 'coverage']);
	const visit = async (directory: vscode.Uri): Promise<void> => {
		if (files.length >= 200) { return; }
		let entries: [string, vscode.FileType][];
		try { entries = await vscode.workspace.fs.readDirectory(directory); }
		catch { return; }
		for (const [name, type] of entries) {
			if (files.length >= 200) { break; }
			const uri = vscode.Uri.joinPath(directory, name);
			if (type === vscode.FileType.Directory && !excluded.has(name)) { await visit(uri); }
			else if (type === vscode.FileType.File && name.toLowerCase().endsWith('.json')) { files.push(uri); }
		}
	};
	await visit(root);
	return files;
}
