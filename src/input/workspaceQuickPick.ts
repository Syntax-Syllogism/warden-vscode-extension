import * as path from 'path';
import * as vscode from 'vscode';

export interface WorkspaceQuickPickItem extends vscode.QuickPickItem {
	value: string;
}

export interface ShowWorkspaceQuickPickOptions {
	items: WorkspaceQuickPickItem[];
	lastValue?: string;
	placeHolder: string;
	matchOnDescription?: boolean;
	createLastValueItem?: (value: string) => WorkspaceQuickPickItem;
}

export async function showWorkspaceQuickPick(options: ShowWorkspaceQuickPickOptions): Promise<string | undefined> {
	const candidates = orderedCandidates(options);
	const picked = await vscode.window.showQuickPick(candidates, {
		placeHolder: options.placeHolder,
		matchOnDescription: options.matchOnDescription,
	});

	return picked?.value;
}

function orderedCandidates(options: ShowWorkspaceQuickPickOptions): WorkspaceQuickPickItem[] {
	const items = [...options.items];
	if (options.lastValue) {
		items.unshift((options.createLastValueItem ?? defaultLastValueItem)(options.lastValue));
	}

	const seen = new Set<string>();
	const candidates: WorkspaceQuickPickItem[] = [];
	for (const item of items) {
		const key = normalizeWorkspacePath(item.value);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		candidates.push(item);
	}

	return candidates;
}

function defaultLastValueItem(value: string): WorkspaceQuickPickItem {
	return { label: value, description: 'Last used', value };
}

function normalizeWorkspacePath(value: string): string {
	const normalized = value.replaceAll(path.sep, '/');
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
