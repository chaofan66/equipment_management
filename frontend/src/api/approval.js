import client from './client'

export function fetchMyApplications(params = {}) {
  return client.get('/approval/applications', { params })
}

export function fetchPendingApprovals() {
  return client.get('/approval/pending')
}

export function fetchApplicationDetail(id) {
  return client.get(`/approval/applications/${id}`)
}

export function approveApplication(id, data = {}) {
  return client.put(`/approval/applications/${id}/status`, {
    action: 'approve',
    ...data
  })
}

export function rejectApplication(id, data = {}) {
  return client.put(`/approval/applications/${id}/status`, {
    action: 'reject',
    ...data
  })
}
