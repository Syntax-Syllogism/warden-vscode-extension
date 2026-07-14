export type FlagKind = 'org' | 'file' | 'outputDir' | 'string' | 'boolean' | 'apiVersion' | 'enum';

export interface FlagDef {
	name: string;
	kind: FlagKind;
	summary?: string;
	required?: boolean;
	options?: readonly string[];
	placeholder?: string;
	exclusiveGroup?: string;
	/**
	 * Only prompt for this flag once the named flag has been chosen. Used to defer
	 * follow-up flags (e.g. `external-id`) until the exclusive-group option they
	 * apply to (e.g. `users-def`) is selected.
	 */
	dependsOnFlag?: string;
	default?: string;
}

export interface CommandDef {
	id: string;
	cliId: string;
	title: string;
	group: string;
	subgroup?: string;
	supportsNoPrompt?: boolean;
	destructive?: boolean;
	requireOneOf?: readonly string[];
	flags: readonly FlagDef[];
}
