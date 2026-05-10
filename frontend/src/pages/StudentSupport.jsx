import { useEffect, useRef, useState } from 'react'
import { sendMessage } from '../api/chatbotApi'

const SESSION_STORAGE_KEY = 'jiit_buddy_session_id'

const QUICK_PROMPTS = [
  'I am confused about admissions. Can you guide me step by step?',
  'What B.Tech programs does JIIT offer?',
  'I am stressed about placements. What should I focus on?',
  'How can I contact the admissions office?',
  'Tell me about JIIT research facilities',
]

const INITIAL_MESSAGES = [
  {
    id: 'init-1',
    role: 'assistant',
    text: "Hi, I am JIIT Buddy. You can ask me anything about JIIT, and I will help you calmly, step by step.",
    sources: [],
  },
]

function renderInlineMarkdown(text) {
  const withoutLinks = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  const parts = withoutLinks.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)

  return parts.map((part, index) => {
    if (!part) return null

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      )
    }

    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-700">
          {part.slice(1, -1)}
        </code>
      )
    }

    return part
  })
}

function MarkdownMessage({ text }) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  let paragraph = []
  let listItems = []
  let listType = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const content = paragraph.join(' ').trim()
    if (content) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="text-sm leading-7 text-slate-700">
          {renderInlineMarkdown(content)}
        </p>
      )
    }
    paragraph = []
  }

  const flushList = () => {
    if (listItems.length === 0) return
    const Tag = listType === 'ol' ? 'ol' : 'ul'
    blocks.push(
      <Tag
        key={`list-${blocks.length}`}
        className={`${listType === 'ol' ? 'list-decimal' : 'list-disc'} space-y-1.5 pl-5 text-sm leading-7 text-slate-700`}
      >
        {listItems.map((item, index) => (
          <li key={index}>{renderInlineMarkdown(item)}</li>
        ))}
      </Tag>
    )
    listItems = []
    listType = null
  }

  lines.forEach((line) => {
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      flushList()
      return
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push(
        <h3 key={`h-${blocks.length}`} className="pt-1 text-sm font-semibold leading-6 text-slate-900">
          {renderInlineMarkdown(heading[2])}
        </h3>
      )
      return
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      if (listType && listType !== 'ul') flushList()
      listType = 'ul'
      listItems.push(bullet[1])
      return
    }

    const numbered = trimmed.match(/^\d+\.\s+(.+)$/)
    if (numbered) {
      flushParagraph()
      if (listType && listType !== 'ol') flushList()
      listType = 'ol'
      listItems.push(numbered[1])
      return
    }

    flushList()
    paragraph.push(trimmed)
  })

  flushParagraph()
  flushList()

  return <div className="space-y-3">{blocks}</div>
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-white border border-slate-200 rounded-3xl px-4 py-3 shadow-sm flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
        <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
        <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" />
      </div>
    </div>
  )
}

