"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { estimateTokens } from "@/lib/tokens";
import { buildMaxTokensStopContext } from "@/lib/prompts";
import {
  Sparkles,
  Plus,
  Trash2,
  LogOut,
  Send,
  ImagePlus,
  X,
  ChevronRight,
  Brain,
  Globe,
  Image as ImageIcon,
  Gauge,
  Zap,
  GraduationCap,
  MessageSquare,
  Sun,
  Moon,
} from "lucide-react";

// ─── Types ───
interface MessageData {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  thought?: string;
  thinkingTime?: number;
  imageUrl?: string;
  generationTime?: number;
  tokenCount?: number;
  isFinished?: boolean;
  isError?: boolean;
  errorMessage?: string;
  errorAction?: "switch_expert" | "switch_fast" | "retry";
  noticeMessage?: string;
  noticeAction?: "switch_expert" | "switch_fast";
}

interface ChatData {
  id: string;
  title: string;
  updatedAt: string;
  _count?: { messages: number };
}

interface UserData {
  id: string;
  username: string;
  name: string;
  avatarUrl?: string;
}

interface ModelCapabilities {
  supportsThinking: boolean;
  supportsImages: boolean;
  supportsWebSearch: boolean;
  supportsEffort: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  errorThreshold?: number;
}

interface ParsedBlock {
  type: "text" | "code";
  content: string;
  language?: string;
}

function parseMessageContent(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const parts = content.split("```");

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      // Inside code block
      const firstNewLineIndex = part.indexOf("\n");
      let language = "text";
      let codeContent = part;

      if (firstNewLineIndex !== -1) {
        const langCandidate = part.substring(0, firstNewLineIndex).trim();
        if (langCandidate.length > 0 && langCandidate.length < 15 && /^[a-zA-Z0-9#+-]+$/.test(langCandidate)) {
          language = langCandidate;
          codeContent = part.substring(firstNewLineIndex + 1);
        }
      }

      blocks.push({
        type: "code",
        content: codeContent,
        language
      });
    } else {
      // Normal text
      if (part) {
        blocks.push({
          type: "text",
          content: part
        });
      }
    }
  }

  return blocks;
}

// ─── Thinking Block ───
function ThinkingBlock({ thought, thinkingTime }: { thought: string; thinkingTime?: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="thinking-block">
      <div className="thinking-header" onClick={() => setExpanded(!expanded)}>
        <ChevronRight size={14} className={`thinking-header-icon ${expanded ? "expanded" : ""}`} />
        <Brain size={14} />
        <span>Thought Process</span>
        {thinkingTime && (
          <span className="thinking-time">{(thinkingTime / 1000).toFixed(1)}s</span>
        )}
      </div>
      {expanded && <div className="thinking-content">{thought}</div>}
    </div>
  );
}

