import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// test/ holds fixture packages (for example chord plugin examples) that are not workspaces.
const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules", "test"]);

export function findPackageDirectories(root = "packages") {
	const packageDirectories = [];

	function visit(directory) {
		if (existsSync(join(directory, "package.json"))) {
			packageDirectories.push(directory);
		}

		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) {
				continue;
			}
			visit(join(directory, entry.name));
		}
	}

	visit(root);
	return packageDirectories.sort();
}
