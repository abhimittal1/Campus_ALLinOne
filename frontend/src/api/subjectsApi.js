import api from './axiosInstance'

export const getSubjects = () => api.get('/subjects')
export const getSubject = (id) => api.get(`/subjects/${id}`)
export const createSubject = (payload) => api.post('/subjects', payload)
export const deleteSubject = (id) => api.delete(`/subjects/${id}`)

export const getSubjectStudents = (id) => api.get(`/subjects/${id}/students`)
export const enrollStudents = (id, studentIds) =>
  api.post(`/subjects/${id}/students`, { student_ids: studentIds })
export const unenrollStudent = (id, studentId) =>
  api.delete(`/subjects/${id}/students/${studentId}`)

export const takeAttendance = (id) => api.post(`/subjects/${id}/take-attendance`)
