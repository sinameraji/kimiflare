import type { ChatEvent } from "../ui/chat.js";

export interface UiUpdaters {
  flushAssistantUpdates: () => void;
  updateAssistant: (
    id: number,
    patch: (e: Extract<ChatEvent, { kind: "assistant" }>) => Partial<ChatEvent>,
  ) => void;
  updateTool: (
    id: string,
    patch: Partial<Extract<ChatEvent, { kind: "tool" }>>,
  ) => void;
}

export function createUiUpdaters({
  setEvents,
  pendingTextRef,
  flushTimeoutRef,
}: {
  setEvents: React.Dispatch<React.SetStateAction<ChatEvent[]>>;
  pendingTextRef: React.MutableRefObject<
    Map<number, { text: string; reasoning: string }>
  >;
  flushTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}): UiUpdaters {
  function flushAssistantUpdates(): void {
    flushTimeoutRef.current = null;
    const pending = pendingTextRef.current;
    if (pending.size === 0) return;
    pendingTextRef.current = new Map();
    setEvents((evts) =>
      evts.map((e) => {
        if (e.kind !== "assistant") return e;
        const delta = pending.get(e.id);
        if (!delta) return e;
        return {
          ...e,
          text: e.text + delta.text,
          reasoning: e.reasoning + delta.reasoning,
        } as ChatEvent;
      }),
    );
  }

  function updateAssistant(
    id: number,
    patch: (e: Extract<ChatEvent, { kind: "assistant" }>) => Partial<ChatEvent>,
  ): void {
    const result = patch({ text: "", reasoning: "" } as Extract<
      ChatEvent,
      { kind: "assistant" }
    >);
    const assistantResult = result as Partial<
      Extract<ChatEvent, { kind: "assistant" }>
    >;
    const hasTextDelta =
      assistantResult.text !== undefined && assistantResult.text.length > 0;
    const hasReasoningDelta =
      assistantResult.reasoning !== undefined &&
      assistantResult.reasoning.length > 0;

    if (hasTextDelta || hasReasoningDelta) {
      const existing = pendingTextRef.current.get(id) ?? {
        text: "",
        reasoning: "",
      };
      pendingTextRef.current.set(id, {
        text: existing.text + (assistantResult.text ?? ""),
        reasoning: existing.reasoning + (assistantResult.reasoning ?? ""),
      });
      if (!flushTimeoutRef.current) {
        flushTimeoutRef.current = setTimeout(flushAssistantUpdates, 16); // ~60fps
      }
      return;
    }

    // Non-text patches (streaming flag, etc.) apply immediately after flushing
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
      flushAssistantUpdates();
    }
    setEvents((evts) =>
      evts.map((e) =>
        e.kind === "assistant" && e.id === id
          ? ({ ...e, ...result } as ChatEvent)
          : e,
      ),
    );
  }

  function updateTool(
    id: string,
    patch: Partial<Extract<ChatEvent, { kind: "tool" }>>,
  ): void {
    setEvents((evts) =>
      evts.map((e) =>
        e.kind === "tool" && e.id === id
          ? ({ ...e, ...patch } as ChatEvent)
          : e,
      ),
    );
  }

  return { flushAssistantUpdates, updateAssistant, updateTool };
}
