import client from './client'

export function login(userId) {
  return client.post('/auth/login', { userId })
}

export function fetchCurrentUser() {
  return client.get('/auth/current-user')
}

export function switchUser(personnelId) {
  return client.post('/auth/switch-user', { personnelId })
}

export function fetchPermissions() {
  return client.get('/auth/permissions')
}

export function fetchUsers() {
  return client.get('/auth/users')
}
