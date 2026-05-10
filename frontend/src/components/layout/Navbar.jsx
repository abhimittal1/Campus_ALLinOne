import { useNavigate } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'

export default function Navbar({ module }) {
  const label = module === 'admin' ? 'Admin Console' : 'Attendance System'
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="flex items-center justify-between h-14 px-6 bg-white border-b border-gray-200 shadow-sm">
      <span className="text-gray-400 text-xs font-medium uppercase tracking-widest">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-gray-500 text-sm">Welcome back, <strong>{user?.username ?? 'admin'}</strong></span>
        <button
          type="button"
          onClick={handleLogout}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
        >
          Logout
        </button>
      </div>
    </header>
  )
}
