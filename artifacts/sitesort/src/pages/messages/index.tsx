import { useState, useEffect, useRef, useCallback } from "react";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, Users, Eye, ArrowLeft, Circle, Pencil, Trash2, Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

type Conversation = {
  otherId: string;
  otherName: string;
  otherRole: string;
  lastMessage: string;
  lastAt: string;
  unread: number;
};

type Message = {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  content: string;
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

const ROLE_COLOURS: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700",
  project_manager: "bg-blue-100 text-blue-700",
  site_worker: "bg-emerald-100 text-emerald-700",
  subcontractor: "bg-orange-100 text-orange-700",
};

function authHeaders() {
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

function getCurrentUser(): { id: string; role: string; name: string } | null {
  try {
    const token = localStorage.getItem("sitesort_token");
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return { id: payload.id, role: payload.role, name: payload.name ?? "" };
  } catch { return null; }
}

export default function MessagesPage() {
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
  const [autoDictate, setAutoDictate] = useState(false);
  const [dictating, setDictating] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dictateRef = useRef<any>(null);
  const voiceSupported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const fetchConversations = useCallback(async () => {
    const r = await fetch(`/api/messages/conversations${viewAll ? "?all=true" : ""}`, { headers: authHeaders() });
    if (r.ok) setConversations(await r.json());
  }, [viewAll]);

  const fetchThread = useCallback(async (conv: Conversation) => {
    setLoadingThread(true);
    const allParam = viewAll ? "?all=true" : "";
    const r = await fetch(`/api/messages/thread/${conv.otherId}${allParam}`, { headers: authHeaders() });
    if (r.ok) setThread(await r.json());
    setLoadingThread(false);
  }, [viewAll]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (activeConv) {
      fetchThread(activeConv);
      pollRef.current = setInterval(() => fetchThread(activeConv), 5000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeConv, fetchThread]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

  useEffect(() => {
    fetch("/api/messages/users", { headers: authHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(setTeamUsers);
  }, []);

  // Voice dictation
  const startDictation = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRec = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;
    const rec = new SpeechRec();
    rec.continuous = true; rec.interimResults = false; rec.lang = "en-GB";
    rec.onstart = () => setDictating(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join(" ");
      setDraft(prev => prev + (prev ? " " : "") + transcript);
    };
    rec.onend = () => { setDictating(false); dictateRef.current = null; };
    rec.onerror = () => { setDictating(false); dictateRef.current = null; };
    rec.start(); dictateRef.current = rec;
  }, []);

  const stopDictation = useCallback(() => {
    dictateRef.current?.stop();
    setDictating(false);
  }, []);

  const toggleDictation = useCallback(() => {
    if (dictating) stopDictation(); else startDictation();
  }, [dictating, startDictation, stopDictation]);

  useEffect(() => () => { dictateRef.current?.stop(); }, []);

  // Handle voice-command params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      window.history.replaceState({}, "", "/messages");
      setNewChatOpen(true);
    } else if (params.get("to")) {
      window.history.replaceState({}, "", "/messages");
      setPendingTo(params.get("to")!.toLowerCase());
    } else if (params.get("dictate") === "1") {
      window.history.replaceState({}, "", "/messages");
      setAutoDictate(true);
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

  // Auto-start dictation when conversation opens via voice command
  useEffect(() => {
    if (autoDictate && activeConv && !viewAll) {
      setAutoDictate(false);
      startDictation();
    }
  }, [autoDictate, activeConv, viewAll, startDictation]);

  async function sendMessage() {
    if (!draft.trim() || !activeConv || sending || viewAll) return;
    setSending(true);
    const r = await fetch("/api/messages", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId: activeConv.otherId, content: draft.trim() }),
    });
    if (r.ok) {
      const msg = await r.json();
      setThread(prev => [...prev, { ...msg, senderName: me?.name ?? "Me" }]);
      setDraft("");
      fetchConversations();
    }
    setSending(false);
  }

  function startEdit(msg: Message) {
    setEditingId(msg.id);
    setEditDraft(msg.content);
    setConfirmDeleteId(null);
  }

  async function saveEdit(id: string) {
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
    const r = await fetch(`/api/messages/${id}`, { method: "DELETE", headers: authHeaders() });
    if (r.ok) {
      setThread(prev => prev.filter(m => m.id !== id));
      setConfirmDeleteId(null);
      fetchConversations();
    }
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
            activeConv ? "hidden sm:flex w-72 shrink-0" : "flex-1 sm:w-72 sm:flex-none sm:shrink-0"
          )}>
            <div className="p-3 border-b flex items-center justify-between bg-muted/30">
              <span className="font-semibold text-sm">
                {viewAll ? "All Company Chats" : "Conversations"}
              </span>
              {!viewAll && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => setNewChatOpen(true)}>
                  <Users className="w-3.5 h-3.5" /> New
                </Button>
              )}
            </div>

            {/* New chat user picker */}
            {newChatOpen && !viewAll && (
              <div className="border-b p-3 bg-muted/20">
                <p className="text-xs font-semibold text-muted-foreground mb-2">Start a conversation:</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {teamUsers.map(u => (
                    <button key={u.id} onClick={() => startNewChat(u)}
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
                <Button size="sm" variant="ghost" className="w-full mt-2 h-7 text-xs" onClick={() => setNewChatOpen(false)}>
                  Cancel
                </Button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto divide-y">
              {conversations.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">{viewAll ? "No messages yet." : "No conversations yet."}</p>
                </div>
              ) : (
                conversations.map(conv => (
                  <button key={conv.otherId} onClick={() => setActiveConv(conv)}
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
              )}
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
                <div>
                  <p className="font-bold text-sm">{activeConv.otherName}</p>
                  {activeConv.otherRole && (
                    <p className="text-[10px] text-muted-foreground capitalize">{activeConv.otherRole.replace(/_/g, " ")}</p>
                  )}
                </div>
                {viewAll && (
                  <Badge variant="outline" className="ml-auto text-[10px] text-orange-600 border-orange-300 bg-orange-50">
                    <Eye className="w-3 h-3 mr-1" /> Manager View
                  </Badge>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                        <div className={cn("flex items-center gap-1 px-1", msg.mine && !viewAll ? "flex-row-reverse" : "flex-row")}>
                          <span className="text-[10px] text-muted-foreground">{timeLabel(msg.createdAt)}</span>
                          {msg.mine && !viewAll && (
                            <Circle className={cn("w-2 h-2", msg.readAt ? "fill-primary text-primary" : "fill-muted-foreground/40 text-muted-foreground/40")} />
                          )}
                          {msg.mine && !viewAll && editingId !== msg.id && confirmDeleteId !== msg.id && (
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
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
                <div className="p-3 border-t bg-muted/20">
                  <form onSubmit={e => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
                    <Input
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      placeholder={dictating ? "Listening… speak your message" : "Type a message…"}
                      className={cn("flex-1", dictating && "border-orange-400 ring-1 ring-orange-400/60")}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    />
                    {voiceSupported && (
                      <Button type="button" size="sm" variant="ghost"
                        title={dictating ? "Stop dictating" : "Dictate message"}
                        className={cn("px-2 shrink-0", dictating && "text-orange-500 animate-pulse")}
                        onClick={toggleDictation}
                      >
                        {dictating ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      </Button>
                    )}
                    <Button type="submit" size="sm" disabled={!draft.trim() || sending} className="px-3">
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
