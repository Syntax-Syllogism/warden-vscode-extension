import * as vscode from 'vscode';
import { execSf } from '../runner/sfProcess';

interface SfOrg {
	alias?: string;
	username?: string;
	isDefaultUsername?: boolean;
}

interface SfOrgList {
	result?: {
		nonScratchOrgs?: SfOrg[];
		scratchOrgs?: SfOrg[];
	};
}

export interface OrgChoice extends vscode.QuickPickItem {
	value: string;
}

export async function loadOrgChoices(): Promise<OrgChoice[]> {
	const payload = await execSf(['org', 'list', '--json']);
	const orgList = JSON.parse(payload) as SfOrgList;
	const orgs = [
		...(orgList.result?.nonScratchOrgs ?? []),
		...(orgList.result?.scratchOrgs ?? []),
	].filter((org): org is SfOrg & { username: string } => Boolean(org.username));

	return orgs.map((org) => ({
		label: org.alias ? `${org.alias} (${org.username})` : org.username,
		description: org.isDefaultUsername ? 'default' : undefined,
		value: org.alias ?? org.username,
	}));
}

export async function pickOrg(lastValue?: string): Promise<string | undefined> {
	const choices = await loadOrgChoices();
	const picked = await vscode.window.showQuickPick(prioritizeOrgChoices(choices, lastValue), {
		ignoreFocusOut: true,
		placeHolder: 'Select a Salesforce org',
		matchOnDescription: true,
	});

	return picked?.value;
}

export function prioritizeOrgChoices(choices: readonly OrgChoice[], lastValue?: string): OrgChoice[] {
	if (!lastValue) {
		return [...choices];
	}

	return [...choices].sort((left, right) => Number(right.value === lastValue) - Number(left.value === lastValue));
}
