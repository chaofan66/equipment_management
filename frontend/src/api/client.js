import axios from 'axios'

const client = axios.create({
  baseURL: '/api',
  timeout: 15000
  // 不设全局 Content-Type：对象请求 axios 自动 application/json；FormData（上传）走 multipart（修复「缺少文件」bug）
})

client.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = error.response?.data?.error || error.message || '请求失败'
    console.error('[API Error]', message)
    return Promise.reject(new Error(message))
  }
)

export default client
