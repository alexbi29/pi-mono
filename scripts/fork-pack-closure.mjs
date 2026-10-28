#!/usr/bin/env node
// Fork packaging helper: computes the production dependency closure of the
// five bundled workspace packages (pi-agent-core, pi-ai, pi-codemode, pi-mcp,
// pi-tui) and stages it for the release tarball.
//
// npm does not install transitive dependencies of bundledDependencies, yet
// the subagent runner (pi-subagents extension) and other SDK consumers load
// these packages unbundled, so every package their import graphs need at
// runtime must ship inside the tarball (see FORK-OPERATIONS.md, "Runner
// dependencies"). Node-style resolution (walk up through node_modules) keeps
// the per-consumer copies (e.g. `openai` nested under packages/ai), and whole
// package dirs are copied so nested node_modules stay intact.
//
// Usage:
//   node scripts/fork-pack-closure.mjs            print name<TAB>dir per line
//   node scripts/fork-pack-closure.mjs --stage D  copy the closure into
//       D/node_modules and rewrite D/package.json bundledDependencies
//
// The five workspace packages themselves are staged by fork-update.sh with
// their built dist/ and are always listed in bundledDependencies.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const WORKSPACES = ["agent", "ai", "codemode", "mcp", "tui"];
const WORKSPACE_PACKAGE_NAMES = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-codemode",
	"@earendil-works/pi-mcp",
	"@earendil-works/pi-tui",
];

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const workspaceDirs = WORKSPACES.map((p) => fs.realpathSync(path.join(repoRoot, "packages", p)));

/** Node-style resolution: walk up from dir through node_modules/<name>. */
function resolvePackageDir(name, fromDir) {
	let dir = fromDir;
	const rel = path.join("node_modules", ...name.split("/"));
	for (;;) {
		const candidate = path.join(dir, rel);
		if (fs.existsSync(path.join(candidate, "package.json"))) return fs.realpathSync(candidate);
		const parent = path.dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/** name -> real package dir; the first consuming context's resolution wins. */
function computeClosure() {
	const seen = new Map();
	const missing = [];
	const walk = (dir) => {
		const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
		const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
		for (const name of Object.keys(deps)) {
			if (seen.has(name)) continue;
			if (name === "@earendil-works/pi-telemetry") {
				throw new Error(
					"Fork policy: the bundled packages must not depend on @earendil-works/pi-telemetry " +
						"(see FORK-OPERATIONS.md). Remove the dependency before releasing.",
				);
			}
			const resolved = resolvePackageDir(name, dir);
			if (!resolved) {
				missing.push(`${pkg.name} (at ${path.relative(repoRoot, dir)}) -> ${name}`);
				continue;
			}
			seen.set(name, resolved);
			walk(resolved);
		}
	};
	for (const dir of workspaceDirs) walk(dir);
	if (missing.length > 0) {
		console.error("Undistributable closure members:\n  " + missing.join("\n  "));
		process.exit(1);
	}
	return seen;
}

const args = process.argv.slice(2);
const stageIndex = args.indexOf("--stage");
const stageDir = stageIndex >= 0 ? args[stageIndex + 1] : undefined;

const closure = computeClosure();
if (!stageDir) {
	for (const [name, dir] of [...closure.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		console.log(`${name}\t${dir}`);
	}
	process.exit(0);
}

const bundled = new Set(WORKSPACE_PACKAGE_NAMES);
for (const [name, dir] of closure.entries()) {
	if (workspaceDirs.includes(dir)) continue;
	bundled.add(name);
	const target = path.join(stageDir, "node_modules", ...name.split("/"));
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.cpSync(dir, target, { recursive: true });
}

const manifestPath = path.join(stageDir, "package.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.bundledDependencies = [...bundled].sort();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
const size = execFileSync("du", ["-sk", ...[...closure.entries()].map(([, d]) => d)], { encoding: "utf8" })
	.split("\n")
	.reduce((total, line) => total + parseInt(line.split("\t")[0] || "0", 0), 0);
console.log(`Staged ${bundled.size} bundled packages (${(size / 1024).toFixed(1)} MB unpacked).`);
