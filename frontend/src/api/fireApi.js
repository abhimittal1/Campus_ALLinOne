import api from './axiosInstance'

export const getFireZones = () => api.get('/fire/zones')
export const createFireZone = (data) => api.post('/fire/zones', data)
export const updateFireZone = (id, data) => api.put(`/fire/zones/${id}`, data)
export const deleteFireZone = (id) => api.delete(`/fire/zones/${id}`)

export const getFireStatus = () => api.get('/fire/status')
export const scanZone = (id) => api.post(`/fire/zones/${id}/scan`)

/** Returns a URL string suitable for <img src={...}> */
export const getZoneSnapshotUrl = (id) => `/fire/zones/${id}/snapshot`

export const startMonitor = () => api.post('/fire/monitor/start')
export const stopMonitor = () => api.post('/fire/monitor/stop')
export const getMonitorStatus = () => api.get('/fire/monitor/status')

export const getFireAlerts = (params) => api.get('/fire/alerts', { params })
export const getFireAlertStats = () => api.get('/fire/alerts/stats')
export const dismissFireAlert = (id) => api.patch(`/fire/alerts/${id}/dismiss`)
