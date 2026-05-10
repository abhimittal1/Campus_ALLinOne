import api from './axiosInstance'

export const getCameraConfig = () => api.get('/camera')
export const updateCameraConfig = (url) => api.put('/camera', { url })
