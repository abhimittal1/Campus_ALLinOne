import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeftIcon,
  CameraIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentCheckIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'

import { createAttendance } from '../api/attendanceApi'
import { getCameraConfig } from '../api/cameraApi'
import { getSubject, getSubjectStudents, takeAttendance } from '../api/subjectsApi'

export default function TakeAttendance() {
  const { subjectId } = useParams()
  const navigate = useNavigate()

  const [subject, setSubject] = useState(null)
  const [cameraUrl, setCameraUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [snapshotTs, setSnapshotTs] = useState(Date.now())

  const [enrolledStudents, setEnrolledStudents] = useState([])
  const [scanning, setScanning] = useState(false)
  const [results, setResults] = useState(null)
  const [checked, setChecked] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([getSubject(subjectId), getCameraConfig(), getSubjectStudents(subjectId)])
      .then(([subRes, camRes, enrollRes]) => {
        setSubject(subRes.data)
        setCameraUrl(camRes.data.url)
        setEnrolledStudents(enrollRes.data)
      })
      .catch(() => toast.error('Failed to load subject'))
      .finally(() => setLoading(false))
  }, [subjectId])

  useEffect(() => {
    const id = setInterval(() => setSnapshotTs(Date.now()), 1500)
    return () => clearInterval(id)
  }, [])

  const handleScan = async () => {
    setScanning(true)
    setResults(null)

    try {
      const res = await takeAttendance(subjectId)
      const data = res.data
      setResults(data)

      const initialChecked = {}
      data.forEach((row) => {
        if (row.enrolled && !row.already_marked) initialChecked[row.student_id] = true
      })
      setChecked(initialChecked)

      const enrolledCount = data.filter((row) => row.enrolled).length
      const notEnrolledCount = data.filter((row) => !row.enrolled).length

      if (data.length === 0) {
        toast('No recognized faces in the frame')
      } else if (enrolledCount === 0 && notEnrolledCount > 0) {
        toast(`${notEnrolledCount} face(s) detected, but none are enrolled in this subject`)
      } else {
        toast.success(`${enrolledCount} enrolled student(s) detected`)
        if (notEnrolledCount > 0) {
          toast(`${notEnrolledCount} face(s) are not enrolled in this subject`)
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Scan failed. Check the camera connection.')
    } finally {
      setScanning(false)
    }
  }

  const handleSaveAttendance = async () => {
    const toSave = (results ?? []).filter((row) => row.enrolled && checked[row.student_id])
    if (toSave.length === 0) {
      toast.error('No students selected')
      return
    }

    setSaving(true)
    const now = new Date()
    const dateStr = now.toISOString().slice(0, 10)
    const timeStr = now.toTimeString().slice(0, 8)

    try {
      await Promise.all(
        toSave.map((row) =>
          createAttendance({
            student_id: row.student_id,
            student_name: row.student_name,
            subject_id: parseInt(subjectId, 10),
            date: dateStr,
            time: timeStr,
            timestamp: now.toISOString(),
          })
        )
      )
      toast.success(`Attendance saved for ${toSave.length} student(s)`)
      setResults(null)
      setChecked({})
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Failed to save attendance')
    } finally {
      setSaving(false)
    }
  }

  const toggleCheck = (studentId) => {
    setChecked((prev) => ({ ...prev, [studentId]: !prev[studentId] }))
  }

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const faceRegisteredCount = enrolledStudents.filter((student) => student.face_registered).length
  const missingFaceStudents = enrolledStudents.filter((student) => !student.face_registered)
  const enrolledDetected = (results ?? []).filter((row) => row.enrolled)
  const notEnrolledDetected = (results ?? []).filter((row) => !row.enrolled)
  const selectableCount = Object.values(checked).filter(Boolean).length
  const detectedIds = new Set((results ?? []).map((row) => row.student_id))
  const absentStudents = enrolledStudents.filter(
    (student) => student.face_registered && !detectedIds.has(student.student_id)
  )

  if (loading) {
    return (
      <div className="rounded-[2rem] border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
        Loading attendance workspace...
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] bg-gradient-to-br from-blue-50 via-white to-sky-50 border border-blue-200 p-7">
        <button
          type="button"
          onClick={() => navigate('/attendance/subjects')}
          className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-blue-50 transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Subjects
        </button>

        <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-blue-600">Face Attendance</p>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">
              Take attendance for {subject?.name}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Scan the classroom camera, review detected students, and save only the selected enrolled students for today's session.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Date" value={today.split(',')[0]} Icon={ClockIcon} />
            <Metric label="Subject" value={subject?.code ?? '-'} Icon={DocumentCheckIcon} />
            <Metric label="Enrolled" value={enrolledStudents.length} Icon={UserGroupIcon} />
            <Metric label="Face Ready" value={`${faceRegisteredCount}/${enrolledStudents.length}`} Icon={CheckCircleIcon} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Live camera preview</h2>
              <p className="text-sm text-slate-500">The scan uses the backend camera snapshot configured for this app.</p>
            </div>
            <span className="max-w-full truncate rounded-full bg-slate-100 px-3 py-1 text-xs font-mono text-slate-500 sm:max-w-[260px]">
              {cameraUrl || 'No camera URL set'}
            </span>
          </div>

          <div className="relative flex min-h-[360px] items-center justify-center bg-slate-950">
            <img
              key={snapshotTs}
              src={`/camera/snapshot?t=${snapshotTs}`}
              alt="Camera preview"
              className="h-full max-h-[520px] w-full object-contain"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              {!cameraUrl && (
                <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-slate-200 backdrop-blur">
                  Camera URL is not configured yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-600 text-white">
                <CameraIcon className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Scan controls</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Make sure students are visible, then run a scan. You can review matches before saving attendance.
                </p>
              </div>
            </div>

            {missingFaceStudents.length > 0 && (
              <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <div className="flex items-start gap-2">
                  <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">{missingFaceStudents.length} enrolled student(s) need face registration.</p>
                    <p className="mt-1 leading-6">
                      {missingFaceStudents.map((student) => student.name).join(', ')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleScan}
              disabled={scanning}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
            >
              {scanning ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Scanning...
                </>
              ) : (
                <>
                  <MagnifyingGlassIcon className="h-5 w-5" />
                  Scan Now
                </>
              )}
            </button>
          </div>

          {results !== null && (
            <ResultsPanel
              enrolledDetected={enrolledDetected}
              notEnrolledDetected={notEnrolledDetected}
              absentStudents={absentStudents}
              checked={checked}
              selectableCount={selectableCount}
              saving={saving}
              onToggle={toggleCheck}
              onSave={handleSaveAttendance}
            />
          )}
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value, Icon }) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-blue-600">
        <Icon className="h-4 w-4" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-lg font-bold text-slate-900">{value}</p>
    </div>
  )
}

function ResultsPanel({
  enrolledDetected,
  notEnrolledDetected,
  absentStudents,
  checked,
  selectableCount,
  saving,
  onToggle,
  onSave,
}) {
  return (
    <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Scan review</h2>
          <p className="mt-1 text-sm text-slate-500">Confirm the enrolled students before saving.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {enrolledDetected.length} matched
        </span>
      </div>

      <div className="mt-5 space-y-5">
        <section>
          <p className="text-sm font-semibold text-slate-700">Enrolled students detected</p>
          {enrolledDetected.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              No enrolled students were recognized in the frame.
            </p>
          ) : (
            <ul className="mt-3 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200">
              {enrolledDetected.map((row) => (
                <li key={row.student_id} className="flex items-center gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    id={`chk-${row.student_id}`}
                    checked={!!checked[row.student_id]}
                    onChange={() => onToggle(row.student_id)}
                    disabled={row.already_marked}
                    className="h-4 w-4 accent-primary-600"
                  />
                  <label
                    htmlFor={`chk-${row.student_id}`}
                    className={`min-w-0 flex-1 cursor-pointer text-sm ${
                      row.already_marked ? 'text-slate-400 line-through' : 'text-slate-800'
                    }`}
                  >
                    <span className="font-medium">{row.student_name}</span>
                    <span className="ml-2 font-mono text-xs text-slate-400">{row.student_id}</span>
                    {row.already_marked && (
                      <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        Already marked
                      </span>
                    )}
                  </label>
                  <span className="text-xs font-semibold text-emerald-600">
                    {(row.similarity * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {notEnrolledDetected.length > 0 && (
          <section>
            <p className="text-sm font-semibold text-amber-700">
              Recognized but not enrolled ({notEnrolledDetected.length})
            </p>
            <ul className="mt-3 max-h-44 divide-y divide-amber-100 overflow-y-auto rounded-2xl border border-amber-200 bg-amber-50">
              {notEnrolledDetected.map((row) => (
                <li key={row.student_id} className="flex items-center gap-3 px-4 py-3 text-sm text-amber-900">
                  <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-amber-600" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{row.student_name}</span>
                    <span className="ml-2 font-mono text-xs text-amber-700">{row.student_id}</span>
                  </span>
                  <span className="text-xs font-semibold text-amber-700">
                    {(row.similarity * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {absentStudents.length > 0 && (
          <section>
            <p className="text-sm font-semibold text-slate-600">
              Not detected, likely absent ({absentStudents.length})
            </p>
            <ul className="mt-3 max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50">
              {absentStudents.map((student) => (
                <li key={student.student_id} className="flex items-center gap-3 px-4 py-3">
                  {student.photo_url ? (
                    <img
                      src={student.photo_url}
                      alt={student.name}
                      className="h-8 w-8 shrink-0 rounded-full border border-slate-200 object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-500">
                      {student.name?.slice(0, 1) ?? '?'}
                    </div>
                  )}
                  <span className="min-w-0 flex-1 text-sm text-slate-600">
                    <span className="font-medium">{student.name}</span>
                    <span className="ml-2 font-mono text-xs text-slate-400">{student.student_id}</span>
                  </span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-500">
                    Absent
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {enrolledDetected.length > 0 && (
          <button
            type="button"
            onClick={onSave}
            disabled={saving || selectableCount === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? 'Saving...' : `Save Attendance (${selectableCount})`}
          </button>
        )}
      </div>
    </div>
  )
}
