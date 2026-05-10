import api from './axiosInstance'

export const login = (username, password) => {
  const form = new URLSearchParams()
  form.append('username', username)
  form.append('password', password)
  return api.post('/auth/login', form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
}

export const register = (payload) => api.post('/auth/register', payload)
export const getMe = () => api.get('/auth/me')
