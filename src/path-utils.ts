import { dirname, isAbsolute, relative, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";

function expandTilde(filePath: string): string {
	if (filePath === "~") return homedir();
	if (filePath.startsWith("~/")) return homedir() + filePath.slice(1);
	return filePath;
}

function realpathDeepestExisting(filePath: string): string {
	let current = filePath;
	while (true) {
		try {
			return realpathSync(current);
		} catch {
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}
	}
	return filePath;
}

/**
 * Resolve a path relative to cwd and verify it does not escape the project root.
 * Symlinks are resolved via realpathSync for security.
 */
export function resolveSafePath(filePath: string, cwd: string): string {
	const expanded = expandTilde(filePath);
	const resolved = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);

	const realCwd = (() => {
		try {
			return realpathSync(cwd);
		} catch {
			return cwd;
		}
	})();

	const realTarget = realpathDeepestExisting(resolved);
	const rel = relative(realCwd, realTarget);

	if (rel === "") return resolved;
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`Path traversal blocked: "${filePath}" resolves outside "${cwd}"`);
	}

	return resolved;
}
