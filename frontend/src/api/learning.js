import client from './client'

export function fetchExamRoles() {
  return client.get('/exam/roles')
}
export function fetchExamBanks() {
  return client.get('/exam/banks')
}
export function saveExamPlan(typeCode, data) {
  return client.put(`/exam/banks/${typeCode}/plan`, data)
}
export function fetchMyPractice() {
  return client.get('/exam/practice')
}
export function startPractice(typeCode) {
  return client.post(`/exam/practice/${typeCode}/start`)
}
export function fetchOpenPaper(id) {
  return client.get(`/exam/papers/${id}`)
}
export function submitPaper(id, answers) {
  return client.post(`/exam/papers/${id}/submit`, { answers })
}
export function fetchAttempts(params) {
  return client.get('/exam/attempts', { params })
}
export function fetchAttempt(id) {
  return client.get(`/exam/attempts/${id}`)
}
export function fetchCourseCatalog() {
  return client.get('/course/catalog')
}
export function saveCoursePlan(typeCode, data) {
  return client.put(`/course/${typeCode}`, data)
}
export function fetchMyCourses() {
  return client.get('/course/mine')
}
export function fetchCourseContent(typeCode, preview) {
  return client.get(`/course/${typeCode}`, { params: preview ? { preview: '1' } : {} })
}
