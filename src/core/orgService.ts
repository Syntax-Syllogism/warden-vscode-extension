import type { Connection, OrgAuthorization } from '@salesforce/core';
import { loadSfCore } from './load';

export interface OrgChoice {
	label: string;
	value: string;
	description?: string;
}

export interface OrgService {
	listOrgs(): Promise<OrgChoice[]>;
	connect(aliasOrUsername: string): Promise<Connection>;
	resolveUsername(aliasOrUsername: string): Promise<string>;
	invalidate(aliasOrUsername: string): Promise<void>;
}

export function authorizationChoices(authorizations: readonly OrgAuthorization[], defaultOrg?: string): OrgChoice[] {
	return authorizations.filter((auth) => auth.username && !auth.error).map((auth) => {
		const alias = auth.aliases?.[0];
		const value = alias ?? auth.username;
		const details = [defaultOrg === value || defaultOrg === auth.username ? 'default' : undefined, auth.isExpired === true ? 'expired' : undefined].filter(Boolean);
		return { label: alias ? `${alias} (${auth.username})` : auth.username, value, description: details.join(', ') || undefined };
	});
}

export function createOrgService(): OrgService {
	const cache = new Map<string, Connection>();
	async function usernameFor(value: string): Promise<string> {
		const { StateAggregator } = await loadSfCore();
		return (await StateAggregator.getInstance()).aliases.resolveUsername(value);
	}
	return {
		resolveUsername: usernameFor,
		async listOrgs() {
			const { AuthInfo, ConfigAggregator } = await loadSfCore();
			const [authorizations, config] = await Promise.all([AuthInfo.listAllAuthorizations(), ConfigAggregator.create()]);
			return authorizationChoices(authorizations, config.getPropertyValue<string>('target-org'));
		},
		async connect(value) {
			const username = await usernameFor(value);
			let connection = cache.get(username);
			if (!connection) {
				const { AuthInfo, Connection } = await loadSfCore();
				connection = await Connection.create({ authInfo: await AuthInfo.create({ username }) });
				cache.set(username, connection);
			}
			return connection;
		},
		async invalidate(value) { cache.delete(await usernameFor(value)); },
	};
}
