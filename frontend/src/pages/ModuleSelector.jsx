import { useNavigate } from 'react-router-dom'
import {
  ClipboardDocumentListIcon,
  ShieldCheckIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

import { useAuth } from '../hooks/useAuth'

const MODULES = [
  {
    title: 'Admin Console',
    description: 'Unified dashboard for complaints, fire alerts, crowd monitoring, and camera control.',
    Icon: ShieldCheckIcon,
    accent: 'from-slate-900 via-slate-800 to-slate-700',
    to: '/admin/dashboard',
  },
  {
    title: 'Fire Detection',
    description: 'Monitor campus camera zones for fire and smoke in real-time using YOLOv8 AI detection.',
    Icon: ExclamationTriangleIcon,
    accent: 'from-rose-700 via-rose-600 to-orange-500',
    to: '/admin/fire',
  },
  {
    title: 'Attendance System',
    description: 'Students, subjects, live face attendance, and attendance records.',
    Icon: ClipboardDocumentListIcon,
    accent: 'from-primary-700 via-primary-600 to-sky-500',
    to: '/attendance/dashboard',
  },
  {
    title: 'JIIT Buddy',
    description: 'AI chatbot grounded in the JIIT official website. Ask about admissions, programs, placements, research, and campus life.',
    Icon: ChatBubbleLeftRightIcon,
    accent: 'from-sky-700 via-sky-600 to-cyan-500',
    to: '/support',
  },
]

export default function ModuleSelector() {
  const navigate = useNavigate()
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.24),_transparent_28%),linear-gradient(180deg,_#0f172a,_#111827_48%,_#1f2937)] px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="rounded-[2rem] border border-white/10 bg-white/5 backdrop-blur-sm text-white px-8 py-8">
          <p className="text-xs uppercase tracking-[0.35em] text-sky-200/80">Campus Security Suite</p>
          <div className="mt-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">Choose where you want to operate.</h1>
              <p className="mt-3 text-slate-300 max-w-2xl text-sm leading-6">
                Open the staff tools for campus operations, the attendance workflow, or chat with JIIT Buddy — the AI assistant grounded in official JIIT content.
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 border border-white/10 px-4 py-3 text-sm text-slate-200">
              Signed in as <span className="font-semibold text-white">{user?.username ?? 'admin'}</span>
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-6">
          {MODULES.map(({ title, description, Icon, accent, to }) => (
            <button
              key={to}
              type="button"
              onClick={() => navigate(to)}
              className="group text-left rounded-[2rem] overflow-hidden border border-white/10 bg-white shadow-xl hover:-translate-y-1 transition-transform"
            >
              <div className={`h-40 bg-gradient-to-br ${accent} px-6 py-6 text-white flex flex-col justify-between`}>
                <Icon className="h-12 w-12" />
                <span className="text-xs uppercase tracking-[0.3em] text-white/70">Open module</span>
              </div>
              <div className="p-6">
                <h2 className="text-2xl font-bold text-slate-900 group-hover:text-primary-700 transition-colors">
                  {title}
                </h2>
                <p className="mt-3 text-sm text-slate-500 leading-6">
                  {description}
                </p>
                <span className="mt-5 inline-flex items-center text-sm font-semibold text-slate-900">
                  Launch
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
