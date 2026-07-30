import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPortalMessages, getGetPortalMessagesQueryKey,
  useGetPortalMessageParticipants, getGetPortalMessageParticipantsQueryKey,
  useGetPortalChannelThread, getGetPortalChannelThreadQueryKey,
  useGetPortalDmThread, getGetPortalDmThreadQueryKey,
  useSendPortalChannelMessage, useSendPortalDm,
  useReactPortalChannelMessage, useReactPortalDm,
  getGetPortalUnseenQueryKey, useGetPortalContext,
} from "@workspace/api-client-react";
import { DictationButton } from "@/components/ui/dictation-button";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PORTAL_LIVE_REFETCH } from "./query-client";
import { ArrowLeft, Send, Hash, X, Plus, Building2 } from "lucide-react";

// Portal Messages — structural section (visible to every member, like Team/
// Daily Report): DMs to any other person on THIS project + the shared project
// channel. v1 composer scope: plain text + reactions + read receipts only (no
// attachments/invoice/reply-to/quick-replies). Reuses the SAME messages/
// channel_messages tables and send/react logic as the dashboard — see
// lib/messaging.ts on the server. A dedicated file (not folded into the
// already-huge section.tsx) since this is list+thread+compose, not a simple
// read-only card list.

const NOTICE_DISMISS_KEY = "sitesort_portal_messages_notice_dismissed";
const REACTION_EMOJIS = ["👍", "✅", "👀", "❤️", "😂"];

