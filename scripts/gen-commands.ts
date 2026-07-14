import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface ManifestFlag {
	name?: string;
	type?: string;
	summary?: string;
	description?: string;
	required?: boolean;
	options?: string[];
	default?: string;
}

interface ManifestCommand {
	id: string;
	description?: string;
	summary?: string;
	flags?: Record<string, ManifestFlag>;
}

interface OclifManifest {
	commands: Record<string, ManifestCommand>;
}

interface PackageJson {
	contributes?: {
		commands?: ContributedCommand[];
	};
}

interface ContributedCommand {
	command: string;
	title: string;
}

const allowList = new Set([
	'warden provision',
	'warden access',
	'warden strip',
	'warden freeze',
	'warden unfreeze',
	'warden snapshot',
	'warden restore',
	'warden diff',
]);

const titleById = new Map([
	['warden provision', 'SF Warden: Provision'],
	['warden access', 'SF Warden: Access'],
	['warden strip', 'SF Warden: Strip'],
	['warden freeze', 'SF Warden: Freeze'],
	['warden unfreeze', 'SF Warden: Unfreeze'],
	['warden snapshot', 'SF Warden: Snapshot'],
	['warden restore', 'SF Warden: Restore'],
	['warden diff', 'SF Warden: Diff'],
]);

const groupById = new Map([
	['warden provision', 'User Lifecycle'],
	['warden access', 'User Lifecycle'],
	['warden strip', 'User Lifecycle'],
	['warden freeze', 'User Lifecycle'],
	['warden unfreeze', 'User Lifecycle'],
	['warden snapshot', 'User Lifecycle'],
	['warden restore', 'User Lifecycle'],
	['warden diff', 'User Lifecycle'],
]);

// Warden has no subgroups — every command sits flat under "User Lifecycle".
const subgroupById = new Map<string, string>();

const requireOneOfById = new Map<string, string[]>();

const userTargetFlags = new Set(['user', 'users-def']);

const guiHiddenFlagsByCommand = new Map<string, Set<string>>([
	['warden access', new Set(['output'])],
	['warden snapshot', new Set(['out'])],
	['warden diff', new Set(['output'])],
]);

const placeholderByCommandFlag = new Map([
	['*:user', 'Username:myUser@email.com'],
	['warden access:target', 'Object__c.Field__c'],
	['warden diff:against', 'Username:otherUser@email.com'],
]);

const summaryByCommandFlag = new Map([
	['*:user', 'Target a single user as field:value (e.g. Username:user@example.com).'],
	['warden strip:external-id', 'Default field used to match users in the definition file.'],
	['warden freeze:external-id', 'Default field used to match users in the definition file.'],
	['warden unfreeze:external-id', 'Default field used to match users in the definition file.'],
	['warden diff:against', 'Compare against this baseline user or persona.'],
	['warden restore:snapshot', 'Snapshot JSON file to restore from.'],
]);

export function generateRegistry(manifest: OclifManifest): string {
	const commands = lifecycleCommands(manifest).map((command) => commandDef(command));

	return `import type { CommandDef } from './types';\n\nexport const commands: readonly CommandDef[] = ${JSON.stringify(commands, null, '\t')} as const;\n`;
}

export function generateContributesCommands(manifest: OclifManifest): ContributedCommand[] {
	return lifecycleCommands(manifest).map((command) => ({
		command: vscodeCommandId(command.id),
		title: titleById.get(cliCommandId(command.id)) ?? cliCommandId(command.id),
	}));
}

export function updatePackageContributesCommands(packageJson: PackageJson, manifest: OclifManifest): PackageJson {
	return {
		...packageJson,
		contributes: {
			...packageJson.contributes,
			commands: generateContributesCommands(manifest),
		},
	};
}

function lifecycleCommands(manifest: OclifManifest): ManifestCommand[] {
	return Object.values(manifest.commands)
		.filter((command) => allowList.has(cliCommandId(command.id)))
		.sort((left, right) => [...allowList].indexOf(cliCommandId(left.id)) - [...allowList].indexOf(cliCommandId(right.id)));
}

function commandDef(command: ManifestCommand): Record<string, unknown> {
	const cliId = cliCommandId(command.id);
	const supportsNoPrompt = Boolean(command.flags?.['no-prompt']);
	return omitUndefined({
		id: vscodeCommandId(command.id),
		cliId,
		title: titleById.get(cliId) ?? cliId,
		group: groupById.get(cliId) ?? 'User Lifecycle',
		subgroup: subgroupById.get(cliId),
		// restore exposes --no-prompt as a normal picker option; it must not be
		// injected or routed through the special confirmation strategy.
		supportsNoPrompt: supportsNoPrompt && cliId !== 'warden restore' ? true : undefined,
		destructive: cliId === 'warden strip' ? true : undefined,
		requireOneOf: requireOneOfById.get(cliId),
		flags: Object.entries(command.flags ?? {})
			.filter(([name]) => shouldPromptForFlag(cliId, name))
			.sort(([left], [right]) => flagOrder(cliId, left) - flagOrder(cliId, right))
			.map(([name, flag]) => omitUndefined({
				name,
				kind: flagKind(cliId, name, flag),
				summary: summaryFor(cliId, name, flag),
				required: flag.required || requiredOverride(cliId, name) || undefined,
				options: flag.options,
				placeholder: placeholderFor(cliId, name),
				exclusiveGroup: exclusiveGroupFor(command, name),
				dependsOnFlag: dependsOnFlagFor(command, name),
				default: flag.default,
			})),
	});
}

