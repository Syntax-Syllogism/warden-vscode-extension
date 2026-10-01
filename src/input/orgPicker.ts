import * as vscode from 'vscode';
import type { OrgChoice, OrgService } from '../core/orgService';

export async function pickOrg(orgs: OrgService, lastValue?: string): Promise<string | undefined> {
	const choices = await orgs.listOrgs();
	const picked = await vscode.window.showQuickPick(prioritizeOrgChoices(choices, lastValue), {
		ignoreFocusOut: true,
		placeHolder: 'Select a Salesforce org',
		matchOnDescription: true,
	});
	return picked?.value;
}

export function prioritizeOrgChoices(choices: readonly OrgChoice[], lastValue?: string): OrgChoice[] {
	if (!lastValue) { return [...choices]; }
	return [...choices].sort((left, right) => Number(right.value === lastValue) - Number(left.value === lastValue));
}
