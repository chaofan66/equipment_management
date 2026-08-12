import { defineStore } from 'pinia'
import {
  fetchMyApplications,
  fetchPendingApprovals,
  fetchApplicationDetail,
  approveApplication,
  rejectApplication
} from '@/api/approval'

export const useApprovalStore = defineStore('approval', {
  state: () => ({
    myApplications: [],
    pendingApprovals: [],
    currentApplication: null,
    loading: false
  }),

  actions: {
    async fetchMyApplications(params = {}) {
      this.loading = true
      try {
        const res = await fetchMyApplications(params)
        this.myApplications = res.data || []
        return this.myApplications
      } finally {
        this.loading = false
      }
    },

    async fetchPendingApprovals() {
      this.loading = true
      try {
        const res = await fetchPendingApprovals()
        this.pendingApprovals = res.data || []
        return this.pendingApprovals
      } finally {
        this.loading = false
      }
    },

    async fetchDetail(id) {
      const res = await fetchApplicationDetail(id)
      this.currentApplication = res.data
      return this.currentApplication
    },

    async approve(id, data = {}) {
      const res = await approveApplication(id, data)
      await this.fetchPendingApprovals()
      return res.data
    },

    async reject(id, data = {}) {
      const res = await rejectApplication(id, data)
      await this.fetchPendingApprovals()
      return res.data
    }
  }
})
