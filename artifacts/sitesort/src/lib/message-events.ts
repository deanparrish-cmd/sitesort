// Cross-component signal for "the user just read some messages".
//
// The messaging UI (sidebar badge + conversation list) uses manual `fetch` +
// polling rather than React Query, so there is no query cache to invalidate.
// This lightweight window event fills that gap: the messages page dispatches it
// after opening a conversation (which marks those messages read server-side),
// and the sidebar listens for it and re-fetches its unread badge. That keeps the
// badge and the conversation list in sync immediately, without a page refresh.
const MESSAGES_READ_EVENT = "sitesort:messages-read";

/** Announce that some messages were just marked read (call after opening a conversation). */
export function notifyMessagesRead(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MESSAGES_READ_EVENT));
  }
}

/** Subscribe to read events. Returns an unsubscribe function. */
export function onMessagesRead(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(MESSAGES_READ_EVENT, handler);
  return () => window.removeEventListener(MESSAGES_READ_EVENT, handler);
}
