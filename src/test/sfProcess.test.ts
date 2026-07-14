import * as assert from 'assert';
import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';
import { execSf } from '../runner/sfProcess';

const isWindows = process.platform === 'win32';

// Writes a fake `sf` executable into a fresh temp dir and returns that dir.
// On Windows the shim is `sf.cmd` — resolving it via PATHEXT is exactly what
// plain child_process.spawn could not do (the reported `spawn sf ENOENT`).
function writeSfShim(opts: { stdout?: string; stderr?: string; exitCode?: number }): string {
	const dir = mkdtempSync(join(tmpdir(), 'warden-sf-shim-'));
	const code = opts.exitCode ?? 0;

	if (isWindows) {
		const lines = ['@echo off'];
		if (opts.stdout) { lines.push(`echo ${opts.stdout}`); }
		if (opts.stderr) { lines.push(`echo ${opts.stderr} 1>&2`); }
		lines.push(`exit /b ${code}`);
		writeFileSync(join(dir, 'sf.cmd'), lines.join('\r\n'));
	} else {
		const lines = ['#!/bin/sh'];
		if (opts.stdout) { lines.push(`printf '%s\\n' '${opts.stdout}'`); }
		if (opts.stderr) { lines.push(`printf '%s\\n' '${opts.stderr}' 1>&2`); }
		lines.push(`exit ${code}`);
		const file = join(dir, 'sf');
		writeFileSync(file, lines.join('\n'));
		chmodSync(file, 0o755);
	}

	return dir;
}

async function withSfOnPath<T>(dir: string, run: () => Promise<T>): Promise<T> {
	const original = process.env.PATH;
	process.env.PATH = dir + delimiter + (original ?? '');
	try {
		return await run();
	} finally {
		process.env.PATH = original;
	}
}

// Replaces PATH entirely so `sf` cannot be resolved from the real system PATH.
async function withSfOffPath<T>(dir: string, run: () => Promise<T>): Promise<T> {
	const original = process.env.PATH;
	process.env.PATH = dir;
	try {
		return await run();
	} finally {
		process.env.PATH = original;
	}
}

suite('sf process helpers', () => {
	test('execSf resolves stdout from the sf binary found on PATH (sf.cmd on Windows)', async function () {
		this.timeout(10000);
		const dir = writeSfShim({ stdout: 'WARDEN_OK' });
		const stdout = await withSfOnPath(dir, () => execSf(['org', 'list', '--json']));
		assert.match(stdout, /WARDEN_OK/);
	});

	test('execSf rejects with stderr text when sf exits non-zero', async function () {
		this.timeout(10000);
		const dir = writeSfShim({ stderr: 'WARDEN_BOOM', exitCode: 3 });
		await assert.rejects(
			withSfOnPath(dir, () => execSf(['warden', '--help'])),
			/WARDEN_BOOM/,
		);
	});

	test('execSf rejects (no hang) when sf cannot be found on PATH', async function () {
		this.timeout(10000);
		const emptyDir = mkdtempSync(join(tmpdir(), 'warden-empty-'));
		await assert.rejects(withSfOffPath(emptyDir, () => execSf(['--version'])));
	});
});
