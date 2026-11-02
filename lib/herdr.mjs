import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { fail } from "./board.mjs";
const runFile = promisify(execFile);
async function json(cmd, args) {
	try {
		const { stdout } = await runFile(cmd, args, {
			timeout: 6000,
			maxBuffer: 4 * 1024 * 1024,
		});
		return JSON.parse(stdout);
	} catch (e) {
		fail(
			"HERDR",
			`${cmd} ${args[0]}: ${String(e.stderr || e.stdout || e.message)
				.trim()
				.slice(0, 300)}`,
		);
	}
}
export async function locatePane(
	run = json,
	terminal = process.env.HC_TERMINAL_ID,
) {
	if (!terminal)
		fail(
			"HERDR",
			"Open Pi inside a local Herdr app terminal, or use /todos here.",
		);
	const info = await run("hc", ["get", terminal, "--json"]);
	const space = info.labels?.["herdr.space"];
	if (info.address !== terminal || !space)
		fail("HERDR", "This terminal is not attached to a Herdr app space.");
	const { spaces } = await run("herdr-app", ["ls"]);
	const matches = spaces
		.filter((s) => !s.machine && s.id === space)
		.flatMap((s) =>
			s.tabs.flatMap((t) =>
				t.terminals.filter(
					(p) =>
						p.terminal === terminal && typeof p.pane === "string" && p.pane,
				),
			),
		);
	if (matches.length !== 1)
		fail(
			"HERDR",
			"Could not identify the owning pane. No split opened; check HERDR_APP_HOME.",
		);
	return matches[0].pane;
}
export async function splitPane(parent, id, run = json) {
	const node = /^node(?:\.exe)?$/.test(basename(process.execPath))
		? process.execPath
		: "node";
	const argv = [
		node,
		fileURLToPath(new URL("../bin/todos.mjs", import.meta.url)),
		"watch",
		id,
	];
	const result = await run("herdr-app", [
		"do",
		"pane.split",
		JSON.stringify({ pane: parent, direction: "right", argv }),
	]);
	if (
		typeof result?.pane !== "string" ||
		!result.pane ||
		result.pane === parent ||
		!result.terminal
	)
		fail("HERDR", "Split outcome unknown. Inspect the window before retrying.");
	return result.pane;
}
