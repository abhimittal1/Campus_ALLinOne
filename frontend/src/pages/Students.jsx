import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  AcademicCapIcon,
  BookOpenIcon,
  CameraIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'

import Modal from '../components/ui/Modal'
import {
  createStudent,
  deleteStudent,
  enrollStudentInSubjects,
  getStudentSubjects,
  getStudents,
  registerFace,
  unenrollStudentFromSubject,
  uploadPhoto,
} from '../api/studentsApi'
import { getSubjects } from '../api/subjectsApi'
import { useAuth } from '../hooks/useAuth'

const EMPTY_FORM = { student_id: '', name: '' }

export default function Students() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [photoFile, setPhotoFile] = useState(null)
  const [saving, setSaving] = useState(false)

  const [faceRegStudent, setFaceRegStudent] = useState(null)
  const [snapshotTs, setSnapshotTs] = useState(Date.now())
  const [captureError, setCaptureError] = useState('')
  const [capturing, setCapturing] = useState(false)

  const [enrollStudent, setEnrollStudent] = useState(null)
  const [enrolledSubjects, setEnrolledSubjects] = useState([])
  const [allSubjects, setAllSubjects] = useState([])
  const [enrollLoading, setEnrollLoading] = useState(false)
  const [selectedSubjectId, setSelectedSubjectId] = useState('')

  const load = () => {
    setLoading(true)
    getStudents({ limit: 200 })
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  useEffect(() => {
    if (!faceRegStudent) return undefined
    const id = setInterval(() => setSnapshotTs(Date.now()), 1500)
    return () => clearInterval(id)
  }, [faceRegStudent])

  const handleChange = (event) => {
    setForm({ ...form, [event.target.name]: event.target.value })
  }

  const handleCreate = async (event) => {
    event.preventDefault()
    setSaving(true)

    try {
      const res = await createStudent(form)
      const newStudent = res.data

      if (photoFile) {
        const fd = new FormData()
        fd.append('file', photoFile)
        await uploadPhoto(newStudent.student_id, fd)
      }

      toast.success('Student added')
      setShowModal(false)
      setForm(EMPTY_FORM)
      setPhotoFile(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Failed to add student')
    } finally {
      setSaving(false)
    }
  }

  const handleRowPhotoUpload = async (studentId, file) => {
    if (!file) return

    const fd = new FormData()
    fd.append('file', file)

    try {
      await uploadPhoto(studentId, fd)
      toast.success('Photo updated')
      load()
    } catch {
      toast.error('Failed to upload photo')
    }
  }

  const handleDelete = async (studentId) => {
    if (!window.confirm(`Delete student ${studentId}?`)) return

    try {
      await deleteStudent(studentId)
      toast.success('Student deleted')
      load()
    } catch {
      toast.error('Failed to delete student')
    }
  }

  const openFaceModal = (student) => {
    setFaceRegStudent(student)
    setCaptureError('')
    setSnapshotTs(Date.now())
  }

  const handleCapture = async () => {
    if (!faceRegStudent) return

    setCapturing(true)
    setCaptureError('')

    try {
      await registerFace(faceRegStudent.student_id)
      toast.success(`Face registered for ${faceRegStudent.name}`)
      setFaceRegStudent(null)
      load()
    } catch (err) {
      setCaptureError(err.response?.data?.detail ?? 'Failed. Check the camera connection and make sure the face is visible.')
    } finally {
      setCapturing(false)
    }
  }

  const openEnrollModal = async (student) => {
    setEnrollStudent(student)
    setEnrollLoading(true)
    setSelectedSubjectId('')

    try {
      const [enrolledRes, allRes] = await Promise.all([
        getStudentSubjects(student.student_id),
        getSubjects(),
      ])
      setEnrolledSubjects(enrolledRes.data)
      setAllSubjects(allRes.data)
    } catch {
      toast.error('Failed to load subjects')
    } finally {
      setEnrollLoading(false)
    }
  }

  const handleEnroll = async () => {
    if (!selectedSubjectId) return

    try {
      await enrollStudentInSubjects(enrollStudent.student_id, [selectedSubjectId])
      toast.success('Enrolled successfully')
      setSelectedSubjectId('')
      const res = await getStudentSubjects(enrollStudent.student_id)
      setEnrolledSubjects(res.data)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Failed to enroll')
    }
  }

  const handleUnenroll = async (subjectId, subjectName) => {
    try {
      await unenrollStudentFromSubject(enrollStudent.student_id, subjectId)
      toast.success(`Removed from ${subjectName}`)
      const res = await getStudentSubjects(enrollStudent.student_id)
      setEnrolledSubjects(res.data)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Failed to unenroll')
    }
  }

  const faceRegisteredCount = rows.filter((student) => student.face_registered).length
  const pendingFaceCount = rows.length - faceRegisteredCount

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] bg-gradient-to-br from-blue-50 via-white to-sky-50 border border-blue-200 p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-blue-600">Student Registry</p>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">Student profiles and face readiness.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Register students, upload profile photos, capture face data, and enroll each student into the right subjects.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
            >
              <PlusIcon className="h-5 w-5" />
              Register Student
            </button>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryTile label="Students" value={rows.length} Icon={AcademicCapIcon} />
          <SummaryTile label="Face Registered" value={faceRegisteredCount} Icon={CheckCircleIcon} />
          <SummaryTile label="Need Face Setup" value={pendingFaceCount} Icon={ExclamationTriangleIcon} />
        </div>
      </section>

      {isAdmin && (
        <div className="rounded-[2rem] border border-blue-200 bg-blue-50 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-blue-800">
            <span className="font-semibold">Setup flow:</span>
            {['Register student', 'Capture face', 'Enroll in subjects', 'Take attendance'].map((item, index) => (
              <span key={item} className="inline-flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-blue-700">
                  {index + 1}
                </span>
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-[2rem] border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
          Loading students...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-[2rem] border border-slate-200 bg-white p-12 text-center shadow-sm">
          <AcademicCapIcon className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-lg font-semibold text-slate-900">No students yet</p>
          <p className="mt-2 text-sm text-slate-500">Register students before enrolling them into subjects.</p>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
            >
              <PlusIcon className="h-5 w-5" />
              Register First Student
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {rows.map((student) => (
            <StudentCard
              key={student.student_id}
              student={student}
              isAdmin={isAdmin}
              onPhotoUpload={handleRowPhotoUpload}
              onFaceRegister={openFaceModal}
              onManageSubjects={openEnrollModal}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Register Student">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Student ID</label>
            <input
              name="student_id"
              value={form.student_id}
              onChange={handleChange}
              required
              placeholder="e.g. STU001"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Full Name</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              required
              placeholder="e.g. John Smith"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Profile Photo <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setPhotoFile(event.target.files?.[0] || null)}
              className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:text-primary-700 hover:file:bg-primary-100"
            />
          </div>
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
            After saving, capture the student face from the camera and enroll the student into subjects before taking attendance.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowModal(false)
                setPhotoFile(null)
              }}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Register Student'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!enrollStudent}
        onClose={() => setEnrollStudent(null)}
        title={`Manage Subjects - ${enrollStudent?.name ?? ''}`}
      >
        {enrollLoading ? (
          <p className="py-4 text-center text-sm text-slate-500">Loading...</p>
        ) : (
          <div className="space-y-5">
            {enrollStudent && !enrollStudent.face_registered && (
              <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
                <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
                <span>
                  <strong>{enrollStudent.name}</strong> can be enrolled now, but will not be auto-detected until face registration is completed.
                </span>
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Enrolled subjects ({enrolledSubjects.length})
              </p>
              {enrolledSubjects.length === 0 ? (
                <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  Not enrolled in any subject yet.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
                  {enrolledSubjects.map((subject) => (
                    <li key={subject.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-slate-800">{subject.name}</span>
                        <span className="ml-2 font-mono text-xs text-slate-400">{subject.code}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnenroll(subject.id, subject.name)}
                        className="text-xs font-semibold text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Enroll in a subject
              </p>
              {(() => {
                const enrolledIds = new Set(enrolledSubjects.map((subject) => subject.id))
                const available = allSubjects.filter((subject) => !enrolledIds.has(subject.id))
                if (available.length === 0) {
                  return <p className="text-sm text-slate-500">Enrolled in all available subjects.</p>
                }

                return (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      value={selectedSubjectId}
                      onChange={(event) => setSelectedSubjectId(event.target.value)}
                      className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">Select a subject...</option>
                      {available.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name} ({subject.code})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleEnroll}
                      disabled={!selectedSubjectId}
                      className="rounded-xl bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-60"
                    >
                      Enroll
                    </button>
                  </div>
                )
              })()}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!faceRegStudent}
        onClose={() => setFaceRegStudent(null)}
        title={`Register Face - ${faceRegStudent?.name ?? ''}`}
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-slate-500">
            Ask the student to look directly at the camera, then capture the face profile.
          </p>
          <div className="relative overflow-hidden rounded-2xl bg-slate-950" style={{ aspectRatio: '4 / 3' }}>
            <img
              key={snapshotTs}
              src={`/camera/snapshot?t=${snapshotTs}`}
              alt="Camera preview"
              className="h-full w-full object-contain"
              onError={() => !captureError && setCaptureError('Camera not reachable. Check the URL in Camera Settings.')}
            />
          </div>
          {captureError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {captureError}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setFaceRegStudent(null)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCapture}
              disabled={capturing}
              className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-700 disabled:opacity-60"
            >
              <CameraIcon className="h-4 w-4" />
              {capturing ? 'Capturing...' : 'Capture and Register'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function SummaryTile({ label, value, Icon }) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-blue-600">
        <Icon className="h-4 w-4" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  )
}

function StudentCard({ student, isAdmin, onPhotoUpload, onFaceRegister, onManageSubjects, onDelete }) {
  return (
    <div className="flex flex-col rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start gap-3">
        {student.photo_url ? (
          <img
            src={student.photo_url}
            alt={student.name}
            className="h-14 w-14 shrink-0 rounded-2xl border border-slate-200 object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50">
            <UserCircleIcon className="h-8 w-8 text-slate-300" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{student.name}</p>
          <p className="mt-1 font-mono text-xs text-slate-400">{student.student_id}</p>
          <p className="mt-1 text-xs text-slate-400">
            Added {new Date(student.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {student.face_registered ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircleIcon className="h-4 w-4" />
            Face Registered
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            <ExclamationTriangleIcon className="h-4 w-4" />
            Face Not Registered
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] font-semibold">
        <span className="rounded-xl bg-emerald-50 px-2 py-2 text-emerald-700">Profile</span>
        <span className={`rounded-xl px-2 py-2 ${student.face_registered ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          Face
        </span>
        <span className="rounded-xl bg-slate-50 px-2 py-2 text-slate-500">Subjects</span>
      </div>

      {isAdmin && (
        <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100">
              <PhotoIcon className="h-4 w-4" />
              Upload Photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => onPhotoUpload(student.student_id, event.target.files?.[0])}
              />
            </label>
            <button
              type="button"
              onClick={() => onFaceRegister(student)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50 px-2 py-2 text-xs font-semibold text-purple-700 transition-colors hover:bg-purple-100"
            >
              <CameraIcon className="h-4 w-4" />
              {student.face_registered ? 'Re-register' : 'Register Face'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => onManageSubjects(student)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-2 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
          >
            <BookOpenIcon className="h-4 w-4" />
            Manage Subjects
          </button>
          <button
            type="button"
            onClick={() => onDelete(student.student_id)}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-2 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100"
          >
            <TrashIcon className="h-4 w-4" />
            Delete Student
          </button>
        </div>
      )}
    </div>
  )
}