function Loading() {
  return <div className="flex justify-center py-16"><Spinner className="size-7 text-primary" /></div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-center py-12 text-muted-foreground text-base">{children}</div>;
}
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-card border border-border rounded-2xl p-4 ${className}`}>{children}</div>;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function ReactionRow({ reactions, onToggle }: { reactions: { emoji: string; count: number; mine: boolean }[]; onToggle: (emoji: string) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {reactions.filter(r => r.count > 0).map(r => (
        <button key={r.emoji} onClick={() => onToggle(r.emoji)}
          className={cn("text-sm min-h-9 px-2.5 rounded-full border-2 transition-colors", r.mine ? "bg-primary/10 border-primary/40" : "bg-muted border-border hover:border-primary/30")}>
          {r.emoji} {r.count}
        </button>
      ))}
      <div className="relative">
        <button onClick={() => setPickerOpen(v => !v)} aria-label="Add reaction" className="text-sm min-w-9 min-h-9 flex items-center justify-center rounded-full border-2 border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/40">
          +
        </button>
        {pickerOpen && (
          <div className="absolute z-10 bottom-full mb-1 left-0 flex gap-1 bg-card border border-border rounded-xl shadow-md p-1.5">
            {REACTION_EMOJIS.map(e => (
              <button key={e} onClick={() => { onToggle(e); setPickerOpen(false); }} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-muted text-lg active:scale-[0.95] transition-all">
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Composer({ onSend, sending }: { onSend: (content: string) => void; sending: boolean }) {
  const [value, setValue] = useState("");
  const submit = () => { const v = value.trim(); if (!v) return; onSend(v); setValue(""); };
  return (
    <div className="flex items-end gap-2 border-t border-border p-3">
      <textarea
        value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        rows={1} placeholder="Message…"
        className="flex-1 min-h-14 max-h-32 rounded-xl border-2 border-border bg-background px-4 py-3 text-base resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <DictationButton transcribeUrl="/api/portal/transcribe" onTranscript={t => setValue(v => (v.trim() ? v.trimEnd() + " " : "") + t)} />
      <button onClick={submit} disabled={sending || !value.trim()} title="Send" aria-label="Send message"
        className="shrink-0 h-14 w-14 flex items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.95] transition-all disabled:opacity-50">
        <Send className="w-6 h-6" />
      </button>
    </div>
  );
}

// The persistent, non-dismissable transparency notice — required to appear on
// every "start a new conversation" screen (spec requirement).
function OversightNotice() {
  return (
    <p className="text-sm text-muted-foreground bg-muted/50 border border-border rounded-lg px-3 py-2.5">
      Messages on this project are visible to project management.
    </p>
  );
}

function MessagesList() {
  const [, setLocation] = useLocation();
  const [dismissedBanner, setDismissedBanner] = useState(false);
  const { data: ctx } = useGetPortalContext();
  const projectId = ctx?.project?.id;
  const bannerKey = projectId ? `${NOTICE_DISMISS_KEY}_${projectId}` : null;
  const { data, isLoading } = useGetPortalMessages({ query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalMessagesQueryKey() } });

  useEffect(() => {
    if (!bannerKey) return;
    try { if (localStorage.getItem(bannerKey) === "1") setDismissedBanner(true); } catch { /* ignore */ }
  }, [bannerKey]);
  const dismiss = () => { if (bannerKey) { try { localStorage.setItem(bannerKey, "1"); } catch { /* ignore */ } } setDismissedBanner(true); };

  if (isLoading) return <Loading />;
  if (!data) return <Empty>Couldn't load messages.</Empty>;

  return (
    <div className="space-y-3">
      {!dismissedBanner && (
        <div className="flex items-start gap-2 bg-primary/5 border border-primary/20 rounded-xl p-3">
          <p className="flex-1 text-sm text-foreground">Messages on this project are visible to project management.</p>
          <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-lg text-muted-foreground hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>
      )}

      <button onClick={() => setLocation("/portal/messages?c=channel")} className="w-full text-left active:scale-[0.98] transition-all">
        <Card className="flex items-center gap-3 min-h-[72px] hover:border-primary/40 transition-colors">
          <div className="shrink-0 w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Hash className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base">Project channel</p>
            <p className="text-sm text-muted-foreground truncate mt-0.5">{data.channel.lastMessage ?? "No messages yet"}</p>
          </div>
          {data.channel.unread > 0 && (
            <span className="shrink-0 min-w-6 h-6 px-1.5 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">{data.channel.unread}</span>
          )}
        </Card>
      </button>

      <div className="flex items-center justify-between pt-1">
        <p className="text-sm font-bold text-muted-foreground uppercase tracking-wide">Direct messages</p>
        <button onClick={() => setLocation("/portal/messages?c=new")} className="inline-flex items-center gap-1.5 min-h-11 px-3 -mr-3 rounded-lg text-sm font-bold text-primary hover:bg-primary/10 active:scale-[0.98] transition-all">
          <Plus className="w-4 h-4" /> New message
        </button>
      </div>

      {data.conversations.length === 0 ? (
        <p className="text-base text-muted-foreground">No direct messages yet.</p>
      ) : (
        <div className="space-y-2">
          {data.conversations.map(c => (
            <button key={c.otherUserId} onClick={() => setLocation(`/portal/messages?c=dm-${c.otherUserId}`)} className="w-full text-left active:scale-[0.98] transition-all">
              <Card className="flex items-center gap-3 min-h-[72px] hover:border-primary/40 transition-colors">
                <div className="shrink-0 w-12 h-12 rounded-full bg-muted flex items-center justify-center font-extrabold text-base">
                  {c.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-base truncate">
                    {c.name}{c.removedFromProject && <span className="text-muted-foreground font-normal"> (removed from project)</span>}
                  </p>
                  <p className="text-sm text-muted-foreground truncate mt-0.5">{c.companyLabel} · {c.lastMessage || "…"}</p>
                </div>
                {c.unread > 0 && (
                  <span className="shrink-0 min-w-6 h-6 px-1.5 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">{c.unread}</span>
                )}
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewConversationPicker() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetPortalMessageParticipants({ query: { queryKey: getGetPortalMessageParticipantsQueryKey() } });

  return (
    <div className="space-y-3">
      <button onClick={() => setLocation("/portal/messages")} className="inline-flex items-center gap-1.5 min-h-11 px-3 -ml-3 rounded-lg text-base font-bold text-muted-foreground hover:text-foreground hover:bg-muted active:scale-[0.98] transition-all">
        <ArrowLeft className="w-5 h-5" /> Back
      </button>
      <OversightNotice />
      {isLoading ? <Loading /> : !data || data.length === 0 ? (
        <Empty>No one else is on this project yet.</Empty>
      ) : (
        <div className="space-y-2">
          {data.map(p => (
            <button key={p.userId} onClick={() => setLocation(`/portal/messages?c=dm-${p.userId}`)} className="w-full text-left active:scale-[0.98] transition-all">
              <Card className="flex items-center gap-3 min-h-[72px] hover:border-primary/40 transition-colors">
                <div className="shrink-0 w-12 h-12 rounded-full bg-muted flex items-center justify-center font-extrabold text-base">
                  {p.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-base truncate">{p.name}</p>
                  <p className="text-sm text-muted-foreground truncate flex items-center gap-1.5 mt-0.5"><Building2 className="w-4 h-4" />{p.companyLabel} · <span className="capitalize">{p.role.replace("_", " ")}</span></p>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelThread() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useGetPortalChannelThread({}, { query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalChannelThreadQueryKey({}) } });
  const send = useSendPortalChannelMessage();
  const react = useReactPortalChannelMessage();

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [data?.messages?.length]);

  const onSend = async (content: string) => {
    try {
      await send.mutateAsync({ data: { content } });
      await queryClient.invalidateQueries({ queryKey: getGetPortalChannelThreadQueryKey({}) });
      await queryClient.invalidateQueries({ queryKey: getGetPortalMessagesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetPortalUnseenQueryKey() });
    } catch { toast({ title: "Couldn't send", variant: "destructive" }); }
  };
  const onToggle = async (id: string, emoji: string) => {
    try { await react.mutateAsync({ id, data: { emoji } }); await queryClient.invalidateQueries({ queryKey: getGetPortalChannelThreadQueryKey({}) }); }
    catch { toast({ title: "Couldn't react", variant: "destructive" }); }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-14rem)] -mx-4 sm:mx-0">
      <div className="flex items-center gap-2 px-4 sm:px-0 pb-3 border-b border-border">
        <button onClick={() => setLocation("/portal/messages")} className="min-w-11 min-h-11 flex items-center justify-center -ml-2 rounded-lg text-muted-foreground hover:bg-muted active:scale-[0.95] transition-all"><ArrowLeft className="w-5 h-5" /></button>
        <Hash className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        <p className="font-bold text-base">Project channel</p>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-0 py-3 space-y-3">
        {isLoading ? <Loading /> : !data || data.messages.length === 0 ? <Empty>No messages yet, say hello.</Empty> : data.messages.map((m: any) => (
          <div key={m.id} className={cn("flex flex-col", m.mine ? "items-end" : "items-start")}>
            {!m.mine && <p className="text-xs text-muted-foreground mb-1 px-1 font-semibold">{m.senderName}{m.senderRemoved && " (removed from project)"}</p>}
            <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-base whitespace-pre-wrap break-words", m.mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
              {m.content}
            </div>
            <p className="text-xs text-muted-foreground mt-1 px-1">{fmtTime(m.createdAt)}</p>
            <ReactionRow reactions={m.reactions} onToggle={emoji => onToggle(m.id, emoji)} />
          </div>
        ))}
      </div>
      <Composer onSend={onSend} sending={send.isPending} />
    </div>
  );
}

function DmThread({ otherUserId }: { otherUserId: string }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useGetPortalDmThread(otherUserId, {}, { query: { refetchInterval: PORTAL_LIVE_REFETCH, queryKey: getGetPortalDmThreadQueryKey(otherUserId, {}) } });
  const send = useSendPortalDm();
  const react = useReactPortalDm();

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [data?.messages?.length]);

  const otherName = data?.messages?.find((m: any) => !m.mine)?.senderName ?? "Conversation";

  const onSend = async (content: string) => {
    try {
      await send.mutateAsync({ otherUserId, data: { content } });
      await queryClient.invalidateQueries({ queryKey: getGetPortalDmThreadQueryKey(otherUserId, {}) });
      await queryClient.invalidateQueries({ queryKey: getGetPortalMessagesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetPortalUnseenQueryKey() });
    } catch (e: any) {
      if (e?.status === 404) toast({ title: "No longer available", description: "This person is no longer on this project.", variant: "destructive" });
      else toast({ title: "Couldn't send", variant: "destructive" });
    }
  };
  const onToggle = async (id: string, emoji: string) => {
    try { await react.mutateAsync({ id, data: { emoji } }); await queryClient.invalidateQueries({ queryKey: getGetPortalDmThreadQueryKey(otherUserId, {}) }); }
    catch { toast({ title: "Couldn't react", variant: "destructive" }); }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-14rem)] -mx-4 sm:mx-0">
      <div className="flex items-center gap-2 px-4 sm:px-0 pb-3 border-b border-border">
        <button onClick={() => setLocation("/portal/messages")} className="min-w-11 min-h-11 flex items-center justify-center -ml-2 rounded-lg text-muted-foreground hover:bg-muted active:scale-[0.95] transition-all"><ArrowLeft className="w-5 h-5" /></button>
        <p className="font-bold text-base truncate">{otherName}</p>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-0 py-3 space-y-3">
        {isLoading ? <Loading /> : !data ? (
          <Empty>Couldn't load this conversation.</Empty>
        ) : data.messages.length === 0 ? <Empty>No messages yet, say hello.</Empty> : data.messages.map((m: any) => (
          <div key={m.id} className={cn("flex flex-col", m.mine ? "items-end" : "items-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-base whitespace-pre-wrap break-words", m.mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
              {m.content}
            </div>
            <p className="text-xs text-muted-foreground mt-1 px-1 flex items-center gap-1">
              {fmtTime(m.createdAt)}
              {m.mine && (m.readAt ? <span title="Read">✓✓</span> : <span title="Sent">✓</span>)}
            </p>
            <ReactionRow reactions={m.reactions} onToggle={emoji => onToggle(m.id, emoji)} />
          </div>
        ))}
      </div>
      <Composer onSend={onSend} sending={send.isPending} />
    </div>
  );
}

export function MessagesView() {
  const c = new URLSearchParams(useSearch()).get("c");
  if (c === "channel") return <ChannelThread />;
  if (c === "new") return <NewConversationPicker />;
  if (c?.startsWith("dm-")) return <DmThread otherUserId={c.slice(3)} />;
  return <MessagesList />;
}
