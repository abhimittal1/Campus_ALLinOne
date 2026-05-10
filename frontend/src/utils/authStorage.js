export const AUTH_TOKEN_STORAGE_KEY = 'campus_security_token'

export function getStoredToken() {
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
}

export function setStoredToken(token) {
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
}

export function clearStoredToken() {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
}