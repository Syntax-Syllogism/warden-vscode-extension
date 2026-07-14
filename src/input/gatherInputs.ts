import * as vscode from 'vscode';
import { pickDefFile, type PickDefFileOptions } from './defFilePicker';
import { pickFile, pickFolder } from './filePicker';
import { pickOrg } from './orgPicker';
import { pickOutputDirectory, type PickOutputDirectoryOptions } from './outputDirPicker';
import type { CommandDef, FlagDef } from '../registry/types';
import { LastValueStore } from '../util/memento';

export interface GatheredInputs {
	args: string[];
	displayArgs: string[];
}

export interface InputApi {
	pickOrg(lastValue?: string): Promise<string | undefined>;
	pickFile(label: string, defaultDirectory?: string): Promise<string | undefined>;
	pickDefFile(options: PickDefFileOptions): Promise<string | undefined>;
	pickFolder(label: string, defaultDirectory?: string): Promise<string | undefined>;
	pickOutputDirectory(options: PickOutputDirectoryOptions): Promise<string | undefined>;
	showInputBox(options: vscode.InputBoxOptions): Thenable<string | undefined>;
	showQuickPick<T extends vscode.QuickPickItem>(items: readonly T[], options?: vscode.QuickPickOptions): Thenable<T | undefined>;
	showBooleanPick(items: readonly BooleanPick[], placeHolder: string): Thenable<readonly BooleanPick[] | undefined>;
	showWarningMessage(message: string): Thenable<string | undefined>;
}

export type { PickOutputDirectoryOptions };
export type { PickDefFileOptions };

export interface BooleanPick extends vscode.QuickPickItem {
	flag: FlagDef;
}

export function createVsCodeInputApi(): InputApi {
	return {
		pickOrg,
		pickFile,
		pickDefFile,
		pickFolder,
		pickOutputDirectory,
		showInputBox: (options) => vscode.window.showInputBox(options),
		showQuickPick: (items, options) => vscode.window.showQuickPick(items, options),
		showBooleanPick: (items, placeHolder) => vscode.window.showQuickPick(items, { canPickMany: true, placeHolder }),
		showWarningMessage: (message) => vscode.window.showWarningMessage(message),
	};
}

export async function gatherInputs(
	command: CommandDef,
	store: LastValueStore,
	inputApi: InputApi = createVsCodeInputApi(),
): Promise<GatheredInputs | undefined> {
	const flags = [...command.flags];
	const gathered = await gatherNamedFlags(command, flags, store, inputApi);
	if (!gathered) {
		return undefined;
	}

	const pickedBooleanNames = await gatherBooleanFlags(gathered, flags, inputApi);
	if (!pickedBooleanNames) {
		return undefined;
	}

	if (!await validateRequiredBooleanSelection(command, pickedBooleanNames, inputApi)) {
		return undefined;
	}

	return gathered;
}

async function gatherNamedFlags(
	command: CommandDef,
	flags: readonly FlagDef[],
	store: LastValueStore,
	inputApi: InputApi,
): Promise<GatheredInputs | undefined> {
	const gathered: GatheredInputs = { args: [], displayArgs: [] };
	const exclusiveGroups = groupExclusiveFlags(flags);
	const handledExclusiveGroups = new Set<string>();
	const dependentFlags = flags.filter((flag) => flag.dependsOnFlag);
	for (const flag of flags) {
		if (flag.dependsOnFlag) {
			// Gathered as a follow-up once its target flag is selected, not here.
			continue;
		}

		if (flag.exclusiveGroup && handledExclusiveGroups.has(flag.exclusiveGroup)) {
			continue;
		}

		if (flag.exclusiveGroup) {
			handledExclusiveGroups.add(flag.exclusiveGroup);
			const groupFlags = exclusiveGroups.get(flag.exclusiveGroup) ?? [];
			const groupGathered = await gatherExclusiveGroup(command, flag.exclusiveGroup, groupFlags, dependentFlags, store, inputApi);
			if (!groupGathered) {
				return undefined;
			}

			appendGatheredInputs(gathered, groupGathered);
			continue;
		}

		if (flag.kind === 'boolean') {
			continue;
		}

		const flagGathered = await gatherFlag(command, flag, store, inputApi);
		if (!flagGathered && flag.required) {
			return undefined;
		}

		if (flagGathered) {
			appendGatheredInputs(gathered, flagGathered);
		}
	}

	return gathered;
}

async function gatherBooleanFlags(
	gathered: GatheredInputs,
	flags: readonly FlagDef[],
	inputApi: InputApi,
): Promise<ReadonlySet<string> | undefined> {
	const pickedBooleanNames = new Set<string>();
	const booleanFlags = flags.filter((flag) => flag.kind === 'boolean' && !flag.exclusiveGroup);
	if (booleanFlags.length === 0) {
		return pickedBooleanNames;
	}

	const picked = await inputApi.showBooleanPick(booleanPickItems(booleanFlags), 'Select options to enable');
	if (!picked) {
		return undefined;
	}

	for (const item of picked) {
		pickedBooleanNames.add(item.flag.name);
		appendGatheredInputs(gathered, {
			args: [`--${item.flag.name}`],
			displayArgs: [`--${item.flag.name}`],
		});
	}

	return pickedBooleanNames;
}

async function validateRequiredBooleanSelection(
	command: CommandDef,
	pickedBooleanNames: ReadonlySet<string>,
	inputApi: InputApi,
): Promise<boolean> {
	if (!command.requireOneOf || command.requireOneOf.some((flagName) => pickedBooleanNames.has(flagName))) {
		return true;
	}

	await inputApi.showWarningMessage(`Select at least one of: ${command.requireOneOf.map((flagName) => `--${flagName}`).join(', ')}`);
	return false;
}

