import * as vscode from 'vscode';
import type { CommandDef } from '../registry/types';

type WardenNode = GroupNode | CommandNode;

interface GroupNode {
	type: 'group';
	label: string;
	commands: readonly CommandDef[];
}

interface CommandNode {
	type: 'command';
	command: CommandDef;
}

export class WardenCommandsProvider implements vscode.TreeDataProvider<WardenNode> {
	private readonly changed = new vscode.EventEmitter<void>();
	public readonly onDidChangeTreeData = this.changed.event;
	public constructor(private commands: readonly CommandDef[]) {}
	public refresh(commands: readonly CommandDef[]): void {
		this.commands = commands;
		this.changed.fire();
	}

	public getTreeItem(element: WardenNode): vscode.TreeItem {
		if (element.type === 'group') {
			const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
			item.contextValue = 'wardenGroup';
			item.iconPath = new vscode.ThemeIcon('person');
			return item;
		}

		const item = new vscode.TreeItem(trimTitle(element.command.title), vscode.TreeItemCollapsibleState.None);
		item.command = {
			command: element.command.id,
			title: element.command.title,
		};
		item.tooltip = element.command.title;
		item.iconPath = new vscode.ThemeIcon(commandIcon(element.command));
		item.contextValue = 'wardenCommand';
		return item;
	}

	public getChildren(element?: WardenNode): WardenNode[] {
		if (element?.type === 'group') {
			return element.commands.map((command) => ({ type: 'command', command }));
		}

		if (element) {
			return [];
		}

		return orderedGroups(this.commands).map(([label, groupCommands]) => ({
			type: 'group',
			label,
			commands: groupCommands,
		}));
	}
}

function trimTitle(title: string): string {
	return title.replace(/^SF Warden:\s*/, '');
}

function orderedGroups(commands: readonly CommandDef[]): [string, CommandDef[]][] {
	return orderedBuckets(commands, (command) => command.group);
}

// Bucket order follows the descriptor order. A Map preserves insertion order.
function orderedBuckets<T>(items: readonly T[], keyOf: (item: T) => string): [string, T[]][] {
	const buckets = new Map<string, T[]>();
	for (const item of items) {
		const key = keyOf(item);
		const bucket = buckets.get(key) ?? [];
		bucket.push(item);
		buckets.set(key, bucket);
	}

	return [...buckets.entries()];
}

function commandIcon(command: CommandDef): string {
	if (command.destructive) {
		return 'warning';
	}

	return 'person';
}
