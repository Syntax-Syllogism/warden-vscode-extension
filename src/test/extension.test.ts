import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import * as vscode from 'vscode';
import { pickDefFile, type PickDefFileOptions } from '../input/defFilePicker';
import { pickFolder } from '../input/filePicker';
import { gatherInputs, type BooleanPick, type InputApi } from '../input/gatherInputs';
import { pickOutputDirectory } from '../input/outputDirPicker';
import { showWorkspaceQuickPick } from '../input/workspaceQuickPick';
import { prioritizeOrgChoices } from '../input/orgPicker';
import { commands } from '../registry/commands.generated';
import type { CommandDef, FlagDef } from '../registry/types';
import { buildCliArgs, createCommandRunner, type RunnerDeps } from '../runner/commandRunner';
import { WardenCommandsProvider } from '../tree/wardenCommandsProvider';
import { LastValueStore } from '../util/memento';

// Synthetic command/flag fixtures for exercising the generic outputDir picker,
// which no warden command currently exposes (it was only used by the AEP
// domain's --output-path flag before the CLI/extension split). The module
// remains as shared scaffolding (see docs/architecture.md), so it keeps its
// own test coverage independent of the live registry.
const SYNTHETIC_OUTPUT_COMMAND: CommandDef = {
	id: 'warden.__test.outputPath',
	cliId: 'warden __test',
	title: 'Test Output Path',
	group: 'User Lifecycle',
	flags: [],
};
const SYNTHETIC_OUTPUT_FLAG: FlagDef = {
	name: 'output-path',
	kind: 'outputDir',
	default: 'generated-files',
};

