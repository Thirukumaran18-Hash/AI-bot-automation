import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatResponse {
  reply: string;
  engine: string;
}

const FALLBACK_SUGGESTIONS: Record<string, string[]> = {
  intern: [
    "What are my open tasks?",
    "When is my next meeting?",
    "Show my status",
    "How do I submit my work?",
  ],
  admin: [
    "Give me a status summary",
    "Show upcoming meetings",
    "Pending reviews",
    "Which candidates are overdue?",
  ],
  mentor: [
    "Give me a status summary",
    "Show upcoming meetings",
    "Pending reviews",
    "Which candidates are overdue?",
  ],
};

export function Chatbot() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!user) return;
    setMessages([]);
    setSuggestions(FALLBACK_SUGGESTIONS[user.role] || FALLBACK_SUGGESTIONS.admin);
    api
      .get<{ suggestions: string[] }>("/api/chatbot/suggestions")
      .then((data) => setSuggestions(data.suggestions))
      .catch(() => undefined);
  }, [user]);

  useEffect(() => {
    if (!open) return;
    setUnread(false);
    window.setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, sending, open]);

  if (!user) return null;

  const welcome = `Hi ${user.name.split(" ")[0]}, I am the InternFlow assistant. Ask me about tasks, meetings, reviews or candidates.`;

  const send = async (value: string) => {
    const text = value.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const data = await api.post<ChatResponse>("/api/chatbot/message", {
        message: text,
        history: next.slice(-8),
      });
      setMessages((current) => [...current, { role: "assistant", content: data.reply }]);
      if (!open) setUnread(true);
    } catch (err) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            err instanceof ApiError
              ? `Sorry, I could not answer: ${err.message}`
              : "Sorry, the assistant is unavailable right now.",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(input);
    }
  };

  return (
    <div className="chatbot-root">
      {open && (
        <section className="chatbot-panel" aria-label="InternFlow assistant">
          <header className="chatbot-header">
            <span className="chatbot-avatar">
              <Icon name="sparkles" size={19} />
            </span>
            <div>
              <strong>InternFlow Assistant</strong>
              <span>
                <i className="chatbot-online" /> Live workspace data
              </span>
            </div>
            <button
              className="chatbot-icon-button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
            >
              <Icon name="x" size={17} />
            </button>
          </header>

          <div className="chatbot-body" ref={bodyRef}>
            <div className="chatbot-row assistant">
              <span className="chatbot-bubble-avatar">
                <Icon name="sparkles" size={13} />
              </span>
              <div className="chatbot-bubble">
                <Markdown text={welcome} className="chatbot-md" />
              </div>
            </div>

            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`chatbot-row ${message.role === "user" ? "user" : "assistant"}`}
              >
                {message.role === "assistant" && (
                  <span className="chatbot-bubble-avatar">
                    <Icon name="sparkles" size={13} />
                  </span>
                )}
                <div className="chatbot-bubble">
                  {message.role === "assistant" ? (
                    <Markdown text={message.content} className="chatbot-md" />
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="chatbot-row assistant">
                <span className="chatbot-bubble-avatar">
                  <Icon name="sparkles" size={13} />
                </span>
                <div className="chatbot-bubble chatbot-typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          {messages.length === 0 && (
            <div className="chatbot-suggestions">
              {suggestions.map((item) => (
                <button key={item} type="button" onClick={() => void send(item)} disabled={sending}>
                  {item}
                </button>
              ))}
            </div>
          )}

          <form className="chatbot-form" onSubmit={onSubmit}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={2000}
              placeholder="Ask about tasks, meetings, reviews..."
            />
            <button
              type="submit"
              className="chatbot-send"
              disabled={!input.trim() || sending}
              aria-label="Send message"
            >
              <Icon name="send" size={17} />
            </button>
          </form>
          <div className="chatbot-footnote">Answers use your live role-scoped workspace data.</div>
        </section>
      )}

      <button
        type="button"
        className={`chatbot-toggle ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close assistant" : "Open assistant"}
      >
        {open ? <Icon name="x" size={21} /> : <Icon name="sparkles" size={22} />}
        {!open && <span>Ask AI</span>}
        {unread && <i className="chatbot-unread" />}
      </button>
    </div>
  );
}
