# Herdr Pi Todos

A task board you open, not a task list that occupies your terminal. Type `/todos` in Pi. Search for a task, press **Enter** for its actions, or choose **+ Add a task**. **Esc** closes the board. Agent updates never pin a widget.

Inside the [Herdr desktop app](https://github.com/herdrdev/herdr-app), `/todos herdr` opens an editable companion in a split beside the Pi terminal that owns the board. Start a task there and Pi sees the change. Complete it in Pi and the open view refreshes.

## Try it without changing your setup

Requires Node 22.19+ and [Pi](https://github.com/earendil-works/pi) (tested with 1.5.0). Herdr is optional.

```sh
git clone https://github.com/johnlindquist/herdr-pi-todos.git
cd herdr-pi-todos
pi -ne -e ./index.mjs
```

`-ne` skips other extensions for this run. No dependency installation, account or model call is needed to use the board. Type these in Pi:

```text
/todos add Write release notes
/todos add Publish the release
/todos after #2 #1
/todos list blocked
/todos
```

Type `release` to filter the board. Move with **↑/↓**, press **Enter**, then choose **Complete** on the first task. `/todos list ready` now includes the second task. In the main editor, type `/todos ` to see verbs with descriptions; `/todos start ` suggests task IDs **and titles**. Type part of a title, press **Tab** to insert its ID, then **Enter** to act. `/todos help after` shows a worked example.

For a permanent install, **disable any other extension that registers `todo` or `/todos` first**. Do not install both providers together. Then:

```sh
pi install git:github.com/johnlindquist/herdr-pi-todos
```

Restart Pi or run `/reload`. To uninstall: `pi remove git:github.com/johnlindquist/herdr-pi-todos`. Removing the extension does not remove Pi session history.

## Work with a task

| In Pi | Effect |
|---|---|
| `/todos add <title>` | Create a pending task with a stable ID |
| `/todos find <words>` · `/todos show #3` | Search title, notes, owner; inspect a task |
| `/todos start #3` · `done #3` · `reopen #3` | Start work, complete it, or return it to pending |
| `/todos edit #3 <title>` · `note #3 <text>` | Rename or replace notes; the board's Notes editor supports multiple lines |
| `/todos assign #3 <owner>` · `priority #3 high` | Set an owner or a low, normal, or high priority |
| `/todos after #3 #1 #2` | Require both tasks first; `after #3` removes the prerequisites |
| `/todos list ready` · `list blocked` | See what can start and what must wait |
| `/todos archive #3` · `list deleted` · `restore #3` | Hide without erasing; restore to pending with the same ID |

Prefix each command with `/todos` in Pi. `list` includes completed tasks; `open` means pending or in progress. Other filters: `all` (includes archived), `pending`, `in_progress`, `completed`, `deleted`. No task begins or completes while a prerequisite is unfinished. Cycles, missing dependencies and archiving a prerequisite that other tasks still reference are rejected without a partial edit.

## Herdr

Run Pi **in a local terminal pane of Herdr 2**, with `hc` and `herdr-app` on PATH. Run `/todos herdr`. The extension matches the terminal address **and** its local space before opening a right split. It refuses unattached terminals and ambiguous matches rather than guessing from focus. No app rebuild, mod installation or layout edit is needed. Remote machines and legacy `herdr` are not supported by this command.

The split starts on open tasks. At `todos ›`, type `help`, `list completed`, `find release`, `start #2`, or `done #2`. **Tab** completes verbs and task IDs. `next` and `prev` page through long lists. The split refreshes while idle and leaves your typing alone. A stale edit is rejected; read the refreshed board before retrying. `quit` closes the companion; `/todos unshare` in Pi revokes access for all companions. Closing Pi or navigating its session tree disconnects the old view.

## Storage and privacy

- One board per active **Pi session branch**. Edits append snapshots to Pi's session journal. Resume/reload restores the list; a fork sees its ancestor's tasks, not later edits from the previous branch. There is no second task database or background syncing service.
- Pi's persistence rules apply: a new conversation may exist only in memory until its first chat turn is saved. `--no-session` boards are temporary. Don't close an unsaved session expecting to resume it.
- Existing `@juicesharp/rpiv-todo` session snapshots are readable. IDs, titles, statuses, dependencies and stored fields carry forward; the first new edit appends a new-format snapshot without rewriting the old entries. The old extension cannot read new-format edits. Other extensions' task files are not imported.
- No TCP, telemetry, API keys, or task files in your project. Only `/todos share` and `/todos herdr` open a private, same-user Unix socket on macOS/Linux. These grant read/write access to **this board**, not to a shell or other Pi tools. A connection ID is not intended as a boundary between processes running as the same OS user. Task text in Pi's journal has the same privacy as the rest of that session.
- Limits per branch: 1,000 tasks including archived, 512 KiB per snapshot, 240 characters per title and 4,000 per note. The journal grows with edits. Do not run two independent Pi writers against the same session file; use the companion for concurrent access.

## Agent and CLI interfaces

Pi registers the `todo` tool: `list`, `get`, `create`, `update`, `archive`, `restore`. Tool results include `details.tasks` (matching or changed rows) and `details.revision`. A mutation with `expectedRevision` is rejected if the observed board changed, even if the same numeric ID exists on another session. `blockedBy` is a replacement list, not an append operation.

External agents can use the CLI without emulating a terminal. `node bin/todos.mjs describe` prints the JSON schema. In Pi, run `/todos share` and copy the connection ID. From a checkout:

```sh
node bin/todos.mjs request "$BOARD" '{"action":"list"}'
node bin/todos.mjs request "$BOARD" '{"action":"update","id":2,"status":"completed","expectedRevision":"<revision from read>"}'
```

Successful CLI calls print JSON to stdout. Errors print JSON to stderr and exit nonzero: `STALE` requires a fresh read; `BLOCKED`/`DEPENDENCY` require fixing the prerequisite; `NOT_FOUND`, `INVALID`, `OFFLINE`, and `CORRUPT` are distinct from an empty list. `node bin/todos.mjs watch "$BOARD"` opens the same companion in any local terminal.

## Development

```sh
node --test test/*.test.mjs
python3 test/pi-smoke.py     # Pi, tmux, Node and Python 3
python3 test/herdr-smoke.py  # also needs hc; starts and stops a private core
```

The Pi acceptance test uses a deterministic offline provider to issue a real task tool call. It also drives the real editor, selects completions, exercises a conflicting edit during a task action, reloads, and resumes the saved session. Linux CI also runs the released Herdr app on a private virtual display, opens the split through `/todos herdr`, edits in both directions and captures the window. It never needs a signed-in desktop.

Design references: [Pi's branch-aware todo example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/todo.ts), [Mitsupi's searchable task UI](https://github.com/mitsuhiko/agent-stuff/blob/main/extensions/todos.ts), [rpiv-todo](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo), [pi-tasks](https://github.com/tintinweb/pi-tasks), and [pi-manage-todo-list](https://github.com/tintinweb/pi-manage-todo-list). MIT licensed.
