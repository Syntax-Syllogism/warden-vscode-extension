import * as vscode from 'vscode';
import type { WardenCore } from '../core/load';
import type { OrgService } from '../core/orgService';
import type { CommandDef, InputDef } from '../registry/types';
import { LastValueStore } from '../util/memento';
import { pickDefFile } from './defFilePicker';
import { pickOrg } from './orgPicker';

export interface GatheredInputs {
	org: string;
	options: Record<string, unknown>;
	outputFile?: string;
	display: string[];
}

export interface InputApi {
	pickOrg(lastValue?: string): Promise<string | undefined>;
	pickDefFile(options: { flag: InputDef; label: string; lastValue?: string; includeGitIgnored?: boolean }): Promise<string | undefined>;
	showInputBox(options: vscode.InputBoxOptions): Thenable<string | undefined>;
	showQuickPick<T extends vscode.QuickPickItem>(items: readonly T[], options?: vscode.QuickPickOptions): Thenable<T | undefined>;
	showBooleanPick(items: readonly BooleanPick[], placeHolder: string): Thenable<readonly BooleanPick[] | undefined>;
}

export interface BooleanPick extends vscode.QuickPickItem { input: InputDef }

export function createVsCodeInputApi(orgs: OrgService): InputApi {
	return {
		pickOrg: (lastValue) => pickOrg(orgs, lastValue),
		pickDefFile,
		showInputBox: (options) => vscode.window.showInputBox(options),
		showQuickPick: (items, options) => vscode.window.showQuickPick(items, options),
		showBooleanPick: (items, placeHolder) => vscode.window.showQuickPick(items, { canPickMany: true, placeHolder }),
	};
}

export async function gatherInputs(command: CommandDef, store: LastValueStore, core: WardenCore, api: InputApi): Promise<GatheredInputs | undefined> {
	const orgInput = command.inputs[0];
	const org = await api.pickOrg(store.get(command.id, orgInput.key) ?? vscode.workspace.getConfiguration('warden').get<string>('defaultTargetOrg'));
	if (!org) { return undefined; }
	await store.set(command.id, orgInput.key, org);
	const gathered: GatheredInputs = { org, options: {}, display: [`Salesforce org: ${org}`] };
	const groups = new Set<string>();
	if (command.coreId === 'access') {
		if (!await gatherAccess(command, gathered, store, api)) { return undefined; }
	} else {
		for (const input of command.inputs.slice(1)) {
			if (input.kind === 'boolean' || input.dependsOn || input.key === 'outputFile') { continue; }
			if (input.exclusiveGroup) {
				if (groups.has(input.exclusiveGroup)) { continue; }
				groups.add(input.exclusiveGroup);
				const choices = command.inputs.filter((candidate) => candidate.exclusiveGroup === input.exclusiveGroup);
				const selected = await api.showQuickPick(choices.map((candidate) => ({ label: candidate.label, input: candidate })), { placeHolder: 'Choose how to target users' });
				if (!selected || !await gatherOne(command, selected.input, gathered, store, core, api, true)) { return undefined; }
			} else if (!await gatherOne(command, input, gathered, store, core, api, Boolean(input.required))) { return undefined; }
		}
	}
	if (command.coreId === 'diff') { gathered.options.mode = gathered.options.user ? 'user' : 'persona'; }
	if (command.coreId === 'snapshot') { gathered.options.org = org; }
	const booleans = command.inputs.filter((input) => input.kind === 'boolean' && (input.key !== 'verify' || gathered.options.mode !== 'user'));
	if (booleans.length) {
		const picked = await api.showBooleanPick(booleans.map((input) => ({ label: input.label, description: input.summary, input })), 'Select options to enable');
		if (!picked) { return undefined; }
		for (const { input } of picked) { gathered.options[input.key] = true; gathered.display.push(`${input.label}: yes`); }
	}
	const output = command.inputs.find((input) => input.key === 'outputFile');
	if (output && !await gatherOne(command, output, gathered, store, core, api, false)) { return undefined; }
	return gathered;
}

async function gatherAccess(command: CommandDef, gathered: GatheredInputs, store: LastValueStore, api: InputApi): Promise<boolean> {
	const type = command.inputs.find((input) => input.key === 'type');
	if (!type || !await gatherOne(command, type, gathered, store, undefined, api, true)) { return false; }
	const target = command.inputs.find((input) => input.key === 'target')!;
	const user = command.inputs.find((input) => input.key === 'user')!;
	const mode = await api.showQuickPick([{ label: 'Audit a permission target', input: target }, { label: "Audit a user's access", input: user }], { placeHolder: 'Choose audit mode' });
	if (!mode || !await gatherOne(command, mode.input, gathered, store, undefined, api, true)) { return false; }
	if (mode.input.key === 'user') {
		const scope = gathered.options.type === 'field' || gathered.options.type === 'object'
			? [target, command.inputs.find((input) => input.key === 'sobject')!]
			: [target];
		const selected = await api.showQuickPick(scope.map((input) => ({ label: input.label, input })), { placeHolder: 'Choose audit scope' });
		if (!selected || !await gatherOne(command, selected.input, gathered, store, undefined, api, true)) { return false; }
	}
	return true;
}

async function gatherOne(command: CommandDef, input: InputDef, gathered: GatheredInputs, store: LastValueStore, core: WardenCore | undefined, api: InputApi, required: boolean): Promise<boolean> {
	let value: string | undefined;
	const lastValue = store.get(command.id, input.key);
	if (input.kind === 'file') {
		value = await api.pickDefFile({ flag: input, label: input.summary ?? input.label, lastValue, includeGitIgnored: command.coreId === 'restore' && input.key === 'snapshotPath' });
	} else if (input.kind === 'enum') {
		const defaultFormat = input.key === 'inputFormat' && typeof gathered.options.usersPath === 'string' ? core?.detectInputFormat(gathered.options.usersPath) : undefined;
		const preferred = defaultFormat ?? lastValue ?? input.default;
		const choices = [...(input.options ?? [])];
		if (typeof preferred === 'string' && choices.includes(preferred)) {
			choices.splice(choices.indexOf(preferred), 1);
			choices.unshift(preferred);
		}
		const options = choices.map((choice) => ({ label: choice, description: choice === preferred ? 'default' : undefined }));
		value = (await api.showQuickPick(options, { placeHolder: input.summary ?? input.label }))?.label;
	} else {
		value = await api.showInputBox({ ignoreFocusOut: true, prompt: input.summary ?? input.label, placeHolder: input.placeholder ?? (input.key === 'csvListDelimiter' ? ';' : undefined), value: lastValue });
	}
	if (value === undefined) { return !required; }
	if (!value.trim()) { return !required; }
	await store.set(command.id, input.key, value);
	if (input.key === 'outputFile') { gathered.outputFile = value; }
	else { gathered.options[input.key] = value; }
	gathered.display.push(`${input.label}: ${value}`);
	for (const dependent of command.inputs.filter((candidate) => candidate.dependsOn === input.key)) {
		if (dependent.key === 'csvListDelimiter' && value !== 'csv') { continue; }
		if (!await gatherOne(command, dependent, gathered, store, core, api, Boolean(dependent.required))) { return false; }
	}
	if (input.key === 'usersPath' && !command.inputs.some((candidate) => candidate.key === 'inputFormat')) { return true; }
	return true;
}
