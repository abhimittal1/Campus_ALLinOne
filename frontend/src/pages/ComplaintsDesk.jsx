import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'

import DataTable from '../components/ui/DataTable'
import Modal from '../components/ui/Modal'
import StatCard from '../components/ui/StatCard'
import {
  getAdminChatSessions,
  getAdminComplaints,
  getAdminSessionMessages,
  getComplaintStats,
  updateComplaintStatus,
} from '../api/chatbotApi'

const STATUS_OPTIONS = ['Open', 'In Review', 'Waiting on Student', 'Resolved', 'Closed']

const PRIORITY_CLASS = {
  High: 'bg-rose-50 text-rose-700',
  Medium: 'bg-cyan-50 text-cyan-700',
  Low: 'bg-emerald-50 text-emerald-700',
}

const STATUS_CLASS = {
  Open: 'bg-amber-50 text-amber-700',
  'In Review': 'bg-violet-50 text-violet-700',
  'Waiting on Student': 'bg-slate-100 text-slate-700',
  Resolved: 'bg-emerald-50 text-emerald-700',
  Closed: 'bg-slate-100 text-slate-500',
}

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function displayStudentName(row) {
  return row.display_name || 'Anonymous'
}

export default function ComplaintsDesk() {
  const [complaints, setComplaints] = useState([])
  const [sessions, setSessions] = useState([])
  const [stats, setStats] = useState({ by_status: {}, by_priority: {} })
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState(null)
  const [sessionMessages, setSessionMessages] = useState([])
  const [messagesLoading, setMessagesLoading] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([
      getAdminComplaints({ limit: 200 }),
      getComplaintStats(),
      getAdminChatSessions({ limit: 8 }),
    ])
      .then(([complaintsRes, statsRes, sessionsRes]) => {
        setComplaints(complaintsRes.data)
        setStats(statsRes.data)
        setSessions(sessionsRes.data)
      })
      .catch(() => toast.error('Failed to load support desk data'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleStatusChange = async (ticketId, status) => {
    try {
      await updateComplaintStatus(ticketId, status)
      toast.success('Complaint updated')
      load()
    } catch {
      toast.error('Failed to update complaint')
    }
  }

  const openSession = async (session) => {
    setSelectedSession(session)
    setSessionMessages([])
    setMessagesLoading(true)
    try {
      const res = await getAdminSessionMessages(session.session_id)
      setSessionMessages(res.data)
    } catch {
      toast.error('Failed to load chat messages')
    } finally {
      setMessagesLoading(false)
    }
  }

  const openCount =
    (stats.by_status?.Open ?? 0) +
    (stats.by_status?.['In Review'] ?? 0) +
    (stats.by_status?.['Waiting on Student'] ?? 0)
  const highPriority = stats.by_priority?.High ?? 0
  const resolved = (stats.by_status?.Resolved ?? 0) + (stats.by_status?.Closed ?? 0)

  const columns = [
    { key: 'ticket_id', label: 'Ticket' },
    {
      key: 'display_name',
      label: 'Student',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{displayStudentName(row)}</p>
          <p className="text-xs font-mono text-slate-400">{row.session_id}</p>
        </div>
      ),
    },
    { key: 'category', label: 'Category' },
    {
      key: 'priority',
      label: 'Priority',
      render: (row) => (
        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${PRIORITY_CLASS[row.priority] ?? PRIORITY_CLASS.Medium}`}>
          {row.priority}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <select
          value={row.status}
          onChange={(e) => handleStatusChange(row.ticket_id, e.target.value)}
          className={`rounded-full border-0 px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500 ${STATUS_CLASS[row.status] ?? STATUS_CLASS.Open}`}
        >
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      ),
    },
    {
      key: 'title',
      label: 'Issue',
      render: (row) => (
        <p className="max-w-[260px] truncate text-slate-700" title={row.summary}>
          {row.title}
        </p>
      ),
    },
    {
      key: 'updated_at',
      label: 'Updated',
      render: (row) => formatDateTime(row.updated_at),
    },
  ]

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] bg-gradient-to-br from-amber-50 via-white to-orange-50 border border-amber-200 p-7">
        <div>
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-amber-600">Complaints Desk</p>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">Live student support queue from JIIT Buddy.</h1>
            <p className="mt-3 text-sm text-slate-600 max-w-2xl leading-6">
              Students can ask the chatbot for guidance first. If the issue needs staff attention, JIIT Buddy creates a ticket here with the chat ID and optional display name.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Open Complaints" value={loading ? '...' : openCount} colorClass="bg-amber-500" />
        <StatCard title="High Priority" value={loading ? '...' : highPriority} colorClass="bg-rose-500" />
        <StatCard title="Resolved / Closed" value={loading ? '...' : resolved} colorClass="bg-emerald-500" />
      </div>

      <section className="grid xl:grid-cols-[1.35fr_0.65fr] gap-6">
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Current queue</h2>
            <p className="text-sm text-slate-500">Tickets raised from chatbot conversations.</p>
          </div>
          <DataTable columns={columns} rows={complaints} loading={loading} />
        </div>

        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Recent chats</h2>
            <p className="text-sm text-slate-500">Monitor what students are asking JIIT Buddy.</p>
          </div>

          {sessions.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-5 text-sm text-slate-500">
              No chat sessions yet.
            </p>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <button
                  key={session.session_id}
                  type="button"
                  onClick={() => openSession(session)}
                  className="w-full text-left rounded-2xl border border-slate-200 hover:border-sky-200 hover:bg-sky-50/60 px-4 py-3 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-900">
                      {session.display_name || 'Anonymous'}
                    </p>
                    <span className="text-xs font-mono text-slate-400">{session.session_id}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500 line-clamp-2">
                    {session.last_message || 'No messages yet'}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    {session.message_count} messages · {session.complaint_count} complaints · {formatDateTime(session.updated_at)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <Modal
        open={!!selectedSession}
        onClose={() => setSelectedSession(null)}
        title={`Chat ${selectedSession?.session_id ?? ''}`}
        size="lg"
      >
        {messagesLoading ? (
          <p className="py-6 text-center text-sm text-slate-400">Loading messages...</p>
        ) : (
          <div className="max-h-[520px] overflow-y-auto space-y-3 pr-1">
            {sessionMessages.map((message, index) => (
              <div
                key={`${message.created_at}-${index}`}
                className={`rounded-2xl px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-50 text-slate-700 border border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide opacity-70">
                    {message.role}
                  </span>
                  <span className="text-xs opacity-60">{formatDateTime(message.created_at)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.content}</p>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
