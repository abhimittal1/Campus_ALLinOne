import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  BookOpenIcon,
  ClipboardDocumentCheckIcon,
  PlusIcon,
  TrashIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'

import Modal from '../components/ui/Modal'
import {
  createSubject,
  deleteSubject,
  enrollStudents,
  getSubjectStudents,
  getSubjects,
  unenrollStudent,
} from '../api/subjectsApi'
import { getStudents } from '../api/studentsApi'

const EMPTY_FORM = { name: '', code: '', description: '' }

export default function Subjects() {
  const navigate = useNavigate()
  const [subjects, setSubjects] = useState([])
  const [loading, setLoading] = useState(true)

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [manageSubject, setManageSubject] = useState(null)
  const [enrolled, setEnrolled] = useState([])
  const [allStudents, setAllStudents] = useState([])
  const [enrollLoading, setEnrollLoading] = useState(false)
  const [selectedToAdd, setSelectedToAdd] = useState([])

  const loadSubjects = () => {
    setLoading(true)
    getSubjects()
      .then((res) => setSubjects(res.data))
      .finally(() => setLoading(false))
  }

  useEffect(loadSubjects, [])

  const handleFormChange = (event) => {
    setForm({ ...form, [event.target.name]: event.target.value })
  }

  const handleCreate = async (event) => {
    event.preventDefault()
    setSaving(true)

    try {
      await createSubject({
        name: form.name,
        code: form.code,
        description: form.description || null,
      })
      toast.success('Subject created')
      setShowAdd(false)
      setForm(EMPTY_FORM)
      loadSubjects()
    } catch (err) {
      toast.error(err.response?.data?.detail ?? 'Failed to create subject')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (subject) => {
    if (!window.confirm(`Delete subject "${subject.name}"?`)) return

    try {
      await deleteSubject(subject.id)
      toast.success('Subject deleted')
      loadSubjects()
    } catch {
      toast.error('Failed to delete subject')
    }
  }

  const openManage = async (subject) => {
    setManageSubject(subject)
    setEnrollLoading(true)
    setSelectedToAdd([])

    try {
      const [enrolledRes, allRes] = await Promise.all([
        getSubjectStudents(subject.id),
        getStudents({ limit: 200 }),
      ])
      setEnrolled(enrolledRes.data)
      setAllStudents(allRes.data)
    } finally {
      setEnrollLoading(false)
    }
  }

  const closeManage = () => {
    setManageSubject(null)
    setEnrolled([])
    setAllStudents([])
    setSelectedToAdd([])
    loadSubjects()
  }

  const handleUnenroll = async (studentId) => {
    try {
      await unenrollStudent(manageSubject.id, studentId)
      setEnrolled((prev) => prev.filter((student) => student.student_id !== studentId))
      toast.success('Student removed')
    } catch {
      toast.error('Failed to remove student')
    }
  }

  const toggleSelectToAdd = (studentId) => {
    setSelectedToAdd((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    )
  }

  const handleEnroll = async () => {
    if (selectedToAdd.length === 0) return

    try {
      await enrollStudents(manageSubject.id, selectedToAdd)
      toast.success(`${selectedToAdd.length} student(s) enrolled`)
      const res = await getSubjectStudents(manageSubject.id)
      setEnrolled(res.data)
      setSelectedToAdd([])
    } catch {
      toast.error('Failed to enroll students')
    }
  }

  const enrolledIds = new Set(enrolled.map((student) => student.student_id))
  const unenrolledStudents = allStudents.filter((student) => !enrolledIds.has(student.student_id))
  const totalEnrollments = subjects.reduce((acc, subject) => acc + (subject.student_count ?? 0), 0)

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] bg-gradient-to-br from-blue-50 via-white to-sky-50 border border-blue-200 p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-blue-600">Subject Management</p>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">Subjects and attendance sessions.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Create courses, enroll students, and launch attendance scans from the subject where the class is happening.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
          >
            <PlusIcon className="h-5 w-5" />
            Add Subject
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryTile label="Subjects" value={subjects.length} Icon={BookOpenIcon} />
          <SummaryTile label="Total Enrollments" value={totalEnrollments} Icon={UserGroupIcon} />
          <SummaryTile label="Ready to Scan" value={subjects.filter((subject) => subject.student_count > 0).length} Icon={ClipboardDocumentCheckIcon} />
        </div>
      </section>

      {loading ? (
        <div className="rounded-[2rem] border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
          Loading subjects...
        </div>
      ) : subjects.length === 0 ? (
        <div className="rounded-[2rem] border border-slate-200 bg-white p-12 text-center shadow-sm">
          <BookOpenIcon className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-lg font-semibold text-slate-900">No subjects yet</p>
          <p className="mt-2 text-sm text-slate-500">Create your first subject to start enrolling students.</p>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl bg-primary-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
          >
            <PlusIcon className="h-5 w-5" />
            Add Subject
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {subjects.map((subject) => (
            <SubjectCard
              key={subject.id}
              subject={subject}
              onManage={() => openManage(subject)}
              onTakeAttendance={() => navigate(`/attendance/subjects/${subject.id}/attendance`)}
              onDelete={() => handleDelete(subject)}
            />
          ))}
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Subject">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Subject Name <span className="text-red-400">*</span>
            </label>
            <input
              name="name"
              value={form.name}
              onChange={handleFormChange}
              required
              placeholder="e.g. Mathematics"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Subject Code <span className="text-red-400">*</span>
            </label>
            <input
              name="code"
              value={form.code}
              onChange={handleFormChange}
              required
              placeholder="e.g. MATH101"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Description <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleFormChange}
              rows={2}
              placeholder="Short description..."
              className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {saving ? 'Creating...' : 'Create Subject'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!manageSubject}
        onClose={closeManage}
        title={`Manage Students - ${manageSubject?.name ?? ''}`}
      >
        {enrollLoading ? (
          <p className="py-4 text-center text-sm text-slate-500">Loading...</p>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Enrolled ({enrolled.length})
              </p>
              {enrolled.length === 0 ? (
                <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  No students enrolled yet.
                </p>
              ) : (
                <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200">
                  {enrolled.map((student) => (
                    <li key={student.student_id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0 text-sm text-slate-800">
                        <span className="font-medium">{student.name}</span>
                        <span className="ml-2 font-mono text-xs text-slate-400">{student.student_id}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUnenroll(student.student_id)}
                        className="text-xs font-semibold text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {unenrolledStudents.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Add Students
                </p>
                <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200">
                  {unenrolledStudents.map((student) => (
                    <li key={student.student_id} className="flex items-center gap-3 px-4 py-3">
                      <input
                        type="checkbox"
                        id={`enroll-${student.student_id}`}
                        checked={selectedToAdd.includes(student.student_id)}
                        onChange={() => toggleSelectToAdd(student.student_id)}
                        className="h-4 w-4 accent-primary-600"
                      />
                      <label
                        htmlFor={`enroll-${student.student_id}`}
                        className="cursor-pointer text-sm text-slate-800"
                      >
                        <span className="font-medium">{student.name}</span>
                        <span className="ml-2 font-mono text-xs text-slate-400">{student.student_id}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={handleEnroll}
                    disabled={selectedToAdd.length === 0}
                    className="rounded-xl bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    Enroll Selected ({selectedToAdd.length})
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={closeManage}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
              >
                Done
              </button>
            </div>
          </div>
        )}
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

function SubjectCard({ subject, onManage, onTakeAttendance, onDelete }) {
  return (
    <div className="flex flex-col rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700">
            {subject.code}
          </span>
          <h2 className="mt-3 text-lg font-bold leading-snug text-slate-900">{subject.name}</h2>
        </div>
        <button
          type="button"
          onClick={onDelete}
          title="Delete subject"
          className="rounded-xl p-2 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
        >
          <TrashIcon className="h-5 w-5" />
        </button>
      </div>

      <p className="mt-3 min-h-[44px] text-sm leading-6 text-slate-500">
        {subject.description || 'No description added yet.'}
      </p>

      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <span className="text-xs font-medium text-slate-500">
          {subject.student_count} student{subject.student_count !== 1 ? 's' : ''} enrolled
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onManage}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          Manage Students
        </button>
        <button
          type="button"
          onClick={onTakeAttendance}
          className="rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-700"
        >
          Take Attendance
        </button>
      </div>
    </div>
  )
}
