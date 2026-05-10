import api from './axiosInstance'

export const getAttendance = (params) => api.get('/attendance', { params })
export const getAttendanceSummary = (days = 7) =>
  api.get('/attendance/summary', { params: { days } })
export const createAttendance = (payload) => api.post('/attendance', payload)
export const getSubjectReport = (params) => api.get('/attendance/subject-report', { params })
