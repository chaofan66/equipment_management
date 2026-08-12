import client from './client'

export function fetchCategories() {
  return client.get('/dict/categories')
}

export function fetchDictCategory(category) {
  return client.get(`/dict/${category}`)
}

export function updateDictCategory(category, items) {
  return client.put(`/dict/${category}`, { items })
}

export function fetchDeviceTypeTree() {
  return client.get('/dict/device-types/tree')
}

export function fetchDeptWorkshopTree() {
  return client.get('/dict/dept-workshop/tree')
}

export function fetchTypeCodeMap() {
  return client.get('/dict/lookup/type-codes')
}

export function fetchDeptCodeMap() {
  return client.get('/dict/lookup/dept-codes')
}

export function fetchWorkshopCodeMap() {
  return client.get('/dict/lookup/workshop-codes')
}

export function fetchTopCategories() {
  return client.get('/dict/top-categories')
}

export function fetchCategoryCodes() {
  return client.get('/dict/category-codes')
}

export function updateDeviceTypeTree(tree) {
  return client.put('/dict/device-types', { tree })
}

export function updateDeptWorkshopTree(tree) {
  return client.put('/dict/dept-workshop', { tree })
}
