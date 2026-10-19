"use client";

import { useActionState, useEffect, useRef, type KeyboardEvent } from "react";
import { Button } from "@/components/ui";
import { askAction } from "../actions";

/** The input bar at the foot of a chat. Enter asks, Shift+Enter starts a new line. */
export function AskBar({ chatId }: { chatId: string }) {
  const [state, action, pending] = useActionState(askAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the question once the server has taken it. Errors keep the text so it can be fixed.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!pending) formRef.current?.requestSubmit();
  }

  const error = state && !state.ok ? state.error : null;

  return (
    <form
      ref={formRef}
      action={action}
      role="group"
      aria-label="Ask a question"
      className="mt-auto flex flex-col gap-2"
    >
      <input type="hidden" name="chatId" value={chatId} />
      <div className="flex items-center gap-2 rounded-full border border-hairline py-1.5 pl-5 pr-1.5 focus-within:border-mint">
        <textarea
          name="question"
          rows={1}
          required
          maxLength={2000}
          aria-label="Ask a question about your files"
          placeholder="Ask about these files…"
          onKeyDown={onKeyDown}
          className="max-h-40 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none"
        />
        <Button type="submit" variant="primary" size="md" disabled={pending}>
          {pending ? "Thinking…" : "Ask"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="px-5 text-[13px] text-error">
          {error}
        </p>
      )}
    </form>
  );
}
