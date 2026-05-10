import axios from 'axios'
import { getStoredToken } from '../utils/authStorage'

const api = axios.create({
  baseURL: '/',           // Vite proxy forwards to FastAPI on :8000
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = getStoredToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export default api