async function gatherExclusiveGroup(
	command: CommandDef,
	groupName: string,
	groupFlags: readonly FlagDef[],
	dependentFlags: readonly FlagDef[],
	store: LastValueStore,
	inputApi: InputApi,
): Promise<GatheredInputs | undefined> {
	const presentation = exclusiveGroupPresentation(groupName);
	const picked = await inputApi.showQuickPick(
		groupFlags.map((flag) => ({ label: presentation.labels.get(flag.name) ?? `--${flag.name}`, flag })),
		{ placeHolder: presentation.prompt },
	);
	if (!picked) {
		return undefined;
	}

	const gathered: GatheredInputs = { args: [], displayArgs: [] };
	if (picked.flag.kind === 'boolean') {
		appendGatheredInputs(gathered, {
			args: [`--${picked.flag.name}`],
			displayArgs: [`--${picked.flag.name}`],
		});
	} else {
		const pickedGathered = await gatherFlag(command, picked.flag, store, inputApi);
		if (!pickedGathered) {
			return undefined;
		}

		appendGatheredInputs(gathered, pickedGathered);
	}

	if (!await gatherDependentFlags(command, picked.flag.name, dependentFlags, gathered, store, inputApi)) {
		return undefined;
	}

	return gathered;
}

async function gatherDependentFlags(
	command: CommandDef,
	selectedFlagName: string,
	dependentFlags: readonly FlagDef[],
	gathered: GatheredInputs,
	store: LastValueStore,
	inputApi: InputApi,
): Promise<boolean> {
	for (const dependent of dependentFlags) {
		if (dependent.dependsOnFlag !== selectedFlagName) {
			continue;
		}

		const dependentGathered = await gatherFlag(command, dependent, store, inputApi);
		if (!dependentGathered && dependent.required) {
			return false;
		}

		if (dependentGathered) {
			appendGatheredInputs(gathered, dependentGathered);
		}
	}

	return true;
}

async function gatherFlag(
	command: CommandDef,
	flag: FlagDef,
	store: LastValueStore,
	inputApi: InputApi,
): Promise<GatheredInputs | undefined> {
	const lastValue = getLastValue(command.id, flag.name, store);
	let value: string | undefined;

	if (flag.kind === 'org') {
		value = await inputApi.pickOrg(lastValue);
	} else if (flag.kind === 'file') {
		value = await inputApi.pickDefFile({
			flag,
			label: flag.summary ?? `Select --${flag.name}`,
			lastValue,
			includeGitIgnored: command.id === 'warden.restore' && flag.name === 'snapshot',
		});
	} else if (flag.kind === 'outputDir') {
		value = await inputApi.pickOutputDirectory({
			command,
			flag,
			label: flag.summary ?? `Select --${flag.name}`,
			defaultValue: flag.default,
			lastValue,
		});
	} else if (flag.kind === 'enum') {
		const picked = await inputApi.showQuickPick(
			(flag.options ?? []).map((option) => ({ label: option })),
			{ placeHolder: flag.summary ?? `Select --${flag.name}` },
		);
		value = picked?.label;
	} else {
		value = await inputApi.showInputBox({
			ignoreFocusOut: true,
			placeHolder: flag.placeholder,
			prompt: flag.summary ?? `Enter --${flag.name}`,
			value: lastValue,
		});
	}

	if (!value) {
		return undefined;
	}

	await store.set(command.id, flag.name, value);
	return {
		args: [`--${flag.name}`, value],
		displayArgs: [`--${flag.name}`, quoteDisplayArg(value)],
	};
}

function quoteDisplayArg(value: string): string {
	return /\s/.test(value) ? JSON.stringify(value) : value;
}

function appendGatheredInputs(target: GatheredInputs, source: GatheredInputs): void {
	target.args.push(...source.args);
	target.displayArgs.push(...source.displayArgs);
}

function booleanPickItems(flags: readonly FlagDef[]): BooleanPick[] {
	return flags.map((flag) => ({ label: `--${flag.name}`, description: flag.summary, flag }));
}

function getLastValue(commandId: string, flagName: string, store: LastValueStore): string | undefined {
	if (flagName === 'target-org') {
		return store.get(commandId, flagName) ?? vscode.workspace.getConfiguration('warden').get<string>('defaultTargetOrg') ?? undefined;
	}

	return store.get(commandId, flagName);
}

function groupExclusiveFlags(flags: readonly FlagDef[]): Map<string, FlagDef[]> {
	const groups = new Map<string, FlagDef[]>();
	for (const flag of flags) {
		if (!flag.exclusiveGroup) {
			continue;
		}

		const group = groups.get(flag.exclusiveGroup) ?? [];
		group.push(flag);
		groups.set(flag.exclusiveGroup, group);
	}

	return groups;
}

function exclusiveGroupPresentation(groupName: string): { prompt: string; labels: ReadonlyMap<string, string> } {
	if (groupName === 'flavor') {
		return {
			prompt: 'Choose framework flavor',
			labels: new Map([
				['at4dx', 'AT4DX'],
				['fflib', 'fflib'],
			]),
		};
	}

	if (groupName === 'userTarget') {
		return {
			prompt: 'Choose how to target users',
			labels: new Map([
				['user', 'Single user'],
				['users-def', 'Users definition file'],
			]),
		};
	}

	return {
		prompt: `Choose ${groupName}`,
		labels: new Map(),
	};
}
