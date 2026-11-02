// Offline Pi acceptance fixture. The first response invokes the real registered tool;
// the second completes the turn. No network, credentials, or model inference.
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
export default function fixture(pi) {
	const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	pi.registerProvider("board-fixture", {
		api: "board-fixture-local",
		apiKey: "offline-fixture",
		baseUrl: "http://127.0.0.1:1",
		models: [
			{
				id: "check",
				name: "Board fixture",
				reasoning: false,
				input: ["text"],
				cost,
				contextWindow: 32768,
				maxTokens: 512,
			},
		],
		streamSimple(model, ctx) {
			const s = createAssistantMessageEventStream(),
				call = ctx.messages.at(-1)?.role !== "toolResult";
			const block = call
				? {
						type: "toolCall",
						id: "offline-call",
						name: "todo",
						arguments: { action: "create", subject: "Inspect the release" },
					}
				: { type: "text", text: "Fixture turn finished." };
			const m = {
				role: "assistant",
				provider: model.provider,
				api: model.api,
				model: model.id,
				timestamp: Date.now(),
				content: [block],
				usage: { ...cost, totalTokens: 0, cost: { ...cost, total: 0 } },
				stopReason: call ? "toolUse" : "stop",
			};
			s.push({ type: "start", partial: m });
			if (call) {
				s.push({ type: "toolcall_start", contentIndex: 0, partial: m });
				s.push({
					type: "toolcall_end",
					contentIndex: 0,
					toolCall: block,
					partial: m,
				});
			} else {
				s.push({ type: "text_start", contentIndex: 0, partial: m });
				s.push({
					type: "text_delta",
					contentIndex: 0,
					delta: block.text,
					partial: m,
				});
				s.push({
					type: "text_end",
					contentIndex: 0,
					content: block.text,
					partial: m,
				});
			}
			s.push({ type: "done", reason: m.stopReason, message: m });
			s.end();
			return s;
		},
	});
}
