import { existsSync } from "node:fs";
import { Text } from "@earendil-works/pi-tui";
import { operate, readBranch, oneLine } from "./lib/board.mjs";
import { parse, help, completions, format } from "./lib/commands.mjs";
import { parameters } from "./lib/schema.mjs";
import { browse } from "./lib/picker.mjs";
import { serve } from "./lib/link.mjs";
import { locatePane, splitPane } from "./lib/herdr.mjs";

function storageNote(ctx) {
	const file = ctx.sessionManager.getSessionFile();
	if (!file) return "Temporary session: this board will not survive exit.";
	return existsSync(file)
		? ""
		: "In memory until Pi saves the first conversation turn.";
}

export default function todos(pi) {
	const listeners = new Set();
	let uiContext,
		link,
		generation = 0;
	const board = (ctx) =>
		readBranch(
			ctx.sessionManager.getBranch(),
			ctx.sessionManager.getSessionId(),
		);
	function run(ctx, req) {
		const result = operate(
			ctx,
			(type, data) => pi.appendEntry(type, data),
			req,
		);
		if (!["list", "get"].includes(req.action)) for (const fn of listeners) fn();
		return result;
	}
	function disconnect() {
		generation++;
		const p = link;
		link = undefined;
		if (p)
			void p.then(
				(s) => s.close(),
				() => {},
			);
	}
	async function connect(ctx) {
		const g = generation;
		link ??= serve((q) => {
			if (g !== generation) throw new Error("This branch is no longer shared.");
			return run(ctx, q);
		});
		try {
			const s = await link;
			if (g !== generation)
				throw new Error("Session changed. Open the board again.");
			return s;
		} catch (e) {
			if (g === generation) disconnect();
			throw e;
		}
	}
	pi.on("session_start", (_e, ctx) => {
		if (ctx.hasUI) {
			disconnect();
			uiContext = ctx;
		}
	});
	pi.on("session_tree", (_e, ctx) => {
		if (ctx.hasUI) {
			disconnect();
			uiContext = ctx;
			for (const fn of listeners) fn();
		}
	});
	pi.on("session_shutdown", (_e, ctx) => {
		if (ctx.hasUI) {
			disconnect();
			uiContext = undefined;
			listeners.clear();
		}
	});
	pi.registerTool({
		name: "todo",
		label: "Session tasks",
		description:
			"Read or edit the task board on the current session branch. Create, update, list, get, archive or restore. List before editing; expectedRevision prevents overwriting a newer edit.",
		promptSnippet: "Track a multi-step task list on this session branch.",
		parameters,
		async execute(_call, req, _signal, _onUpdate, ctx) {
			const result = run(ctx, req);
			return {
				content: [
					{
						type: "text",
						text: `${format(req, result)}\nRevision: ${result.revision}`,
					},
				],
				details: { ...result, action: req.action },
			};
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", `todo ${oneLine(args.action ?? "")}`),
				0,
				0,
			);
		},
		renderResult(result, { expanded }, theme) {
			const text = result.content.find((c) => c.type === "text")?.text ?? "";
			const lines = text.split("\n");
			const compact =
				result.details?.tasks?.length > 1
					? `${result.details.tasks.length} tasks · /todos to browse`
					: lines[0];
			return new Text(expanded ? text : theme.fg("muted", compact), 0, 0);
		},
	});
	pi.registerCommand("todos", {
		description:
			"Browse session tasks · type /todos and a space for actions, IDs and examples",
		getArgumentCompletions(prefix) {
			let tasks = [];
			if (uiContext) tasks = board(uiContext).tasks;
			const items = completions(prefix, tasks);
			return items.length && !items.some((i) => i.value === prefix)
				? items
				: null;
		},
		async handler(args, ctx) {
			try {
				const q = parse(args),
					apply = (req) => run(ctx, req);
				if (q.command === "board") {
					if (ctx.mode !== "tui") {
						const r = apply({ action: "list" });
						ctx.ui.notify(format({ action: "list" }, r), "info");
						return;
					}
					return await browse(
						ctx,
						() => ({ ...board(ctx), storageNote: storageNote(ctx) }),
						apply,
						(fn) => {
							listeners.add(fn);
							return () => listeners.delete(fn);
						},
					);
				}
				if (q.command === "help") return ctx.ui.notify(help(q.arg), "info");
				if (q.command === "unshare") {
					disconnect();
					return ctx.ui.notify("External access closed.", "info");
				}
				if (q.command === "share") {
					const s = await connect(ctx);
					return ctx.ui.notify(
						`Local board connection:\n${s.id}\nClose it with /todos unshare.`,
						"info",
					);
				}
				if (q.command === "herdr") {
					const pane = await locatePane();
					const existing = link;
					const channel = await connect(ctx);
					try {
						const created = await splitPane(pane, channel.id);
						return ctx.ui.notify(
							`Opened tasks in Herdr pane ${created}. Type quit there to close the view.`,
							"info",
						);
					} catch (e) {
						if (!existing) disconnect();
						throw e;
					}
				}
				const result = apply(q);
				ctx.ui.notify(
					[format(q, result), storageNote(ctx)].filter(Boolean).join("\n"),
					"info",
				);
			} catch (e) {
				ctx.ui.notify(oneLine(e.message), "error");
			}
		},
	});
}
