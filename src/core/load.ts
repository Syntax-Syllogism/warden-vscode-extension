import type * as CoreModule from '@syntax-syllogism/warden-core' with { 'resolution-mode': 'import' };
export type WardenCore = typeof CoreModule;
export type SfCore = typeof import('@salesforce/core');

let corePromise: Promise<WardenCore> | undefined;
let sfPromise: Promise<SfCore> | undefined;

function disableSalesforceLogs(): void {
	process.env.SF_DISABLE_LOG_FILE ??= 'true';
	process.env.SFDX_DISABLE_LOG_FILE ??= 'true';
}

export function loadWardenCore(): Promise<WardenCore> {
	disableSalesforceLogs();
	return corePromise ??= import('@syntax-syllogism/warden-core');
}

export function loadSfCore(): Promise<SfCore> {
	disableSalesforceLogs();
	return sfPromise ??= import('@salesforce/core');
}
