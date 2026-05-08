import type { ChatEvent } from "./ui/chat.js";

export function safeSave(
	operation: string,
	promise: Promise<unknown>,
	pushEvent: (event: ChatEvent) => void,
): void {
	void promise.catch((err) => {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[save error] ${operation}: ${msg}`);
		pushEvent({ kind: "error", key: `err_${Date.now()}`, text: `${operation} failed: ${msg}` });
	});
}
