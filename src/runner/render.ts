import type { WardenCore } from '../core/load';
import type { CommandDef } from '../registry/types';
import type { LifecycleResult, UserSnapshotFile, ProvisionResult, UserAccessResult, UserConformanceVerdict, UserDiffResult, FreezePlan } from '@syntax-syllogism/warden-core' with { 'resolution-mode': 'import' };

type Core = WardenCore;

export function renderResult(command: CommandDef, value: unknown, core: Core, options: Record<string, unknown>, format: 'human' | 'csv'): string {
	switch (command.coreId) {
		case 'freeze':
		case 'unfreeze':
		case 'strip':
		case 'restore': {
			const result = value as LifecycleResult;
			if (format === 'human') { return core.renderLifecycleResult(result, core.renderMessages); }
			return command.coreId === 'strip' ? core.renderStripCsv(result) : command.coreId === 'restore' ? core.renderRestoreCsv(result) : core.renderLifecycleCsv(result);
		}
		case 'snapshot': {
			const result = core.snapshotToLifecycleResult(value as UserSnapshotFile);
			return format === 'human' ? core.renderLifecycleResult(result, core.renderMessages) : core.renderSnapshotCsv(result);
		}
		case 'provision': {
			const result = value as ProvisionResult;
			return format === 'human' ? core.renderProvisionHuman(result, typeof options.personasPath === 'string' ? options.personasPath : undefined, core.renderMessages) : core.renderProvisionCsv(result);
		}
		case 'access': {
			const result = value as UserAccessResult;
			if (format === 'human') { return core.renderAccessResult(result, typeof options.user === 'string' ? options.user : undefined); }
			const columns = options.user ? core.reverseCsvColumns(result.targetType) : core.getResolver(result.targetType).csvColumns();
			return core.serializeCsv(result.rows.map((row) => core.flattenAccessRow(row, columns)), columns);
		}
		case 'diff': {
			if (options.verify) {
				const result = value as UserConformanceVerdict[];
				return format === 'human' ? core.renderUserConformanceHuman(result, core.renderMessages) : core.renderUserConformanceCsv(result);
			}
			const result = value as UserDiffResult;
			return format === 'human' ? core.renderUserDiffHuman(result, core.renderMessages, { verbose: false }) : core.renderUserDiffCsv(result);
		}
	}
	throw new Error(`Unsupported command: ${command.coreId}`);
}

export function previewValue(command: CommandDef, plan: unknown, core: Core): unknown {
	if (command.coreId === 'freeze' || command.coreId === 'unfreeze') {
		const freeze = plan as FreezePlan;
		return { users: freeze.users, summary: core.summarizeLifecycle(freeze.users) };
	}
	return (plan as { preview: unknown }).preview;
}

export function planWarnings(plan: unknown): string[] {
	const value = plan as { warnings?: string[]; licenses?: Array<{ shortfall?: number; licenseName?: string }> };
	const warnings = [...(value.warnings ?? [])];
	for (const license of value.licenses ?? []) {
		if ((license.shortfall ?? 0) > 0) { warnings.push(`License shortfall: ${license.licenseName ?? 'unknown'} (${license.shortfall})`); }
	}
	return warnings;
}
