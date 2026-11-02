import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, operate, readBranch, ENTRY, oneLine } from "../lib/board.mjs";
import { completions, format, help, parse, GUIDE } from "../lib/commands.mjs";

function journal(entries = [], session = "one") {
	const ctx = {
		sessionManager: { getBranch: () => entries, getSessionId: () => session },
	};
	const append = (customType, data) =>
		entries.push({
			type: "custom",
			customType,
			data,
			id: `entry-${entries.length + 1}`,
		});
	return {
		entries,
		read: () => readBranch(entries, session),
		op: (q) => operate(ctx, append, q),
		cmd: (line) => operate(ctx, append, parse(line)),
	};
}
const rejects = (fn, code) => assert.throws(fn, (e) => e.code === code);

test("human and agent edit the same tasks; notes, owner, priority, search and archive round-trip", () => {
	const j = journal();
	j.cmd("add Verify migration");
	j.cmd("note #1 Test both directions");
	j.cmd("assign 1 Alex");
	j.cmd("priority #1 high");
	j.cmd("edit 1 Verify upgrade");
	assert.match(
		format({ action: "get" }, j.cmd("show #1")),
		/Test both directions/,
	);
	assert.equal(j.cmd("find alex directions").tasks[0].priority, "high");
	j.op({
		action: "update",
		id: 1,
		status: "in_progress",
		activeForm: "Testing upgrades",
	});
	j.cmd("done 1");
	j.cmd("archive 1");
	assert.equal(j.cmd("list").tasks.length, 0);
	assert.deepEqual(
		j.cmd("list deleted").tasks.map((t) => t.subject),
		["Verify upgrade"],
	);
	j.cmd("restore 1");
	assert.equal(j.cmd("show #1").tasks[0].status, "pending");
	j.cmd("add Second");
	assert.equal(j.read().nextId, 3);
});
test("dependencies prevent cycles, early start/finish, invalid references and orphaning", () => {
	const j = journal();
	for (const t of ["first", "second", "third"]) j.cmd(`add ${t}`);
	j.cmd("after #2 #1");
	j.cmd("after #3 #2");
	const revision = j.read().revision;
	for (const cmd of ["after 1 3", "after 1 1", "after 1 99", "archive 1"])
		rejects(() => j.cmd(cmd), "DEPENDENCY");
	for (const cmd of ["start 3", "done 2"]) rejects(() => j.cmd(cmd), "BLOCKED");
	assert.equal(j.read().revision, revision);
	assert.deepEqual(
		j.cmd("list ready").tasks.map((t) => t.id),
		[1],
	);
	assert.deepEqual(
		j.cmd("list blocked").tasks.map((t) => t.id),
		[2, 3],
	);
	j.cmd("done 1");
	j.cmd("start 2");
	rejects(() => j.cmd("reopen 1"), "DEPENDENCY");
	j.cmd("after 2");
	j.cmd("reopen 1");
	j.cmd("archive 1");
	rejects(() => j.cmd("after 3 1"), "DEPENDENCY");
});
test("branch replay, fork isolation and compare-and-set use snapshot and session identity", () => {
	const a = journal();
	const empty = a.read().revision;
	a.cmd("add Common ancestor");
	const rev = a.read().revision;
	const b = journal([...a.entries], "fork");
	a.cmd("done 1");
	assert.equal(b.read().tasks[0].status, "pending");
	b.cmd("edit 1 Fork only");
	assert.equal(a.read().tasks[0].subject, "Common ancestor");
	for (const r of [empty, rev, b.read().revision])
		rejects(
			() => a.op({ action: "archive", id: 1, expectedRevision: r }),
			"STALE",
		);
	a.op({ action: "archive", id: 1, expectedRevision: a.read().revision });
	assert.equal(a.read().tasks[0].status, "deleted");
	const before = journal(a.entries.slice(0, 1));
	assert.equal(before.read().tasks[0].status, "pending");
});
test("existing rpiv custom snapshots beat legacy tool results; IDs, notes and metadata survive first local edit", () => {
	const snapshot = {
		nextId: 8,
		tasks: [
			{
				id: 3,
				status: "completed",
				subject: "Legacy",
				metadata: { url: "local" },
			},
		],
	};
	const j = journal([
		{ id: "a", type: "custom", customType: "rpiv-todo-state", data: snapshot },
		{
			id: "b",
			type: "message",
			message: {
				role: "toolResult",
				toolName: "todo",
				details: { nextId: 1, tasks: [] },
			},
		},
	]);
	assert.equal(j.cmd("show 3").tasks[0].subject, "Legacy");
	j.cmd("add New");
	assert.equal(j.read().tasks[1].id, 8);
	assert.deepEqual(j.read().tasks[0].metadata, { url: "local" });
	assert.equal(snapshot.tasks.length, 1);
	assert.equal(journal([j.entries[1]]).read().nextId, 1);
	assert.equal(j.read().version, 1);
});
test("invalid/future state is never mistaken for empty; invalid input never appends", () => {
	rejects(
		() =>
			readBranch(
				[
					{
						id: "x",
						type: "custom",
						customType: ENTRY,
						data: { version: 2, tasks: [], nextId: 1 },
					},
				],
				"x",
			),
		"CORRUPT",
	);
	const j = journal();
	j.cmd("add Test");
	const rev = j.read().revision;
	for (const q of [
		{ action: "create", subject: "  " },
		{ action: "create", subject: "\x1b[2J" },
		{ action: "update", id: 1 },
		{ action: "update", id: 1, subject: "x".repeat(241) },
		{ action: "update", id: 1, status: "deleted" },
		{ action: "update", id: 1, blockedBy: [null] },
		{ action: "get", id: "1" },
		{ action: "clear" },
		{ action: "archive", id: 1, owner: "oops" },
	])
		rejects(() => j.op(q), "INVALID");
	rejects(() => j.op({ action: "get", id: 55 }), "NOT_FOUND");
	assert.equal(rev, j.read().revision);
	assert.doesNotMatch(oneLine("\x1b[2J\rhi"), /\p{Cc}/u);
});
test("command help and completions lead to executable commands and current task IDs", () => {
	const j = journal();
	j.cmd("add Paint UI");
	j.cmd("add Retired");
	j.cmd("archive 2");
	for (const [name, [, , example]] of Object.entries(GUIDE)) {
		assert.ok(parse(example));
		assert.ok(help(name).includes(example));
	}
	assert.ok(completions("st").some((c) => c.value === "start"));
	assert.equal(completions("done Paint", j.read().tasks)[0].value, "done #1");
	assert.equal(completions("restore ", j.read().tasks)[0].value, "restore #2");
	assert.equal(completions("list blo")[0].value, "list blocked");
	assert.deepEqual(completions("after #1 ", j.read().tasks), []);
	assert.deepEqual(completions("share", [], true), []);
	for (const s of [
		"__proto__",
		"unknown",
		"start 1 extra",
		"done 1.2",
		"done",
		"share arg",
	])
		rejects(() => parse(s), "USAGE");
	assert.equal(apply(j.read(), parse("list deleted")).rows.length, 1);
});