export default function StudentSupport() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES)
  const [draft, setDraft] = useState('')
  const [sessionId, setSessionId] = useState(() => window.localStorage.getItem(SESSION_STORAGE_KEY) || '')
  const [displayName, setDisplayName] = useState('')
  const [shareName, setShareName] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const submitMessage = async (text, { raiseComplaint = false } = {}) => {
    const clean = text.trim()
    if (!clean || loading) return

    setDraft('')
    setError('')

    const userMsg = { id: Date.now(), role: 'user', text: clean, sources: [] }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    const history = messages
      .filter((m) => m.id !== 'init-1')
      .map((m) => ({ role: m.role, content: m.text }))

    try {
      const res = await sendMessage(clean, history, {
        session_id: sessionId || null,
        display_name: displayName.trim() || null,
        share_name: shareName,
        raise_complaint: raiseComplaint,
      })
      const { reply, session_id: nextSessionId, complaint } = res.data
      if (nextSessionId && nextSessionId !== sessionId) {
        setSessionId(nextSessionId)
        window.localStorage.setItem(SESSION_STORAGE_KEY, nextSessionId)
      }
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          text: reply,
          complaint,
          sources: [],
        },
      ])
    } catch (err) {
      const detail = err.response?.data?.detail ?? 'Something went wrong. Please try again.'
      setError(detail)
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id))
    } finally {
      setLoading(false)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitMessage(draft)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_30%),linear-gradient(180deg,_#f8fafc,_#e2e8f0)] px-4 py-8 sm:px-6 lg:px-10">
      <div className="max-w-7xl mx-auto grid xl:grid-cols-[0.9fr_1.1fr] gap-6 items-start">
        <section className="bg-slate-950 text-white rounded-[2rem] p-8 shadow-xl">
          <p className="text-xs uppercase tracking-[0.35em] text-sky-200/80">JIIT Buddy</p>
          <h1 className="mt-4 text-3xl font-bold leading-tight">
            A calm campus guide for JIIT questions, confusion, and next steps.
          </h1>
          <p className="mt-4 text-sm text-slate-300 leading-6">
            Ask about admissions, programs, placements, research, hostel, fees, faculty, or campus life.
            JIIT Buddy answers from JIIT website context and explains things in a student-friendly way.
          </p>

          <div className="mt-8 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
              Try asking
            </p>
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={loading}
                onClick={() => submitMessage(prompt)}
                className="w-full text-left rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40 transition-colors px-4 py-3"
              >
                <p className="text-sm font-medium text-white">{prompt}</p>
              </button>
            ))}
          </div>

          <div className="mt-8 rounded-3xl bg-white/5 border border-white/10 p-5 space-y-2">
            <p className="text-sm font-semibold text-white">Private and student-first</p>
            <p className="text-sm text-slate-300">
              You can ask freely. If you raise a complaint, admins see your chat ID and only see your display name when you choose to share it.
            </p>
          </div>
        </section>

        <section className="bg-white rounded-[2rem] border border-slate-200 shadow-xl overflow-hidden flex flex-col">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-sky-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
              J
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-900">JIIT Buddy</p>
              <p className="text-xs text-slate-500">
                {sessionId ? `Chat ID ${sessionId}` : 'Professional campus guidance for students'}
              </p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Online
            </span>
          </div>

          <div className="px-6 py-6 space-y-5 min-h-[480px] max-h-[560px] overflow-y-auto bg-slate-50/70 flex-1">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-xl">
                  <div
                    className={`rounded-3xl px-4 py-3 shadow-sm ${
                      msg.role === 'user'
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-700 border border-slate-200'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="space-y-3">
                        <MarkdownMessage text={msg.text} />
                        {msg.complaint && (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            Complaint ticket: <span className="font-semibold">{msg.complaint.ticket_id}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-6">{msg.text}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {loading && <TypingIndicator />}

            {error && (
              <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); submitMessage(draft) }}
            className="border-t border-slate-100 px-6 py-5 bg-white"
          >
            <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Display name for complaints
                  </label>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    disabled={loading}
                    placeholder="Optional"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 sm:max-w-[240px]">
                  <input
                    type="checkbox"
                    checked={shareName}
                    onChange={(e) => setShareName(e.target.checked)}
                    disabled={loading}
                    className="accent-sky-500"
                  />
                  Show my display name to admins if I raise a complaint
                </label>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                If unchecked, admins only see your chat ID.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
                disabled={loading}
                placeholder="Ask anything about JIIT... (Enter to send, Shift+Enter for newline)"
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !draft.trim()}
                className="sm:self-end rounded-2xl bg-sky-500 text-white px-5 py-3 text-sm font-semibold hover:bg-sky-600 transition-colors disabled:opacity-40"
              >
                {loading ? 'Thinking...' : 'Send'}
              </button>
              <button
                type="button"
                onClick={() => submitMessage(draft, { raiseComplaint: true })}
                disabled={loading || !draft.trim()}
                className="sm:self-end rounded-2xl bg-amber-500 text-white px-5 py-3 text-sm font-semibold hover:bg-amber-600 transition-colors disabled:opacity-40"
              >
                Raise Complaint
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              For critical decisions, please verify details with the college office.
            </p>
          </form>
        </section>
      </div>
    </div>
  )
}
