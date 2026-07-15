import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, Users, Eye, ArrowLeft, Check, CheckCheck, Pencil, Trash2, User, Building2, Receipt, X, ExternalLink, FileText, Image, FileCheck, Paperclip, Hash, CornerUpLeft, Search, Zap, ChevronUp, Loader2, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { notifyMessagesRead } from "@/lib/message-events";
import { useSubscription } from "@/contexts/subscription";
import { useToast } from "@/hooks/use-toast";

type Conversation = {
  otherId: string;
  otherName: string;
  otherRole: string;
  lastMessage: string;
  lastAt: string;
  unread: number;
};

type InvoiceAttachment = {
  id: string;
  counterpartyName: string;
  amount: string;
  currency: string;
  dueDate: string;
  status: string;
  reference?: string | null;
  attachmentUrl?: string | null;
  direction: string;
};

type DocAttachment = { id: string; name: string; type: string; fileUrl: string; status: string; version: number };
type PhotoAttachment = { id: string; photoUrl?: string | null; category: string; description?: string | null; referenceNumber: string; zone?: string | null };
type PermitAttachment = { id: string; type: string; description: string; expiryDate: string; documentUrl?: string | null };

type Reaction = { emoji: string; count: number; mine: boolean };
type ReplyTo = { id: string; senderName: string; content: string; attachmentType?: string | null };
type DmSearchResult = { id: string; content: string; senderName: string; otherId: string; otherName: string; createdAt: string; mine: boolean };
type ChannelSearchResult = { id: string; content: string; senderName: string; projectId: string; projectName: string; createdAt: string; mine: boolean };

type Message = {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  content: string;
  invoiceId?: string | null;
  invoice?: InvoiceAttachment | null;
  attachmentType?: "document" | "photo" | "permit" | null;
  attachmentId?: string | null;
  attachment?: DocAttachment | PhotoAttachment | PermitAttachment | null;
  reactions?: Reaction[];
  replyToId?: string | null;
  replyTo?: ReplyTo | null;
  readAt: string | null;
  editedAt: string | null;
  createdAt: string;
  mine: boolean;
};

type TeamUser = {
  id: string;
  name: string;
  role: string;
  email: string;
};

type Channel = {
  projectId: string;
  projectName: string;
  lastMessage: string;
  lastAt: string | null;
  unread: number;
};

type ChannelMessage = {
  id: string;
  projectId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  content: string;
  attachmentType?: "document" | "photo" | "permit" | null;
  attachmentId?: string | null;
  attachment?: DocAttachment | PhotoAttachment | PermitAttachment | null;
  reactions?: Reaction[];
  replyToId?: string | null;
  replyTo?: ReplyTo | null;
  editedAt: string | null;
  createdAt: string;
  mine: boolean;
};

const QUICK_REPLIES: { category: string; items: string[] }[] = [
  { category: "Acknowledge", items: ["Got it, thanks ✓", "Received ✓", "Will do", "On it"] },
  { category: "Status", items: ["On my way", "On site now", "Leaving site now", "Job complete ✓", "Running ~10 mins late"] },
  { category: "Requests", items: ["Need more supplies", "Call me when you can", "Can you clarify?", "Need assistance here"] },
  { category: "Safety", items: ["Area is clear ✓", "Hazard identified – please advise", "All PPE in use", "Permit checked ✓"] },
];

