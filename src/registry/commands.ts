import { z } from 'zod';
import type { WardenCore } from '../core/load';
import type { CommandDef, InputDef } from './types';

function fieldDetails(field: z.ZodType): Pick<InputDef, 'required' | 'default' | 'options'> {
	let current = field;
	let required = true;
	let defaultValue: unknown;
	while (current instanceof z.ZodOptional || current instanceof z.ZodDefault || current instanceof z.ZodNullable) {
		if (current instanceof z.ZodOptional || current instanceof z.ZodDefault) { required = false; }
		if (current instanceof z.ZodDefault) { defaultValue = current.parse(undefined); }
		current = current.def.innerType as z.ZodType;
	}
	return { required, default: defaultValue, options: current instanceof z.ZodEnum ? current.options.map(String) : undefined };
}

export function buildCommands(core: WardenCore): CommandDef[] {
	return core.commandDescriptors.map((descriptor) => {
		const hints = core.uiHints(descriptor.optionsSchema as z.ZodType);
		const shape = (descriptor.optionsSchema as z.ZodObject<z.ZodRawShape>).shape;
		const inputs: InputDef[] = [{ key: 'org', kind: 'org', label: 'Salesforce org', required: true }];
		for (const [key, rawField] of Object.entries(shape)) {
			const field = rawField as z.ZodType;
			if (key.endsWith('Doc') || descriptor.id === 'snapshot' && key === 'org' || descriptor.id === 'diff' && key === 'mode') { continue; }
			const hint = hints[key];
			if (!hint) { continue; }
			inputs.push({ key, kind: hint.kind, label: hint.label, summary: hint.summary ?? hint.label, placeholder: hint.placeholder, fileFilter: hint.fileFilter, exclusiveGroup: hint.exclusiveGroup, dependsOn: key === 'inputFormat' ? 'usersPath' : hint.dependsOn, ...fieldDetails(field), required: key === 'usersPath' && descriptor.id === 'provision' || key === 'snapshotPath' || fieldDetails(field).required });
		}
		inputs.push({ key: 'outputFile', kind: 'outputFile', label: 'Output file', summary: 'Workspace-relative CSV or JSON output path', placeholder: 'reports/warden-output.json' });
		return { id: `warden.${descriptor.id}`, coreId: descriptor.id, title: `SF Warden: ${descriptor.title}`, group: descriptor.group, kind: core[descriptor.id].kind, destructive: descriptor.destructive, inputs };
	});
}
