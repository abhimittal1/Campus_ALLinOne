import { useEffect, useState } from 'react'
import DataTable from '../components/ui/DataTable'
import { getAttendance, getSubjectReport } from '../api/attendanceApi'
import { getSubjects } from '../api/subjectsApi'
import toast from 'react-hot-toast'

// ── Log tab columns ───────────────────────────────────────────────────────────
const LOG_COLUMNS_BASE = [
  { key: 'student_id', label: 'Student ID' },
  { key: 'student_name', label: 'Name' },
  { key: 'subject_id', label: 'Subject' },
  { key: 'date', label: 'Date' },
  { key: 'time', label: 'Time' },
]

export default function Attendance() {
  const [tab, setTab] = useState('log') // 'log' | 'report'

  // ── Log tab state ──────────────────────────────────────────────────────────
  const [logRows, setLogRows] = useState([])
  const [logLoading, setLogLoading] = useState(true)
  const [logFilters, setLogFilters] = useState({ date_from: '', date_to: '', student_id: '' })

  // ── Report tab state ───────────────────────────────────────────────────────
  const [subjects, setSubjects] = useState([])
  const [selectedSubject, setSelectedSubject] = useState('')
  const [reportDateFrom, setReportDateFrom] = useState('')
  const [reportDateTo, setReportDateTo] = useState('')
  const [report, setReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)

  // Load subjects once (used in both tabs for display)
  useEffect(() => {
    getSubjects()
      .then((r) => {
        setSubjects(r.data)
        if (r.data.length > 0) setSelectedSubject(String(r.data[0].id))
      })
      .catch(() => {})
  }, [])

  // ── Log tab ────────────────────────────────────────────────────────────────
  const loadLog = () => {
    setLogLoading(true)
    const params = { limit: 500 }
    if (logFilters.date_from) params.date_from = logFilters.date_from
    if (logFilters.date_to) params.date_to = logFilters.date_to
    if (logFilters.student_id) params.student_id = logFilters.student_id
    getAttendance(params)
      .then((r) => setLogRows(r.data))
      .finally(() => setLogLoading(false))
  }

  useEffect(loadLog, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogFilterChange = (e) =>
    setLogFilters({ ...logFilters, [e.target.name]: e.target.value })

  // Build log columns with subject name resolution
  const logColumns = LOG_COLUMNS_BASE.map((col) => {
    if (col.key !== 'subject_id') return col
    return {
      ...col,
      render: (row) => {
        const sub = subjects.find((s) => s.id === row.subject_id)
        return sub ? (
          <span className="inline-flex items-center text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full font-medium">
            {sub.code}
          </span>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )
      },
    }
  })

  // ── Report tab ─────────────────────────────────────────────────────────────
  const loadReport = async () => {
    if (!selectedSubject) return
    setReportLoading(true)
    setReport(null)
    try {
      const params = { subject_id: parseInt(selectedSubject, 10) }
      if (reportDateFrom) params.date_from = reportDateFrom
      if (reportDateTo) params.date_to = reportDateTo
      const res = await getSubjectReport(params)
      setReport(res.data)
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Failed to load report')
    } finally {
      setReportLoading(false)
    }
  }

  // Auto-load when switching to report tab
  useEffect(() => {
    if (tab === 'report' && selectedSubject) loadReport()
  }, [tab, selectedSubject]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSubjectObj = subjects.find((s) => s.id === parseInt(selectedSubject, 10))
  const totalSessions = report
    ? [...new Set(report.flatMap((r) => r.dates))].length
    : 0

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-800">Attendance</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: 'log', label: 'Attendance Log' },
          { key: 'report', label: 'Subject Report' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── LOG TAB ── */}
      {tab === 'log' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
              <input
                type="date"
                name="date_from"
                value={logFilters.date_from}
                onChange={handleLogFilterChange}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <input
                type="date"
                name="date_to"
                value={logFilters.date_to}
                onChange={handleLogFilterChange}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Student ID</label>
              <input
                name="student_id"
                value={logFilters.student_id}
                onChange={handleLogFilterChange}
                placeholder="e.g. S001"
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <button
              onClick={loadLog}
              className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              Filter
            </button>
            <button
              onClick={() => {
                setLogFilters({ date_from: '', date_to: '', student_id: '' })
                setTimeout(loadLog, 0)
              }}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Clear
            </button>
          </div>
          <DataTable columns={logColumns} rows={logRows} loading={logLoading} />
        </div>
      )}

      {/* ── SUBJECT REPORT TAB ── */}
      {tab === 'report' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
              <select
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 min-w-[220px]"
              >
                {subjects.length === 0 && <option value="">No subjects yet</option>}
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
              <input
                type="date"
                value={reportDateFrom}
                onChange={(e) => setReportDateFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <input
                type="date"
                value={reportDateTo}
                onChange={(e) => setReportDateTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <button
              onClick={loadReport}
              className="bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              Load Report
            </button>
          </div>

          {/* Summary bar */}
          {report && selectedSubjectObj && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-3 flex flex-wrap gap-6 items-center">
              <div>
                <p className="text-xs text-gray-500">Subject</p>
                <p className="text-sm font-semibold text-gray-800">
                  {selectedSubjectObj.name}
                  <span className="ml-2 text-xs text-indigo-600 font-mono bg-indigo-50 px-1.5 py-0.5 rounded">
                    {selectedSubjectObj.code}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Enrolled</p>
                <p className="text-sm font-semibold text-gray-800">{report.length}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Unique Sessions</p>
                <p className="text-sm font-semibold text-gray-800">{totalSessions}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Attended at least once</p>
                <p className="text-sm font-semibold text-green-700">
                  {report.filter((r) => r.present_count > 0).length}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Never attended</p>
                <p className="text-sm font-semibold text-red-600">
                  {report.filter((r) => r.present_count === 0).length}
                </p>
              </div>
            </div>
          )}

          {reportLoading && (
            <p className="text-sm text-gray-400 py-8 text-center">Loading report…</p>
          )}

          {!reportLoading && report !== null && report.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 text-center">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-gray-500 text-sm">No enrolled students in this subject.</p>
            </div>
          )}

          {!reportLoading && report !== null && report.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Student</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">ID</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Classes Attended</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Attendance %</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Seen</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {report.map((r) => {
                    const pct = totalSessions > 0 ? Math.round((r.present_count / totalSessions) * 100) : 0
                    return (
                      <tr key={r.student_id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {r.photo_url ? (
                              <img src={r.photo_url} alt={r.student_name} className="w-8 h-8 rounded-full object-cover border border-gray-200 flex-shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 text-xs flex-shrink-0">?</div>
                            )}
                            <span className="font-medium text-gray-800">{r.student_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.student_id}</td>
                        <td className="px-4 py-3 text-center font-semibold text-gray-800">
                          {r.present_count}
                          {totalSessions > 0 && <span className="text-gray-400 font-normal text-xs"> / {totalSessions}</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {totalSessions > 0 ? (
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-20 bg-gray-100 rounded-full h-1.5">
                                <div
                                  className={`h-1.5 rounded-full ${pct >= 75 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-400' : 'bg-red-400'}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium text-gray-600 w-8">{pct}%</span>
                            </div>
                          ) : <span className="text-gray-400 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {r.last_seen ?? <span className="text-gray-300">Never</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {r.present_count > 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">✓ Present</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">✗ Absent</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!reportLoading && report === null && subjects.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 text-center text-gray-400 text-sm">
              Select a subject and click <strong>Load Report</strong>.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
