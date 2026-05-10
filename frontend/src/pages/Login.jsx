import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '' })
  const [submitting, setSubmitting] = useState(false)

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await login(form.username.trim(), form.password)
      navigate('/home', { replace: true })
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Sign in failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-6 py-10">
      <div className="w-full max-w-5xl rounded-[2rem] overflow-hidden shadow-2xl border border-white/10 bg-slate-900 grid lg:grid-cols-[1.2fr_0.8fr]">
        <div className="relative hidden lg:flex flex-col justify-between p-10 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.35),_transparent_35%),linear-gradient(135deg,_#0f172a,_#111827_58%,_#1e293b)] text-white">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-sky-200/80">Campus Operations</p>
            <h1 className="mt-6 text-4xl font-bold leading-tight">Admin control for attendance, incidents, and student support.</h1>
            <p className="mt-4 max-w-md text-sm text-slate-300 leading-6">
              Sign in to manage attendance records, camera settings, complaint resolution, and the new monitoring modules from one place.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <p className="text-slate-400">Attendance</p>
              <p className="mt-2 text-2xl font-semibold">Live</p>
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <p className="text-slate-400">Complaints</p>
              <p className="mt-2 text-2xl font-semibold">Tracked</p>
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <p className="text-slate-400">Monitoring</p>
              <p className="mt-2 text-2xl font-semibold">Unified</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-8 sm:p-10 lg:p-12">
          <div className="max-w-sm mx-auto">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-primary-600">Admin Sign In</p>
            <h2 className="mt-3 text-3xl font-bold text-slate-900">Welcome back</h2>
            <p className="mt-2 text-sm text-slate-500">Use the seeded development admin or your registered admin account.</p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Username</label>
                <input
                  name="username"
                  value={form.username}
                  onChange={handleChange}
                  autoComplete="username"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="admin"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  autoComplete="current-password"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Enter password"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-60"
              >
                {submitting ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <div className="mt-6 rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-800">Development credentials</p>
              <p className="mt-1">Username: <span className="font-mono">admin</span></p>
              <p>Password: <span className="font-mono">admin12345</span></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