suite('Warden extension', () => {
	test('registry exposes user lifecycle commands with known flag kinds', () => {
		assert.deepStrictEqual(commands.map((command) => command.id), [
			'warden.provision',
			'warden.access',
			'warden.strip',
			'warden.freeze',
			'warden.unfreeze',
			'warden.snapshot',
			'warden.restore',
			'warden.diff',
		]);

		const knownKinds = new Set(['org', 'file', 'outputDir', 'outputFile', 'string', 'boolean', 'apiVersion', 'enum']);
		for (const command of commands) {
			for (const flag of command.flags) {
				assert.ok(knownKinds.has(flag.kind), `${command.id}:${flag.name} has unknown kind ${flag.kind}`);
			}
		}
	});

	test('registry metadata covers snapshot, restore, and diff branches', () => {
		const snapshot = commandById('warden.snapshot');
		assert.strictEqual(snapshot.flags.find((flag) => flag.name === 'user')?.exclusiveGroup, 'userTarget');
		assert.strictEqual(snapshot.flags.find((flag) => flag.name === 'out'), undefined);
		const restore = commandById('warden.restore');
		assert.strictEqual(restore.flags.find((flag) => flag.name === 'snapshot')?.kind, 'file');
		assert.strictEqual(restore.flags.find((flag) => flag.name === 'no-prompt')?.kind, 'boolean');
		const diff = commandById('warden.diff');
		assert.strictEqual(diff.flags.find((flag) => flag.name === 'against')?.dependsOnFlag, 'user');
		assert.strictEqual(diff.flags.find((flag) => flag.name === 'against')?.required, true);
		assert.strictEqual(diff.flags.find((flag) => flag.name === 'personas-def')?.dependsOnFlag, 'users-def');
		assert.strictEqual(diff.flags.find((flag) => flag.name === 'personas-def')?.required, undefined);
		assert.strictEqual(diff.flags.find((flag) => flag.name === 'external-id')?.dependsOnFlag, 'users-def');
		assert.strictEqual(diff.flags.find((flag) => flag.name === 'output'), undefined);
	});

	test('registry surfaces output files and deliberately hides CLI-only format flags', () => {
		const hiddenEverywhere = new Set(['output', 'input-format', 'csv-list-delimiter']);
		for (const command of commands) {
			assert.ok(command.flags.some((flag) => flag.name === 'output-file' && flag.kind === 'outputFile'), `${command.id} should expose --output-file`);
			for (const flagName of hiddenEverywhere) {
				assert.ok(!command.flags.some((flag) => flag.name === flagName), `${command.id} should hide --${flagName}`);
			}
		}

		assert.ok(!commandById('warden.diff').flags.some((flag) => flag.name === 'fail-on-drift'));
		assert.strictEqual(commandById('warden.provision').flags.find((flag) => flag.name === 'personas-def')?.required, undefined);
		assert.strictEqual(commandById('warden.access').flags.find((flag) => flag.name === 'target')?.required, undefined);
		assert.strictEqual(commandById('warden.diff').flags.find((flag) => flag.name === 'against')?.required, true);
	});

	test('registry marks strip as the only destructive command', () => {
		assert.strictEqual(commandById('warden.strip').destructive, true);
		for (const command of commands) {
			if (command.id !== 'warden.strip') {
				assert.strictEqual(command.destructive, undefined, `${command.id} should not be destructive`);
			}
		}
	});

	test('generated registry stays in sync with the checked-in manifest fixture', () => {
		const repositoryRoot = resolve(__dirname, '..', '..');
		const tempDir = mkdtempSync(join(tmpdir(), 'warden-codegen-'));
		const registryPath = join(tempDir, 'commands.generated.ts');
		const packagePath = join(tempDir, 'package.json');
		writeFileSync(packagePath, readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));

		execFileSync('node', [
			'--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
			'--experimental-strip-types',
			join(repositoryRoot, 'scripts', 'gen-commands.ts'),
			join(repositoryRoot, 'vendor', 'warden.oclif.manifest.json'),
			registryPath,
			packagePath,
		], { cwd: repositoryRoot });

		assert.strictEqual(readFileSync(registryPath, 'utf8'), readFileSync(join(repositoryRoot, 'src', 'registry', 'commands.generated.ts'), 'utf8'));
		const generatedPackage = JSON.parse(readFileSync(packagePath, 'utf8')) as { contributes: { commands: unknown } };
		const currentPackage = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as { contributes: { commands: unknown } };
		assert.deepStrictEqual(generatedPackage.contributes.commands, currentPackage.contributes.commands);
	});

	test('gatherInputs builds argv from definition file picker responses and skips blank optionals', async () => {
		const command = commandById('warden.provision');
		const store = new LastValueStore(new MemoryMemento());
		let defFilePickCount = 0;
		const inputApi: InputApi = {
			pickOrg: async () => 'scratch',
			pickFile: async () => {
				throw new Error('native file picker should not be used for definition files');
			},
			pickDefFile: async () => defFilePickCount++ === 0 ? 'config/users.json' : 'config/personas.json',
			pickFolder: async () => undefined,
			pickOutputDirectory: async () => undefined,
			showInputBox: async () => '',
			showQuickPick: async () => undefined,
			showBooleanPick: async (items: readonly BooleanPick[]) => items.filter((item) => item.flag.name === 'dry-run'),
			showWarningMessage: async () => undefined,
		};

		const result = await gatherInputs(command, store, inputApi);

		assert.deepStrictEqual(result?.args, [
			'--target-org', 'scratch',
			'--users-def', 'config/users.json',
			'--personas-def', 'config/personas.json',
			'--dry-run',
		]);
	});

	test('gatherInputs aborts when a required definition file prompt is cancelled', async () => {
		const command = commandById('warden.provision');
		const store = new LastValueStore(new MemoryMemento());
		const inputApi: InputApi = {
			pickOrg: async () => 'scratch',
			pickFile: async () => undefined,
			pickDefFile: async () => undefined,
			pickFolder: async () => undefined,
			pickOutputDirectory: async () => undefined,
			showInputBox: async () => '',
			showQuickPick: async () => undefined,
			showBooleanPick: async () => [],
			showWarningMessage: async () => undefined,
		};

		assert.strictEqual(await gatherInputs(command, store, inputApi), undefined);
	});

	test('gatherInputs aborts when an exclusive-group definition file prompt is cancelled', async () => {
		const command = commandById('warden.freeze');
		const store = new LastValueStore(new MemoryMemento());
		const inputApi: InputApi = {
			pickOrg: async () => 'dev',
			pickFile: async () => undefined,
			pickDefFile: async () => undefined,
			pickFolder: async () => undefined,
			pickOutputDirectory: async () => undefined,
			showInputBox: async (options) => options.prompt?.includes('match users') ? 'Username' : '',
			showQuickPick: async (items) => items.find((item) => item.label === 'Users definition file'),
			showBooleanPick: async () => [],
			showWarningMessage: async () => undefined,
		};

		assert.strictEqual(await gatherInputs(command, store, inputApi), undefined);
	});

	test('gatherInputs passes last-used definition file and stores the selected relative path', async () => {
		const command = commandById('warden.strip');
		const store = new LastValueStore(new MemoryMemento());
		await store.set(command.id, 'users-def', 'config/previous-users.json');
		const receivedOptions: PickDefFileOptions[] = [];
		const inputApi: InputApi = {
			pickOrg: async () => 'dev',
			pickFile: async () => undefined,
			pickDefFile: async (options) => {
				receivedOptions.push(options);
				return 'config/current-users.json';
			},
			pickFolder: async () => undefined,
			pickOutputDirectory: async () => undefined,
			showInputBox: async (options) => options.prompt?.includes('match users') ? 'Username' : '',
			showQuickPick: async (items) => items.find((item) => item.label === 'Users definition file'),
			showBooleanPick: async () => [],
			showWarningMessage: async () => undefined,
		};

		const result = await gatherInputs(command, store, inputApi);

		assert.deepStrictEqual(result?.args, [
			'--users-def', 'config/current-users.json',
			'--external-id', 'Username',
			'--target-org', 'dev',
		]);
		assert.strictEqual(receivedOptions[0].lastValue, 'config/previous-users.json');
		assert.strictEqual(store.get(command.id, 'users-def'), 'config/current-users.json');
	});

	test('gatherInputs uses verified access flags without prompting for dead output mode', async () => {
		const command = commandById('warden.access');
		const accessType = command.flags.find((flag) => flag.name === 'type');
		const target = command.flags.find((flag) => flag.name === 'target');
		assert.deepStrictEqual(accessType?.options, ['field', 'object', 'apex-class', 'vf-page', 'custom-permission', 'tab']);
		assert.strictEqual(target?.placeholder, 'Object__c.Field__c');
		assert.ok(!command.flags.some((flag) => flag.name === 'output'));
		assert.ok(!command.flags.some((flag) => flag.name === 'api-version'));

		const store = new LastValueStore(new MemoryMemento());
		const inputApi: InputApi = {
			pickOrg: async () => 'dev',
			pickFile: async () => undefined,
			pickDefFile: async () => undefined,
			pickFolder: async () => undefined,
			pickOutputDirectory: async () => undefined,
			showInputBox: async (options) => options.prompt?.includes('Target API name') ? 'Account.Name' : '',
			showQuickPick: async (items) => items[0],
			showBooleanPick: async () => [],
			showWarningMessage: async () => undefined,
		};

		const result = await gatherInputs(command, store, inputApi);

		assert.deepStrictEqual(result?.args, [
			'--target-org', 'dev',
			'--type', 'field',
			'--target', 'Account.Name',
		]);
	});

	test('gatherInputs treats access reverse-audit flags as optional flat prompts', async () => {
		const command = commandById('warden.access');
		const store = new LastValueStore(new MemoryMemento());
		const inputApi: InputApi = {
			pickOrg: async () => 'dev',
			pickFile: async () => undefined,
			pickDefFile: async () => undefined,
			pickFolder: async () => undefined,
			pickOutputDirectory: async () => undefined,
			showInputBox: async (options) => {
				if (options.placeHolder === 'Object__c.Field__c') {
					return '';
				}
				if (options.placeHolder === 'Username:myUser@email.com') {
					return 'Username:user@example.com';
				}
				if (options.placeHolder === 'Account') {
					return 'Account';
				}
				return '';
			},
			showQuickPick: async (items) => items[0],
			showBooleanPick: async () => [],
			showWarningMessage: async () => undefined,
		};

		assert.deepStrictEqual((await gatherInputs(command, store, inputApi))?.args, [
			'--target-org', 'dev',
			'--type', 'field',
			'--user', 'Username:user@example.com',
			'--sobject', 'Account',
		]);
	});

	test('gatherInputs prompts for optional output files and skips blanks', async () => {
		const command: CommandDef = {
			id: 'warden.__test.outputFile',
			cliId: 'warden __test',
			title: 'Test Output File',
			group: 'User Lifecycle',
			flags: [{ name: 'output-file', kind: 'outputFile', placeholder: 'reports/result.json' }],
		};
		const baseInputApi: InputApi = {
			pickOrg: async () => undefined,
			pickFile: async () => undefined,
			pickDefFile: async () => undefined,
			pickFolder: async () => undefined,
			pickOutputDirectory: async () => undefined,
			showInputBox: async () => 'reports/result.json',
			showQuickPick: async () => undefined,
			showBooleanPick: async () => [],
			showWarningMessage: async () => undefined,
		};

		assert.deepStrictEqual((await gatherInputs(command, new LastValueStore(new MemoryMemento()), baseInputApi))?.args, [
			'--output-file', 'reports/result.json',
		]);
		assert.deepStrictEqual((await gatherInputs(command, new LastValueStore(new MemoryMemento()), { ...baseInputApi, showInputBox: async () => '' }))?.args, []);
	});

	test('gatherInputs suppresses diff verbose when an output file is selected', async () => {
		const command: CommandDef = {
			id: 'warden.diff',
			cliId: 'warden diff',
			title: 'SF Warden: Diff',
			group: 'User Lifecycle',
			flags: [
				{ name: 'output-file', kind: 'outputFile', placeholder: 'reports/result.json' },
				{ name: 'verbose', kind: 'boolean' },
			],
		};
		const offered: string[][] = [];
		const inputApi: InputApi = {
			pickOrg: async () => undefined,
			pickFile: async () => undefined,
			pickDefFile: async () => undefined,
			pickFolder: async () => undefined,
			pickOutputDirectory: async () => undefined,
			showInputBox: async () => 'reports/result.json',
			showQuickPick: async () => undefined,
			showBooleanPick: async (items) => {
				offered.push(items.map((item) => item.flag.name));
				return [];
			},
			showWarningMessage: async () => undefined,
		};

		await gatherInputs(command, new LastValueStore(new MemoryMemento()), inputApi);
		assert.deepStrictEqual(offered, []);

		offered.length = 0;
		await gatherInputs(command, new LastValueStore(new MemoryMemento()), { ...inputApi, showInputBox: async () => '' });
		assert.deepStrictEqual(offered, [['verbose']]);
	});

	test('gatherInputs aborts when a required org is cancelled', async () => {
		const command = commandById('warden.access');
		const store = new LastValueStore(new MemoryMemento());
		await store.set(command.id, 'target-org', 'previous-org');
		const inputApi: InputApi = {
			pickOrg: async () => undefined,
			pickFile: async () => undefined,
			pickDefFile: async () => undefined,
			pickFolder: async () => undefined,
			pickOutputDirectory: async () => undefined,
			showInputBox: async () => 'Account.Name',
			showQuickPick: async (items) => items[0],
			showBooleanPick: async () => [],
			showWarningMessage: async () => undefined,
		};

		assert.strictEqual(await gatherInputs(command, store, inputApi), undefined);
	});

	test('prioritizeOrgChoices moves the last-used org first without changing cancel semantics', () => {
		const choices = [
			{ label: 'one', value: 'one' },
			{ label: 'two', value: 'two' },
		];

		assert.deepStrictEqual(prioritizeOrgChoices(choices, 'two').map((choice) => choice.value), ['two', 'one']);
		assert.deepStrictEqual(prioritizeOrgChoices(choices).map((choice) => choice.value), ['one', 'two']);
	});

	test('pickFolder returns project-relative paths and root as dot', async () => {
		await withWorkspaceFolders(['/repo'], async () => {
			await withOpenDialog([vscode.Uri.file('/repo/force-app')], async () => {
				assert.strictEqual(await pickFolder('Output folder'), 'force-app');
			});

			await withOpenDialog([vscode.Uri.file('/repo')], async () => {
				assert.strictEqual(await pickFolder('Output folder'), '.');
			});
		});
	});

	test('pickFolder rejects out-of-workspace folders', async () => {
		const warnings: string[] = [];
		await withWorkspaceFolders(['/repo'], async () => {
			await withOpenDialog([vscode.Uri.file('/outside')], async () => {
				await withWarningMessage(async (message) => {
					warnings.push(message);
					return undefined;
				}, async () => {
					assert.strictEqual(await pickFolder('Output folder'), undefined);
				});
			});
		});

		assert.deepStrictEqual(warnings, ['Choose a folder inside the current workspace.']);
	});

	test('showWorkspaceQuickPick injects last-used first, deduplicates, and returns undefined on cancel', async () => {
		const capturedItems: vscode.QuickPickItem[][] = [];
		await withQuickPick((items) => {
			capturedItems.push([...items]);
			return items[0];
		}, async () => {
			const result = await showWorkspaceQuickPick({
				items: [
					{ label: 'users.json', value: 'config/users.json' },
					{ label: 'users duplicate', value: 'config/users.json' },
					{ label: 'personas.json', value: 'config/personas.json' },
				],
				lastValue: 'config/users.json',
				placeHolder: 'Pick JSON',
			});
			assert.strictEqual(result, 'config/users.json');
		});

		assert.deepStrictEqual(capturedItems[0].map((item) => (item as unknown as { value: string }).value), [
			'config/users.json',
			'config/personas.json',
		]);

		await withQuickPick(() => undefined, async () => {
			const result = await showWorkspaceQuickPick({
				items: [{ label: 'users.json', value: 'config/users.json' }],
				placeHolder: 'Pick JSON',
			});
			assert.strictEqual(result, undefined);
		});
	});

	test('pickDefFile offers discovered workspace JSON and CSV files and returns a relative path', async () => {
		const command = commandById('warden.provision');
		const flag = command.flags.find((f) => f.name === 'users-def')!;
		const tempDir = mkdtempSync(join(tmpdir(), 'warden-test-'));
		mkdirSync(join(tempDir, 'config'));
		mkdirSync(join(tempDir, 'data'));
		writeFileSync(join(tempDir, 'config', 'users.json'), '{}');
		writeFileSync(join(tempDir, 'data', 'personas.json'), '{}');
		writeFileSync(join(tempDir, 'data', 'users.csv'), 'Username\nuser@example.com\n');
		const capturedItems: vscode.QuickPickItem[][] = [];

		await withWorkspaceFolders([tempDir], async () => {
			await withFindFiles([
				vscode.Uri.file(join(tempDir, 'data', 'personas.json')),
				vscode.Uri.file(join(tempDir, 'config', 'users.json')),
				vscode.Uri.file(join(tempDir, 'data', 'users.csv')),
			], async () => {
				await withQuickPick((items) => {
					capturedItems.push([...items]);
					return items.find((item) => (item as unknown as { value: string }).value === 'data/personas.json');
				}, async () => {
					const result = await pickDefFile({ flag, label: 'Path to user definition JSON file.' });
					assert.strictEqual(result, 'data/personas.json');
				});
			});
		});

		assert.deepStrictEqual(capturedItems[0].map((item) => (item as unknown as { value: string }).value), [
			'config/users.json',
			'data/personas.json',
			'data/users.csv',
		]);
		assert.strictEqual(capturedItems[0][0].label, 'users.json');
		assert.strictEqual(capturedItems[0][0].description, 'config');
	});

	test('pickDefFile filters JSON files ignored by git', async () => {
		const command = commandById('warden.provision');
		const flag = command.flags.find((f) => f.name === 'users-def')!;
		const tempDir = mkdtempSync(join(tmpdir(), 'warden-test-'));
		mkdirSync(join(tempDir, 'config'));
		mkdirSync(join(tempDir, 'ignored'));
		writeFileSync(join(tempDir, '.gitignore'), 'ignored/**\n');
		writeFileSync(join(tempDir, 'config', 'users.json'), '{}');
		writeFileSync(join(tempDir, 'ignored', 'users.json'), '{}');
		execFileSync('git', ['init'], { cwd: tempDir });
		const capturedItems: vscode.QuickPickItem[][] = [];

		await withWorkspaceFolders([tempDir], async () => {
			await withFindFiles([
				vscode.Uri.file(join(tempDir, 'ignored', 'users.json')),
				vscode.Uri.file(join(tempDir, 'config', 'users.json')),
			], async () => {
				await withQuickPick((items) => {
					capturedItems.push([...items]);
					return undefined;
				}, async () => {
					await pickDefFile({ flag, label: 'Path to user definition JSON file.', lastValue: 'ignored/users.json' });
				});
			});
		});

		assert.deepStrictEqual(capturedItems[0].map((item) => (item as unknown as { value: string }).value), ['config/users.json']);
	});

	test('pickDefFile keeps restore snapshots JSON-only while including gitignored files', async () => {
		const flag = commandById('warden.restore').flags.find((candidate) => candidate.name === 'snapshot')!;
		const tempDir = mkdtempSync(join(tmpdir(), 'warden-test-'));
		mkdirSync(join(tempDir, 'snapshots'));
		writeFileSync(join(tempDir, '.gitignore'), 'snapshots/**\n');
		writeFileSync(join(tempDir, 'snapshots', 'user.json'), '{}');
		writeFileSync(join(tempDir, 'snapshots', 'user.csv'), 'Username\nuser@example.com\n');
		execFileSync('git', ['init'], { cwd: tempDir });
		const capturedItems: vscode.QuickPickItem[][] = [];

		await withWorkspaceFolders([tempDir], async () => {
			await withFindFiles([
				vscode.Uri.file(join(tempDir, 'snapshots', 'user.json')),
				vscode.Uri.file(join(tempDir, 'snapshots', 'user.csv')),
			], async () => {
				await withQuickPick((items) => {
					capturedItems.push([...items]);
					return undefined;
				}, async () => {
					await pickDefFile({ flag, label: 'Snapshot JSON file to restore from.', includeGitIgnored: true });
				});
			});
		});

		assert.deepStrictEqual(capturedItems[0].map((item) => (item as unknown as { value: string }).value), ['snapshots/user.json']);
	});

	test('pickDefFile puts an existing last-used file first and deduplicates discovered matches', async () => {
		const command = commandById('warden.provision');
		const flag = command.flags.find((f) => f.name === 'users-def')!;
		const tempDir = mkdtempSync(join(tmpdir(), 'warden-test-'));
		mkdirSync(join(tempDir, 'config'));
		writeFileSync(join(tempDir, 'config', 'users.json'), '{}');
		writeFileSync(join(tempDir, 'config', 'personas.json'), '{}');
		const capturedItems: vscode.QuickPickItem[][] = [];

		await withWorkspaceFolders([tempDir], async () => {
			await withFindFiles([
				vscode.Uri.file(join(tempDir, 'config', 'personas.json')),
				vscode.Uri.file(join(tempDir, 'config', 'users.json')),
			], async () => {
				await withQuickPick((items) => {
					capturedItems.push([...items]);
					return undefined;
				}, async () => {
					await pickDefFile({ flag, label: 'Path to user definition JSON file.', lastValue: 'config/users.json' });
				});
			});
		});

		const values = capturedItems[0].map((item) => (item as unknown as { value: string }).value);
		assert.deepStrictEqual(values, ['config/users.json', 'config/personas.json']);
		assert.strictEqual(capturedItems[0][0].description, 'Last used • config');
	});

	test('pickDefFile silently omits a missing last-used file', async () => {
		const command = commandById('warden.provision');
		const flag = command.flags.find((f) => f.name === 'users-def')!;
		const tempDir = mkdtempSync(join(tmpdir(), 'warden-test-'));
		mkdirSync(join(tempDir, 'config'));
		writeFileSync(join(tempDir, 'config', 'users.json'), '{}');
		const capturedItems: vscode.QuickPickItem[][] = [];

		await withWorkspaceFolders([tempDir], async () => {
			await withFindFiles([vscode.Uri.file(join(tempDir, 'config', 'users.json'))], async () => {
				await withQuickPick((items) => {
					capturedItems.push([...items]);
					return undefined;
				}, async () => {
					await pickDefFile({ flag, label: 'Path to user definition JSON file.', lastValue: 'config/missing.json' });
				});
			});
		});

		assert.deepStrictEqual(capturedItems[0].map((item) => item.description), ['config']);
	});

	test('gatherInputs enforces user-or-users-def targeting as a single choice', async () => {
		const command = commandById('warden.freeze');
		const userFlag = command.flags.find((flag) => flag.name === 'user');
		assert.strictEqual(userFlag?.placeholder, 'Username:myUser@email.com');
		assert.strictEqual(userFlag?.summary, 'Target a single user as field:value (e.g. Username:user@example.com).');

		const store = new LastValueStore(new MemoryMemento());
		const inputApi: InputApi = {
			pickOrg: async () => 'dev',
			pickFile: async () => {
				throw new Error('file picker should not be used for single-user targeting');
			},
			pickDefFile: async () => {
				throw new Error('definition file picker should not be used for single-user targeting');
			},
			pickFolder: async () => undefined,
			pickOutputDirectory: async () => undefined,
			showInputBox: async (options) => {
				if (options.prompt?.includes('match users')) {
					throw new Error('external-id should not be prompted for single-user targeting');
				}

				return options.prompt?.includes('single user') ? 'Username:myUser@email.com' : '';
			},
			showQuickPick: async (items) => items[0],
			showBooleanPick: async () => [],
			showWarningMessage: async () => undefined,
		};

		const result = await gatherInputs(command, store, inputApi);

		assert.deepStrictEqual(result?.args, [
			'--user', 'Username:myUser@email.com',
			'--target-org', 'dev',
		]);
	});

	test('gatherInputs gathers both diff dependents for users-def mode', async () => {
		const command = commandById('warden.diff');
		const inputApi: InputApi = {
			pickOrg: async () => 'dev',
			pickFile: async () => undefined,
			pickDefFile: async ({ flag }) => `${flag.name}.json`,
			pickFolder: async () => undefined,
			pickOutputDirectory: async () => undefined,
			showInputBox: async (options) => options.placeHolder === 'reports/warden-output.json' ? '' : 'FederationIdentifier',
			showQuickPick: async (items) => items.find((item) => item.label === 'Users definition file'),
			showBooleanPick: async () => [],
			showWarningMessage: async () => undefined,
		};

		const result = await gatherInputs(command, new LastValueStore(new MemoryMemento()), inputApi);
		assert.deepStrictEqual(result?.args, [
			'--users-def', 'users-def.json',
			'--personas-def', 'personas-def.json',
			'--external-id', 'FederationIdentifier',
			'--target-org', 'dev',
		]);
	});

	test('gatherInputs supports snapshot target modes and restore options', async () => {
		const snapshot = commandById('warden.snapshot');
		const gatherSnapshot = async (targetLabel: string) => gatherInputs(snapshot, new LastValueStore(new MemoryMemento()), {
			pickOrg: async () => 'dev', pickFile: async () => undefined, pickDefFile: async () => 'users.json',
			pickFolder: async () => undefined, pickOutputDirectory: async () => undefined,
			showInputBox: async (options) => options.placeHolder === 'reports/warden-output.json'
				? ''
				: options.prompt?.includes('single user') ? 'Username:user@example.com' : 'FederationIdentifier',
			showQuickPick: async (items) => items.find((item) => item.label === targetLabel), showBooleanPick: async () => [], showWarningMessage: async () => undefined,
		});
		assert.deepStrictEqual((await gatherSnapshot('Single user'))?.args, ['--user', 'Username:user@example.com', '--target-org', 'dev']);
		assert.deepStrictEqual((await gatherSnapshot('Users definition file'))?.args, ['--users-def', 'users.json', '--external-id', 'FederationIdentifier', '--target-org', 'dev']);

		let includeGitIgnored: boolean | undefined;
		const restore = await gatherInputs(commandById('warden.restore'), new LastValueStore(new MemoryMemento()), {
			pickOrg: async () => 'dev', pickFile: async () => undefined,
			pickDefFile: async (options) => { includeGitIgnored = options.includeGitIgnored; return 'snapshots/user.json'; },
			pickFolder: async () => undefined, pickOutputDirectory: async () => undefined, showInputBox: async () => undefined,
			showQuickPick: async () => undefined, showBooleanPick: async (items) => items, showWarningMessage: async () => undefined,
		});
		assert.strictEqual(includeGitIgnored, true);
		assert.deepStrictEqual(restore?.args, ['--target-org', 'dev', '--snapshot', 'snapshots/user.json', '--no-prompt', '--dry-run']);
	});

	test('gatherInputs supports diff single-user mode and optional persona follow-ups', async () => {
		const diff = commandById('warden.diff');
		const inputApi: InputApi = {
			pickOrg: async () => 'dev', pickFile: async () => undefined, pickDefFile: async () => 'users.json',
			pickFolder: async () => undefined, pickOutputDirectory: async () => undefined,
			showInputBox: async (options) => options.placeHolder === 'reports/warden-output.json'
				? undefined
				: options.prompt?.includes('baseline') ? 'Username:baseline@example.com' : 'Username:user@example.com',
			showQuickPick: async (items) => items.find((item) => item.label === 'Single user'), showBooleanPick: async () => [], showWarningMessage: async () => undefined,
		};
		assert.deepStrictEqual((await gatherInputs(diff, new LastValueStore(new MemoryMemento()), inputApi))?.args, ['--user', 'Username:user@example.com', '--against', 'Username:baseline@example.com', '--target-org', 'dev']);
		assert.strictEqual(await gatherInputs(diff, new LastValueStore(new MemoryMemento()), { ...inputApi, showInputBox: async () => undefined }), undefined);
		assert.deepStrictEqual((await gatherInputs(diff, new LastValueStore(new MemoryMemento()), {
			...inputApi, showQuickPick: async (items) => items.find((item) => item.label === 'Users definition file'),
			pickDefFile: async ({ flag }) => flag.name === 'personas-def' ? undefined : 'users.json',
		}))?.args, ['--users-def', 'users.json', '--external-id', 'Username:user@example.com', '--target-org', 'dev']);
	});

	test('buildCliArgs avoids json by default and injects no-prompt only where supported', () => {
		const command = commandById('warden.access');

		assert.deepStrictEqual(buildCliArgs(command, ['--target-org', 'dev']), [
			'warden', 'access',
			'--target-org', 'dev',
		]);
		assert.deepStrictEqual(buildCliArgs(command, ['--target-org', 'dev', '--output-file', 'reports/result.json']), [
			'warden', 'access',
			'--target-org', 'dev', '--output-file', 'reports/result.json', '--output', 'json',
		]);

		assert.deepStrictEqual(buildCliArgs(commandById('warden.provision'), ['--target-org', 'dev']), [
			'warden', 'provision',
			'--target-org', 'dev',
			'--no-prompt',
		]);
		const restore = commandById('warden.restore');
		assert.deepStrictEqual(buildCliArgs(restore, ['--target-org', 'dev', '--snapshot', 'snapshot.json']), [
			'warden', 'restore', '--target-org', 'dev', '--snapshot', 'snapshot.json',
		]);
		assert.deepStrictEqual(buildCliArgs(restore, ['--target-org', 'dev', '--snapshot', 'snapshot.json', '--no-prompt']), [
			'warden', 'restore', '--target-org', 'dev', '--snapshot', 'snapshot.json', '--no-prompt',
		]);
	});

	test('runner prepares output-file parents, offers Open File, and skips the reveal on dry-run', async () => {
		const access = commandById('warden.access');
		const workspaceFolder = mkdtempSync(join(tmpdir(), 'warden-output-'));
		const spawnedArgs: string[][] = [];
		const infoChoices: string[] = [];
		const executed: Array<[string, vscode.Uri]> = [];
		const runner = createCommandRunner({
			output: new MemoryOutputChannel(),
			workspaceFolder,
			spawnProcess: (_file, args) => {
				spawnedArgs.push([...args]);
				return fakeChildProcess('{"status":0,"result":{}}');
			},
			withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
			showInformationMessage: async (_message: string, ...items: unknown[]) => {
				infoChoices.push(String(items.at(-1)));
				return 'Open File' as never;
			},
			showWarningMessage: async () => undefined as never,
			showErrorMessage: async () => undefined as never,
			executeCommand: async <T = unknown>(commandId: string, uri: vscode.Uri): Promise<T> => {
				executed.push([commandId, uri as vscode.Uri]);
			return undefined as T;
			},
		} satisfies RunnerDeps);

		await runner.run(access, {
			args: ['--target-org', 'dev', '--output-file', 'reports/result.json'],
			displayArgs: ['--target-org', 'dev', '--output-file', 'reports/result.json'],
		});

		assert.deepStrictEqual(spawnedArgs[0].slice(-2), ['--output', 'json']);
		assert.deepStrictEqual(infoChoices, ['Open File']);
		assert.deepStrictEqual(executed, [['vscode.open', vscode.Uri.file(join(workspaceFolder, 'reports/result.json'))]]);
		assert.ok(existsSync(join(workspaceFolder, 'reports')));

		spawnedArgs.length = 0;
		infoChoices.length = 0;
		executed.length = 0;
		await runner.run(access, {
			args: ['--target-org', 'dev', '--output-file', 'reports/result.json', '--dry-run'],
			displayArgs: ['--target-org', 'dev', '--output-file', 'reports/result.json', '--dry-run'],
		});

		assert.deepStrictEqual(executed, []);
		assert.deepStrictEqual(infoChoices, ['undefined']);
	});

	test('runner rejects output-file paths outside the workspace before spawning', async () => {
		const access = commandById('warden.access');
		const errors: string[] = [];
		const spawnedArgs: string[][] = [];
		const runner = createCommandRunner({
			output: new MemoryOutputChannel(),
			workspaceFolder: mkdtempSync(join(tmpdir(), 'warden-output-')),
			spawnProcess: (_file, args) => {
				spawnedArgs.push([...args]);
				return fakeChildProcess('{"status":0,"result":{}}');
			},
			withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
			showInformationMessage: async () => undefined as never,
			showWarningMessage: async () => undefined as never,
			showErrorMessage: async (message: string) => {
				errors.push(message);
				return undefined as never;
			},
		} satisfies RunnerDeps);

		await runner.run(access, {
			args: ['--target-org', 'dev', '--output-file', '../result.json'],
			displayArgs: ['--target-org', 'dev', '--output-file', '../result.json'],
		});

		assert.deepStrictEqual(spawnedArgs, []);
		assert.deepStrictEqual(errors, ['Output file must be a non-empty path inside the current workspace.']);
	});

	test('destructive strip previews with dry-run before applying', async () => {
		const strip = commandById('warden.strip');
		const spawnedArgs: string[][] = [];
		const output = new MemoryOutputChannel();
		const runner = createCommandRunner({
			output,
			spawnProcess: (_file, args) => {
				spawnedArgs.push([...args]);
				return fakeChildProcess('{"status":0,"result":{}}');
			},
			withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
			showInformationMessage: async () => 'Run' as never,
			showWarningMessage: async () => 'Apply' as never,
			showErrorMessage: async () => undefined as never,
		} satisfies RunnerDeps);

		await runner.run(strip, { args: ['--target-org', 'dev', '--user', 'myUser@email.com'], displayArgs: ['--target-org', 'dev', '--user', 'myUser@email.com'] });

		assert.strictEqual(spawnedArgs.length, 2);
		assert.ok(spawnedArgs[0].includes('--dry-run'));
		assert.ok(!spawnedArgs[1].includes('--dry-run'));
		assert.ok(spawnedArgs[0].includes('--no-prompt'));
		assert.ok(!spawnedArgs[0].includes('--json'));
		assert.ok(!spawnedArgs[1].includes('--json'));
		assert.match(output.value, /\$ sf warden strip/);
	});

	test('runner executes restore once through the standard strategy', async () => {
		const restore = commandById('warden.restore');
		const spawnedArgs: string[][] = [];
		const runner = createCommandRunner({
			output: new MemoryOutputChannel(),
			spawnProcess: (_file, args) => {
				spawnedArgs.push([...args]);
				return fakeChildProcess('Restored snapshot');
			},
			withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
			showInformationMessage: async () => undefined as never,
			showWarningMessage: async () => undefined as never,
			showErrorMessage: async () => undefined as never,
		} satisfies RunnerDeps);

		await runner.run(restore, {
			args: ['--target-org', 'dev', '--snapshot', 'snapshots/user.json', '--no-prompt'],
			displayArgs: ['--target-org', 'dev', '--snapshot', 'snapshots/user.json', '--no-prompt'],
		});

		assert.deepStrictEqual(spawnedArgs, [[
			'warden', 'restore', '--target-org', 'dev', '--snapshot', 'snapshots/user.json', '--no-prompt',
		]]);
	});

	test('runner strips ANSI output and reports JSON-envelope failures', async () => {
		const access = commandById('warden.access');
		const errors: string[] = [];
		const infos: string[] = [];
		const output = new MemoryOutputChannel();
		const runner = createCommandRunner({
			output,
			spawnProcess: () => fakeChildProcess('[31m{"status":1,"message":"bad"}[0m', 0),
			withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
			showInformationMessage: async (message: string) => {
				infos.push(message);
				return 'Run' as never;
			},
			showWarningMessage: async () => undefined as never,
			showErrorMessage: async (message: string) => {
				errors.push(message);
				return undefined as never;
			},
		} satisfies RunnerDeps);

		await runner.run(access, { args: ['--target-org', 'dev', '--type', 'field', '--target', 'Account.Name'], displayArgs: ['--target-org', 'dev', '--type', 'field', '--target', 'Account.Name'] });

		assert.match(output.value, /"status":1/);
		assert.doesNotMatch(output.value, //);
		assert.deepStrictEqual(errors, ['SF Warden: Access failed. See the Warden output channel.']);
		assert.deepStrictEqual(infos, []);
	});

	test('runner runs access immediately and treats cancellation as a user stop, not a failure', async () => {
		const access = commandById('warden.access');
		const errors: string[] = [];
		const infos: string[] = [];
		const spawnedArgs: string[][] = [];
		const output = new MemoryOutputChannel();
		const runner = createCommandRunner({
			output,
			spawnProcess: (_file, args) => {
				spawnedArgs.push([...args]);
				return fakeCancellableChildProcess();
			},
			withProgress: async (_options, task) => {
				const source = new vscode.CancellationTokenSource();
				const promise = task({ report: () => undefined }, source.token);
				source.cancel();
				return promise;
			},
			showInformationMessage: async (message: string) => {
				infos.push(message);
				return 'Run' as never;
			},
			showWarningMessage: async () => undefined as never,
			showErrorMessage: async (message: string) => {
				errors.push(message);
				return undefined as never;
			},
		} satisfies RunnerDeps);

		await runner.run(access, { args: ['--target-org', 'dev'], displayArgs: ['--target-org', 'dev'] });

		assert.deepStrictEqual(errors, []);
		assert.deepStrictEqual(infos, []);
		assert.deepStrictEqual(spawnedArgs, [['warden', 'access', '--target-org', 'dev']]);
	});

	test('runner surfaces a JSON result summary when one is available', async () => {
		const access = commandById('warden.access');
		const infos: string[] = [];
		const runner = createCommandRunner({
			output: new MemoryOutputChannel(),
			spawnProcess: () => fakeChildProcess('{"status":0,"result":{"summary":"Access report ready"}}'),
			withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
			showInformationMessage: async (message: string) => {
				infos.push(message);
				return 'Run' as never;
			},
			showWarningMessage: async () => undefined as never,
			showErrorMessage: async () => undefined as never,
		} satisfies RunnerDeps);

		await runner.run(access, { args: ['--target-org', 'dev'], displayArgs: ['--target-org', 'dev'] });

		assert.deepStrictEqual(infos, [
			'Access report ready',
		]);
	});

	test('runner logs malformed JSON-like output and falls back to process exit code', async () => {
		const access = commandById('warden.access');
		const infos: string[] = [];
		const errors: string[] = [];
		const output = new MemoryOutputChannel();
		const runner = createCommandRunner({
			output,
			spawnProcess: () => fakeChildProcess('{"status":0,', 0),
			withProgress: async (_options, task) => task({ report: () => undefined }, new vscode.CancellationTokenSource().token),
			showInformationMessage: async (message: string) => {
				infos.push(message);
				return 'Run' as never;
			},
			showWarningMessage: async () => undefined as never,
			showErrorMessage: async (message: string) => {
				errors.push(message);
				return undefined as never;
			},
		} satisfies RunnerDeps);

		await runner.run(access, { args: ['--target-org', 'dev'], displayArgs: ['--target-org', 'dev'] });

		assert.match(output.value, /\[debug\] Unable to parse Salesforce CLI JSON envelope:/);
		assert.deepStrictEqual(infos, ['SF Warden: Access completed.']);
		assert.deepStrictEqual(errors, []);
	});

	test('pickOutputDirectory shows Quick Pick with default as first item', async () => {
		const capturedItems: vscode.QuickPickItem[][] = [];

		await withWorkspaceFolders(['/repo'], async () => {
			await withQuickPick((items) => {
				capturedItems.push([...items]);
				return items[0];
			}, async () => {
				const result = await pickOutputDirectory({ command: SYNTHETIC_OUTPUT_COMMAND, flag: SYNTHETIC_OUTPUT_FLAG, label: 'Output folder', defaultValue: 'generated-files' });
				assert.strictEqual(result, 'generated-files');
			});
		});

		const items = capturedItems[0];
		assert.ok(items, 'showQuickPick should have been called');
		assert.strictEqual(items[0].label, 'generated-files');
		assert.strictEqual(items[0].description, 'Default');
	});

	test('pickOutputDirectory includes last-used as second item when different from default', async () => {
		const capturedItems: vscode.QuickPickItem[][] = [];

		await withWorkspaceFolders(['/repo'], async () => {
			await withQuickPick((items) => {
				capturedItems.push([...items]);
				return undefined;
			}, async () => {
				await pickOutputDirectory({
					command: SYNTHETIC_OUTPUT_COMMAND, flag: SYNTHETIC_OUTPUT_FLAG, label: 'Output folder',
					defaultValue: 'generated-files',
					lastValue: 'force-app',
				});
			});
		});

		const items = capturedItems[0];
		assert.strictEqual(items[0].label, 'generated-files');
		assert.strictEqual(items[0].description, 'Default');
		assert.strictEqual(items[1].label, 'force-app');
		assert.strictEqual(items[1].description, 'Last used');
	});

	test('pickOutputDirectory returns undefined when Quick Pick is cancelled', async () => {
		await withWorkspaceFolders(['/repo'], async () => {
			await withQuickPick(() => undefined, async () => {
				const result = await pickOutputDirectory({ command: SYNTHETIC_OUTPUT_COMMAND, flag: SYNTHETIC_OUTPUT_FLAG, label: 'Output folder', defaultValue: 'generated-files' });
				assert.strictEqual(result, undefined);
			});
		});
	});

	test('pickOutputDirectory falls back to folder picker for Choose Different Folder', async () => {
		await withWorkspaceFolders(['/repo'], async () => {
			await withQuickPick((items) => items.find((item) => item.label.includes('Choose Different Folder')), async () => {
				await withOpenDialog([vscode.Uri.file('/repo/custom-dir')], async () => {
					const result = await pickOutputDirectory({ command: SYNTHETIC_OUTPUT_COMMAND, flag: SYNTHETIC_OUTPUT_FLAG, label: 'Output folder', defaultValue: 'generated-files' });
					assert.strictEqual(result, 'custom-dir');
				});
			});
		});
	});

	test('pickOutputDirectory rejects out-of-workspace folders from custom fallback', async () => {
		const warnings: string[] = [];

		await withWorkspaceFolders(['/repo'], async () => {
			await withQuickPick((items) => items.find((item) => item.label.includes('Choose Different Folder')), async () => {
				await withOpenDialog([vscode.Uri.file('/outside')], async () => {
					await withWarningMessage(async (msg) => {
						warnings.push(msg);
						return undefined;
					}, async () => {
						const result = await pickOutputDirectory({ command: SYNTHETIC_OUTPUT_COMMAND, flag: SYNTHETIC_OUTPUT_FLAG, label: 'Output folder', defaultValue: 'generated-files' });
						assert.strictEqual(result, undefined);
					});
				});
			});
		});

		assert.deepStrictEqual(warnings, ['Choose a folder inside the current workspace.']);
	});

	test('pickOutputDirectory discovers sfdx-project.json package directories', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'warden-test-'));
		writeFileSync(join(tempDir, 'sfdx-project.json'), JSON.stringify({
			packageDirectories: [
				{ path: 'force-app', default: true },
				{ path: 'packages/shared' },
			],
		}));
		const capturedItems: vscode.QuickPickItem[][] = [];

		await withWorkspaceFolders([tempDir], async () => {
			await withQuickPick((items) => {
				capturedItems.push([...items]);
				return undefined;
			}, async () => {
				await pickOutputDirectory({ command: SYNTHETIC_OUTPUT_COMMAND, flag: SYNTHETIC_OUTPUT_FLAG, label: 'Output folder', defaultValue: 'generated-files' });
			});
		});

		const labels = capturedItems[0].map((item) => item.label);
		assert.ok(labels.includes('force-app'), 'should include default package dir');
		assert.ok(labels.includes('packages/shared'), 'should include other package dirs');
	});

	test('pickOutputDirectory puts sfdx default package before non-default packages', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'warden-test-'));
		writeFileSync(join(tempDir, 'sfdx-project.json'), JSON.stringify({
			packageDirectories: [
				{ path: 'packages/shared' },
				{ path: 'force-app', default: true },
			],
		}));
		const capturedItems: vscode.QuickPickItem[][] = [];

		await withWorkspaceFolders([tempDir], async () => {
			await withQuickPick((items) => {
				capturedItems.push([...items]);
				return undefined;
			}, async () => {
				await pickOutputDirectory({ command: SYNTHETIC_OUTPUT_COMMAND, flag: SYNTHETIC_OUTPUT_FLAG, label: 'Output folder', defaultValue: 'generated-files' });
			});
		});

		const packageItems = capturedItems[0].filter((item) => item.description === 'Package directory');
		assert.strictEqual(packageItems[0].label, 'force-app');
		assert.strictEqual(packageItems[1].label, 'packages/shared');
	});

	test('pickOutputDirectory ignores malformed sfdx-project.json without throwing', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'warden-test-'));
		writeFileSync(join(tempDir, 'sfdx-project.json'), 'not valid json {{{');

		await withWorkspaceFolders([tempDir], async () => {
			await withQuickPick(() => undefined, async () => {
				const result = await pickOutputDirectory({ command: SYNTHETIC_OUTPUT_COMMAND, flag: SYNTHETIC_OUTPUT_FLAG, label: 'Output folder', defaultValue: 'generated-files' });
				assert.strictEqual(result, undefined);
			});
		});
	});

	test('pickOutputDirectory deduplicates candidates', async () => {
		const tempDir = mkdtempSync(join(tmpdir(), 'warden-test-'));
		writeFileSync(join(tempDir, 'sfdx-project.json'), JSON.stringify({
			packageDirectories: [{ path: 'generated-files', default: true }],
		}));
		const capturedItems: vscode.QuickPickItem[][] = [];

		await withWorkspaceFolders([tempDir], async () => {
			await withQuickPick((items) => {
				capturedItems.push([...items]);
				return undefined;
			}, async () => {
				await pickOutputDirectory({
					command: SYNTHETIC_OUTPUT_COMMAND, flag: SYNTHETIC_OUTPUT_FLAG, label: 'Output folder',
					defaultValue: 'generated-files',
					lastValue: 'generated-files',
				});
			});
		});

		const generatedFilesItems = capturedItems[0].filter((item) => item.label === 'generated-files');
		assert.strictEqual(generatedFilesItems.length, 1, 'generated-files should appear only once');
		assert.strictEqual(generatedFilesItems[0].description, 'Default');
	});

	test('tree provider exposes a flat User Lifecycle group with all commands', () => {
		const provider = new WardenCommandsProvider(commands);
		const groups = provider.getChildren();
		assert.deepStrictEqual(groups.map((node) => node.type === 'group' ? node.label : ''), ['User Lifecycle']);

		const lifecycle = groups[0];
		assert.strictEqual(lifecycle.type, 'group');
		assert.deepStrictEqual(provider.getChildren(lifecycle).map((node) => node.type === 'command' ? node.command.id : ''), [
			'warden.provision',
			'warden.access',
			'warden.strip',
			'warden.freeze',
			'warden.unfreeze',
			'warden.snapshot',
			'warden.restore',
			'warden.diff',
		]);
	});

	test('tree provider marks strip with a warning icon and other commands with a person icon', () => {
		const provider = new WardenCommandsProvider(commands);
		const strip = commandById('warden.strip');
		const stripItem = provider.getTreeItem({ type: 'command', command: strip });
		assert.deepStrictEqual(stripItem.iconPath, new vscode.ThemeIcon('warning'));

		const access = commandById('warden.access');
		const accessItem = provider.getTreeItem({ type: 'command', command: access });
		assert.deepStrictEqual(accessItem.iconPath, new vscode.ThemeIcon('person'));
	});
});

