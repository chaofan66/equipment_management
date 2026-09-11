import client from './client'

export function fetchDevices(params = {}) {
  return client.get('/devices', { params })
}

/** 按资产编号精确查询（扫码落地） */
export function fetchDeviceByCode(code) {
  return client.get(`/devices/by-code/${encodeURIComponent(code)}`)
}

export function fetchDevice(id) {
  return client.get(`/devices/${id}`)
}

export function createDevice(data) {
  return client.post('/devices', data)
}

export function updateDevice(id, data) {
  return client.put(`/devices/${id}`, data)
}

export function deleteDevice(id) {
  return client.delete(`/devices/${id}`)
}

export function transferDevice(id, data) {
  return client.post(`/devices/${id}/transfer`, data)
}

export function scrapDevice(id, data) {
  return client.post(`/devices/${id}/scrap`, data)
}

export function fetchMaintenanceHistory(id) {
  return client.get(`/devices/${id}/maintenance-history`)
}

export function fetchTransferHistory(id) {
  return client.get(`/devices/${id}/transfer-history`)
}

export function generateAssetCode(data) {
  return client.post('/devices/generate-code', data)
}

export function fetchSuppliers() {
  return client.get('/devices/suppliers')
}
