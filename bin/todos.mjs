#!/usr/bin/env node
import { createInterface } from "node:readline";
import { request } from "../lib/link.mjs";
import { completions, format, help, parse, PI_ONLY } from "../lib/commands.mjs";
import { oneLine, row, select } from "../lib/board.mjs";
import { parameters } from "../lib/schema.mjs";
const usage =
	"herdr-pi-todos describe | request CONNECTION JSON | watch CONNECTION";
async function watch(id) {
	if (!process.stdin.isTTY || !process.stdout.isTTY)
		throw new Error(
			"watch needs an interactive terminal. Use request for JSON.",
		);
	let state = await request(id, { action: "list", filter: "all" }),
		filter = "open",
		search = "",
		page = 0,
		note = "",
		busy = false,
		generation = 0,
		closed = false;
	let displayedRevision = state.revision;
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: "todos › ",
		completer(line) {
			const choices = completions(line, state.tasks, true).map((v) => v.value);
			return [choices, line];
		},
	});
	function draw() {
		if (closed || rl.line) return;
		const width = Math.max(10, (process.stdout.columns || 80) - 1),
			n = Math.max(1, (process.stdout.rows || 24) - 10);
		const rows = select(state, filter, search);
		page = Math.max(0, Math.min(page, Math.ceil(rows.length / n) - 1));
		displayedRevision = state.revision;
		const lines = [
			"PI TODOS",
			`${filter.toUpperCase()}  ·  ${rows.length} ${rows.length === 1 ? "task" : "tasks"}${search ? `  ·  ${search}` : ""}`,
			"",
			...rows.slice(page * n, (page + 1) * n).map(row),
		];
		if (!rows.length)
			lines.push(
				search
					? "No matches. Type list to reset."
					: "Nothing here. Try: add Review the release notes",
			);
		lines.push(
			"",
			`Page ${page + 1}/${Math.max(1, Math.ceil(rows.length / n))}   next / prev`,
			"Tab completes commands and IDs · help · quit",
			note,
		);
		process.stdout.write(
			"\x1b[2J\x1b[H" +
				lines.map((s) => oneLine(s).slice(0, width)).join("\n") +
				"\n",
		);
		rl.prompt();
	}
	let refreshing = false;
	async function refresh(force = false) {
		if (closed || (!force && (busy || refreshing || rl.line))) return;
		const seq = ++generation;
		refreshing = true;
		try {
			const next = await request(id, { action: "list", filter: "all" });
			if (seq !== generation || closed || (!force && rl.line)) return;
			const changed = next.revision !== state.revision;
			state = next;
			if (changed || force) draw();
		} catch (e) {
			if (!closed) {
				process.stdout.write(`\n${oneLine(e.message)}\n`);
				rl.close();
			}
		} finally {
			if (seq === generation) refreshing = false;
		}
	}
	rl.on("line", async (line) => {
		if (busy) return;
		if (["quit", "exit"].includes(line.trim())) return rl.close();
		busy = true;
		generation++;
		refreshing = false;
		note = "";
		try {
			if (["next", "prev"].includes(line.trim())) {
				page += line.trim() === "next" ? 1 : -1;
			} else {
				const q = parse(line);
				if (q.command === "help") {
					process.stdout.write(`${help(q.arg, true)}\n`);
					rl.prompt();
					return;
				}
				if (PI_ONLY.includes(q.command))
					throw new Error("Use that command in Pi.");
				if (q.action === "list" || q.command === "board") {
					filter = q.filter ?? (q.search ? "all" : "open");
					search = q.search ?? "";
					page = 0;
				} else {
					const r = await request(id, {
						...q,
						expectedRevision: displayedRevision,
					});
					note = format(q, r);
					if (q.action === "get") {
						process.stdout.write(`${note}\n`);
						rl.prompt();
						return;
					}
				}
			}
		} catch (e) {
			note = e.message;
		} finally {
			busy = false;
		}
		await refresh(true);
	});
	const tick = setInterval(() => void refresh(), 1000);
	const resize = () => draw();
	process.stdout.on("resize", resize);
	rl.on("close", () => {
		closed = true;
		clearInterval(tick);
		process.stdout.off("resize", resize);
	});
	draw();
}
try {
	const [op, id, input] = process.argv.slice(2);
	if (op === "describe")
		console.log(
			JSON.stringify({
				version: 1,
				usage,
				request: parameters,
				localAccess:
					"Run /todos share in Pi. Write requests require expectedRevision from a read.",
				commands: help("", true),
			}),
		);
	else if (op === "request")
		console.log(JSON.stringify(await request(id, JSON.parse(input))));
	else if (op === "watch") await watch(id);
	else if (!op || ["-h", "--help"].includes(op)) console.log(usage);
	else throw new Error(usage);
} catch (e) {
	console.error(
		JSON.stringify({
			ok: false,
			code: e.code ?? "INVALID",
			message: e.message,
		}),
	);
	process.exitCode = 1;
}
