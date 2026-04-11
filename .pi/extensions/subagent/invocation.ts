import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export interface PiInvocation {
	command: string;
	args: string[];
}

export interface ResolvePiInvocationOptions {
	cwd: string;
	localPiPath?: string;
	packageCliPath?: string;
}

const require = createRequire(import.meta.url);

function resolveLocalPiPath(cwd: string): string | undefined {
	const candidate = path.join(cwd, "node_modules", ".bin", "pi");
	return existsSync(candidate) ? candidate : undefined;
}

function resolvePackageCliPath(): string | undefined {
	try {
		return require.resolve("@mariozechner/pi-coding-agent/dist/cli.js");
	} catch {
		return undefined;
	}
}

export function resolvePiInvocation(args: string[], options: ResolvePiInvocationOptions): PiInvocation {
	const localPiPath = options.localPiPath ?? resolveLocalPiPath(options.cwd);
	if (localPiPath) {
		return { command: localPiPath, args };
	}

	const packageCliPath = options.packageCliPath ?? resolvePackageCliPath();
	if (packageCliPath) {
		return { command: process.execPath, args: [packageCliPath, ...args] };
	}

	return { command: "pi", args };
}

export function resolveChildExtensionPaths(cwd: string): string[] {
	const childExtensionPath = path.join(cwd, ".pi", "extensions", "subagent", "search-journals-child.ts");
	return existsSync(childExtensionPath) ? [childExtensionPath] : [];
}
