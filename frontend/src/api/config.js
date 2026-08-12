import client from './client'

// Personnel CRUD
export function fetchPersonnel(params = {}) {
  return client.get('/config/personnel', { params })
}

export function fetchPersonnelById(id) {
  return client.get(`/config/personnel/${id}`)
}

export function createPersonnel(data) {
  return client.post('/config/personnel', data)
}

export function updatePersonnel(id, data) {
  return client.put(`/config/personnel/${id}`, data)
}

export function deletePersonnel(id) {
  return client.delete(`/config/personnel/${id}`)
}

// 系统角色（V1.9：11 系统角色 = 10 职责 + 系统管理员 + 系统操作权限目录）
export function fetchRoles() {
  return client.get('/config/roles')
}

export function fetchRole(id) {
  return client.get(`/config/roles/${id}`)
}

export function updateRole(id, data) {
  return client.put(`/config/roles/${id}`, data)
}

export function fetchPermissionCatalog() {
  return client.get('/config/permissions')
}

// Teams & Params
export function fetchTeams() {
  return client.get('/config/teams')
}

// Params
export function fetchParams() {
  return client.get('/config/params')
}

export function updateParams(data) {
  return client.put('/config/params', data)
}
