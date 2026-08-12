import { defineStore } from 'pinia'
import {
  fetchDevices,
  fetchDevice,
  createDevice,
  updateDevice,
  deleteDevice,
  transferDevice,
  scrapDevice,
  fetchMaintenanceHistory,
  fetchTransferHistory,
  generateAssetCode
} from '@/api/devices'

export const useDevicesStore = defineStore('devices', {
  state: () => ({
    list: [],
    current: null,
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
    filters: { status: '', type: '', code: '', supplier: '' },
    maintenanceHistory: [],
    transferHistory: [],
    loading: false
  }),

  actions: {
    async fetchList(params = {}) {
      this.loading = true
      try {
        const merged = { ...this.filters, ...params, page: this.pagination.page, pageSize: this.pagination.pageSize }
        const res = await fetchDevices(merged)
        this.list = res.data || []
        this.pagination = res.pagination || this.pagination
      } catch (e) {
        console.error('Failed to fetch devices:', e)
      } finally {
        this.loading = false
      }
    },

    async fetchById(id) {
      const res = await fetchDevice(id)
      this.current = res.data
      return this.current
    },

    async create(data) {
      const res = await createDevice(data)
      await this.fetchList()
      return res.data
    },

    async update(id, data) {
      const res = await updateDevice(id, data)
      if (this.current?.id === id) this.current = res.data
      await this.fetchList()
      return res.data
    },

    async remove(id) {
      await deleteDevice(id)
      await this.fetchList()
    },

    async transfer(id, data) {
      const res = await transferDevice(id, data)
      return res.data
    },

    async scrap(id, data) {
      const res = await scrapDevice(id, data)
      return res.data
    },

    async fetchMaintenanceHistory(id) {
      const res = await fetchMaintenanceHistory(id)
      this.maintenanceHistory = res.data || []
      return this.maintenanceHistory
    },

    async fetchTransferHistory(id) {
      const res = await fetchTransferHistory(id)
      this.transferHistory = res.data || []
      return this.transferHistory
    },

    async generateCode(data) {
      const res = await generateAssetCode(data)
      return res.data?.code || ''
    },

    setFilters(filters) {
      Object.assign(this.filters, filters)
      this.pagination.page = 1
    },

    setPage(page) {
      this.pagination.page = page
    },

    setPageSize(size) {
      this.pagination.pageSize = size
      this.pagination.page = 1
    }
  }
})
