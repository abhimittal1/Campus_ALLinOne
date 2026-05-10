import { useEffect, useState } from 'react'

import AttendanceChart from '../components/charts/AttendanceChart'
import StatCard from '../components/ui/StatCard'
import { getAttendanceSummary } from '../api/attendanceApi'
import { getStudents } from '../api/studentsApi'

export default function Dashboard() {
  const [summary, setSummary] = useState([])
  const [studentCount, setStudentCount] = useState(0)
  const [todayCount, setTodayCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getAttendanceSummary(7), getStudents({ limit: 200 })])
      .then(([sumRes, stuRes]) => {
        const data = sumRes.data
        setSummary(data)
        const today = new Date().toISOString().slice(0, 10)
        const todayRow = data.find((d) => d.date === today)
        setTodayCount(todayRow?.total ?? 0)
        setStudentCount(stuRes.data.length)
      })
      .finally(() => setLoading(false))
  }, [])

  const totalWeek = summary.reduce((acc, d) => acc + d.total, 0)
  const averageDaily = summary.length ? Math.round(totalWeek / summary.length) : 0

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] bg-gradient-to-br from-blue-50 via-white to-sky-50 border border-blue-200 p-7">
        <p className="text-xs uppercase tracking-[0.35em] text-blue-600">Attendance Dashboard</p>
        <h1 className="mt-3 text-3xl font-bold text-slate-900">Monitor daily presence with a clean operational view.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Use this module to register students, manage subjects, take face-based attendance, and review records without leaving the attendance workflow.
        </p>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Registered Students"
          value={loading ? '...' : studentCount}
          colorClass="bg-primary-600"
        />
        <StatCard
          title="Present Today"
          value={loading ? '...' : todayCount}
          colorClass="bg-emerald-500"
        />
        <StatCard
          title="Total This Week"
          value={loading ? '...' : totalWeek}
          colorClass="bg-violet-500"
        />
        <StatCard
          title="Daily Average"
          value={loading ? '...' : averageDaily}
          colorClass="bg-sky-500"
        />
      </div>

      <section className="grid xl:grid-cols-[1.25fr_0.75fr] gap-6">
        <AttendanceChart data={summary} />

        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6">
          <h2 className="text-xl font-semibold text-slate-900">Recommended flow</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Keep the attendance setup in this order so camera scans are reliable and reports stay accurate.
          </p>
          <div className="mt-5 space-y-3">
            {[
              'Register student profiles',
              'Capture face data from the camera',
              'Enroll students into subjects',
              'Take attendance from the Subjects page',
            ].map((item, index) => (
              <div key={item} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">
                  {index + 1}
                </span>
                <span className="text-sm font-medium text-slate-700">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
