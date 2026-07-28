import * as path from 'path';
import * as vscode from 'vscode';

export async function pickFile(label: string, defaultDirectory?: string): Promise<string | undefined> {
	const defaultUri = defaultDirectoryUri(defaultDirectory);
	const result = await vscode.window.showOpenDialog({
		canSelectFiles: true,
		canSelectFolders: false,
		canSelectMany: false,
		defaultUri,
		openLabel: label,
	});

	return result?.[0]?.fsPath;
}

export async function pickFolder(label: string, defaultDirectory?: string): Promise<string | undefined> {
	const result = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		defaultUri: defaultDirectoryUri(defaultDirectory),
		openLabel: label,
	});
	const selected = result?.[0]?.fsPath;
	if (!selected) {
		return undefined;
	}

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspaceRoot) {
		return selected;
	}

	const relative = path.relative(workspaceRoot, selected);
	if (!relative) {
		return '.';
	}
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		await vscode.window.showWarningMessage('Choose a folder inside the current workspace.');
		return undefined;
	}

	return relative;
}

export function directoryOf(filePath: string): string {
	return path.dirname(filePath);
}

function defaultDirectoryUri(defaultDirectory?: string): vscode.Uri | undefined {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!defaultDirectory) {
		return workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined;
	}

	return vscode.Uri.file(path.isAbsolute(defaultDirectory) || !workspaceRoot ? defaultDirectory : path.join(workspaceRoot, defaultDirectory));
}
