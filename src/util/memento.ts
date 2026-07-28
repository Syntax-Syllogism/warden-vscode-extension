import type * as vscode from 'vscode';

export class LastValueStore {
	public constructor(private readonly memento: vscode.Memento) {}

	public get(commandId: string, flagName: string): string | undefined {
		return this.memento.get<string>(this.key(commandId, flagName));
	}

	public async set(commandId: string, flagName: string, value: string | undefined): Promise<void> {
		if (!value) {
			return;
		}

		await this.memento.update(this.key(commandId, flagName), value);
	}

	private key(commandId: string, flagName: string): string {
		return `warden:${commandId}:${flagName}`;
	}
}
