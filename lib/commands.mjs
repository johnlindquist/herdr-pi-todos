import { fail, FILTERS, PRIORITIES, row, oneLine } from "./board.mjs";

// One vocabulary for Pi's autocomplete, the companion prompt, and /todos help.
export const GUIDE = {
	add: ["title", "Create a task", "add Review the release notes"],
	list: ["[filter]", "Show tasks by state", "list blocked"],
	find: ["words", "Search titles, notes and owners", "find release"],
	show: ["#id", "Inspect a task and its notes", "show #1"],
	start: ["#id", "Mark work in progress", "start #1"],
	done: ["#id", "Mark work complete", "done #1"],
	reopen: ["#id", "Move back to pending", "reopen #1"],
	edit: ["#id title", "Rename a task", "edit #1 Review release notes"],
	note: [
		"#id text",
		"Replace the notes; omit text to clear",
		"note #1 Check the migration guide",
	],
	assign: ["#id owner", "Set owner; omit name to unassign", "assign #1 Sam"],
	priority: ["#id low|normal|high", "Set priority", "priority #1 high"],
	after: [
		"#id [#id …]",
		"Replace prerequisites; omit IDs to unlink",
		"after #2 #1",
	],
	archive: ["#id", "Hide a task without erasing it", "archive #1"],
	restore: ["#id", "Recover an archived task", "restore #1"],
	herdr: ["", "Open this live board beside Pi in Herdr", "herdr"],
	share: ["", "Enable local CLI access and print the connection ID", "share"],
	unshare: ["", "Disconnect external clients", "unshare"],
	help: ["[command]", "Show usage and examples", "help after"],
};
export const PI_ONLY = ["herdr", "share", "unshare"];
const ids = [
	"show",
	"start",
	"done",
	"reopen",
	"edit",
	"note",
	"assign",
	"priority",
	"after",
	"archive",
	"restore",
];
function number(s) {
	if (
		!/^#?[1-9]\d*$/.test(s ?? "") ||
		!Number.isSafeInteger(Number(s.replace("#", "")))
	)
		fail("USAGE", "Use a task ID such as #1.");
	return Number(s.replace("#", ""));
}
export function help(arg = "", external = false) {
	if (arg && !Object.hasOwn(GUIDE, arg))
		fail("USAGE", `Unknown command: ${oneLine(arg)}`);
	const names = (arg ? [arg] : Object.keys(GUIDE)).filter(
		(k) => !external || !PI_ONLY.includes(k),
	);
	return names
		.map(
			(k) =>
				`${k} ${GUIDE[k][0]} — ${GUIDE[k][1]}${arg ? `\nExample: ${external ? "" : "/todos "}${GUIDE[k][2]}` : ""}`,
		)
		.join("\n");
}
export function parse(line) {
	const [, cmd = "", args = ""] = line
		.trim()
		.match(/^(\S+)?(?:\s+([\s\S]*))?$/);
	if (!cmd) return { command: "board" };
	if (!Object.hasOwn(GUIDE, cmd))
		fail("USAGE", `Unknown command: ${oneLine(cmd)}. Try help.`);
	if (PI_ONLY.includes(cmd)) {
		if (args) fail("USAGE", `${cmd} takes no arguments.`);
		return { command: cmd };
	}
	if (cmd === "help") return { command: "help", arg: args };
	if (cmd === "list") {
		if (args && !FILTERS.includes(args))
			fail("USAGE", `Unknown filter. Choose ${FILTERS.join(", ")}.`);
		return { action: "list", ...(args ? { filter: args } : {}) };
	}
	if (cmd === "find") return { action: "list", search: args };
	if (cmd === "add") return { action: "create", subject: args };
	const [, raw, tail = ""] = args.match(/^(\S+)?(?:\s+([\s\S]*))?$/);
	const id = number(raw);
	if (["edit", "note", "assign", "priority"].includes(cmd))
		return {
			action: "update",
			id,
			[{
				edit: "subject",
				note: "description",
				assign: "owner",
				priority: "priority",
			}[cmd]]: tail,
		};
	if (cmd === "after")
		return {
			action: "update",
			id,
			blockedBy: tail ? tail.split(/[\s,]+/).map(number) : [],
		};
	if (tail) fail("USAGE", `Usage: ${cmd} #id`);
	if (["start", "done", "reopen"].includes(cmd))
		return {
			action: "update",
			id,
			status: { start: "in_progress", done: "completed", reopen: "pending" }[
				cmd
			],
		};
	return { action: cmd === "show" ? "get" : cmd, id };
}
export function completions(prefix, tasks = [], external = false) {
	const words = prefix.trimStart().split(/\s+/);
	const [cmd, part = ""] = words;
	const verbs = Object.keys(GUIDE).filter(
		(k) => !external || !PI_ONLY.includes(k),
	);
	if (words.length === 1)
		return verbs
			.filter((v) => v.startsWith(cmd))
			.map((v) => ({
				value: v,
				label: `${v} ${GUIDE[v][0]}`.trimEnd(),
				description: GUIDE[v][1],
			}));
	const choices =
		cmd === "list"
			? FILTERS
			: cmd === "help"
				? verbs
				: cmd === "priority" && words.length === 3
					? PRIORITIES
					: null;
	if (choices)
		return choices
			.filter((v) => v.startsWith(words.at(-1)))
			.map((v) => ({ value: [...words.slice(0, -1), v].join(" "), label: v }));
	if (!ids.includes(cmd) || (words.length !== 2 && cmd !== "after")) return [];
	const needle = (cmd === "after" ? words.at(-1) : part)
		.replace(/^#/, "")
		.toLowerCase();
	return tasks
		.filter(
			(t) =>
				(cmd === "restore"
					? t.status === "deleted"
					: cmd === "show" || t.status !== "deleted") &&
				(String(t.id).startsWith(needle) ||
					t.subject.toLowerCase().includes(needle)),
		)
		.filter(
			(t) =>
				cmd !== "after" ||
				words.length < 3 ||
				!words.slice(1, -1).some((s) => s.replace(/^#/, "") === String(t.id)),
		)
		.map((t) => ({
			value: [...words.slice(0, -1), `#${t.id}`].join(" "),
			label: `#${t.id} ${oneLine(t.subject)}`,
			description: t.status,
		}));
}
export function format(req, result) {
	if (!result.tasks.length) return "No matching tasks.";
	return result.tasks
		.map(
			(t) =>
				row(t) +
				(req.action === "get" && t.description
					? `\n  ${t.description.split("\n").map(oneLine).join("\n  ")}`
					: ""),
		)
		.join("\n");
}
