import React, { createContext, useEffect, useMemo, useState } from 'react'

import { getMe, login as loginRequest } from '../api/authApi'
import {
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from '../utils/authStorage'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getStoredToken()
    if (!token) {
      setLoading(false)
      return
    }

    getMe()
      .then((response) => {
        setUser(response.data)
      })
      .catch(() => {
        clearStoredToken()
        setUser(null)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  const login = async (username, password) => {
    const response = await loginRequest(username, password)
    const nextToken = response.data.access_token
    setStoredToken(nextToken)

    const me = await getMe()
    setUser(me.data)
    return me.data
  }

  const logout = () => {
    clearStoredToken()
    setUser(null)
  }

  const value = useMemo(() => ({
    user,
    loading,
    isAuthenticated: Boolean(user),
    login,
    logout,
  }), [loading, user])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
