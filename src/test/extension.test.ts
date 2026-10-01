import * as assert from 'assert';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';
import { z } from 'zod';
import type { WardenCore } from '../core/load';
import { authorizationChoices } from '../core/orgService';
import type { GatheredInputs } from '../input/gatherInputs';
import { gatherInputs, type InputApi } from '../input/gatherInputs';
import { buildCommands } from '../registry/commands';
import { createCommandRunner, resolveOutputPath } from '../runner/commandRunner';
import { LastValueStore } from '../util/memento';

suite('In-process Warden extension', () => {
	let core: WardenCore;
	suiteSetup(async () => { core = await import('@syntax-syllogism/warden-core'); });

	test('registry exposes all descriptor options and package commands', () => {
		const commands = buildCommands(core);
		assert.strictEqual(commands.length, 8);
		assert.deepStrictEqual(commands.map((command) => command.id), core.commandDescriptors.map((descriptor) => `warden.${descriptor.id}`));
		const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { contributes: { commands: Array<{ command: string; title: string }> } };
		assert.deepStrictEqual(pkg.contributes.commands, commands.map((command) => ({ command: command.id, title: command.title })));
		for (const command of commands) {
			const hints = core.uiHints(core[command.coreId].descriptor.optionsSchema as z.ZodType);
			for (const key of Object.keys(hints)) {
				if (key.endsWith('Doc') || command.coreId === 'snapshot' && key === 'org' || command.coreId === 'diff' && key === 'mode') { continue; }
				assert.ok(command.inputs.some((input) => input.key === key), `${command.coreId} missing ${key}`);
			}
		}
		const freeze = commands.find((command) => command.coreId === 'freeze')!;
		assert.strictEqual(freeze.inputs.find((input) => input.key === 'user')?.exclusiveGroup, 'userTarget');
		assert.strictEqual(freeze.inputs.find((input) => input.key === 'usersPath')?.exclusiveGroup, 'userTarget');
		assert.ok(commands.find((command) => command.coreId === 'access')?.inputs.find((input) => input.key === 'type')?.options?.includes('record-type'));
	});

	test('org labels preserve alias, default, and expired status', () => {
		const choices = authorizationChoices([
			{ orgId: '1', username: 'a@example.com', aliases: ['dev'], configs: [], oauthMethod: 'web', isExpired: true },
			{ orgId: '2', username: 'bad@example.com', aliases: [], configs: [], oauthMethod: 'web', isExpired: false, error: 'invalid' },
		], 'dev');
		assert.deepStrictEqual(choices, [{ label: 'dev (a@example.com)', value: 'dev', description: 'default, expired' }]);
	});

	test('input gathering uses core keys, CSV format, and dependent prompts', async () => {
		const saved = new Map<string, string>();
		const store = new LastValueStore({ get: (key: string) => saved.get(key), update: async (key: string, value: string) => { saved.set(key, value); } } as unknown as vscode.Memento);
		const command = buildCommands(core).find((entry) => entry.coreId === 'provision')!;
		await store.set(command.id, 'inputFormat', 'json');
		const prompted: string[] = [];
		const api: InputApi = {
			pickOrg: async () => 'dev',
			pickDefFile: async ({ flag }) => flag.key === 'usersPath' ? 'input/users.csv' : undefined,
			showInputBox: async (options) => { prompted.push(options.prompt ?? ''); return options.prompt === 'CSV list delimiter' ? '|' : undefined; },
			showQuickPick: async (items) => {
				assert.strictEqual(items[0]?.label, 'csv');
				return items[0] as never;
			},
			showBooleanPick: async () => [],
		};
		const gathered = await gatherInputs(command, store, core, api);
		assert.strictEqual(gathered?.org, 'dev');
		assert.deepStrictEqual(gathered?.options, { usersPath: 'input/users.csv', inputFormat: 'csv', csvListDelimiter: '|' });
		assert.ok(prompted.includes('CSV list delimiter'));
	});

	test('canceling a required restore snapshot stops input gathering', async () => {
		const command = buildCommands(core).find((entry) => entry.coreId === 'restore')!;
		assert.strictEqual(command.inputs.find((input) => input.key === 'snapshotPath')?.required, true);
		const store = new LastValueStore({ get: () => undefined, update: async () => undefined } as unknown as vscode.Memento);
		const api: InputApi = {
			pickOrg: async () => 'dev',
			pickDefFile: async ({ flag }) => {
				assert.strictEqual(flag.key, 'snapshotPath');
				return undefined;
			},
			showInputBox: async () => { assert.fail('Gathering continued after cancel'); },
			showQuickPick: async () => { assert.fail('Gathering continued after cancel'); },
			showBooleanPick: async () => { assert.fail('Gathering continued after cancel'); },
		};
		assert.strictEqual(await gatherInputs(command, store, core, api), undefined);
	});

	test('diff user mode derives mode and omits verify', async () => {
		const command = buildCommands(core).find((entry) => entry.coreId === 'diff')!;
		let booleanLabels: string[] = [];
		const api: InputApi = {
			pickOrg: async () => 'dev',
			pickDefFile: async () => undefined,
			showInputBox: async (options) => options.prompt === 'User match (field:value)' ? 'Username:user@example.com' : options.prompt === 'Reference user match (field:value)' ? 'Username:baseline@example.com' : undefined,
			showQuickPick: async (items) => items.find((item) => item.label === 'User match (field:value)') as never,
			showBooleanPick: async (items) => { booleanLabels = items.map((item) => item.label); return []; },
		};
		const store = new LastValueStore({ get: () => undefined, update: async () => undefined } as unknown as vscode.Memento);
		const gathered = await gatherInputs(command, store, core, api);
		assert.strictEqual(gathered?.options.mode, 'user');
		assert.strictEqual(gathered?.options.against, 'Username:baseline@example.com');
		assert.ok(!booleanLabels.includes('Verify conformance'));
	});

	test('every write command previews and applies its exact plan only after approval', async () => {
		const lifecycle = { users: [], summary: { total: 0, changed: 0, unchanged: 0, failed: 0 } };
		const provision = { users: [], summary: { total: 0, created: 0, updated: 0, failed: 0, warnings: 0 } };
		for (const coreId of ['provision', 'freeze', 'unfreeze', 'strip', 'restore'] as const) {
			const output: string[] = [];
			const parsedOptions = { user: 'Username:test@example.com' };
			const result = coreId === 'provision' ? provision : lifecycle;
			const plan = coreId === 'freeze' || coreId === 'unfreeze'
				? { users: [], warnings: ['check'] }
				: { preview: result, warnings: ['check'] };
			const connection = {};
			let approval = 'Cancel';
			let planCount = 0;
			let applyCount = 0;
			const fakeCase = {
				kind: 'write',
				descriptor: { optionsSchema: { safeParse: () => ({ success: true, data: parsedOptions }) } },
				plan: async (conn: unknown, options: unknown) => {
					assert.strictEqual(conn, connection, coreId);
					assert.strictEqual(options, parsedOptions, coreId);
					planCount++;
					return plan;
				},
				apply: async (conn: unknown, value: unknown) => {
					assert.strictEqual(conn, connection, coreId);
					assert.strictEqual(value, plan, coreId);
					applyCount++;
					return result;
				},
			};
			const fakeCore = { ...core, [coreId]: fakeCase } as unknown as WardenCore;
			const runner = createCommandRunner({
				core: async () => fakeCore,
				orgs: { listOrgs: async () => [], connect: async () => connection as never, resolveUsername: async (value: string) => value, invalidate: async () => undefined },
				output: { appendLine: (line: string) => output.push(line), show: () => undefined } as unknown as vscode.OutputChannel,
				withProgress: async (_options: unknown, task: (progress: { report: () => void }, token: { isCancellationRequested: boolean; onCancellationRequested: () => { dispose: () => void } }) => Promise<unknown>) => task({ report: () => undefined }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) }),
				showInformationMessage: async () => undefined,
				showWarningMessage: async () => approval,
				showErrorMessage: async () => undefined,
			} as unknown as Parameters<typeof createCommandRunner>[0]);
			const command = buildCommands(core).find((entry) => entry.coreId === coreId)!;
			const inputs: GatheredInputs = { org: 'dev', options: parsedOptions, display: ['User: test'] };
			await runner.run(command, inputs);
			assert.strictEqual(planCount, 1, coreId);
			assert.strictEqual(applyCount, 0, coreId);
			assert.ok(output.some((line) => line.includes('Preview')), coreId);
			assert.ok(output.some((line) => line.includes('warning: check')), coreId);
			approval = 'Apply';
			await runner.run(command, inputs);
			assert.strictEqual(planCount, 2, coreId);
			assert.strictEqual(applyCount, 1, coreId);
		}
	});

	test('CSV and JSON files are written from the final result', async () => {
		const root = mkdtempSync(join(tmpdir(), 'warden-result-'));
		const result = { users: [], summary: { total: 0, changed: 0, unchanged: 0, failed: 0 } };
		const fakeCore = { ...core, strip: { kind: 'write', descriptor: { optionsSchema: { safeParse: () => ({ success: true, data: { user: 'Username:test@example.com' } }) } }, plan: async () => ({ preview: result, warnings: [] }), apply: async () => result } } as unknown as WardenCore;
		const runner = createCommandRunner({
			core: async () => fakeCore,
			orgs: { listOrgs: async () => [], connect: async () => ({}) as never, resolveUsername: async (value: string) => value, invalidate: async () => undefined },
			output: { appendLine: () => undefined, show: () => undefined } as unknown as vscode.OutputChannel,
			withProgress: async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) => task({ report: () => undefined }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) }),
			showInformationMessage: async () => undefined,
			showWarningMessage: async () => 'Apply',
			showErrorMessage: async () => undefined,
			workspaceFolder: root,
		} as unknown as Parameters<typeof createCommandRunner>[0]);
		const command = buildCommands(core).find((entry) => entry.coreId === 'strip')!;
		const inputs: GatheredInputs = { org: 'dev', options: { user: 'Username:test@example.com' }, display: [], outputFile: 'report.csv' };
		await runner.run(command, inputs);
		assert.strictEqual(readFileSync(join(root, 'report.csv'), 'utf8'), core.renderStripCsv(result));
		inputs.outputFile = 'report.json';
		await runner.run(command, inputs);
		assert.deepStrictEqual(JSON.parse(readFileSync(join(root, 'report.json'), 'utf8')), result);
	});

	test('auth failure invalidates the connection and retries planning once', async () => {
		const connections = [{ id: 1 }, { id: 2 }];
		const calls: string[] = [];
		const result = { users: [], summary: { total: 0, changed: 0, unchanged: 0, failed: 0 } };
		const plan = { preview: result, warnings: [] };
		const fakeCore = { ...core, strip: {
			kind: 'write',
			descriptor: { optionsSchema: { safeParse: () => ({ success: true, data: { user: 'Username:test@example.com' } }) } },
			plan: async (conn: { id: number }) => {
				calls.push(`plan:${conn.id}`);
				if (conn.id === 1) { throw Object.assign(new Error('Session expired'), { code: 'INVALID_SESSION_ID' }); }
				return plan;
			},
			apply: async (conn: { id: number }, value: unknown) => {
				calls.push(`apply:${conn.id}`);
				assert.strictEqual(value, plan);
				return result;
			},
		} } as unknown as WardenCore;
		let connectionIndex = 0;
		const errors: string[] = [];
		const runner = createCommandRunner({
			core: async () => fakeCore,
			orgs: {
				listOrgs: async () => [],
				connect: async () => { calls.push('connect'); return connections[connectionIndex++] as never; },
				resolveUsername: async (value: string) => value,
				invalidate: async (value: string) => { assert.strictEqual(value, 'dev'); calls.push('invalidate'); },
			},
			output: { appendLine: () => undefined, show: () => undefined } as unknown as vscode.OutputChannel,
			withProgress: async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) => task({ report: () => undefined }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) }),
			showInformationMessage: async () => undefined,
			showWarningMessage: async () => 'Apply',
			showErrorMessage: async (message: string) => { errors.push(message); return undefined; },
		} as unknown as Parameters<typeof createCommandRunner>[0]);
		await runner.run(buildCommands(core).find((entry) => entry.coreId === 'strip')!, { org: 'dev', options: { user: 'Username:test@example.com' }, display: [] });
		assert.deepStrictEqual(calls, ['connect', 'plan:1', 'invalidate', 'connect', 'plan:2', 'apply:2']);
		assert.deepStrictEqual(errors, []);
	});

	test('invalid options stop before opening an org connection', async () => {
		let connected = false;
		const errors: string[] = [];
		const lines: string[] = [];
		const fakeCore = { ...core, access: { kind: 'read', descriptor: { optionsSchema: { safeParse: () => ({ success: false, error: { issues: [{ message: 'type required' }] } }) } } } } as unknown as WardenCore;
		const runner = createCommandRunner({
			core: async () => fakeCore,
			orgs: { listOrgs: async () => [], connect: async () => { connected = true; return {} as never; }, resolveUsername: async (value: string) => value, invalidate: async () => undefined },
			output: { appendLine: (line: string) => lines.push(line), show: () => undefined } as unknown as vscode.OutputChannel,
			withProgress: vscode.window.withProgress,
			showInformationMessage: vscode.window.showInformationMessage,
			showWarningMessage: vscode.window.showWarningMessage,
			showErrorMessage: async (message: string) => { errors.push(message); return undefined; },
		} as unknown as Parameters<typeof createCommandRunner>[0]);
		await runner.run(buildCommands(core).find((entry) => entry.coreId === 'access')!, { org: 'dev', options: {}, display: [] });
		assert.strictEqual(connected, false);
		assert.deepStrictEqual(errors, ['Invalid options']);
		assert.ok(lines.some((line) => line.includes('type required')));
	});

	test('Warden cancellation is reported without an error notification', async () => {
		const messages: string[] = [];
		const errors: string[] = [];
		const fakeCore = { ...core, access: {
			kind: 'read',
			descriptor: { optionsSchema: { safeParse: () => ({ success: true, data: { type: 'field', target: 'Account.Name' } }) } },
			run: async (_conn: unknown, _options: unknown, ctx: { signal: AbortSignal }) => {
				assert.strictEqual(ctx.signal.aborted, true);
				throw new core.WardenError('cancelled', 'Cancelled');
			},
		} } as unknown as WardenCore;
		const runner = createCommandRunner({
			core: async () => fakeCore,
			orgs: { listOrgs: async () => [], connect: async () => ({}) as never, resolveUsername: async (value: string) => value, invalidate: async () => undefined },
			output: { appendLine: () => undefined, show: () => undefined } as unknown as vscode.OutputChannel,
			withProgress: async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) => task({ report: () => undefined }, { isCancellationRequested: true, onCancellationRequested: () => ({ dispose: () => undefined }) }),
			showInformationMessage: async (message: string) => { messages.push(message); return undefined; },
			showWarningMessage: vscode.window.showWarningMessage,
			showErrorMessage: async (message: string) => { errors.push(message); return undefined; },
		} as unknown as Parameters<typeof createCommandRunner>[0]);
		await runner.run(buildCommands(core).find((entry) => entry.coreId === 'access')!, { org: 'dev', options: { type: 'field', target: 'Account.Name' }, display: [] });
		assert.deepStrictEqual(messages, ['SF Warden: Access cancelled.']);
		assert.deepStrictEqual(errors, []);
	});

	test('output path stays inside workspace', async () => {
		const root = mkdtempSync(join(tmpdir(), 'warden-output-'));
		const outside = mkdtempSync(join(tmpdir(), 'warden-outside-'));
		assert.strictEqual(await resolveOutputPath('../escape.json', root), undefined);
		assert.strictEqual(await resolveOutputPath('reports/output.csv', root), join(root, 'reports/output.csv'));
		symlinkSync(outside, join(root, 'linked-dir'), 'dir');
		assert.strictEqual(await resolveOutputPath('linked-dir/escape.json', root), undefined);
		assert.strictEqual(await resolveOutputPath('linked-dir/nested/escape.json', root), undefined);
		writeFileSync(join(outside, 'target.json'), '{}');
		symlinkSync(join(outside, 'target.json'), join(root, 'linked-file.json'));
		assert.strictEqual(await resolveOutputPath('linked-file.json', root), undefined);
		symlinkSync(join(outside, 'missing.json'), join(root, 'dangling.json'));
		assert.strictEqual(await resolveOutputPath('dangling.json', root), undefined);
		mkdirSync(join(root, 'real-dir'));
		symlinkSync(join(root, 'real-dir'), join(root, 'inner-link'), 'dir');
		assert.strictEqual(await resolveOutputPath('inner-link/ok.json', root), join(root, 'inner-link/ok.json'));
	});

	test('source has no process spawning', () => {
		const src = join(__dirname, '..');
		const inspect = (directory: string): void => {
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				if (entry.name === 'test') { continue; }
				const file = join(directory, entry.name);
				if (entry.isDirectory()) { inspect(file); }
				else if (entry.name.endsWith('.ts')) {
					assert.doesNotMatch(readFileSync(file, 'utf8'), /child_process|cross-spawn|execSf|spawnSf/, file);
				}
			}
		};
		inspect(src);
	});

	test('the VS Code extension host runs Node 22 or later', () => {
		assert.ok(Number(process.versions.node.split('.')[0]) >= 22, process.versions.node);
	});
});
