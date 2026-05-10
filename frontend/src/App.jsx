import { Routes, Route, Navigate, Outlet } from 'react-router-dom'

import Layout from './components/layout/Layout'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import AdminOverview from './pages/AdminOverview'
import ComplaintsDesk from './pages/ComplaintsDesk'
import CrowdControl from './pages/CrowdControl'
import ModuleSelector from './pages/ModuleSelector'
import Dashboard from './pages/Dashboard'
import FireDetection from './pages/FireDetection'
import Students from './pages/Students'
import StudentSupport from './pages/StudentSupport'
import Subjects from './pages/Subjects'
import TakeAttendance from './pages/TakeAttendance'
import Attendance from './pages/Attendance'
import CameraSettings from './pages/CameraSettings'

function FullPageLoader() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <p className="text-sm tracking-[0.3em] uppercase text-slate-400">Loading session</p>
    </div>
  )
}

function ProtectedRoute() {
  const { loading, isAuthenticated } = useAuth()

  if (loading) return <FullPageLoader />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}

function PublicOnlyRoute() {
  const { loading, isAuthenticated } = useAuth()

  if (loading) return <FullPageLoader />
  if (isAuthenticated) return <Navigate to="/home" replace />
  return <Outlet />
}

/** `/` — chatbot for guests, redirect to /home for logged-in staff */
export default function App() {
  return (
    <Routes>
      {/* Unauthenticated root — chatbot for guests */}
      <Route path="/" element={<Navigate to="/home" replace />} />

      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<Login />} />
      </Route>

      {/* Public chatbot alias */}
      <Route path="/support" element={<StudentSupport />} />

      <Route element={<ProtectedRoute />}>
        {/* Module selector — authenticated landing */}
        <Route path="/home" element={<ModuleSelector />} />

        <Route path="/admin" element={<Layout module="admin" />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminOverview />} />
          <Route path="complaints" element={<ComplaintsDesk />} />
          <Route path="fire" element={<FireDetection />} />
          <Route path="crowd" element={<CrowdControl />} />
          <Route path="camera" element={<CameraSettings />} />
        </Route>

        {/* Attendance module */}
        <Route path="/attendance" element={<Layout module="attendance" />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="students" element={<Students />} />
          <Route path="subjects" element={<Subjects />} />
          <Route path="subjects/:subjectId/attendance" element={<TakeAttendance />} />
          <Route path="records" element={<Attendance />} />
          <Route path="camera" element={<Navigate to="/admin/camera" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
