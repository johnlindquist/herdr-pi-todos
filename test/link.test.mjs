import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { operate } from "../lib/board.mjs";
import { serve, request } from "../lib/link.mjs";
import { locatePane, splitPane } from "../lib/herdr.mjs";

test(
	"real private socket: simultaneous edits conflict, reads observe writes, unshare cuts access",
	{ skip: process.platform === "win32" },
	async () => {
		const entries = [];
		const ctx = {
			sessionManager: { getBranch: () => entries, getSessionId: () => "test" },
		};
		const server = await serve((q) =>
			operate(
				ctx,
				(customType, data) =>
					entries.push({
						id: String(entries.length),
						type: "custom",
						customType,
						data,
					}),
				q,
			),
		);
		try {
			assert.equal(
				statSync(`/tmp/herdr-pi-todos-${server.id}`).mode & 0o777,
				0o700,
			);
			const { revision } = await request(server.id, { action: "list" });
			await assert.rejects(
				request(server.id, { action: "create", subject: "without revision" }),
				(e) => e.code === "STALE",
			);
			const results = await Promise.allSettled(
				["first", "second"].map((subject) =>
					request(server.id, {
						action: "create",
						subject,
						expectedRevision: revision,
					}),
				),
			);
			assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
			assert.equal(
				results.find((r) => r.status === "rejected").reason.code,
				"STALE",
			);
			assert.equal(
				(await request(server.id, { action: "list" })).tasks.length,
				1,
			);
		} finally {
			server.close();
		}
		await assert.rejects(
			request(server.id, { action: "list" }),
			(e) => e.code === "OFFLINE",
		);
		await assert.rejects(
			request("../../unsafe", { action: "list" }),
			(e) => e.code === "INVALID",
		);
	},
);
test("Herdr targets the exact local source terminal and space, not focus or a remote ID match", async () => {
	const record = { address: "t3", labels: { "herdr.space": "s1" } };
	const tab = (pane) => ({ terminals: [{ pane, terminal: "t3" }] });
	const good = { id: "s1", tabs: [tab("p3")] };
	let spaces = [
		{ ...good, machine: "remote" },
		{ id: "s2", tabs: [tab("p4")] },
		good,
	];
	const run = async (cmd) => (cmd === "hc" ? record : { spaces });
	assert.equal(await locatePane(run, "t3"), "p3");
	spaces = [good, good];
	await assert.rejects(locatePane(run, "t3"), /identify/);
	spaces = [];
	await assert.rejects(locatePane(run, "t3"), /identify/);
	await assert.rejects(locatePane(run, ""), /local Herdr/);
	const pane = await splitPane("p3", "connection", async (cmd, args) => {
		assert.equal(cmd, "herdr-app");
		const q = JSON.parse(args[2]);
		assert.equal(q.pane, "p3");
		assert.deepEqual(q.argv.slice(-2), ["watch", "connection"]);
		assert.equal(q.direction, "right");
		return { pane: "p4", terminal: "t4" };
	});
	assert.equal(pane, "p4");
	await assert.rejects(
		splitPane("p3", "connection", async () => ({ pane: "p3", terminal: "t3" })),
		/unknown/,
	);
});
