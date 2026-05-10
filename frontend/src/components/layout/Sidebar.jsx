import { NavLink, useNavigate } from 'react-router-dom'
import {
  ChatBubbleLeftRightIcon,
  HomeIcon,
  UsersIcon,
  ClipboardDocumentListIcon,
  VideoCameraIcon,
  BookOpenIcon,
  ArrowLeftIcon,
  ExclamationTriangleIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'

const ADMIN_LINKS = [
  { to: '/admin/dashboard', label: 'Overview', Icon: HomeIcon },
  { to: '/admin/complaints', label: 'Complaints', Icon: ChatBubbleLeftRightIcon },
  { to: '/admin/fire', label: 'Fire Detection', Icon: ExclamationTriangleIcon },
  { to: '/admin/crowd', label: 'Crowd Control', Icon: UserGroupIcon },
  { to: '/admin/camera', label: 'Camera', Icon: VideoCameraIcon },
  { to: '/support', label: 'JIIT Buddy', Icon: ChatBubbleLeftRightIcon },
]

const ATTENDANCE_LINKS = [
  { to: '/attendance/dashboard', label: 'Dashboard', Icon: HomeIcon },
  { to: '/attendance/students', label: 'Students', Icon: UsersIcon },
  { to: '/attendance/subjects', label: 'Subjects', Icon: BookOpenIcon },
  { to: '/attendance/records', label: 'Attendance', Icon: ClipboardDocumentListIcon },
  { to: '/support', label: 'JIIT Buddy', Icon: ChatBubbleLeftRightIcon },
]

const MODULE_META = {
  admin: {
    title: 'Campus Ops',
    accentBg: 'bg-slate-900',
    accentActive: 'bg-slate-800',
    accentHover: 'hover:bg-slate-800',
    accentBorder: 'border-slate-800',
    links: ADMIN_LINKS,
  },
  attendance: {
    title: 'Face Attend',
    accentBg: 'bg-primary-700',
    accentActive: 'bg-primary-600',
    accentHover: 'hover:bg-primary-600',
    accentBorder: 'border-primary-600',
    links: ATTENDANCE_LINKS,
  },
}

export default function Sidebar({ module }) {
  const navigate = useNavigate()
  const meta = MODULE_META[module] ?? MODULE_META.admin
  const { links, accentBg, accentActive, accentHover, accentBorder, title } = meta

  return (
    <aside className={`flex flex-col w-60 min-h-screen ${accentBg} text-white`}>
      <div className={`px-6 py-5 text-xl font-bold tracking-wide border-b ${accentBorder}`}>
        {title}
      </div>

      {/* Back to modules */}
      <button
        onClick={() => navigate('/home')}
        className={`flex items-center gap-2 px-6 py-3 text-xs font-medium text-white/70 ${accentHover} hover:text-white transition-colors border-b ${accentBorder}`}
      >
        <ArrowLeftIcon className="w-4 h-4" />
        All Modules
      </button>

      <nav className="flex-1 py-4 space-y-1">
        {links.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? `${accentActive} text-white`
                  : `text-white/80 ${accentHover} hover:text-white`
              }`
            }
          >
            <Icon className="w-5 h-5 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
