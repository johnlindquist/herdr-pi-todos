import net from "node:net";
import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, rmdirSync } from "node:fs";
import { fail } from "./board.mjs";
const limit = 2 * 1024 * 1024;
function dir(id) {
	if (process.platform === "win32")
		fail("UNAVAILABLE", "Local board sharing requires macOS or Linux.");
	if (!/^[a-f0-9]{32}$/.test(id))
		fail("INVALID", "Invalid connection ID. Run /todos share in Pi.");
	return `/tmp/herdr-pi-todos-${id}`;
}
function readLine(socket, onLine, onError, maxBytes) {
	let size = 0,
		finished = false;
	const chunks = [];
	const error = (err) => {
		if (!finished) {
			finished = true;
			onError(err);
		}
	};
	socket.setTimeout(4000, () => error(new Error("Connection timed out.")));
	socket.on("error", error);
	socket.on("end", () => error(new Error("Connection closed before a reply.")));
	socket.on("data", (chunk) => {
		if (finished) return;
		size += chunk.length;
		if (size > maxBytes) return error(new Error("Message too large."));
		const at = chunk.indexOf(10);
		chunks.push(at < 0 ? chunk : chunk.subarray(0, at));
		if (at >= 0) {
			let value;
			try {
				value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			} catch {
				return error(new Error("Invalid JSON frame."));
			}
			finished = true;
			onLine(value);
		}
	});
}
export async function serve(dispatch) {
	const id = randomUUID().replaceAll("-", ""),
		root = dir(id),
		file = `${root}/board.sock`;
	mkdirSync(root, { mode: 0o700 });
	const sockets = new Set();
	const server = net.createServer((socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		readLine(
			socket,
			(req) => {
				let reply;
				try {
					if (
						!["list", "get"].includes(req?.action) &&
						typeof req?.expectedRevision !== "string"
					)
						fail(
							"STALE",
							"Read the board and supply expectedRevision for edits.",
						);
					reply = { ok: true, ...dispatch(req) };
				} catch (e) {
					reply = { ok: false, code: e.code ?? "ERROR", message: e.message };
				}
				socket.end(`${JSON.stringify(reply)}\n`);
			},
			() => socket.destroy(),
			32 * 1024,
		);
	});
	server.maxConnections = 16;
	try {
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(file, resolve);
		});
		chmodSync(file, 0o600);
	} catch (e) {
		server.close();
		rmdirSync(root);
		throw e;
	}
	let closed = false;
	return {
		id,
		close() {
			if (closed) return;
			closed = true;
			for (const s of sockets) s.destroy();
			server.close(() => {
				try {
					rmdirSync(root);
				} catch {
					/* the OS may already have cleaned its temporary directory */
				}
			});
		},
	};
}
export async function request(id, req) {
	const root = dir(id);
	let st;
	try {
		st = lstatSync(root);
	} catch {
		fail("OFFLINE", "Board is offline. Reopen it from the owning Pi session.");
	}
	if (
		!st.isDirectory() ||
		st.uid !== process.getuid() ||
		(st.mode & 0o077) !== 0
	)
		fail("UNSAFE", "Not a private board directory owned by this user.");
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(`${root}/board.sock`);
		readLine(
			socket,
			(reply) => {
				socket.destroy();
				if (reply?.ok === true) resolve(reply);
				else
					reject(
						Object.assign(new Error(reply?.message ?? "Invalid reply."), {
							code: reply?.code ?? "ERROR",
						}),
					);
			},
			(err) => {
				socket.destroy();
				reject(
					Object.assign(new Error(`Board unavailable: ${err.message}`), {
						code: "OFFLINE",
					}),
				);
			},
			limit,
		);
		socket.on("connect", () => socket.write(`${JSON.stringify(req)}\n`));
	});
}
