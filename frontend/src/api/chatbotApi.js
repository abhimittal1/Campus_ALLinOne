import api from './axiosInstance'

/**
 * Send a chat message to the JIIT RAG chatbot.
 *
 * @param {object} options Additional chat/session metadata
 */
export const sendMessage = (message, history = [], options = {}) =>
  api.post('/chatbot/chat', { message, history, ...options })

export const getAdminChatSummary = () => api.get('/chatbot/admin/summary')
export const getAdminChatSessions = (params) => api.get('/chatbot/admin/sessions', { params })
export const getAdminSessionMessages = (sessionId) =>
  api.get(`/chatbot/admin/sessions/${sessionId}/messages`)
export const getAdminComplaints = (params) => api.get('/chatbot/admin/complaints', { params })
export const updateComplaintStatus = (ticketId, status) =>
  api.patch(`/chatbot/admin/complaints/${ticketId}`, { status })
export const getComplaintStats = () => api.get('/chatbot/admin/complaints/stats')
