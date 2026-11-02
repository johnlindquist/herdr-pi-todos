import { ACTIONS, FILTERS, PRIORITIES, STATES } from "./board.mjs";
const string = (description, maxLength) => ({
	type: "string",
	description,
	...(maxLength ? { maxLength } : {}),
});
const pick = (values, description) => ({
	type: "string",
	enum: values,
	description,
});
export const parameters = {
	type: "object",
	additionalProperties: false,
	required: ["action"],
	properties: {
		action: pick(ACTIONS, "list, get, create, update, archive or restore."),
		id: {
			type: "integer",
			minimum: 1,
			description: "Stable task ID; required except for list/create.",
		},
		subject: string("Task title. Required for create.", 240),
		description: string("Task notes; empty text clears.", 4000),
		owner: string("Person or agent responsible.", 100),
		activeForm: string("Activity label while in progress.", 240),
		status: pick(
			STATES.filter((x) => x !== "deleted"),
			"For update. Use archive/restore to hide/recover tasks.",
		),
		priority: pick(PRIORITIES, "Low, normal or high."),
		blockedBy: {
			type: "array",
			items: { type: "integer", minimum: 1 },
			description: "Replace prerequisites with these IDs. [] unlinks all.",
		},
		filter: pick(FILTERS, "For list; default is all non-archived tasks."),
		search: string("For list; search title, notes and owner."),
		expectedRevision: string(
			"Reject the edit if the board changed since your read. Required on the external connection.",
		),
	},
};
