import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  UserGroupIcon,
  VideoCameraIcon,
} from '@heroicons/react/24/outline'

import StatCard from '../components/ui/StatCard'
import { getAttendanceSummary } from '../api/attendanceApi'
import { getStudents } from '../api/studentsApi'
import { getAdminChatSummary } from '../api/chatbotApi'
import { getFireAlertStats } from '../api/fireApi'

const QUICK_ACTIONS = [
  {
    to: '/admin/complaints',
    title: 'Complaints Desk',
    description: 'Review escalated student issues and route them to the right team.',
    accent: 'from-amber-500 to-orange-500',
    Icon: ChatBubbleLeftRightIcon,
  },
  {
    to: '/admin/fire',
    title: 'Fire Detection',
    description: 'Watch live camera alerts and inspect recent incidents.',
    accent: 'from-rose-500 to-red-500',
    Icon: ExclamationTriangleIcon,
  },
  {
    to: '/admin/crowd',
    title: 'Crowd Control',
    description: 'Track footfall density and crowd thresholds around campus.',
    accent: 'from-cyan-500 to-sky-500',
    Icon: UserGroupIcon,
  },
  {
    to: '/admin/camera',
    title: 'Camera Control',
    description: 'Update the shared camera source used across monitoring screens.',
    accent: 'from-slate-600 to-slate-800',
    Icon: VideoCameraIcon,
  },
]

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function AdminOverview() {
  const [loading, setLoading] = useState(true)
  const [studentCount, setStudentCount] = useState(0)
  const [presentToday, setPresentToday] = useState(0)
  const [fireAlertsToday, setFireAlertsToday] = useState(0)
  const [chatSummary, setChatSummary] = useState({
    open_complaints: 0,
    high_priority_complaints: 0,
    active_chat_sessions: 0,
    total_chat_messages: 0,
    recent_activity: [],
  })

  useEffect(() => {
    Promise.all([getAttendanceSummary(7), getStudents({ limit: 200 }), getAdminChatSummary(), getFireAlertStats()])
      .then(([summaryRes, studentsRes, chatRes, fireRes]) => {
        const summary = summaryRes.data
        const today = new Date().toISOString().slice(0, 10)
        const todayRow = summary.find((item) => item.date === today)
        setPresentToday(todayRow?.total ?? 0)
        setStudentCount(studentsRes.data.length)
        setChatSummary(chatRes.data)
        setFireAlertsToday(fireRes.data.alerts_today ?? 0)
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.25),_transparent_30%),linear-gradient(135deg,_#0f172a,_#1e293b_60%,_#334155)] text-white px-8 py-9">
        <p className="text-xs uppercase tracking-[0.35em] text-sky-200/80">Admin Overview</p>
        <div className="mt-4 max-w-2xl">
          <div className="max-w-2xl">
            <h1 className="text-3xl lg:text-4xl font-bold leading-tight">One console for attendance, complaints, fire alerts, and crowd monitoring.</h1>
            <p className="mt-3 text-sm text-slate-300 leading-6">
              Monitor attendance, student support chats, and complaint tickets raised through JIIT Buddy from one place.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard title="Registered Students" value={loading ? '...' : studentCount} colorClass="bg-primary-600" />
        <StatCard title="Present Today" value={loading ? '...' : presentToday} colorClass="bg-emerald-500" />
        <StatCard
          title="Open Complaints"
          value={loading ? '...' : chatSummary.open_complaints}
          subtitle={`${chatSummary.high_priority_complaints} high priority`}
          colorClass="bg-amber-500"
        />
        <StatCard
          title="Chat Sessions"
          value={loading ? '...' : chatSummary.active_chat_sessions}
          subtitle={`${chatSummary.total_chat_messages} messages`}
          colorClass="bg-sky-500"
        />
        <StatCard
          title="Fire Alerts Today"
          value={loading ? '...' : fireAlertsToday}
          colorClass="bg-rose-500"
        />
      </div>

      <section className="grid xl:grid-cols-[1.25fr_0.75fr] gap-6">
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Control modules</h2>
              <p className="text-sm text-slate-500">Jump into the new monitoring and support areas.</p>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {QUICK_ACTIONS.map(({ to, title, description, accent, Icon }) => (
              <Link
                key={to}
                to={to}
                className="group rounded-3xl border border-slate-200 bg-slate-50 hover:bg-white hover:shadow-md transition-all p-5"
              >
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${accent} text-white flex items-center justify-center`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm text-slate-500 leading-6">{description}</p>
                <span className="mt-4 inline-block text-sm font-semibold text-slate-900">Open</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Recent operations feed</h2>
            <p className="text-sm text-slate-500">Live support activity from JIIT Buddy and complaint tickets.</p>
          </div>
          <div className="space-y-3">
            {chatSummary.recent_activity.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                No chatbot activity yet.
              </div>
            ) : (
              chatSummary.recent_activity.map((item) => (
                <div key={`${item.time}-${item.title}`} className={`rounded-2xl border px-4 py-4 ${item.tone}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{item.title}</p>
                    <span className="text-xs font-semibold">{formatTime(item.time)}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6">{item.summary}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