function commandById(id: string): CommandDef {
	const command = commands.find((candidate) => candidate.id === id);
	assert.ok(command, `missing command ${id}`);
	return command;
}

async function withWorkspaceFolders(roots: readonly string[], task: () => Promise<void>): Promise<void> {
	const descriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');
	Object.defineProperty(vscode.workspace, 'workspaceFolders', {
		configurable: true,
		value: roots.map((root, index) => ({ uri: vscode.Uri.file(root), name: root, index })),
	});
	try {
		await task();
	} finally {
		if (descriptor) {
			Object.defineProperty(vscode.workspace, 'workspaceFolders', descriptor);
		} else {
			delete (vscode.workspace as { workspaceFolders?: readonly vscode.WorkspaceFolder[] }).workspaceFolders;
		}
	}
}

async function withOpenDialog(result: readonly vscode.Uri[] | undefined, task: () => Promise<void>): Promise<void> {
	const original = vscode.window.showOpenDialog;
	vscode.window.showOpenDialog = async () => result as vscode.Uri[] | undefined;
	try {
		await task();
	} finally {
		vscode.window.showOpenDialog = original;
	}
}

async function withFindFiles(result: readonly vscode.Uri[], task: () => Promise<void>): Promise<void> {
	const original = vscode.workspace.findFiles;
	(vscode.workspace as unknown as { findFiles: unknown }).findFiles = async (pattern: string) => pattern === '**/*.json'
		? result.filter((uri) => uri.fsPath.endsWith('.json'))
		: result;
	try {
		await task();
	} finally {
		(vscode.workspace as unknown as { findFiles: unknown }).findFiles = original;
	}
}

