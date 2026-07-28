import type { ChildProcessWithoutNullStreams } from 'child_process';
import spawn = require('cross-spawn');

export interface SfSpawnOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
}

/**
 * Spawn the `sf` CLI. Uses cross-spawn so the Windows `sf.cmd` shim is resolved
 * via PATHEXT and invoked correctly (plain child_process.spawn throws ENOENT for
 * `sf`, and EINVAL when pointed at `sf.cmd` on patched Node without a shell).
 */
export function spawnSf(args: readonly string[], options: SfSpawnOptions = {}): ChildProcessWithoutNullStreams {
	return spawn('sf', [...args], options) as ChildProcessWithoutNullStreams;
}

/** Run `sf` to completion, resolving stdout. Rejects on spawn failure or non-zero exit. */
export function execSf(args: readonly string[], options: SfSpawnOptions = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawnSf(args, options);
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk: Buffer | string) => { stdout += String(chunk); });
		child.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk); });
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(new Error(stderr.trim() || `sf exited with code ${code}`));
			}
		});
	});
}
