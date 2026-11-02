import { Input, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { row, select, waits, oneLine } from "./board.mjs";

export async function browse(ctx, read, run, subscribe) {
	let query = "",
		selected = "add";
	for (;;) {
		const choice = await ctx.ui.custom(
			(tui, theme, kb, done) => {
				const input = new Input();
				input.setValue(query);
				let board = read(),
					items = [],
					index = 0,
					problem = "";
				function rebuild() {
					query = input.getValue();
					const rows = select(board, "all", query).filter(
						(t) => t.status !== "deleted",
					);
					items = [
						...rows.map((t) => ({ key: t.id, label: row(t), task: t })),
						{ key: "add", label: "+ Add a task" },
					];
					const found = items.findIndex((x) => x.key === selected);
					index = found < 0 ? 0 : found;
					selected = items[index].key;
				}
				if (
					selected === "add" &&
					!query &&
					board.tasks.some((t) => t.status !== "deleted")
				)
					selected = board.tasks.find((t) => t.status !== "deleted").id;
				rebuild();
				const off = subscribe(() => {
					try {
						board = read();
						rebuild();
					} catch (e) {
						problem = e.message;
					}
					tui.requestRender();
				});
				return {
					get focused() {
						return input.focused;
					},
					set focused(value) {
						input.focused = value;
					},
					render(width) {
						const muted = (s) => theme.fg("muted", s),
							ink = (s) => theme.fg("accent", s);
						const n = Math.max(1, Math.min(8, (tui.terminal.rows || 24) - 10)),
							start = Math.max(
								0,
								Math.min(index - Math.floor(n / 2), items.length - n),
							);
						const visible = board.tasks.filter((t) => t.status !== "deleted");
						const current = items[index].task;
						const lines = [
							ink(theme.bold(" Session tasks")) +
								muted(
									`   ${visible.filter((t) => t.status === "completed").length}/${visible.length} done`,
								),
							input.getValue()
								? input.render(width)[0]
								: muted(" Search tasks…  (type a title, owner or note)"),
							"",
							...items
								.slice(start, start + n)
								.map((item, i) =>
									start + i === index
										? ink(` › ${item.label}`)
										: `   ${item.label}`,
								),
							muted(
								items.length > n
									? ` ${index + 1} of ${items.length} choices`
									: "",
							),
							muted(
								problem ||
									(current
										? waits(current, board).length
											? " Waiting on " +
												waits(current, board)
													.map((id) => `#${id}`)
													.join(", ")
											: current.description
												? ` ${oneLine(current.description)}`
												: " Enter for task actions"
										: " Enter to name a new task"),
							),
							...(board.storageNote ? [muted(` ${board.storageNote}`)] : []),
							muted(" ↑↓ choose   Enter open   Esc close"),
						];
						const space = Math.max(1, width - 2),
							edge = muted("│");
						return [
							muted(`╭${"─".repeat(Math.max(0, width - 2))}╮`),
							...lines.map((s) => {
								const line = truncateToWidth(s, space);
								return (
									edge +
									theme.bg(
										"customMessageBg",
										line + " ".repeat(Math.max(0, space - visibleWidth(line))),
									) +
									edge
								);
							}),
							muted(`╰${"─".repeat(Math.max(0, width - 2))}╯`),
						].map((s) => truncateToWidth(s, width));
					},
					handleInput(key) {
						if (kb.matches(key, "tui.select.cancel")) return done(undefined);
						if (kb.matches(key, "tui.select.confirm"))
							return done({ task: items[index].task, rev: board.revision });
						if (
							kb.matches(key, "tui.select.up") ||
							kb.matches(key, "tui.select.down")
						) {
							index =
								(index +
									items.length +
									(kb.matches(key, "tui.select.up") ? -1 : 1)) %
								items.length;
							selected = items[index].key;
						} else {
							input.handleInput(key);
							selected = null;
							rebuild();
						}
						tui.requestRender();
					},
					invalidate() {
						input.invalidate();
					},
					dispose() {
						off();
					},
				};
			},
			{ overlay: true, overlayOptions: { width: "86%", maxHeight: "90%" } },
		);
		if (!choice) return;
		const t = choice.task;
		try {
			let q;
			if (!t) {
				const subject = await ctx.ui.input(
					"New task",
					"e.g. Review release notes",
				);
				if (subject === undefined) continue;
				q = { action: "create", subject };
			} else {
				const actions = [
					...(t.status === "pending" ? ["Start"] : []),
					...(t.status !== "completed" ? ["Complete"] : []),
					...(t.status !== "pending" ? ["Reopen"] : []),
					"Rename",
					"Notes",
					"Owner",
					"Priority",
					"Prerequisites",
					"Archive",
				];
				const op = await ctx.ui.select(
					`#${t.id} · ${oneLine(t.subject)}`,
					actions,
				);
				if (!op) continue;
				if (["Start", "Complete", "Reopen"].includes(op))
					q = {
						action: "update",
						id: t.id,
						status: {
							Start: "in_progress",
							Complete: "completed",
							Reopen: "pending",
						}[op],
					};
				else if (op === "Archive") {
					if (
						!(await ctx.ui.confirm(
							"Archive this task?",
							`Recover it with /todos restore #${t.id}.`,
						))
					)
						continue;
					q = { action: "archive", id: t.id };
				} else {
					const key = {
						Rename: "subject",
						Notes: "description",
						Owner: "owner",
						Priority: "priority",
						Prerequisites: "blockedBy",
					}[op];
					let value =
						op === "Priority"
							? await ctx.ui.select("Priority", ["low", "normal", "high"])
							: await ctx.ui.editor(
									op === "Prerequisites"
										? "Prerequisite IDs (space separated; empty unlinks all)"
										: op,
									op === "Prerequisites" ? t.blockedBy.join(" ") : t[key],
								);
					if (value === undefined) continue;
					if (op === "Prerequisites")
						value = value.trim()
							? value
									.trim()
									.split(/[\s,]+/)
									.map((v) => Number(v.replace(/^#/, "")))
							: [];
					q = { action: "update", id: t.id, [key]: value };
				}
			}
			const result = run({ ...q, expectedRevision: choice.rev });
			selected = result.tasks[0].id;
			query = "";
		} catch (e) {
			ctx.ui.notify(e.message, "error");
		}
	}
}
