// Pi's branch is the journal. Every successful edit appends one immutable snapshot.
export const ENTRY = "herdr-pi-todos/v1";
export const STATES = ["pending", "in_progress", "completed", "deleted"];
export const PRIORITIES = ["normal", "high", "low"];
export const ACTIONS = [
	"list",
	"get",
	"create",
	"update",
	"archive",
	"restore",
];
export const FILTERS = ["open", "ready", "blocked", ...STATES, "all"];
export class BoardError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}
export function fail(code, message) {
	throw new BoardError(code, message);
}
const invalid = (message) => fail("INVALID", message);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const own = (v, key) => Object.hasOwn(v, key);
const max = { subject: 240, description: 4000, owner: 100, activeForm: 240 };
const enums = { status: STATES, priority: PRIORITIES };
const terminalControls = /[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/u;
export const oneLine = (value) =>
	String(value).replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu, " ");
function fields(input) {
	const patch = {};
	for (const [name, limit] of Object.entries(max))
		if (own(input, name)) {
			const value = input[name];
			if (
				typeof value !== "string" ||
				value.length > limit ||
				terminalControls.test(
					name === "description" && typeof value === "string"
						? value.replace(/\n/g, "")
						: value,
				)
			)
				invalid(`${name} must be plain text (max ${limit} characters).`);
			patch[name] = value.trim();
			if (name === "subject" && !patch.subject)
				invalid("Give the task a title.");
		}
	for (const [key, choices] of Object.entries(enums))
		if (own(input, key)) {
			if (!choices.includes(input[key]))
				invalid(`${key}: choose ${choices.join(", ")}.`);
			patch[key] = input[key];
		}
	if (own(input, "blockedBy")) {
		if (!Array.isArray(input.blockedBy) || !input.blockedBy.every(positive))
			invalid("blockedBy must be an array of positive integer IDs.");
		patch.blockedBy = [...new Set(input.blockedBy)];
	}
	return patch;
}
const defaults = () => ({
	status: "pending",
	priority: "normal",
	description: "",
	activeForm: "",
	owner: "",
	blockedBy: [],
});
function loadSnapshot(data, legacy) {
	if (
		!plain(data) ||
		!positive(data.nextId) ||
		!Array.isArray(data.tasks) ||
		(!legacy && data.version !== 1)
	)
		fail("CORRUPT", "Unsupported task snapshot; history was not changed.");
	const ids = new Set();
	const tasks = data.tasks.map((t) => {
		if (
			!plain(t) ||
			!positive(t.id) ||
			t.id >= data.nextId ||
			ids.has(t.id) ||
			typeof t.subject !== "string" ||
			!STATES.includes(t.status)
		)
			fail("CORRUPT", "Invalid task or duplicate ID in saved board.");
		ids.add(t.id);
		const task = { ...defaults(), ...t };
		if (
			!Array.isArray(task.blockedBy) ||
			!task.blockedBy.every(positive) ||
			!PRIORITIES.includes(task.priority) ||
			Object.keys(max).some((k) => typeof task[k] !== "string")
		)
			fail("CORRUPT", "Invalid task fields in saved board.");
		return task;
	});
	return { version: 1, tasks, nextId: data.nextId };
}
export function readBranch(entries, session) {
	let legacy, result;
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === "custom" && e.customType === ENTRY)
			return { ...loadSnapshot(e.data, false), revision: `${session}:${e.id}` };
		if (e.type === "custom" && e.customType?.startsWith("herdr-pi-todos/v"))
			fail(
				"CORRUPT",
				"Newer board format. Upgrade before editing this branch.",
			);
		if (!legacy && e.type === "custom" && e.customType === "rpiv-todo-state")
			legacy = e;
		const m = e.type === "message" && e.message;
		if (
			!result &&
			m?.role === "toolResult" &&
			m.toolName === "todo" &&
			!m.isError &&
			Array.isArray(m.details?.tasks) &&
			positive(m.details.nextId)
		)
			result = e;
	}
	const e = legacy ?? result;
	return {
		...(e
			? loadSnapshot(legacy ? e.data : e.message.details, true)
			: { version: 1, tasks: [], nextId: 1 }),
		revision: `${session}:${e?.id ?? "empty"}`,
	};
}
export function waits(task, board) {
	return task.blockedBy.filter(
		(id) => board.tasks.find((t) => t.id === id)?.status !== "completed",
	);
}
export function select(board, filter = "open", search = "") {
	if (!FILTERS.includes(filter))
		invalid(`Unknown filter: ${filter}. Choose ${FILTERS.join(", ")}.`);
	if (typeof search !== "string") invalid("Search must be text.");
	const words = search.toLowerCase().split(/\s+/).filter(Boolean);
	return board.tasks.filter((t) => {
		const open = t.status === "pending" || t.status === "in_progress";
		if (
			!(
				filter === "all" ||
				(filter === "open"
					? open
					: filter === "ready"
						? open && !waits(t, board).length
						: filter === "blocked"
							? open && !!waits(t, board).length
							: filter === t.status)
			)
		)
			return false;
		const haystack =
			`#${t.id} ${t.subject} ${t.owner} ${t.description} ${t.priority} ${t.activeForm}`.toLowerCase();
		return words.every((w) => haystack.includes(w));
	});
}
export function apply(board, req) {
	if (!plain(req) || !ACTIONS.includes(req.action))
		invalid(`Choose an action: ${ACTIONS.join(", ")}.`);
	if (
		req.expectedRevision !== undefined &&
		req.expectedRevision !== board.revision
	)
		fail("STALE", "The board changed. Read it again before editing.");
	const a = req.action;
	const keys = [
		"action",
		"expectedRevision",
		...(a === "list"
			? ["filter", "search"]
			: a === "get" || a === "restore" || a === "archive"
				? ["id"]
				: [
						...Object.keys(max),
						"priority",
						"blockedBy",
						...(a === "update" ? ["id", "status"] : []),
					]),
	];
	for (const key of Object.keys(req))
		if (!keys.includes(key)) invalid(`${key} is not valid for ${a}.`);
	if (a === "list")
		return {
			rows: select(board, req.filter ?? "all", req.search).filter(
				(t) => req.filter || t.status !== "deleted",
			),
		};
	let task;
	if (a !== "create") {
		if (!positive(req.id)) invalid("Use a positive task ID.");
		task = board.tasks.find((t) => t.id === req.id);
		if (!task) fail("NOT_FOUND", `No task #${req.id} on this branch.`);
		if (a === "get") return { rows: [task] };
		if ((task.status === "deleted") !== (a === "restore"))
			invalid(
				task.status === "deleted"
					? "Restore the archived task before editing it."
					: "Only archived tasks can be restored.",
			);
	}
	let patch;
	if (a === "archive") {
		if (
			board.tasks.some(
				(t) => t.status !== "deleted" && t.blockedBy.includes(task.id),
			)
		)
			fail(
				"DEPENDENCY",
				"Remove links from dependent tasks before archiving this one.",
			);
		patch = { status: "deleted" };
	} else if (a === "restore") patch = { status: "pending" };
	else {
		patch = fields(req);
		if (a === "create" && !patch.subject) invalid("Give the task a title.");
		if (patch.status === "deleted") invalid("Use archive to remove a task.");
		if (!Object.keys(patch).length)
			invalid("Choose at least one field to change.");
	}
	const next = { ...(task ?? { ...defaults(), id: board.nextId }), ...patch };
	const tasks = task
		? board.tasks.map((t) => (t.id === task.id ? next : t))
		: [...board.tasks, next];
	if ("blockedBy" in patch || a === "restore") {
		const byId = new Map(tasks.map((t) => [t.id, t]));
		const visiting = new Set();
		const done = new Set();
		function visit(id) {
			if (visiting.has(id))
				fail("DEPENDENCY", "That dependency would create a cycle.");
			if (done.has(id)) return;
			const t = byId.get(id);
			if (!t || t.status === "deleted")
				fail("DEPENDENCY", `Dependency #${id} is missing or archived.`);
			visiting.add(id);
			for (const dep of t.blockedBy) visit(dep);
			visiting.delete(id);
			done.add(id);
		}
		visit(next.id);
	}
	if (
		(patch.status || patch.blockedBy) &&
		["completed", "in_progress"].includes(next.status) &&
		waits(next, { tasks }).length
	)
		fail(
			"BLOCKED",
			`Finish ${waits(next, { tasks })
				.map((i) => `#${i}`)
				.join(", ")} first.`,
		);
	if (
		task?.status === "completed" &&
		next.status !== "completed" &&
		tasks.some(
			(t) =>
				["completed", "in_progress"].includes(t.status) &&
				t.blockedBy.includes(next.id),
		)
	)
		fail(
			"DEPENDENCY",
			"Reopen or unlink active and completed dependents first.",
		);
	const snapshot = { version: 1, nextId: board.nextId + (task ? 0 : 1), tasks };
	if (
		tasks.length > 1000 ||
		Buffer.byteLength(JSON.stringify(snapshot)) > 512 * 1024
	)
		fail(
			"LIMIT",
			"Board limit: 1,000 tasks or 512 KiB. Start a new session for new work.",
		);
	return { rows: [next], snapshot };
}
// Synchronous read, validation and append: two tool/UI/socket callers cannot interleave.
export function operate(ctx, append, req) {
	const read = () =>
		readBranch(
			ctx.sessionManager.getBranch(),
			ctx.sessionManager.getSessionId(),
		);
	const board = read();
	const { rows, snapshot } = apply(board, req);
	if (snapshot) append(ENTRY, snapshot);
	return { revision: snapshot ? read().revision : board.revision, tasks: rows };
}
export function row(t) {
	const state = {
		pending: "todo",
		in_progress: "doing",
		completed: "done",
		deleted: "archived",
	}[t.status];
	return `#${t.id}  ${state}  ${oneLine(t.subject)}${t.priority !== "normal" ? `  !${t.priority}` : ""}${t.owner ? `  @${oneLine(t.owner)}` : ""}${t.blockedBy.length ? `  after ${t.blockedBy.map((id) => `#${id}`).join(",")}` : ""}`;
}
