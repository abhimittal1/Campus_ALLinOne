import api from './axiosInstance'

export const getStudents = (params) => api.get('/students', { params })
export const getStudent = (id) => api.get(`/students/${id}`)
export const createStudent = (payload) => api.post('/students', payload)
export const updateStudent = (id, payload) => api.patch(`/students/${id}`, payload)
export const deleteStudent = (id) => api.delete(`/students/${id}`)
export const uploadPhoto = (studentId, formData) =>
  api.post(`/students/${studentId}/photo`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
export const registerFace = (studentId) => api.post(`/students/${studentId}/register-face`)

// Enrollment management from the Students page
export const getStudentSubjects = (studentId) => api.get(`/students/${studentId}/subjects`)
export const enrollStudentInSubjects = (studentId, subjectIds) =>
  api.post(`/students/${studentId}/subjects`, { student_ids: subjectIds.map(String) })
export const unenrollStudentFromSubject = (studentId, subjectId) =>
  api.delete(`/students/${studentId}/subjects/${subjectId}`)