const ROLE_COLOURS: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700",
  project_manager: "bg-blue-100 text-blue-700",
  site_worker: "bg-emerald-100 text-emerald-700",
  subcontractor: "bg-orange-100 text-orange-700",
};

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("sitesort_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Full, unambiguous date + time for the message tooltip / audit trail.
function fullTimestamp(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Plain-text preview of a message for saving into a contact's notes.
function messageText(m: { content?: string | null; invoice?: unknown; attachmentType?: string | null }): string {
  if (m.content && m.content.trim()) return m.content.trim();
  if (m.invoice) return "[Invoice]";
  if (m.attachmentType === "document") return "[Document]";
  if (m.attachmentType === "photo") return "[Photo]";
  if (m.attachmentType === "permit") return "[Permit]";
  return "";
}

function getCurrentUser(): { id: string; role: string; name: string } | null {
  try {
    const token = localStorage.getItem("sitesort_token");
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return { id: payload.id, role: payload.role, name: payload.name ?? "" };
  } catch { return null; }
}

export default function MessagesPage() {
  const { isCancelled } = useSubscription();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const me = getCurrentUser();
  const isManager = me?.role === "admin" || me?.role === "project_manager";

  const [viewAll, setViewAll] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [thread, setThread] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingTo, setPendingTo] = useState<string | null>(null);

  // Project channel state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [channelThread, setChannelThread] = useState<ChannelMessage[]>([]);
  const [loadingChannelThread, setLoadingChannelThread] = useState(false);
  const channelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  type BroadcastMode = "individual" | "role" | "project";
  type BroadcastMember = { userId: string; name: string; role: string };
  const [broadcastMode, setBroadcastMode] = useState<BroadcastMode>("individual");
  const [broadcastProjects, setBroadcastProjects] = useState<{ id: string; name: string }[]>([]);
  const [broadcastProjectId, setBroadcastProjectId] = useState("");
  const [broadcastMembers, setBroadcastMembers] = useState<BroadcastMember[]>([]);
  const [broadcastRole, setBroadcastRole] = useState("all");
  const [broadcastContent, setBroadcastContent] = useState("");
  const [broadcastSending, setBroadcastSending] = useState(false);

  // Invoice attachment state
  const [invoicePickerOpen, setInvoicePickerOpen] = useState(false);
  const [pickerInvoices, setPickerInvoices] = useState<InvoiceAttachment[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [attachedInvoice, setAttachedInvoice] = useState<InvoiceAttachment | null>(null);

  // Doc/photo/permit attachment state
  type AttachTab = "document" | "photo" | "permit";
  const [attachPickerOpen, setAttachPickerOpen] = useState(false);
  const [attachTab, setAttachTab] = useState<AttachTab>("document");
  const [attachPickerProjects, setAttachPickerProjects] = useState<{ id: string; name: string }[]>([]);
  const [attachPickerProjectId, setAttachPickerProjectId] = useState("");
  const [attachPickerItems, setAttachPickerItems] = useState<(DocAttachment | PhotoAttachment | PermitAttachment)[]>([]);
  const [attachPickerLoading, setAttachPickerLoading] = useState(false);
  const [attachedItem, setAttachedItem] = useState<{ type: AttachTab; data: DocAttachment | PhotoAttachment | PermitAttachment } | null>(null);
  const [emojiPickerId, setEmojiPickerId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ReplyTo | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDms, setSearchDms] = useState<DmSearchResult[]>([]);
  const [searchChannels, setSearchChannels] = useState<ChannelSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const unreadDeepLinkRef = useRef(false);

  // Deep-link ?filter=unread (e.g. from the dashboard "Unread Messages" card):
  // once threads load, open the first conversation/channel that has unread messages.
  useEffect(() => {
    if (unreadDeepLinkRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("filter") !== "unread") { unreadDeepLinkRef.current = true; return; }
    if (conversations.length === 0 && channels.length === 0) return; // wait for first load
    unreadDeepLinkRef.current = true;
    window.history.replaceState({}, "", "/messages");
    const unreadConv = conversations.find(c => c.unread > 0);
    const unreadChan = channels.find(ch => ch.unread > 0);
    if (unreadConv) { setActiveConv(unreadConv); setActiveChannel(null); }
    else if (unreadChan) { setActiveChannel(unreadChan); setActiveConv(null); }
  }, [conversations, channels]);

  // Pagination state
  const [dmHasMore, setDmHasMore] = useState(false);
  const [channelHasMore, setChannelHasMore] = useState(false);
  const [loadingOlderDm, setLoadingOlderDm] = useState(false);
  const [loadingOlderChannel, setLoadingOlderChannel] = useState(false);

  const threadEndRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const channelScrollRef = useRef<HTMLDivElement>(null);
  // Scroll anchor: records pre-prepend scrollHeight so we can restore position
  const scrollAnchorRef = useRef<number | null>(null);
  const channelScrollAnchorRef = useRef<number | null>(null);
  // Flag to suppress scroll-to-bottom during load-older
  const skipScrollRef = useRef(false);
  // Refs to current thread data for poll callbacks
  const threadRef = useRef<Message[]>([]);
  const channelThreadRef = useRef<ChannelMessage[]>([]);
  const activeConvRef = useRef<Conversation | null>(null);
  const activeChannelRef = useRef<Channel | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchConversations = useCallback(async () => {
    const r = await fetch(`/api/messages/conversations${viewAll ? "?all=true" : ""}`, { headers: authHeaders() });
    if (r.ok) setConversations(await r.json());
  }, [viewAll]);

  const fetchThread = useCallback(async (conv: Conversation) => {
    setLoadingThread(true);
    const params = viewAll ? "?all=true" : "";
    const r = await fetch(`/api/messages/thread/${conv.otherId}${params}`, { headers: authHeaders() });
    if (r.ok) {
      const data = await r.json();
      setThread(data.messages ?? data);
      setDmHasMore(data.hasMore ?? false);
      // The thread GET marks this conversation's messages read server-side.
      // Reflect that immediately so both counts update together without a
      // refresh: clear this conversation's unread pill locally (mirrors what
      // fetchChannelThread already does for channels) and tell the sidebar to
      // re-fetch its badge. Skipped in viewAll (oversight) mode, which never
      // marks messages read.
      if (!viewAll) {
        setConversations(prev => prev.map(c => c.otherId === conv.otherId ? { ...c, unread: 0 } : c));
        notifyMessagesRead();
      }
    }
    setLoadingThread(false);
  }, [viewAll]);

  const fetchChannels = useCallback(async () => {
    const r = await fetch("/api/channels", { headers: authHeaders() });
    if (r.ok) setChannels(await r.json());
  }, []);

  const fetchChannelThread = useCallback(async (ch: Channel) => {
    setLoadingChannelThread(true);
    const r = await fetch(`/api/channels/${ch.projectId}/messages`, { headers: authHeaders() });
    if (r.ok) {
      const data = await r.json();
      setChannelThread(data.messages ?? data);
      setChannelHasMore(data.hasMore ?? false);
      setChannels(prev => prev.map(c => c.projectId === ch.projectId ? { ...c, unread: 0 } : c));
    }
    setLoadingChannelThread(false);
  }, []);

  const loadOlderDm = useCallback(async () => {
    if (!activeConv || !dmHasMore || loadingOlderDm) return;
    const firstId = threadRef.current[0]?.id;
    if (!firstId) return;
    setLoadingOlderDm(true);
    const container = threadScrollRef.current;
    if (container) scrollAnchorRef.current = container.scrollHeight;
    skipScrollRef.current = true;
    const params = new URLSearchParams({ before: firstId });
    if (viewAll) params.set("all", "true");
    const r = await fetch(`/api/messages/thread/${activeConv.otherId}?${params}`, { headers: authHeaders() });
    if (r.ok) {
      const data = await r.json();
      setThread(prev => [...(data.messages ?? []), ...prev]);
      setDmHasMore(data.hasMore ?? false);
    }
    setLoadingOlderDm(false);
  }, [activeConv, dmHasMore, loadingOlderDm, viewAll]);

  const loadOlderChannel = useCallback(async () => {
    if (!activeChannel || !channelHasMore || loadingOlderChannel) return;
    const firstId = channelThreadRef.current[0]?.id;
    if (!firstId) return;
    setLoadingOlderChannel(true);
    const container = channelScrollRef.current;
    if (container) channelScrollAnchorRef.current = container.scrollHeight;
    skipScrollRef.current = true;
    const r = await fetch(`/api/channels/${activeChannel.projectId}/messages?before=${firstId}`, { headers: authHeaders() });
    if (r.ok) {
      const data = await r.json();
      setChannelThread(prev => [...(data.messages ?? []), ...prev]);
      setChannelHasMore(data.hasMore ?? false);
    }
    setLoadingOlderChannel(false);
  }, [activeChannel, channelHasMore, loadingOlderChannel]);

  useEffect(() => {
    fetchConversations();
    fetchChannels();
  }, [fetchConversations, fetchChannels]);

  // Keep refs in sync so poll callbacks always have current data
  useEffect(() => { threadRef.current = thread; }, [thread]);
  useEffect(() => { channelThreadRef.current = channelThread; }, [channelThread]);
  useEffect(() => { activeConvRef.current = activeConv; }, [activeConv]);
  useEffect(() => { activeChannelRef.current = activeChannel; }, [activeChannel]);

  useEffect(() => {
    if (!activeConv) return;
    setThread([]);
    setDmHasMore(false);
    fetchThread(activeConv);

    pollRef.current = setInterval(async () => {
      const conv = activeConvRef.current;
      if (!conv) return;
      const lastId = threadRef.current[threadRef.current.length - 1]?.id;
      if (!lastId) return;
      const params = new URLSearchParams({ after: lastId });
      if (viewAll) params.set("all", "true");
      const r = await fetch(`/api/messages/thread/${conv.otherId}?${params}`, { headers: authHeaders() });
      if (r.ok) {
        const data = await r.json();
        const newMsgs: Message[] = data.messages ?? [];
        const receipts: { id: string; readAt: string }[] = data.readUpdates ?? [];
        setThread(prev => {
          // Apply new messages
          const existingIds = new Set(prev.map(m => m.id));
          const fresh = newMsgs.filter(m => !existingIds.has(m.id));
          // Apply read receipt updates to existing messages
          const receiptMap = new Map(receipts.map(r => [r.id, r.readAt]));
          const updated = (fresh.length > 0 ? [...prev, ...fresh] : prev).map(m =>
            (!m.readAt && receiptMap.has(m.id)) ? { ...m, readAt: receiptMap.get(m.id)! } : m
          );
          return updated;
        });
      }
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeConv, fetchThread, viewAll]);

  useEffect(() => {
    if (!activeChannel) return;
    setChannelThread([]);
    setChannelHasMore(false);
    fetchChannelThread(activeChannel);

    channelPollRef.current = setInterval(async () => {
      const ch = activeChannelRef.current;
      if (!ch) return;
      const lastId = channelThreadRef.current[channelThreadRef.current.length - 1]?.id;
      if (!lastId) return;
      const r = await fetch(`/api/channels/${ch.projectId}/messages?after=${lastId}`, { headers: authHeaders() });
      if (r.ok) {
        const data = await r.json();
        const newMsgs: ChannelMessage[] = data.messages ?? [];
        if (newMsgs.length > 0) {
          setChannelThread(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const fresh = newMsgs.filter(m => !existingIds.has(m.id));
            if (fresh.length > 0) {
              setChannels(c => c.map(ch2 => ch2.projectId === ch.projectId ? { ...ch2, unread: 0 } : ch2));
              return [...prev, ...fresh];
            }
            return prev;
          });
        }
      }
    }, 5000);
    return () => { if (channelPollRef.current) clearInterval(channelPollRef.current); };
  }, [activeChannel, fetchChannelThread]);

  // Scroll to bottom on new messages (suppressed during load-older)
  useEffect(() => {
    if (skipScrollRef.current) { skipScrollRef.current = false; return; }
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread, channelThread]);

  // Restore scroll position after prepending older messages
  useLayoutEffect(() => {
    if (scrollAnchorRef.current !== null && threadScrollRef.current) {
      threadScrollRef.current.scrollTop = threadScrollRef.current.scrollHeight - scrollAnchorRef.current;
      scrollAnchorRef.current = null;
    }
  }, [thread]);

  useLayoutEffect(() => {
    if (channelScrollAnchorRef.current !== null && channelScrollRef.current) {
      channelScrollRef.current.scrollTop = channelScrollRef.current.scrollHeight - channelScrollAnchorRef.current;
      channelScrollAnchorRef.current = null;
    }
  }, [channelThread]);

  useEffect(() => {
    fetch("/api/messages/users", { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setTeamUsers);
  }, []);

  // Debounced search
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchDms([]); setSearchChannels([]); return; }
    const t = setTimeout(async () => {
      setSearchLoading(true);
      const [dmRes, chRes] = await Promise.all([
        fetch(`/api/messages/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() }),
        fetch(`/api/channels/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() }),
      ]);
      if (dmRes.ok) setSearchDms(await dmRes.json());
      if (chRes.ok) setSearchChannels(await chRes.json());
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Handle URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      window.history.replaceState({}, "", "/messages");
      setNewChatOpen(true);
    } else if (params.get("to")) {
      window.history.replaceState({}, "", "/messages");
      setPendingTo(params.get("to")!.toLowerCase());
    }
  }, []);

  // Match pendingTo name once teamUsers loads
  useEffect(() => {
    if (!pendingTo || teamUsers.length === 0) return;
    const match = teamUsers.find(u => u.name.toLowerCase().includes(pendingTo));
    setPendingTo(null);
    if (match) {
      setNewChatOpen(false);
      setActiveConv({ otherId: match.id, otherName: match.name, otherRole: match.role, lastMessage: "", lastAt: new Date().toISOString(), unread: 0 });
      setThread([]);
    } else {
      setNewChatOpen(true);
    }
  }, [pendingTo, teamUsers]);

  async function sendMessage() {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if ((!draft.trim() && !attachedInvoice && !attachedItem) || !activeConv || sending || viewAll) return;
    setSending(true);
    const r = await fetch("/api/messages", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientId: activeConv.otherId,
        content: draft.trim(),
        ...(attachedInvoice ? { invoiceId: attachedInvoice.id } : {}),
        ...(attachedItem ? { attachmentType: attachedItem.type, attachmentId: attachedItem.data.id } : {}),
        ...(replyingTo ? { replyToId: replyingTo.id } : {}),
      }),
    });
    if (r.ok) {
      const msg = await r.json();
      setThread(prev => [...prev, { ...msg, senderName: me?.name ?? "Me", invoice: attachedInvoice, attachment: attachedItem?.data ?? null, replyTo: replyingTo }]);
      setDraft("");
      setAttachedInvoice(null);
      setAttachedItem(null);
      setReplyingTo(null);
      fetchConversations();
    }
    setSending(false);
  }

  async function sendChannelMessage() {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if ((!draft.trim() && !attachedItem) || !activeChannel || sending) return;
    setSending(true);
    const r = await fetch(`/api/channels/${activeChannel.projectId}/messages`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        content: draft.trim(),
        ...(attachedItem ? { attachmentType: attachedItem.type, attachmentId: attachedItem.data.id } : {}),
        ...(replyingTo ? { replyToId: replyingTo.id } : {}),
      }),
    });
    if (r.ok) {
      const msg = await r.json();
      setChannelThread(prev => [...prev, { ...msg, attachment: attachedItem?.data ?? null, replyTo: replyingTo }]);
      setDraft("");
      setAttachedItem(null);
      setReplyingTo(null);
      fetchChannels();
    }
    setSending(false);
  }

  async function saveChannelEdit(id: string) {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!editDraft.trim()) return;
    const r = await fetch(`/api/channel-messages/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ content: editDraft.trim() }),
    });
    if (r.ok) {
      const data = await r.json();
      setChannelThread(prev => prev.map(m => m.id === id ? { ...m, content: data.content, editedAt: data.editedAt } : m));
      setEditingId(null);
    }
  }

  async function deleteChannelMessage(id: string) {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    const r = await fetch(`/api/channel-messages/${id}`, { method: "DELETE", headers: authHeaders() });
    if (r.ok) {
      setChannelThread(prev => prev.filter(m => m.id !== id));
      setConfirmDeleteId(null);
    }
  }

  function startEdit(msg: Message) {
    setEditingId(msg.id);
    setEditDraft(msg.content);
    setConfirmDeleteId(null);
  }

  async function saveEdit(id: string) {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!editDraft.trim()) return;
    const r = await fetch(`/api/messages/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ content: editDraft.trim() }),
    });
    if (r.ok) {
      const data = await r.json();
      setThread(prev => prev.map(m => m.id === id ? { ...m, content: data.content, editedAt: data.editedAt } : m));
      setEditingId(null);
    }
  }

  async function deleteMessage(id: string) {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    const r = await fetch(`/api/messages/${id}`, { method: "DELETE", headers: authHeaders() });
    if (r.ok) {
      setThread(prev => prev.filter(m => m.id !== id));
      setConfirmDeleteId(null);
      fetchConversations();
    }
  }

  // Save a DM into the conversation partner's Notes & Reminders log (In-House Team).
  async function saveToNotes(msg: Message) {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!activeConv || viewAll) return;
    const text = messageText(msg);
    if (!text) { toast({ title: "Nothing to save", description: "This message has no text to copy into notes.", variant: "destructive" }); return; }
    const body = `${msg.senderName} · ${fullTimestamp(msg.createdAt)}\n${text}`;
    try {
      const r = await fetch(`/api/users/${activeConv.otherId}/notes`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (r.ok) {
        toast({ title: "Saved to notes", description: `Added to ${activeConv.otherName}'s Notes & Reminders.` });
      } else {
        toast({ title: "Couldn't save to notes", description: "Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Couldn't save to notes", description: "Please try again.", variant: "destructive" });
    }
  }

  // Fetch active projects when switching to role/project broadcast mode
  useEffect(() => {
    if ((broadcastMode === "role" || broadcastMode === "project") && broadcastProjects.length === 0) {
      fetch("/api/projects", { headers: authHeaders() })
        .then(r => r.ok ? r.json() : [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((all: any[]) => setBroadcastProjects(all.filter((p: any) => p.status === "active")));
    }
  }, [broadcastMode, broadcastProjects.length]);

  // Fetch project members when a project is selected
  useEffect(() => {
    if (!broadcastProjectId) { setBroadcastMembers([]); return; }
    fetch(`/api/projects/${broadcastProjectId}/members`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((members: any[]) => setBroadcastMembers(
        members
          .filter((m: any) => m.userId && m.userId !== me?.id)
          .map((m: any) => ({ userId: m.userId, name: m.name, role: m.role }))
      ));
  }, [broadcastProjectId, me?.id]);

  const broadcastRecipients: BroadcastMember[] =
    broadcastMode === "project"
      ? broadcastMembers
      : broadcastMembers.filter(m => broadcastRole === "all" || m.role === broadcastRole);

  function resetBroadcast() {
    setBroadcastMode("individual");
    setBroadcastProjectId("");
    setBroadcastMembers([]);
    setBroadcastRole("all");
    setBroadcastContent("");
  }

  async function openInvoicePicker() {
    setInvoicePickerOpen(true);
    if (pickerInvoices.length > 0) return;
    setPickerLoading(true);
    const r = await fetch("/api/invoices", { headers: authHeaders() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (r.ok) setPickerInvoices(await r.json() as any[]);
    setPickerLoading(false);
  }

  function openAttachPicker() {
    setAttachPickerOpen(true);
    setInvoicePickerOpen(false);
    if (attachPickerProjects.length === 0) {
      fetch("/api/projects", { headers: authHeaders() })
        .then(r => r.ok ? r.json() : [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((all: any[]) => setAttachPickerProjects(all.filter((p: any) => p.status === "active")));
    }
  }

  // Fetch items when project or tab changes in attach picker
  useEffect(() => {
    if (!attachPickerOpen || !attachPickerProjectId) { setAttachPickerItems([]); return; }
    setAttachPickerLoading(true);
    const endpoint = attachTab === "document" ? "documents" : attachTab === "photo" ? "photos" : "permits";
    fetch(`/api/projects/${attachPickerProjectId}/${endpoint}`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((items: any[]) => setAttachPickerItems(items))
      .finally(() => setAttachPickerLoading(false));
  }, [attachPickerOpen, attachPickerProjectId, attachTab]);

  async function sendBroadcast() {
    if (isCancelled) { toast({ title: "Subscription cancelled", description: "Renew your plan to continue.", variant: "destructive" }); return; }
    if (!broadcastContent.trim() || broadcastRecipients.length === 0 || broadcastSending) return;
    setBroadcastSending(true);
    const r = await fetch("/api/messages/broadcast", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ recipientIds: broadcastRecipients.map(m => m.userId), content: broadcastContent.trim() }),
    });
    if (r.ok) {
      const { sent } = await r.json();
      toast({ title: `Message sent to ${sent} team member${sent !== 1 ? "s" : ""}` });
      setBroadcastContent("");
      setNewChatOpen(false);
      resetBroadcast();
      fetchConversations();
    }
    setBroadcastSending(false);
  }

  const EMOJI_SET = ["👍", "✅", "👀", "❤️", "😂"];

  async function toggleReaction(messageId: string, emoji: string) {
    const r = await fetch(`/api/messages/${messageId}/react`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    if (r.ok) {
      const reactions: Reaction[] = await r.json();
      setThread(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
    }
    setEmojiPickerId(null);
  }

  async function toggleChannelReaction(messageId: string, emoji: string) {
    const r = await fetch(`/api/channel-messages/${messageId}/react`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });
    if (r.ok) {
      const reactions: Reaction[] = await r.json();
      setChannelThread(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
    }
    setEmojiPickerId(null);
  }

  async function startNewChat(user: TeamUser) {
    setNewChatOpen(false);
    const conv: Conversation = {
      otherId: user.id,
      otherName: user.name,
      otherRole: user.role,
      lastMessage: "",
      lastAt: new Date().toISOString(),
      unread: 0,
    };
    setActiveConv(conv);
    setThread([]);
  }

  return (
    <SidebarLayout>
      <div className="flex flex-col h-[calc(100vh-6rem)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold">Messages</h1>
            <p className="text-muted-foreground text-sm">Direct messages between team members.</p>
          </div>
          {isManager && (
            <Button
              variant={viewAll ? "default" : "outline"}
              size="sm"
              onClick={() => { setViewAll(v => !v); setActiveConv(null); setThread([]); }}
              className="gap-2"
            >
              <Eye className="w-4 h-4" />
              {viewAll ? "All Conversations" : "View All"}
            </Button>
          )}
        </div>

        <div className="flex flex-1 gap-4 min-h-0">
          {/* Conversation list */}
          <div className={cn(
            "flex flex-col border rounded-2xl overflow-hidden bg-card",
            (activeConv || activeChannel) ? "hidden sm:flex w-72 shrink-0" : "flex-1 sm:w-72 sm:flex-none sm:shrink-0"
          )}>
            <div className="p-3 border-b bg-muted/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">
                  {viewAll ? "All Company Chats" : "Conversations"}
                </span>
                {!viewAll && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => setNewChatOpen(true)}>
                    <Users className="w-3.5 h-3.5" /> New
                  </Button>
                )}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search messages…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* New chat picker */}
            {newChatOpen && !viewAll && (
              <div className="border-b p-3 bg-muted/20 space-y-2">
                {/* Mode selector */}
                <div className="flex gap-1">
                  {([
                    { id: "individual", label: "Individual", Icon: User },
                    { id: "role", label: "By Role", Icon: Users },
                    { id: "project", label: "All in Project", Icon: Building2 },
                  ] as { id: BroadcastMode; label: string; Icon: React.ElementType }[]).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      onClick={() => { setBroadcastMode(id); setBroadcastProjectId(""); setBroadcastRole("all"); setBroadcastContent(""); }}
                      className={cn(
                        "flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[10px] font-semibold transition-colors",
                        broadcastMode === id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                {/* Individual: existing user list */}
                {broadcastMode === "individual" && (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {teamUsers.map(u => (
                      <button key={u.id} onClick={() => { startNewChat(u); resetBroadcast(); }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                          {u.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold leading-none">{u.name}</p>
                          <p className="text-[10px] text-muted-foreground capitalize mt-0.5">{u.role.replace(/_/g, " ")}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Role / All in Project: project picker + compose */}
                {(broadcastMode === "role" || broadcastMode === "project") && (
                  <div className="space-y-2">
                    <select
                      value={broadcastProjectId}
                      onChange={e => { setBroadcastProjectId(e.target.value); setBroadcastRole("all"); }}
                      className="w-full text-xs rounded-lg border px-2 py-1.5 bg-background"
                    >
                      <option value="">Select project…</option>
                      {broadcastProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>

                    {/* Role filter chips (role mode only) */}
                    {broadcastMode === "role" && broadcastProjectId && (
                      <div className="flex flex-wrap gap-1">
                        {(["all", "admin", "project_manager", "site_worker", "subcontractor"] as const).map(r => {
                          const count = r === "all" ? broadcastMembers.length : broadcastMembers.filter(m => m.role === r).length;
                          if (r !== "all" && count === 0) return null;
                          return (
                            <button
                              key={r}
                              onClick={() => setBroadcastRole(r)}
                              className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors capitalize",
                                broadcastRole === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                              )}
                            >
                              {r === "all" ? "All" : r.replace(/_/g, " ")} ({count})
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Member preview */}
                    {broadcastProjectId && broadcastRecipients.length > 0 && (
                      <div className="max-h-20 overflow-y-auto space-y-0.5 bg-muted/30 rounded-lg px-2 py-1">
                        {broadcastRecipients.slice(0, 6).map(m => (
                          <div key={m.userId} className="flex items-center gap-1.5 text-xs text-muted-foreground py-0.5">
                            <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary shrink-0">
                              {m.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                            </div>
                            {m.name}
                          </div>
                        ))}
                        {broadcastRecipients.length > 6 && (
                          <p className="text-[10px] text-muted-foreground">+{broadcastRecipients.length - 6} more</p>
                        )}
                      </div>
                    )}
                    {broadcastProjectId && broadcastRecipients.length === 0 && (
                      <p className="text-[10px] text-muted-foreground">No team members with accounts in this project.</p>
                    )}

                    {/* Compose + send */}
                    {broadcastProjectId && broadcastRecipients.length > 0 && (
                      <>
                        <textarea
                          value={broadcastContent}
                          onChange={e => setBroadcastContent(e.target.value)}
                          placeholder="Type your message…"
                          rows={2}
                          className="w-full text-xs rounded-lg border px-2 py-1.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <Button
                          size="sm"
                          className="w-full h-7 text-xs gap-1"
                          disabled={!broadcastContent.trim() || broadcastSending}
                          onClick={sendBroadcast}
                        >
                          <Send className="w-3 h-3" />
                          {broadcastSending ? "Sending…" : `Send to ${broadcastRecipients.length} member${broadcastRecipients.length !== 1 ? "s" : ""}`}
                        </Button>
                      </>
                    )}
                  </div>
                )}

                <Button size="sm" variant="ghost" className="w-full h-7 text-xs" onClick={() => { setNewChatOpen(false); resetBroadcast(); }}>
                  Cancel
                </Button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto divide-y">
              {/* Search results */}
              {searchQuery.trim().length >= 2 ? (
                searchLoading ? (
                  <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">Searching…</div>
                ) : searchDms.length === 0 && searchChannels.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                    <Search className="w-6 h-6 opacity-30" />
                    <p className="text-xs">No messages found</p>
                  </div>
                ) : (
                  <>
                    {searchDms.length > 0 && (
                      <>
                        <div className="px-4 py-2 bg-muted/20 flex items-center gap-1.5">
                          <MessageSquare className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Direct Messages</span>
                        </div>
                        {searchDms.map(r => {
                          const q = searchQuery.trim();
                          const idx = r.content.toLowerCase().indexOf(q.toLowerCase());
                          const snippet = idx === -1 ? r.content : r.content.slice(Math.max(0, idx - 20), idx + q.length + 40);
                          const pre = snippet.slice(0, Math.max(0, idx - Math.max(0, idx - 20)));
                          const match = snippet.slice(Math.max(0, idx - Math.max(0, idx - 20)), Math.max(0, idx - Math.max(0, idx - 20)) + q.length);
                          const post = snippet.slice(Math.max(0, idx - Math.max(0, idx - 20)) + q.length);
                          return (
                            <button
                              key={r.id}
                              onClick={() => {
                                setSearchQuery("");
                                const conv: Conversation = { otherId: r.otherId, otherName: r.otherName, otherRole: "", lastMessage: r.content, lastAt: r.createdAt, unread: 0 };
                                setActiveConv(conv);
                                setActiveChannel(null);
                                setDmHasMore(false);
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors"
                            >
                              <div className="flex items-center gap-2 mb-0.5">
                                <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-[8px] font-bold text-primary shrink-0">
                                  {r.otherName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                                </div>
                                <span className="text-xs font-semibold truncate">{r.otherName}</span>
                                <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{timeLabel(r.createdAt)}</span>
                              </div>
                              <p className="text-[11px] text-muted-foreground pl-7 truncate">
                                {r.mine && <span className="text-primary/60 mr-1">You:</span>}
                                {pre}<span className="bg-yellow-200 text-yellow-900 rounded px-0.5">{match}</span>{post}
                              </p>
                            </button>
                          );
                        })}
                      </>
                    )}
                    {searchChannels.length > 0 && (
                      <>
                        <div className="px-4 py-2 bg-muted/20 flex items-center gap-1.5">
                          <Hash className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Channel Messages</span>
                        </div>
                        {searchChannels.map(r => {
                          const q = searchQuery.trim();
                          const idx = r.content.toLowerCase().indexOf(q.toLowerCase());
                          const start = Math.max(0, idx - 20);
                          const snippet = r.content.slice(start, idx + q.length + 40);
                          const pre = r.content.slice(start, idx);
                          const match = r.content.slice(idx, idx + q.length);
                          const post = r.content.slice(idx + q.length, idx + q.length + 40);
                          return (
                            <button
                              key={r.id}
                              onClick={() => {
                                setSearchQuery("");
                                const ch = channels.find(c => c.projectId === r.projectId) ?? { projectId: r.projectId, projectName: r.projectName, lastMessage: "", lastAt: null, unread: 0 };
                                setActiveChannel(ch);
                                setActiveConv(null);
                                setChannelHasMore(false);
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors"
                            >
                              <div className="flex items-center gap-2 mb-0.5">
                                <div className="w-5 h-5 rounded bg-blue-500/10 flex items-center justify-center shrink-0">
                                  <Hash className="w-3 h-3 text-blue-500" />
                                </div>
                                <span className="text-xs font-semibold truncate">#{r.projectName}</span>
                                <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{timeLabel(r.createdAt)}</span>
                              </div>
                              <p className="text-[11px] text-muted-foreground pl-7 truncate">
                                <span className="text-foreground/60 mr-1">{r.senderName}:</span>
                                {pre}<span className="bg-yellow-200 text-yellow-900 rounded px-0.5">{match}</span>{post}
                              </p>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </>
                )
              ) : null}

              {/* Project channels */}
              {!searchQuery && !viewAll && channels.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-muted/20 flex items-center gap-1.5">
                    <Hash className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Project Channels</span>
                  </div>
                  {channels.map(ch => (
                    <button key={ch.projectId} onClick={() => { setActiveChannel(ch); setActiveConv(null); setChannelHasMore(false); setQuickReplyOpen(false); }}
                      className={cn(
                        "w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors",
                        activeChannel?.projectId === ch.projectId && "bg-muted"
                      )}>
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                          <Hash className="w-4 h-4 text-blue-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <p className="font-semibold text-sm truncate">{ch.projectName}</p>
                            {ch.lastAt && <span className="text-[10px] text-muted-foreground shrink-0">{timeLabel(ch.lastAt)}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{ch.lastMessage || "No messages yet"}</p>
                        </div>
                        {ch.unread > 0 && (
                          <Badge className="bg-blue-500 text-white text-[10px] h-4 min-w-4 px-1 shrink-0">{ch.unread}</Badge>
                        )}
                      </div>
                    </button>
                  ))}
                  <div className="px-4 py-2 bg-muted/20 flex items-center gap-1.5">
                    <MessageSquare className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Direct Messages</span>
                  </div>
                </>
              )}

              {!searchQuery && conversations.length === 0 && channels.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">{viewAll ? "No messages yet." : "No conversations yet."}</p>
                </div>
              ) : !searchQuery && conversations.length === 0 && !viewAll ? (
                <div className="px-4 py-3 text-xs text-muted-foreground">No direct messages yet.</div>
              ) : !searchQuery ? (
                conversations.map(conv => (
                  <button key={conv.otherId} onClick={() => { setActiveConv(conv); setQuickReplyOpen(false); }}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors",
                      activeConv?.otherId === conv.otherId && "bg-muted"
                    )}>
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                        {conv.otherName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="font-semibold text-sm truncate">{conv.otherName}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0">{timeLabel(conv.lastAt)}</span>
                        </div>
                        {conv.otherRole && (
                          <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-semibold capitalize", ROLE_COLOURS[conv.otherRole] ?? "bg-muted text-muted-foreground")}>
                            {conv.otherRole.replace(/_/g, " ")}
                          </span>
                        )}
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.lastMessage}</p>
                      </div>
                      {conv.unread > 0 && (
                        <Badge className="bg-primary text-primary-foreground text-[10px] h-4 min-w-4 px-1 shrink-0">{conv.unread}</Badge>
                      )}
                    </div>
                  </button>
                ))
              ) : null}
            </div>
          </div>

          {/* Thread panel */}
          {activeConv ? (
            <div className="flex flex-col flex-1 border rounded-2xl overflow-hidden bg-card min-w-0">
              {/* Thread header */}
              <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-3">
                <button className="sm:hidden mr-1 text-muted-foreground" onClick={() => setActiveConv(null)}>
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
                  {activeConv.otherName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate">{activeConv.otherName}</p>
                  {activeConv.otherRole && (
                    <p className="text-[10px] text-muted-foreground capitalize truncate">{activeConv.otherRole.replace(/_/g, " ")}</p>
                  )}
                </div>
                {viewAll && (
                  <Badge variant="outline" className="ml-auto text-[10px] text-orange-600 border-orange-300 bg-orange-50">
                    <Eye className="w-3 h-3 mr-1" /> Manager View
                  </Badge>
                )}
              </div>

              {/* Messages */}
              <div ref={threadScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Load older button */}
                {dmHasMore && !loadingThread && (
                  <div className="flex justify-center pb-2">
                    <button
                      onClick={loadOlderDm}
                      disabled={loadingOlderDm}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border rounded-full px-3 py-1 bg-muted/50 hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {loadingOlderDm ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronUp className="w-3 h-3" />}
                      Load older messages
                    </button>
                  </div>
                )}
                {loadingThread ? (
                  <div className="flex justify-center pt-8">
                    <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  </div>
                ) : thread.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                    <MessageSquare className="w-10 h-10 opacity-20" />
                    <p className="text-sm">No messages yet. Say hello!</p>
                  </div>
                ) : (
                  thread.map(msg => (
                    <div key={msg.id} className={cn("flex gap-2 group", msg.mine && !viewAll ? "flex-row-reverse" : "flex-row")}>
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary shrink-0 mt-1">
                        {msg.senderName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                      </div>
                      <div className={cn("max-w-[70%]", msg.mine && !viewAll ? "items-end" : "items-start", "flex flex-col gap-0.5")}>
                        {viewAll && (
                          <span className="text-[10px] text-muted-foreground px-1">{msg.senderName}</span>
                        )}
                        {editingId === msg.id ? (
                          <div className="flex flex-col gap-1 min-w-[180px]">
                            <input
                              value={editDraft}
                              onChange={e => setEditDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(msg.id); }
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              className="px-3 py-2 rounded-2xl text-sm bg-primary text-primary-foreground outline outline-2 outline-white/40 w-full"
                              autoFocus
                            />
                            <div className="flex gap-2 justify-end px-1">
                              <button onClick={() => setEditingId(null)} className="text-[10px] text-muted-foreground hover:text-foreground">Cancel</button>
                              <button onClick={() => saveEdit(msg.id)} className="text-[10px] text-primary font-semibold hover:underline">Save</button>
                            </div>
                          </div>
                        ) : confirmDeleteId === msg.id ? (
                          <div className="px-3 py-2 rounded-2xl text-sm bg-red-100 text-red-700 flex items-center gap-2">
                            <span>Delete this message?</span>
                            <button onClick={() => deleteMessage(msg.id)} className="font-semibold hover:underline">Yes</button>
                            <button onClick={() => setConfirmDeleteId(null)} className="text-muted-foreground hover:underline">No</button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {/* Reply quote */}
                            {msg.replyTo && (
                              <div className={cn(
                                "flex items-start gap-2 px-2.5 py-1.5 rounded-xl border-l-2 border-primary/50 text-xs bg-muted/60 max-w-full",
                                msg.mine && !viewAll ? "rounded-tr-sm" : "rounded-tl-sm"
                              )}>
                                <CornerUpLeft className="w-3 h-3 text-primary/60 shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                  <span className="font-semibold text-primary/80">{msg.replyTo.senderName}</span>
                                  <p className="text-muted-foreground truncate">
                                    {msg.replyTo.content || (msg.replyTo.attachmentType ? `[${msg.replyTo.attachmentType}]` : "[attachment]")}
                                  </p>
                                </div>
                              </div>
                            )}
                            {/* Invoice card */}
                            {msg.invoice && (
                              <div className={cn(
                                "rounded-2xl border text-xs overflow-hidden min-w-[220px]",
                                msg.mine && !viewAll ? "rounded-tr-sm border-primary/20 bg-primary/5" : "rounded-tl-sm border-border bg-card"
                              )}>
                                <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
                                  <Receipt className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                  <span className="font-semibold text-foreground">Invoice</span>
                                  <span className={cn("ml-auto px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize",
                                    msg.invoice.status === "paid" ? "bg-emerald-100 text-emerald-700" :
                                    msg.invoice.status === "overdue" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                                  )}>{msg.invoice.status}</span>
                                </div>
                                <div className="px-3 py-2 space-y-0.5">
                                  <p className="font-semibold text-foreground">{msg.invoice.counterpartyName}</p>
                                  <p className="text-muted-foreground">{msg.invoice.currency} {Number(msg.invoice.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}</p>
                                  {msg.invoice.reference && <p className="text-muted-foreground">Ref: {msg.invoice.reference}</p>}
                                  <p className="text-muted-foreground">Due: {new Date(msg.invoice.dueDate + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                                </div>
                                <div className="px-3 pb-2 flex items-center gap-3">
                                  <button
                                    onClick={() => { if (msg.invoice) navigate(`/invoices?invoice=${msg.invoice.id}`); }}
                                    className="inline-flex items-center gap-1 text-primary hover:underline text-[11px] font-medium"
                                  >
                                    <Eye className="w-3 h-3" /> Open invoice
                                  </button>
                                  {msg.invoice.attachmentUrl && (
                                    <button
                                      onClick={() => { const u = msg.invoice?.attachmentUrl?.replace(/^\/uploads\//, "/api/uploads/"); if (u) window.open(u, '_blank', 'noopener,noreferrer'); }}
                                      className="inline-flex items-center gap-1 text-primary hover:underline text-[11px] font-medium"
                                    >
                                      <ExternalLink className="w-3 h-3" /> View document
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                            {/* Document attachment card */}
                            {msg.attachmentType === "document" && msg.attachment && (() => {
                              const doc = msg.attachment as DocAttachment;
                              return (
                                <div className={cn(
                                  "rounded-2xl border text-xs overflow-hidden min-w-[220px]",
                                  msg.mine && !viewAll ? "rounded-tr-sm border-primary/20 bg-primary/5" : "rounded-tl-sm border-border bg-card"
                                )}>
                                  <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
                                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    <span className="font-semibold text-foreground">Document</span>
                                    <span className={cn("ml-auto px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize",
                                      doc.status === "current" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                                    )}>{doc.status}</span>
                                  </div>
                                  <div className="px-3 py-2 space-y-0.5">
                                    <p className="font-semibold text-foreground">{doc.name}</p>
                                    <p className="text-muted-foreground capitalize">{doc.type} · v{doc.version}</p>
                                    <button onClick={() => window.open(doc.fileUrl.replace(/^\/uploads\//, "/api/uploads/"), '_blank', 'noopener,noreferrer')}
                                      className="inline-flex items-center gap-1 text-primary hover:underline text-[11px] font-medium mt-1">
                                      <ExternalLink className="w-3 h-3" /> View document
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Photo attachment card */}
                            {msg.attachmentType === "photo" && msg.attachment && (() => {
                              const photo = msg.attachment as PhotoAttachment;
                              return (
                                <div className={cn(
                                  "rounded-2xl border text-xs overflow-hidden min-w-[220px] max-w-[260px]",
                                  msg.mine && !viewAll ? "rounded-tr-sm border-primary/20 bg-primary/5" : "rounded-tl-sm border-border bg-card"
                                )}>
                                  {photo.photoUrl && (
                                    <img
                                      src={photo.photoUrl.replace(/^\/uploads\//, "/api/uploads/")}
                                      alt={photo.description ?? photo.category}
                                      className="w-full aspect-video object-cover"
                                    />
                                  )}
                                  <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/40">
                                    <Image className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    <span className="font-semibold text-foreground capitalize">{photo.category}</span>
                                    <span className="ml-auto text-muted-foreground">{photo.referenceNumber}</span>
                                  </div>
                                  {(photo.description || photo.zone) && (
                                    <div className="px-3 py-2 space-y-0.5">
                                      {photo.description && <p className="text-foreground">{photo.description}</p>}
                                      {photo.zone && <p className="text-muted-foreground">Zone: {photo.zone}</p>}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Permit attachment card */}
                            {msg.attachmentType === "permit" && msg.attachment && (() => {
                              const permit = msg.attachment as PermitAttachment;
                              const expiry = new Date(permit.expiryDate + "T12:00:00");
                              const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / 86400000);
                              return (
                                <div className={cn(
                                  "rounded-2xl border text-xs overflow-hidden min-w-[220px]",
                                  msg.mine && !viewAll ? "rounded-tr-sm border-primary/20 bg-primary/5" : "rounded-tl-sm border-border bg-card"
                                )}>
                                  <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
                                    <FileCheck className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    <span className="font-semibold text-foreground">Permit</span>
                                    <span className={cn("ml-auto px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                      daysLeft < 0 ? "bg-red-100 text-red-700" : daysLeft <= 14 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                                    )}>{daysLeft < 0 ? "Expired" : daysLeft <= 14 ? "Expiring soon" : "Active"}</span>
                                  </div>
                                  <div className="px-3 py-2 space-y-0.5">
                                    <p className="font-semibold text-foreground capitalize">{permit.type}</p>
                                    <p className="text-muted-foreground">{permit.description}</p>
                                    <p className="text-muted-foreground">Expires: {expiry.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                                    {permit.documentUrl && (
                                      <button onClick={() => window.open(permit.documentUrl!.replace(/^\/uploads\//, "/api/uploads/"), '_blank', 'noopener,noreferrer')}
                                        className="inline-flex items-center gap-1 text-primary hover:underline text-[11px] font-medium mt-1">
                                        <ExternalLink className="w-3 h-3" /> View permit
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Text bubble (optional note alongside invoice, or standalone message) */}
                            {(msg.content || (!msg.invoice && !msg.attachmentType)) && (
                              <div className={cn(
                                "px-3 py-2 rounded-2xl text-sm leading-relaxed break-words",
                                msg.mine && !viewAll
                                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                                  : "bg-muted rounded-tl-sm"
                              )}>
                                {msg.content}
                                {msg.editedAt && <span className="text-[9px] opacity-50 ml-1.5">(edited)</span>}
                              </div>
                            )}
                          </div>
                        )}
                        {/* Reactions row */}
                        {((msg.reactions && msg.reactions.length > 0) || emojiPickerId === msg.id) && (
                          <div className={cn("flex flex-wrap gap-1 px-1", msg.mine && !viewAll ? "justify-end" : "justify-start")}>
                            {(msg.reactions ?? []).map(r => (
                              <button
                                key={r.emoji}
                                onClick={() => toggleReaction(msg.id, r.emoji)}
                                className={cn(
                                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors",
                                  r.mine ? "bg-primary/10 border-primary/30 text-primary font-semibold" : "bg-muted border-border text-muted-foreground hover:bg-muted/70"
                                )}
                              >
                                {r.emoji} {r.count}
                              </button>
                            ))}
                            {emojiPickerId === msg.id && (
                              <div className="flex gap-0.5 bg-card border rounded-full px-1.5 py-0.5 shadow-sm">
                                {EMOJI_SET.map(e => (
                                  <button key={e} onClick={() => toggleReaction(msg.id, e)} className="text-sm hover:scale-125 transition-transform px-0.5">
                                    {e}
                                  </button>
                                ))}
                                <button onClick={() => setEmojiPickerId(null)} className="text-muted-foreground hover:text-foreground text-xs px-1 ml-0.5">✕</button>
                              </div>
                            )}
                          </div>
                        )}
                        <div className={cn("flex items-center gap-1 px-1", msg.mine && !viewAll ? "flex-row-reverse" : "flex-row")}>
                          <span className="text-[10px] text-muted-foreground cursor-default" title={fullTimestamp(msg.createdAt)}>{timeLabel(msg.createdAt)}</span>
                          {msg.mine && !viewAll && (
                            msg.readAt
                              ? <CheckCheck className="w-3.5 h-3.5 text-primary" />
                              : <Check className="w-3.5 h-3.5 text-muted-foreground/40" />
                          )}
                          {!viewAll && editingId !== msg.id && confirmDeleteId !== msg.id && (
                            <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex gap-0.5">
                              <button
                                onClick={() => { setReplyingTo({ id: msg.id, senderName: msg.senderName, content: msg.content, attachmentType: msg.attachmentType }); setEmojiPickerId(null); }}
                                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                title="Reply"
                              ><CornerUpLeft className="w-3 h-3" /></button>
                              <button
                                onClick={() => setEmojiPickerId(id => id === msg.id ? null : msg.id)}
                                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground text-sm"
                                title="React"
                              >😊</button>
                              <button
                                onClick={() => saveToNotes(msg)}
                                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                title={`Save to ${activeConv?.otherName ?? "contact"}'s notes`}
                              ><StickyNote className="w-3 h-3" /></button>
                              {msg.mine && (
                                <>
                                  <button
                                    onClick={() => startEdit(msg)}
                                    className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                    title="Edit"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteId(msg.id)}
                                    className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-red-500"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Input */}
              {!viewAll ? (
                <div className="p-3 border-t bg-muted/20 space-y-2">
                  {/* Reply-to preview */}
                  {replyingTo && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-muted/60 border-l-2 border-primary/50 text-xs">
                      <CornerUpLeft className="w-3.5 h-3.5 text-primary/60 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-primary/80">{replyingTo.senderName}</span>
                        <p className="text-muted-foreground truncate">{replyingTo.content || (replyingTo.attachmentType ? `[${replyingTo.attachmentType}]` : "[attachment]")}</p>
                      </div>
                      <button onClick={() => setReplyingTo(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  {/* Attached invoice preview */}
                  {attachedInvoice && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-xs">
                      <Receipt className="w-4 h-4 text-blue-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-semibold text-blue-800">{attachedInvoice.counterpartyName}</span>
                        <span className="text-blue-600 ml-2">{attachedInvoice.currency} {Number(attachedInvoice.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
                        {attachedInvoice.reference && <span className="text-blue-500 ml-1">· {attachedInvoice.reference}</span>}
                      </div>
                      <button onClick={() => setAttachedInvoice(null)} className="text-blue-400 hover:text-blue-600 shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Attached doc/photo/permit preview */}
                  {attachedItem && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-50 border border-violet-200 text-xs">
                      {attachedItem.type === "document" && <FileText className="w-4 h-4 text-violet-600 shrink-0" />}
                      {attachedItem.type === "photo" && <Image className="w-4 h-4 text-violet-600 shrink-0" />}
                      {attachedItem.type === "permit" && <FileCheck className="w-4 h-4 text-violet-600 shrink-0" />}
                      <span className="flex-1 font-semibold text-violet-800 truncate">
                        {attachedItem.type === "document" && (attachedItem.data as DocAttachment).name}
                        {attachedItem.type === "photo" && `Photo · ${(attachedItem.data as PhotoAttachment).referenceNumber}`}
                        {attachedItem.type === "permit" && `Permit · ${(attachedItem.data as PermitAttachment).type}`}
                      </span>
                      <button onClick={() => setAttachedItem(null)} className="text-violet-400 hover:text-violet-600 shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Invoice picker dropdown */}
                  {invoicePickerOpen && (
                    <div className="rounded-xl border bg-card shadow-lg max-h-48 overflow-y-auto">
                      {pickerLoading ? (
                        <div className="p-3 text-xs text-muted-foreground text-center">Loading invoices…</div>
                      ) : pickerInvoices.length === 0 ? (
                        <div className="p-3 text-xs text-muted-foreground text-center">No invoices found.</div>
                      ) : (
                        pickerInvoices.map(inv => (
                          <button
                            key={inv.id}
                            onClick={() => { setAttachedInvoice(inv); setInvoicePickerOpen(false); }}
                            className="w-full text-left px-3 py-2 hover:bg-muted transition-colors text-xs flex items-center gap-2 border-b last:border-0"
                          >
                            <Receipt className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold truncate">{inv.counterpartyName}</p>
                              <p className="text-muted-foreground">{inv.currency} {Number(inv.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}{inv.reference ? ` · ${inv.reference}` : ""}</p>
                            </div>
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize shrink-0",
                              inv.status === "paid" ? "bg-emerald-100 text-emerald-700" :
                              inv.status === "overdue" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground"
                            )}>{inv.status}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {/* Doc/Photo/Permit picker */}
                  {attachPickerOpen && (
                    <div className="rounded-xl border bg-card shadow-lg overflow-hidden">
                      {/* Tabs */}
                      <div className="flex border-b">
                        {([
                          { id: "document" as const, label: "Document", Icon: FileText },
                          { id: "photo" as const, label: "Photo", Icon: Image },
                          { id: "permit" as const, label: "Permit", Icon: FileCheck },
                        ]).map(({ id, label, Icon }) => (
                          <button
                            key={id}
                            onClick={() => { setAttachTab(id); setAttachPickerItems([]); }}
                            className={cn(
                              "flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[11px] font-semibold border-b-2 transition-colors",
                              attachTab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                            )}
                          >
                            <Icon className="w-3 h-3" />{label}
                          </button>
                        ))}
                      </div>
                      {/* Project picker */}
                      <div className="px-3 pt-2 pb-1">
                        <select
                          value={attachPickerProjectId}
                          onChange={e => setAttachPickerProjectId(e.target.value)}
                          className="w-full text-xs rounded-lg border px-2 py-1.5 bg-background"
                        >
                          <option value="">Select project…</option>
                          {attachPickerProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      {/* Items list */}
                      <div className="max-h-40 overflow-y-auto">
                        {!attachPickerProjectId ? (
                          <div className="p-3 text-xs text-muted-foreground text-center">Select a project above.</div>
                        ) : attachPickerLoading ? (
                          <div className="p-3 text-xs text-muted-foreground text-center">Loading…</div>
                        ) : attachPickerItems.length === 0 ? (
                          <div className="p-3 text-xs text-muted-foreground text-center">No {attachTab}s found in this project.</div>
                        ) : attachTab === "document" ? (
                          (attachPickerItems as DocAttachment[]).map(doc => (
                            <button key={doc.id} onClick={() => { setAttachedItem({ type: "document", data: doc }); setAttachPickerOpen(false); setAttachPickerProjectId(""); }}
                              className="w-full text-left px-3 py-2 hover:bg-muted transition-colors text-xs flex items-center gap-2 border-b last:border-0">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold truncate">{doc.name}</p>
                                <p className="text-muted-foreground capitalize">{doc.type} · v{doc.version}</p>
                              </div>
                              <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize shrink-0",
                                doc.status === "current" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                              )}>{doc.status}</span>
                            </button>
                          ))
                        ) : attachTab === "photo" ? (
                          (attachPickerItems as PhotoAttachment[]).map(photo => (
                            <button key={photo.id} onClick={() => { setAttachedItem({ type: "photo", data: photo }); setAttachPickerOpen(false); setAttachPickerProjectId(""); }}
                              className="w-full text-left px-3 py-2 hover:bg-muted transition-colors text-xs flex items-center gap-2 border-b last:border-0">
                              {photo.photoUrl ? (
                                <img src={photo.photoUrl.replace(/^\/uploads\//, "/api/uploads/")} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                              ) : (
                                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0"><Image className="w-3 h-3 text-muted-foreground" /></div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold truncate capitalize">{photo.category}</p>
                                <p className="text-muted-foreground truncate">{photo.description ?? photo.referenceNumber}</p>
                              </div>
                            </button>
                          ))
                        ) : (
                          (attachPickerItems as PermitAttachment[]).map(permit => {
                            const daysLeft = Math.ceil((new Date(permit.expiryDate + "T12:00:00").getTime() - Date.now()) / 86400000);
                            return (
                              <button key={permit.id} onClick={() => { setAttachedItem({ type: "permit", data: permit }); setAttachPickerOpen(false); setAttachPickerProjectId(""); }}
                                className="w-full text-left px-3 py-2 hover:bg-muted transition-colors text-xs flex items-center gap-2 border-b last:border-0">
                                <FileCheck className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold truncate capitalize">{permit.type}</p>
                                  <p className="text-muted-foreground truncate">{permit.description}</p>
                                </div>
                                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0",
                                  daysLeft < 0 ? "bg-red-100 text-red-700" : daysLeft <= 14 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                                )}>{daysLeft < 0 ? "Expired" : "Active"}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                      <div className="px-3 pb-2 pt-1 border-t">
                        <button onClick={() => { setAttachPickerOpen(false); setAttachPickerProjectId(""); }} className="text-[10px] text-muted-foreground hover:text-foreground">Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Quick reply templates */}
                  {quickReplyOpen && (
                    <div className="rounded-xl border bg-card shadow-sm p-3 space-y-2 max-h-52 overflow-y-auto">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold flex items-center gap-1.5 text-amber-600"><Zap className="w-3.5 h-3.5" />Quick Replies</span>
                        <button onClick={() => setQuickReplyOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                      </div>
                      {QUICK_REPLIES.map(group => (
                        <div key={group.category}>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{group.category}</p>
                          <div className="flex flex-wrap gap-1">
                            {group.items.map(t => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => { setDraft(t); setQuickReplyOpen(false); }}
                                className="px-2.5 py-1 rounded-full border text-xs bg-muted/50 hover:bg-primary/10 hover:border-primary/40 hover:text-primary transition-colors text-left"
                              >{t}</button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <form onSubmit={e => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      title="Attach invoice"
                      className={cn("px-2 shrink-0", invoicePickerOpen && "text-blue-600 bg-blue-50")}
                      onClick={() => invoicePickerOpen ? setInvoicePickerOpen(false) : openInvoicePicker()}
                    >
                      <Receipt className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      title="Attach document, photo or permit"
                      className={cn("px-2 shrink-0", attachPickerOpen && "text-violet-600 bg-violet-50")}
                      onClick={() => attachPickerOpen ? setAttachPickerOpen(false) : openAttachPicker()}
                    >
                      <Paperclip className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      title="Quick replies"
                      className={cn("px-2 shrink-0", quickReplyOpen && "text-amber-500 bg-amber-50")}
                      onClick={() => { setQuickReplyOpen(v => !v); setInvoicePickerOpen(false); setAttachPickerOpen(false); }}
                    >
                      <Zap className="w-4 h-4" />
                    </Button>
                    <Input
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      placeholder={(attachedInvoice || attachedItem) ? "Add a note (optional)…" : "Type a message…"}
                      className="flex-1"
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    />
                    <Button type="submit" size="sm" disabled={(!draft.trim() && !attachedInvoice && !attachedItem) || sending} className="px-3">
                      <Send className="w-4 h-4" />
                    </Button>
                  </form>
                </div>
              ) : (
                <div className="p-3 border-t bg-muted/20 text-center">
                  <p className="text-xs text-muted-foreground">Read-only — manager view</p>
                </div>
              )}
            </div>
          ) : activeChannel ? (
            /* Channel thread panel */
            <div className="flex flex-col flex-1 border rounded-2xl overflow-hidden bg-card min-w-0">
              {/* Channel header */}
              <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-3">
                <button className="sm:hidden mr-1 text-muted-foreground" onClick={() => setActiveChannel(null)}>
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Hash className="w-4 h-4 text-blue-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate">{activeChannel.projectName}</p>
                  <p className="text-[10px] text-muted-foreground truncate">Project channel · all members</p>
                </div>
              </div>

              {/* Messages */}
              <div ref={channelScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Load older button */}
                {channelHasMore && !loadingChannelThread && (
                  <div className="flex justify-center pb-2">
                    <button
                      onClick={loadOlderChannel}
                      disabled={loadingOlderChannel}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border rounded-full px-3 py-1 bg-muted/50 hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {loadingOlderChannel ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronUp className="w-3 h-3" />}
                      Load older messages
                    </button>
                  </div>
                )}
                {loadingChannelThread ? (
                  <div className="flex justify-center pt-8">
                    <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  </div>
                ) : channelThread.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                    <Hash className="w-10 h-10 opacity-20" />
                    <p className="text-sm">No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  channelThread.map(msg => (
                    <div key={msg.id} className={cn("flex gap-2 group", msg.mine ? "flex-row-reverse" : "flex-row")}>
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary shrink-0 mt-1">
                        {msg.senderName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
                      </div>
                      <div className={cn("max-w-[70%] flex flex-col gap-0.5", msg.mine ? "items-end" : "items-start")}>
                        <span className="text-[10px] text-muted-foreground px-1">{msg.senderName}
                          {msg.senderRole && <span className={cn("ml-1.5 px-1 py-0.5 rounded text-[9px] font-semibold capitalize", ROLE_COLOURS[msg.senderRole] ?? "")}>{msg.senderRole.replace(/_/g, " ")}</span>}
                        </span>
                        {editingId === msg.id ? (
                          <div className="flex flex-col gap-1 min-w-[180px]">
                            <input value={editDraft} onChange={e => setEditDraft(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveChannelEdit(msg.id); } if (e.key === "Escape") setEditingId(null); }}
                              className="px-3 py-2 rounded-2xl text-sm bg-primary text-primary-foreground outline outline-2 outline-white/40 w-full" autoFocus />
                            <div className="flex gap-2 justify-end px-1">
                              <button onClick={() => setEditingId(null)} className="text-[10px] text-muted-foreground hover:text-foreground">Cancel</button>
                              <button onClick={() => saveChannelEdit(msg.id)} className="text-[10px] text-primary font-semibold hover:underline">Save</button>
                            </div>
                          </div>
                        ) : confirmDeleteId === msg.id ? (
                          <div className="px-3 py-2 rounded-2xl text-sm bg-red-100 text-red-700 flex items-center gap-2">
                            <span>Delete?</span>
                            <button onClick={() => deleteChannelMessage(msg.id)} className="font-semibold hover:underline">Yes</button>
                            <button onClick={() => setConfirmDeleteId(null)} className="text-muted-foreground hover:underline">No</button>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {/* Reply quote */}
                            {msg.replyTo && (
                              <div className={cn(
                                "flex items-start gap-2 px-2.5 py-1.5 rounded-xl border-l-2 border-primary/50 text-xs bg-muted/60 max-w-full",
                                msg.mine ? "rounded-tr-sm" : "rounded-tl-sm"
                              )}>
                                <CornerUpLeft className="w-3 h-3 text-primary/60 shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                  <span className="font-semibold text-primary/80">{msg.replyTo.senderName}</span>
                                  <p className="text-muted-foreground truncate">
                                    {msg.replyTo.content || (msg.replyTo.attachmentType ? `[${msg.replyTo.attachmentType}]` : "[attachment]")}
                                  </p>
                                </div>
                              </div>
                            )}
                            {/* Document card */}
                            {msg.attachmentType === "document" && msg.attachment && (() => {
                              const doc = msg.attachment as DocAttachment;
                              return (
                                <div className={cn("rounded-2xl border text-xs overflow-hidden min-w-[220px]", msg.mine ? "rounded-tr-sm border-primary/20 bg-primary/5" : "rounded-tl-sm border-border bg-card")}>
                                  <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
                                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" /><span className="font-semibold">Document</span>
                                    <span className={cn("ml-auto px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize", doc.status === "current" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{doc.status}</span>
                                  </div>
                                  <div className="px-3 py-2 space-y-0.5">
                                    <p className="font-semibold">{doc.name}</p>
                                    <p className="text-muted-foreground capitalize">{doc.type} · v{doc.version}</p>
                                    <button onClick={() => window.open(doc.fileUrl.replace(/^\/uploads\//, "/api/uploads/"), '_blank', 'noopener,noreferrer')} className="inline-flex items-center gap-1 text-primary hover:underline text-[11px] font-medium mt-1"><ExternalLink className="w-3 h-3" /> View</button>
                                  </div>
                                </div>
                              );
                            })()}
                            {/* Photo card */}
                            {msg.attachmentType === "photo" && msg.attachment && (() => {
                              const photo = msg.attachment as PhotoAttachment;
                              return (
                                <div className={cn("rounded-2xl border text-xs overflow-hidden min-w-[220px] max-w-[260px]", msg.mine ? "rounded-tr-sm border-primary/20 bg-primary/5" : "rounded-tl-sm border-border bg-card")}>
                                  {photo.photoUrl && <img src={photo.photoUrl.replace(/^\/uploads\//, "/api/uploads/")} alt={photo.category} className="w-full aspect-video object-cover" />}
                                  <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/40">
                                    <Image className="w-3.5 h-3.5 text-muted-foreground shrink-0" /><span className="font-semibold capitalize">{photo.category}</span>
                                    <span className="ml-auto text-muted-foreground">{photo.referenceNumber}</span>
                                  </div>
                                  {(photo.description || photo.zone) && (
                                    <div className="px-3 py-2 space-y-0.5">
                                      {photo.description && <p>{photo.description}</p>}
                                      {photo.zone && <p className="text-muted-foreground">Zone: {photo.zone}</p>}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                            {/* Permit card */}
                            {msg.attachmentType === "permit" && msg.attachment && (() => {
                              const permit = msg.attachment as PermitAttachment;
                              const daysLeft = Math.ceil((new Date(permit.expiryDate + "T12:00:00").getTime() - Date.now()) / 86400000);
                              return (
                                <div className={cn("rounded-2xl border text-xs overflow-hidden min-w-[220px]", msg.mine ? "rounded-tr-sm border-primary/20 bg-primary/5" : "rounded-tl-sm border-border bg-card")}>
                                  <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
                                    <FileCheck className="w-3.5 h-3.5 text-muted-foreground shrink-0" /><span className="font-semibold">Permit</span>
                                    <span className={cn("ml-auto px-1.5 py-0.5 rounded text-[10px] font-semibold", daysLeft < 0 ? "bg-red-100 text-red-700" : daysLeft <= 14 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>{daysLeft < 0 ? "Expired" : daysLeft <= 14 ? "Expiring soon" : "Active"}</span>
                                  </div>
                                  <div className="px-3 py-2 space-y-0.5">
                                    <p className="font-semibold capitalize">{permit.type}</p>
                                    <p className="text-muted-foreground">{permit.description}</p>
                                    <p className="text-muted-foreground">Expires: {new Date(permit.expiryDate + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                                    {permit.documentUrl && <button onClick={() => window.open(permit.documentUrl!.replace(/^\/uploads\//, "/api/uploads/"), '_blank', 'noopener,noreferrer')} className="inline-flex items-center gap-1 text-primary hover:underline text-[11px] font-medium mt-1"><ExternalLink className="w-3 h-3" /> View permit</button>}
                                  </div>
                                </div>
                              );
                            })()}
                            {(msg.content || !msg.attachmentType) && (
                              <div className={cn("px-3 py-2 rounded-2xl text-sm leading-relaxed break-words", msg.mine ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm")}>
                                {msg.content}{msg.editedAt && <span className="text-[9px] opacity-50 ml-1.5">(edited)</span>}
                              </div>
                            )}
                          </div>
                        )}
                        {/* Reactions row */}
                        {((msg.reactions && msg.reactions.length > 0) || emojiPickerId === msg.id) && (
                          <div className={cn("flex flex-wrap gap-1 px-1", msg.mine ? "justify-end" : "justify-start")}>
                            {(msg.reactions ?? []).map(r => (
                              <button
                                key={r.emoji}
                                onClick={() => toggleChannelReaction(msg.id, r.emoji)}
                                className={cn(
                                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors",
                                  r.mine ? "bg-primary/10 border-primary/30 text-primary font-semibold" : "bg-muted border-border text-muted-foreground hover:bg-muted/70"
                                )}
                              >
                                {r.emoji} {r.count}
                              </button>
                            ))}
                            {emojiPickerId === msg.id && (
                              <div className="flex gap-0.5 bg-card border rounded-full px-1.5 py-0.5 shadow-sm">
                                {EMOJI_SET.map(e => (
                                  <button key={e} onClick={() => toggleChannelReaction(msg.id, e)} className="text-sm hover:scale-125 transition-transform px-0.5">
                                    {e}
                                  </button>
                                ))}
                                <button onClick={() => setEmojiPickerId(null)} className="text-muted-foreground hover:text-foreground text-xs px-1 ml-0.5">✕</button>
                              </div>
                            )}
                          </div>
                        )}
                        <div className={cn("flex items-center gap-1 px-1", msg.mine ? "flex-row-reverse" : "flex-row")}>
                          <span className="text-[10px] text-muted-foreground cursor-default" title={fullTimestamp(msg.createdAt)}>{timeLabel(msg.createdAt)}</span>
                          {editingId !== msg.id && confirmDeleteId !== msg.id && (
                            <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex gap-0.5">
                              <button
                                onClick={() => { setReplyingTo({ id: msg.id, senderName: msg.senderName, content: msg.content, attachmentType: msg.attachmentType }); setEmojiPickerId(null); }}
                                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                title="Reply"
                              ><CornerUpLeft className="w-3 h-3" /></button>
                              <button
                                onClick={() => setEmojiPickerId(id => id === msg.id ? null : msg.id)}
                                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground text-sm"
                                title="React"
                              >😊</button>
                              {msg.mine && (
                                <>
                                  <button onClick={() => { setEditingId(msg.id); setEditDraft(msg.content); setConfirmDeleteId(null); }} className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit"><Pencil className="w-3 h-3" /></button>
                                  <button onClick={() => setConfirmDeleteId(msg.id)} className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-red-500" title="Delete"><Trash2 className="w-3 h-3" /></button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={threadEndRef} />
              </div>

              {/* Channel compose area */}
              <div className="p-3 border-t bg-muted/20 space-y-2">
                {/* Reply-to preview */}
                {replyingTo && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-muted/60 border-l-2 border-primary/50 text-xs">
                    <CornerUpLeft className="w-3.5 h-3.5 text-primary/60 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-primary/80">{replyingTo.senderName}</span>
                      <p className="text-muted-foreground truncate">{replyingTo.content || (replyingTo.attachmentType ? `[${replyingTo.attachmentType}]` : "[attachment]")}</p>
                    </div>
                    <button onClick={() => setReplyingTo(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {attachedItem && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-50 border border-violet-200 text-xs">
                    {attachedItem.type === "document" && <FileText className="w-4 h-4 text-violet-600 shrink-0" />}
                    {attachedItem.type === "photo" && <Image className="w-4 h-4 text-violet-600 shrink-0" />}
                    {attachedItem.type === "permit" && <FileCheck className="w-4 h-4 text-violet-600 shrink-0" />}
                    <span className="flex-1 font-semibold text-violet-800 truncate">
                      {attachedItem.type === "document" && (attachedItem.data as DocAttachment).name}
                      {attachedItem.type === "photo" && `Photo · ${(attachedItem.data as PhotoAttachment).referenceNumber}`}
                      {attachedItem.type === "permit" && `Permit · ${(attachedItem.data as PermitAttachment).type}`}
                    </span>
                    <button onClick={() => setAttachedItem(null)} className="text-violet-400 hover:text-violet-600 shrink-0"><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                {attachPickerOpen && (
                  <div className="rounded-xl border bg-card shadow-lg overflow-hidden">
                    <div className="flex border-b">
                      {([{ id: "document" as const, label: "Document", Icon: FileText }, { id: "photo" as const, label: "Photo", Icon: Image }, { id: "permit" as const, label: "Permit", Icon: FileCheck }]).map(({ id, label, Icon }) => (
                        <button key={id} onClick={() => { setAttachTab(id); setAttachPickerItems([]); }}
                          className={cn("flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[11px] font-semibold border-b-2 transition-colors", attachTab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
                          <Icon className="w-3 h-3" />{label}
                        </button>
                      ))}
                    </div>
                    <div className="px-3 pt-2 pb-1">
                      <select value={attachPickerProjectId} onChange={e => setAttachPickerProjectId(e.target.value)} className="w-full text-xs rounded-lg border px-2 py-1.5 bg-background">
                        <option value="">Select project…</option>
                        {attachPickerProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="max-h-40 overflow-y-auto">
                      {!attachPickerProjectId ? <div className="p-3 text-xs text-muted-foreground text-center">Select a project above.</div>
                        : attachPickerLoading ? <div className="p-3 text-xs text-muted-foreground text-center">Loading…</div>
                        : attachPickerItems.length === 0 ? <div className="p-3 text-xs text-muted-foreground text-center">No {attachTab}s found.</div>
                        : attachTab === "document" ? (attachPickerItems as DocAttachment[]).map(doc => (
                          <button key={doc.id} onClick={() => { setAttachedItem({ type: "document", data: doc }); setAttachPickerOpen(false); setAttachPickerProjectId(""); }}
                            className="w-full text-left px-3 py-2 hover:bg-muted transition-colors text-xs flex items-center gap-2 border-b last:border-0">
                            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0"><p className="font-semibold truncate">{doc.name}</p><p className="text-muted-foreground capitalize">{doc.type} · v{doc.version}</p></div>
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize shrink-0", doc.status === "current" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{doc.status}</span>
                          </button>
                        )) : attachTab === "photo" ? (attachPickerItems as PhotoAttachment[]).map(photo => (
                          <button key={photo.id} onClick={() => { setAttachedItem({ type: "photo", data: photo }); setAttachPickerOpen(false); setAttachPickerProjectId(""); }}
                            className="w-full text-left px-3 py-2 hover:bg-muted transition-colors text-xs flex items-center gap-2 border-b last:border-0">
                            {photo.photoUrl ? <img src={photo.photoUrl.replace(/^\/uploads\//, "/api/uploads/")} alt="" className="w-8 h-8 rounded object-cover shrink-0" /> : <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0"><Image className="w-3 h-3 text-muted-foreground" /></div>}
                            <div className="flex-1 min-w-0"><p className="font-semibold truncate capitalize">{photo.category}</p><p className="text-muted-foreground truncate">{photo.description ?? photo.referenceNumber}</p></div>
                          </button>
                        )) : (attachPickerItems as PermitAttachment[]).map(permit => {
                          const daysLeft = Math.ceil((new Date(permit.expiryDate + "T12:00:00").getTime() - Date.now()) / 86400000);
                          return (
                            <button key={permit.id} onClick={() => { setAttachedItem({ type: "permit", data: permit }); setAttachPickerOpen(false); setAttachPickerProjectId(""); }}
                              className="w-full text-left px-3 py-2 hover:bg-muted transition-colors text-xs flex items-center gap-2 border-b last:border-0">
                              <FileCheck className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <div className="flex-1 min-w-0"><p className="font-semibold truncate capitalize">{permit.type}</p><p className="text-muted-foreground truncate">{permit.description}</p></div>
                              <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0", daysLeft < 0 ? "bg-red-100 text-red-700" : daysLeft <= 14 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>{daysLeft < 0 ? "Expired" : "Active"}</span>
                            </button>
                          );
                        })}
                    </div>
                    <div className="px-3 pb-2 pt-1 border-t">
                      <button onClick={() => { setAttachPickerOpen(false); setAttachPickerProjectId(""); }} className="text-[10px] text-muted-foreground hover:text-foreground">Cancel</button>
                    </div>
                  </div>
                )}
                {/* Quick reply templates */}
                {quickReplyOpen && (
                  <div className="rounded-xl border bg-card shadow-sm p-3 space-y-2 max-h-52 overflow-y-auto">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold flex items-center gap-1.5 text-amber-600"><Zap className="w-3.5 h-3.5" />Quick Replies</span>
                      <button onClick={() => setQuickReplyOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    {QUICK_REPLIES.map(group => (
                      <div key={group.category}>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{group.category}</p>
                        <div className="flex flex-wrap gap-1">
                          {group.items.map(t => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => { setDraft(t); setQuickReplyOpen(false); }}
                              className="px-2.5 py-1 rounded-full border text-xs bg-muted/50 hover:bg-primary/10 hover:border-primary/40 hover:text-primary transition-colors text-left"
                            >{t}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={e => { e.preventDefault(); sendChannelMessage(); }} className="flex gap-2">
                  <Button type="button" size="sm" variant="ghost" title="Attach document, photo or permit"
                    className={cn("px-2 shrink-0", attachPickerOpen && "text-violet-600 bg-violet-50")}
                    onClick={() => attachPickerOpen ? setAttachPickerOpen(false) : openAttachPicker()}>
                    <Paperclip className="w-4 h-4" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" title="Quick replies"
                    className={cn("px-2 shrink-0", quickReplyOpen && "text-amber-500 bg-amber-50")}
                    onClick={() => { setQuickReplyOpen(v => !v); setAttachPickerOpen(false); }}>
                    <Zap className="w-4 h-4" />
                  </Button>
                  <Input value={draft} onChange={e => setDraft(e.target.value)}
                    placeholder={attachedItem ? "Add a note (optional)…" : `Message #${activeChannel.projectName}…`}
                    className="flex-1"
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChannelMessage(); } }} />
                  <Button type="submit" size="sm" disabled={(!draft.trim() && !attachedItem) || sending} className="px-3">
                    <Send className="w-4 h-4" />
                  </Button>
                </form>
              </div>
            </div>
          ) : (
            <div className="hidden sm:flex flex-1 items-center justify-center border rounded-2xl bg-card/50 border-dashed">
              <div className="text-center text-muted-foreground">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="font-semibold">Select a conversation</p>
                <p className="text-sm">or start a new one</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </SidebarLayout>
  );
}
