export type CommandId = 'provision' | 'access' | 'diff' | 'freeze' | 'unfreeze' | 'strip' | 'snapshot' | 'restore';

export type InputKind = 'org' | 'file' | 'outputFile' | 'string' | 'boolean' | 'enum';

export interface InputDef {
	key: string;
	kind: InputKind;
	label: string;
	summary?: string;
	required?: boolean;
	options?: readonly string[];
	placeholder?: string;
	exclusiveGroup?: string;
	dependsOn?: string;
	default?: unknown;
	fileFilter?: 'json' | 'csv' | 'json-or-csv';
}

export interface CommandDef {
	id: string;
	coreId: CommandId;
	title: string;
	group: string;
	kind: 'read' | 'write';
	destructive: boolean;
	inputs: readonly InputDef[];
}