// ─── Main Chat Page ───
export default function ChatPage() {
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // User & state
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  // Chats
  const [chats, setChats] = useState<ChatData[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);

  // Theme & Layout
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  // Model & Deep Think
  const [modelType, setModelType] = useState<"fast" | "expert">("fast");
  const [deepThink, setDeepThink] = useState(true);
  const [capabilities, setCapabilities] = useState<{
    fast: ModelCapabilities;
    expert: ModelCapabilities;
  }>({
    fast: { supportsThinking: false, supportsImages: false, supportsWebSearch: false, supportsEffort: true },
    expert: { supportsThinking: true, supportsImages: false, supportsWebSearch: false, supportsEffort: true },
  });

  // Toggles
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [websearchEnabled, setWebsearchEnabled] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState("medium");

  // Input
  const [inputText, setInputText] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);

  // Stop generation & stream stats
  const abortControllerRef = useRef<AbortController | null>(null);
  const consecutiveExpertErrorsRef = useRef(0);
  const [expertErrorThreshold, setExpertErrorThreshold] = useState(3);
  const [fastMaxOutputTokens, setFastMaxOutputTokens] = useState(512);
  const [streamTime, setStreamTime] = useState(0);
  const [streamTokens, setStreamTokens] = useState(0);
  const timerRef = useRef<any>(null);

  // Current capabilities for active model
  const currentCaps = modelType === "fast"
    ? capabilities.fast
    : (deepThink
        ? { supportsThinking: true, supportsImages: false, supportsWebSearch: true, supportsEffort: true }
        : { supportsThinking: false, supportsImages: false, supportsWebSearch: true, supportsEffort: true }
      );

  // ─── Init ───
  useEffect(() => {
    fetchUser();
    fetchChats();
    fetchCapabilities();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchUser = async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchChats = async () => {
    const res = await fetch("/api/chats");
    const data = await res.json();
    if (data.success) {
      setChats(data.chats);
    }
  };

  const fetchCapabilities = async () => {
    try {
      const res = await fetch("/api/chat/stream");
      const data = await res.json();
      if (data.success) {
        setCapabilities({
          fast: data.fast,
          expert: data.expert,
        });
        if (data.expert?.errorThreshold) {
          setExpertErrorThreshold(data.expert.errorThreshold);
        }
        if (data.fast?.maxOutputTokens) {
          setFastMaxOutputTokens(data.fast.maxOutputTokens);
        }
      }
    } catch (err) {
      // Keep defaults
    }
  };

  const loadChat = async (chatId: string) => {
    setActiveChat(chatId);
    const res = await fetch(`/api/chats/${chatId}`);
    const data = await res.json();
    if (data.success) {
      setMessages(data.chat.messages);
    }
  };

  const createChat = async () => {
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Chat" }),
    });
    const data = await res.json();
    if (data.success) {
      setChats((prev) => [data.chat, ...prev]);
      setActiveChat(data.chat.id);
      setMessages([]);
    }
  };

  const deleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    if (activeChat === chatId) {
      setActiveChat(null);
      setMessages([]);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  // ─── Image Upload ───
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setImageData(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // ─── Send Message ───
  const handleSend = async (isRetry = false) => {
    if (!isRetry && (!inputText.trim() && !imageData) || isStreaming) return;

    let chatId = activeChat;

    // Create a chat if none active (only if not retrying)
    if (!chatId) {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: inputText.trim().slice(0, 50) || "New Chat" }),
      });
      const data = await res.json();
      if (data.success) {
        chatId = data.chat.id;
        setChats((prev) => [data.chat, ...prev]);
        setActiveChat(chatId);
      }
    }

    let updatedMessages: MessageData[];
    let userMsg: MessageData;

    if (isRetry) {
      // Find the last user message in the list
      const lastUserIndex = [...messages].reverse().findIndex(m => m.role === "user");
      if (lastUserIndex === -1) return;
      const actualIndex = messages.length - 1 - lastUserIndex;
      
      // Keep only up to this user message, discard any trailing error assistant message
      updatedMessages = messages.slice(0, actualIndex + 1);
      userMsg = messages[actualIndex];
      setMessages(updatedMessages);
    } else {
      // Add user message
      userMsg = {
        role: "user",
        content: inputText.trim(),
        imageUrl: imageData || undefined,
      };
      updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      setInputText("");
      setImageData(null);
    }

    setIsStreaming(true);
    setIsThinking(modelType === "expert" ? true : (thinkingEnabled && currentCaps.supportsThinking));

    // Reset stream metrics
    setStreamTime(0);
    setStreamTokens(0);
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setStreamTime(Date.now() - startTime);
    }, 100);

    // Initialize AbortController
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Save user message if not retry
    if (!isRetry) {
      await fetch(`/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userMsg),
      });
    }

    let assistantContent = "";
    let assistantThought = "";
    let maxTokensReached = false;
    let liveTokenCount = 0;
    const thinkStart = Date.now();

    // Stream AI response
    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          chatId,
          messages: updatedMessages,
          modelType,
          modelName: modelType === "fast"
            ? "hf.co/bartowski/Llama-3.1-8B-Lexi-Uncensored-V2-GGUF:Q4_K_M"
            : (deepThink ? "nvidia/nemotron-3-ultra-550b-a55b:free" : "cohere/north-mini-code:free"),
          thinkingEnabled: modelType === "expert" ? true : (thinkingEnabled && currentCaps.supportsThinking),
          reasoningEffort,
          imageData,
          websearchEnabled: websearchEnabled && currentCaps.supportsWebSearch,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "Stream failed" }));
        throw new Error(errData.error || "Stream failed");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";

      // Add placeholder assistant message
      const assistantMsg: MessageData = { role: "assistant", content: "" };
      setMessages((prev) => [...prev, assistantMsg]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() || ""; // keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6).trim();
          if (data === "[DONE]") break;

          try {
            const event = JSON.parse(data);

            if (event.type === "thinking") {
              assistantThought += event.content;
              setIsThinking(true);
            } else if (event.type === "content") {
              if (isThinking) setIsThinking(false);
              assistantContent += event.content;
            } else if (event.type === "token_count") {
              liveTokenCount = event.count;
              setStreamTokens(event.count);
            } else if (event.type === "metrics") {
              if (typeof event.eval_count === "number") {
                liveTokenCount = event.eval_count;
                setStreamTokens(event.eval_count);
              } else if (typeof event.completion_tokens === "number") {
                liveTokenCount = event.completion_tokens;
                setStreamTokens(event.completion_tokens);
              }
            } else if (event.type === "max_tokens_reached") {
              maxTokensReached = true;
            }

            const elapsed = Date.now() - thinkStart;
            const currentTokens = modelType === "fast" && liveTokenCount > 0
              ? liveTokenCount
              : estimateTokens(assistantContent + assistantThought);

            if (modelType !== "fast" || liveTokenCount === 0) {
              setStreamTokens(currentTokens);
            }

            // Update the assistant message in real time
            setMessages((prev) => {
              const updated = [...prev];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg.role === "assistant") {
                lastMsg.content = assistantContent;
                lastMsg.thought = assistantThought || undefined;
                lastMsg.thinkingTime = assistantThought
                  ? elapsed
                  : undefined;
                lastMsg.generationTime = elapsed;
                lastMsg.tokenCount = currentTokens;
              }
              return [...updated];
            });
          } catch (e) {
            // skip invalid json
          }
        }
      }

      const finalTokenCount = modelType === "fast" && liveTokenCount > 0
        ? liveTokenCount
        : estimateTokens(assistantContent + assistantThought);

      // Save assistant message to DB
      const finalMsg: MessageData = {
        role: "assistant",
        content: assistantContent,
        thought: assistantThought || undefined,
        thinkingTime: assistantThought ? Date.now() - thinkStart : undefined,
        generationTime: Date.now() - thinkStart,
        tokenCount: finalTokenCount,
        isFinished: true,
        ...(maxTokensReached
          ? {
              noticeMessage:
                "MAX OUTPUT TOKEN REACHED SWITCH TO EXPERT MODE FOR MORE STABLE RESPONSES",
              noticeAction: "switch_expert" as const,
            }
          : {}),
      };

      if (modelType === "expert" && !maxTokensReached) {
        consecutiveExpertErrorsRef.current = 0;
      }

      setMessages((prev) => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          lastMsg.generationTime = finalMsg.generationTime;
          lastMsg.tokenCount = finalMsg.tokenCount;
          lastMsg.isFinished = true;
          if (maxTokensReached) {
            lastMsg.noticeMessage = finalMsg.noticeMessage;
            lastMsg.noticeAction = finalMsg.noticeAction;
          }
        }
        return updated;
      });

      await fetch(`/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalMsg),
      });

      if (maxTokensReached) {
        const stopContext: MessageData = {
          role: "system",
          content: buildMaxTokensStopContext(fastMaxOutputTokens),
        };

        setMessages((prev) => [...prev, stopContext]);

        await fetch(`/api/chats/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(stopContext),
        });
      }

      // Update chat title if it was the first message
      if (updatedMessages.length === 1) {
        const newTitle = inputText.trim().slice(0, 50);
        await fetch(`/api/chats/${chatId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        });
        setChats((prev) =>
          prev.map((c) => (c.id === chatId ? { ...c, title: newTitle } : c))
        );
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        // User stopped generation manually
        const elapsed = Date.now() - thinkStart;
        const currentTokens = liveTokenCount > 0
          ? liveTokenCount
          : estimateTokens(assistantContent + assistantThought);

        const abortedMsg: MessageData = {
          role: "assistant",
          content: assistantContent + " (stopped)",
          thought: assistantThought || undefined,
          thinkingTime: assistantThought ? elapsed : undefined,
          generationTime: elapsed,
          tokenCount: currentTokens,
          isFinished: true,
        };

        setMessages((prev) => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === "assistant") {
            lastMsg.content = abortedMsg.content;
            lastMsg.thought = abortedMsg.thought;
            lastMsg.thinkingTime = abortedMsg.thinkingTime;
            lastMsg.generationTime = abortedMsg.generationTime;
            lastMsg.tokenCount = abortedMsg.tokenCount;
            lastMsg.isFinished = true;
          }
          return updated;
        });

        // Save partial response to DB
        await fetch(`/api/chats/${chatId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(abortedMsg),
        });
      } else {
        let errorMsg = err.message || "Failed to get response";
        if (errorMsg.includes("429") || errorMsg.toLowerCase().includes("rate limit") || errorMsg.toLowerCase().includes("credit")) {
          errorMsg = "Connection failed";
        }

        let errorAction: "switch_expert" | "switch_fast" | "retry" = "retry";
        if (modelType === "expert") {
          consecutiveExpertErrorsRef.current += 1;
          if (consecutiveExpertErrorsRef.current >= expertErrorThreshold) {
            errorAction = "switch_fast";
          }
        }

        setMessages((prev) => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === "assistant") {
            lastMsg.isError = true;
            lastMsg.errorMessage = errorMsg;
            lastMsg.errorAction = errorAction;
            lastMsg.content = "";
          } else {
            updated.push({
              role: "assistant",
              content: "",
              isError: true,
              errorMessage: errorMsg,
              errorAction,
            });
          }
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      setIsThinking(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleSwitchMode = (target: "fast" | "expert") => {
    setModelType(target);
    if (target === "expert") {
      consecutiveExpertErrorsRef.current = 0;
    }
  };

  const handleRetry = () => {
    handleSend(true);
  };

  // ─── Textarea auto-resize & Enter to send ───
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  // ─── Loading screen ───
  if (loading) {
    return (
      <div className="auth-page">
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="sidebar-brand-icon">
              <Sparkles size={16} />
            </div>
            <h1>Silver Chat</h1>
          </div>
          <button className="new-chat-btn" onClick={createChat}>
            <Plus size={14} /> New
          </button>
        </div>

        <div className="chat-list">
          {chats.length === 0 ? (
            <div className="empty-state">
              <MessageSquare size={28} className="empty-state-icon" />
              <span>No chats yet</span>
            </div>
          ) : (
            chats.map((chat) => (
              <div
                key={chat.id}
                className={`chat-item ${activeChat === chat.id ? "active" : ""}`}
                onClick={() => loadChat(chat.id)}
              >
                <MessageSquare size={14} />
                <span className="chat-item-title">{chat.title}</span>
                <button
                  className="chat-item-delete"
                  onClick={(e) => deleteChat(chat.id, e)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          <div className="profile-section" style={{ cursor: "default" }}>
            <div className="profile-avatar">
              {user?.avatarUrl || user?.name?.[0]?.toUpperCase() || "?"}
            </div>
            <div className="profile-info">
              <div className="profile-name">{user?.name}</div>
              <div className="profile-email">@{user?.username}</div>
            </div>
          </div>
          <button
            className="new-chat-btn"
            style={{ width: "100%", marginTop: "8px", justifyContent: "center" }}
            onClick={handleLogout}
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Header */}
        <div className="chat-header">
          <div className="model-selector">
            <button
              className={`model-option ${modelType === "fast" ? "active" : ""}`}
              onClick={() => setModelType("fast")}
            >
              <span className="model-label">
                <Zap size={14} />
                Fast
                <span className="model-badge">Chatting</span>
              </span>
            </button>
            <button
              className={`model-option ${modelType === "expert" ? "active" : ""}`}
              onClick={() => setModelType("expert")}
            >
              <span className="model-label">
                <GraduationCap size={14} />
                Expert
                <span className="model-badge">Coding</span>
              </span>
            </button>
          </div>

          <button
            onClick={toggleTheme}
            style={{
              marginLeft: "auto",
              padding: "var(--space-2)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-default)",
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition: "all var(--transition-fast)"
            }}
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        {/* Capabilities Bar */}
        <div className="capabilities-bar">
          <button
            className={`capability-toggle ${(modelType === "expert" || (thinkingEnabled && currentCaps.supportsThinking)) ? "active" : ""} ${modelType === "expert" ? "disabled" : (!currentCaps.supportsThinking ? "disabled" : "")}`}
            onClick={() => modelType !== "expert" && currentCaps.supportsThinking && setThinkingEnabled(!thinkingEnabled)}
            style={modelType === "expert" ? { cursor: "default" } : undefined}
          >
            <span className="capability-dot" />
            <Brain size={12} />
            Thinking
            {modelType === "expert" && <span style={{ fontSize: "9px", opacity: 0.7 }}>(ON)</span>}
            {modelType !== "expert" && !currentCaps.supportsThinking && <span style={{ fontSize: "9px" }}>N/A</span>}
          </button>

          <button
            className={`capability-toggle ${websearchEnabled && currentCaps.supportsWebSearch ? "active" : ""} ${!currentCaps.supportsWebSearch ? "disabled" : ""}`}
            onClick={() => currentCaps.supportsWebSearch && setWebsearchEnabled(!websearchEnabled)}
          >
            <span className="capability-dot" />
            <Globe size={12} />
            Web Search
            {!currentCaps.supportsWebSearch && <span style={{ fontSize: "9px" }}>N/A</span>}
          </button>

          <button
            className={`capability-toggle ${currentCaps.supportsImages ? "active" : ""} ${!currentCaps.supportsImages ? "disabled" : ""}`}
            style={{ cursor: "default" }}
          >
            <span className="capability-dot" />
            <ImageIcon size={12} />
            Images
            {!currentCaps.supportsImages && <span style={{ fontSize: "9px" }}>N/A</span>}
          </button>

          <div className="effort-selector">
            <Gauge size={12} style={{ color: "var(--text-tertiary)" }} />
            <span className="effort-label">Effort</span>
            {["auto", "low", "medium", "high", "max"].map((level) => (
              <button
                key={level}
                className={`effort-option ${reasoningEffort === level ? "active" : ""} ${!currentCaps.supportsEffort ? "disabled" : ""}`}
                onClick={() => currentCaps.supportsEffort && setReasoningEffort(level)}
              >
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Messages or Welcome */}
        {messages.length === 0 ? (
          <div className="welcome-screen">
            <div className="welcome-icon">
              <Sparkles size={28} />
            </div>
            <h2 className="welcome-title">How can I help you?</h2>
            <p className="welcome-subtitle">
              Start a conversation with Fast model or Expert model. Toggle Deep Think for advanced reasoning on Expert.
            </p>
          </div>
        ) : (
          <div className="messages-area">
            <div className="messages-container">
              {messages.filter((msg) => msg.role !== "system").map((msg, i) => (
                <div key={i} className={`message ${msg.role === "user" ? "user-message" : "assistant-message"}`}>
                  <div className="message-header" style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingLeft: "var(--space-1)",
                    marginBottom: "var(--space-1)"
                  }}>
                    <div className="message-role">
                      {msg.role === "user" ? "You" : "Assistant"}
                    </div>
                    {msg.role === "assistant" && msg.content && (
                      <button
                        className="copy-message-btn"
                        onClick={() => navigator.clipboard.writeText(msg.content)}
                        style={{
                          fontSize: "var(--font-size-xs)",
                          color: "var(--text-tertiary)",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          cursor: "pointer",
                          transition: "color var(--transition-fast)"
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-primary)"}
                        onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-tertiary)"}
                        title="Copy response"
                      >
                        <span>Copy</span>
                      </button>
                    )}
                  </div>

                  {/* Thinking Block */}
                  {msg.thought && (
                    <ThinkingBlock
                      thought={msg.thought}
                      thinkingTime={msg.thinkingTime}
                    />
                  )}

                  {/* Image */}
                  {msg.imageUrl && (
                    <img src={msg.imageUrl} alt="Attached" className="message-image" />
                  )}

                  {/* Content */}
                  {msg.content && (
                    <div className="message-content">
                      {parseMessageContent(msg.content).map((block, idx) => (
                        block.type === "code" ? (
                          <div key={idx} className="code-block-container" style={{
                            margin: "var(--space-3) 0",
                            border: "1px solid var(--border-default)",
                            borderRadius: "var(--radius-md)",
                            background: "var(--bg-tertiary)",
                            overflow: "hidden"
                          }}>
                            <div className="code-block-header" style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "var(--space-2) var(--space-4)",
                              background: "var(--bg-secondary)",
                              borderBottom: "1px solid var(--border-subtle)",
                              fontSize: "var(--font-size-xs)",
                              color: "var(--text-secondary)",
                              fontFamily: "monospace"
                            }}>
                              <span>{block.language || "code"}</span>
                              <button
                                onClick={() => navigator.clipboard.writeText(block.content.trim())}
                                style={{
                                  cursor: "pointer",
                                  color: "var(--text-tertiary)",
                                  transition: "color var(--transition-fast)",
                                  background: "none",
                                  border: "none"
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-primary)"}
                                onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-tertiary)"}
                              >
                                Copy Code
                              </button>
                            </div>
                            <pre style={{
                              padding: "var(--space-4)",
                              margin: 0,
                              overflowX: "auto",
                              fontSize: "var(--font-size-sm)",
                              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                              lineHeight: 1.5,
                              background: "var(--bg-tertiary)"
                            }}>
                              <code>{block.content}</code>
                            </pre>
                          </div>
                        ) : (
                          <div key={idx} className="text-block">
                            {block.content.split("\n").map((line, j) => (
                              <p key={j} style={{ marginBottom: line ? "var(--space-3)" : 0 }}>
                                {line || "\u00A0"}
                              </p>
                            ))}
                          </div>
                        )
                      ))}
                    </div>
                  )}

                  {/* Message stats / status */}
                  {msg.role === "assistant" && (
                    <div className="message-stats" style={{
                      fontSize: "var(--font-size-xs)",
                      color: "var(--text-tertiary)",
                      marginTop: "var(--space-2)",
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      userSelect: "none"
                    }}>
                      {isStreaming && msg.role === "assistant" && i === messages.filter((m) => m.role !== "system").length - 1 ? (
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1 }} />
                          Generating • {(streamTime / 1000).toFixed(1)}s • {modelType === "fast"
                            ? `${streamTokens} / ${fastMaxOutputTokens} tokens`
                            : `~${streamTokens} tokens`} • {streamTime > 0 ? Math.round((streamTokens / (streamTime / 1000))) : 0} t/s
                        </span>
                      ) : (
                        (msg.generationTime || msg.tokenCount || msg.isFinished) && (
                          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <span style={{ color: "var(--success)" }}>✓</span>
                            Response finished {msg.generationTime ? `in ${(msg.generationTime / 1000).toFixed(1)}s` : msg.thinkingTime ? `in ${(msg.thinkingTime / 1000).toFixed(1)}s` : ""}
                            {msg.noticeMessage
                              ? ` • ${msg.tokenCount ?? 0} / ${fastMaxOutputTokens} tokens (limit reached)`
                              : ` • ${msg.tokenCount ?? estimateTokens(msg.content + (msg.thought || ""))} tokens`}
                            {msg.generationTime && msg.tokenCount ? ` • ${Math.round(msg.tokenCount / (msg.generationTime / 1000))} t/s` : ""}
                          </span>
                        )
                      )}
                    </div>
                  )}

                  {/* Max output notice — response kept, prompt to switch mode */}
                  {msg.noticeMessage && (
                    <div style={{
                      margin: "var(--space-3) 0 0",
                      padding: "var(--space-3) var(--space-4)",
                      background: "rgba(251, 191, 36, 0.08)",
                      border: "1px solid rgba(251, 191, 36, 0.25)",
                      borderRadius: "var(--radius-md)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-2)",
                    }}>
                      <span style={{ fontSize: "var(--font-size-sm)", color: "var(--warning, #fbbf24)" }}>
                        ⚠️ {msg.noticeMessage}
                      </span>
                      {msg.noticeAction === "switch_expert" && (
                        <button
                          onClick={() => handleSwitchMode("expert")}
                          style={{
                            alignSelf: "flex-start",
                            padding: "6px 14px",
                            fontSize: "var(--font-size-xs)",
                            fontWeight: 600,
                            borderRadius: "var(--radius-md)",
                            background: "var(--accent-subtle)",
                            border: "1px solid var(--border-default)",
                            color: "var(--text-primary)",
                            cursor: "pointer",
                          }}
                        >
                          Switch to Expert Mode
                        </button>
                      )}
                    </div>
                  )}

                  {/* Error block */}
                  {msg.isError && (
                    <div className="error-block" style={{
                      margin: "var(--space-3) 0",
                      padding: "var(--space-4)",
                      background: "rgba(248, 113, 113, 0.08)",
                      border: "1px solid rgba(248, 113, 113, 0.2)",
                      borderRadius: "var(--radius-md)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-3)",
                      maxWidth: "100%"
                    }}>
                      <div style={{
                        fontSize: "var(--font-size-sm)",
                        color: "var(--error)",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px"
                      }}>
                        <span>⚠️ {msg.errorMessage || "Unknown error occurred"}</span>
                      </div>
                      {msg.errorAction === "switch_fast" ? (
                        <button
                          onClick={() => handleSwitchMode("fast")}
                          style={{
                            alignSelf: "flex-start",
                            padding: "6px 16px",
                            fontSize: "var(--font-size-xs)",
                            fontWeight: 600,
                            borderRadius: "var(--radius-md)",
                            background: "var(--accent-subtle)",
                            border: "1px solid var(--border-default)",
                            color: "var(--text-primary)",
                            cursor: "pointer",
                          }}
                        >
                          Switch to Fast Mode
                        </button>
                      ) : (
                        <button
                          onClick={handleRetry}
                          style={{
                            alignSelf: "flex-start",
                            padding: "6px 16px",
                            fontSize: "var(--font-size-xs)",
                            fontWeight: 600,
                            borderRadius: "var(--radius-md)",
                            background: "var(--bg-hover)",
                            border: "1px solid var(--border-default)",
                            color: "var(--text-primary)",
                            cursor: "pointer",
                            transition: "all var(--transition-fast)"
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-active)"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                        >
                          Retry Response
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Thinking indicator while streaming */}
              {isThinking && (
                <div className="thinking-indicator">
                  <div className="thinking-dots-container">
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                  </div>
                  <span className="thinking-label">Thinking...</span>
                </div>
              )}

              {/* Streaming indicator */}
              {isStreaming && !isThinking && messages[messages.length - 1]?.content === "" && (
                <div className="thinking-indicator">
                  <div className="thinking-dots-container">
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                  </div>
                  <span className="thinking-label">Generating response...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="input-area">
          <div className="input-container">
            {imageData && (
              <div className="image-preview">
                <img src={imageData} alt="Preview" />
                <button className="image-preview-remove" onClick={() => setImageData(null)}>
                  <X size={14} />
                </button>
              </div>
            )}

            <div className={`input-wrapper ${isStreaming ? "is-thinking" : ""}`}>
              <button
                className="input-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={!currentCaps.supportsImages}
                style={{ opacity: currentCaps.supportsImages ? 1 : 0.3 }}
              >
                <ImagePlus size={18} />
              </button>

              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleImageUpload}
              />

              <textarea
                ref={inputRef}
                className="chat-input"
                placeholder={isStreaming ? "Waiting for response..." : "Send a message..."}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                rows={1}
              />

              {/* Deep Think toggle — only for Expert mode */}
              {!isStreaming && modelType === "expert" && (
                <button
                  className={`deep-think-toggle ${deepThink ? "active" : ""}`}
                  onClick={() => setDeepThink(!deepThink)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    borderRadius: "var(--radius-full)",
                    border: "1px solid var(--border-default)",
                    background: deepThink ? "var(--accent-subtle)" : "var(--bg-elevated)",
                    color: deepThink ? "var(--text-primary)" : "var(--text-tertiary)",
                    cursor: "pointer",
                    fontSize: "var(--font-size-xs)",
                    fontWeight: 500,
                    transition: "all var(--transition-fast)",
                    userSelect: "none",
                    alignSelf: "center",
                    marginRight: "var(--space-1)"
                  }}
                  title={deepThink ? "Using Nemotron-3 (Deep reasoning ON)" : "Using Cohere (Fast code model)"}
                >
                  <Brain size={13} style={{ color: deepThink ? "var(--success)" : "inherit" }} />
                  <span>Deep Think</span>
                  <span style={{
                    width: "18px",
                    height: "10px",
                    borderRadius: "var(--radius-full)",
                    background: deepThink ? "var(--success)" : "var(--text-muted)",
                    position: "relative",
                    display: "inline-block",
                    transition: "background var(--transition-fast)"
                  }}>
                    <span style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#fff",
                      position: "absolute",
                      top: "2px",
                      left: deepThink ? "10px" : "2px",
                      transition: "left var(--transition-fast)"
                    }} />
                  </span>
                </button>
              )}

              {isStreaming ? (
                <button
                  className="input-btn stop-btn"
                  onClick={handleStop}
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--error)",
                    border: "1px solid var(--border-hover)"
                  }}
                  title="Stop generating"
                >
                  <X size={16} />
                </button>
              ) : (
                <button
                  className="input-btn send-btn"
                  onClick={() => handleSend()}
                  disabled={(!inputText.trim() && !imageData)}
                  title="Send message"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