function requiredOverride(commandId: string, flagName: string): boolean {
	return commandId === 'warden diff' && (flagName === 'against' || flagName === 'personas-def');
}

function shouldPromptForFlag(commandId: string, name: string): boolean {
	if (name === 'json' || (name === 'no-prompt' && commandId !== 'warden restore') || name === 'api-version' || name === 'flags-dir') {
		return false;
	}

	return !guiHiddenFlagsByCommand.get(commandId)?.has(name);
}

function flagKind(commandId: string, name: string, flag: ManifestFlag): string {
	if (name === 'target-org') {
		return 'org';
	}
	if (name === 'api-version') {
		return 'apiVersion';
	}
	if (name === 'output-path') {
		return 'outputDir';
	}
	if (commandId === 'warden restore' && name === 'snapshot') {
		return 'file';
	}
	if (flag.type === 'boolean') {
		return 'boolean';
	}
	if (flag.options?.length) {
		return 'enum';
	}
	if (flag.type === 'option' && /file|path|def$/.test(name)) {
		return 'file';
	}

	return 'string';
}

function exclusiveGroupFor(command: ManifestCommand, flagName: string): string | undefined {
	const commandFlagNames = new Set(Object.keys(command.flags ?? {}));
	if (userTargetFlags.has(flagName) && commandFlagNames.has('user') && commandFlagNames.has('users-def')) {
		return 'userTarget';
	}

	return undefined;
}

function dependsOnFlagFor(command: ManifestCommand, flagName: string): string | undefined {
	const commandId = cliCommandId(command.id);
	const explicit = new Map([
		['warden diff:against', 'user'],
		['warden diff:personas-def', 'users-def'],
	]).get(`${commandId}:${flagName}`);
	if (explicit) {
		return explicit;
	}
	if (flagName !== 'external-id') {
		return undefined;
	}

	// `external-id` only sets the default match field for `--users-def` entries, so
	// defer it to the def-file branch of the userTarget choice (single-user mode
	// carries its own `field:value`). Scope to commands that offer that choice.
	const commandFlagNames = new Set(Object.keys(command.flags ?? {}));
	if (commandFlagNames.has('user') && commandFlagNames.has('users-def')) {
		return 'users-def';
	}

	return undefined;
}

function placeholderFor(commandId: string, flagName: string): string | undefined {
	return placeholderByCommandFlag.get(`${commandId}:${flagName}`) ?? placeholderByCommandFlag.get(`*:${flagName}`);
}

function summaryFor(commandId: string, flagName: string, flag: ManifestFlag): string | undefined {
	return summaryByCommandFlag.get(`${commandId}:${flagName}`) ?? summaryByCommandFlag.get(`*:${flagName}`) ?? flag.summary ?? flag.description;
}

function flagOrder(commandId: string, flagName: string): number {
	if (!['warden strip', 'warden freeze', 'warden unfreeze', 'warden snapshot', 'warden diff'].includes(commandId)) {
		return 0;
	}

	// Surface the userTarget choice (single user vs. definition file) before
	// `--target-org` and the rest. `--external-id` is not ordered here: it carries
	// `dependsOnFlag` and is only prompted within the `--users-def` branch.
	if (flagName === 'user') {
		return -1;
	}
	if (flagName === 'users-def') {
		return -1;
	}

	return 0;
}

function cliCommandId(manifestId: string): string {
	return manifestId.replace(/:/g, ' ');
}

function vscodeCommandId(manifestId: string): string {
	return manifestId.replace(/:/g, '.').replaceAll(' ', '.');
}

function omitUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const manifestPath = resolve(process.argv[2] ?? 'vendor/warden.oclif.manifest.json');
	const outputPath = resolve(process.argv[3] ?? 'src/registry/commands.generated.ts');
	const packageJsonPath = resolve(process.argv[4] ?? 'package.json');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as OclifManifest;
	writeFileSync(outputPath, generateRegistry(manifest));
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson;
	writeFileSync(packageJsonPath, `${JSON.stringify(updatePackageContributesCommands(packageJson, manifest), null, 2)}\n`);
}
