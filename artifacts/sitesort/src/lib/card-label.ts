import { formatDate } from "@/lib/utils";

// One person can hold more than one contact card on a project (two firms), and
// two cards can carry the same name and email. Name alone tells a PM nothing,
// so a card is always identified by firm, trade and date added (Dean,
// 2026-10-20). Used by the Team tab marker and the removal confirmation.
export type CardIdentity = {
  companyName?: string | null;
  contactType?: string | null;
  trades?: string[] | null;
  addedAt?: string | null;
};

export function cardFirm(c: CardIdentity): string {
  if (c.contactType === "self_employed") return "Self-employed";
  return c.companyName?.trim() || "In-house";
}

export function cardLabel(c: CardIdentity): string {
  return [
    cardFirm(c),
    c.trades?.length ? c.trades.join(", ") : null,
    c.addedAt ? `added ${formatDate(c.addedAt)}` : null,
  ].filter(Boolean).join(" · ");
}