async function withQuickPick(
	handler: (items: readonly vscode.QuickPickItem[]) => vscode.QuickPickItem | undefined,
	task: () => Promise<void>,
): Promise<void> {
	const original = vscode.window.showQuickPick;
	(vscode.window as unknown as { showQuickPick: unknown }).showQuickPick = async (items: readonly vscode.QuickPickItem[]) => handler(items);
	try {
		await task();
	} finally {
		vscode.window.showQuickPick = original;
	}
}

async function withWarningMessage(handler: (message: string) => Thenable<string | undefined>, task: () => Promise<void>): Promise<void> {
	const original = vscode.window.showWarningMessage;
	vscode.window.showWarningMessage = handler as typeof vscode.window.showWarningMessage;
	try {
		await task();
	} finally {
		vscode.window.showWarningMessage = original;
	}
}

class MemoryMemento implements vscode.Memento {
	private readonly values = new Map<string, unknown>();

	public get<T>(key: string): T | undefined;
	public get<T>(key: string, defaultValue: T): T;
	public get<T>(key: string, defaultValue?: T): T | undefined {
		return this.values.has(key) ? this.values.get(key) as T : defaultValue;
	}

	public keys(): readonly string[] {
		return [...this.values.keys()];
	}

	public update(key: string, value: unknown): Thenable<void> {
		this.values.set(key, value);
		return Promise.resolve();
	}
}

class MemoryOutputChannel implements vscode.OutputChannel {
	public value = '';
	public readonly name = 'Warden';

	public append(value: string): void {
		this.value += value;
	}

	public appendLine(value: string): void {
		this.value += `${value}\n`;
	}

	public clear(): void {}
	public show(): void {}
	public hide(): void {}
	public dispose(): void {}
	public replace(value: string): void {
		this.value = value;
	}
}

function fakeChildProcess(stdout: string, code = 0): any {
	const child = new EventEmitter() as any;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.kill = () => true;
	setImmediate(() => {
		child.stdout.emit('data', stdout);
		child.emit('close', code);
	});
	return child;
}

function fakeCancellableChildProcess(): any {
	const child = new EventEmitter() as any;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.kill = () => {
		setImmediate(() => child.emit('close', null));
		return true;
	};
	return child;
}
