import { defineStore } from 'pinia'
import {
  fetchDashboardOverview,
  fetchPlans, fetchPlan, createPlan, updatePlan, deletePlan, updatePlanStatus,
  fetchRecords, fetchRecord, createRecord,
  fetchWorkOrders, fetchWorkOrder, createWorkOrder, updateWorkOrder, updateWorkOrderStatus,
  fetchDailyChecks, createDailyCheck,
  fetchInspections, fetchInspection, createInspection, updateInspection, advanceInspectionStep,
  fetchRectifications, updateRectification, fetchRectificationClose,
  fetchPurchases
} from '@/api/maintenance'

export const useMaintenanceStore = defineStore('maintenance', {
  state: () => ({
    // Dashboard（V1.42：维保总览聚合数据）
    dashboardOverview: null,

    // Plans
    plans: [],
    currentPlan: null,

    // Records
    records: [],
    currentRecord: null,

    // Work Orders
    workOrders: [],
    currentWorkOrder: null,

    // Daily Checks
    dailyChecks: [],

    // Inspections
    inspections: [],
    currentInspection: null,
    rectifications: [],

    // Purchases
    purchases: [],

    loading: false
  }),

  actions: {
    // Dashboard（V1.42：维保总览聚合）
    async fetchDashboardOverview(params = {}) {
      const res = await fetchDashboardOverview(params)
      this.dashboardOverview = res.data || null
      return this.dashboardOverview
    },

    // Plans
    async fetchPlans(params = {}) {
      this.loading = true
      try {
        const res = await fetchPlans(params)
        this.plans = res.data || []
        return this.plans
      } finally {
        this.loading = false
      }
    },

    async fetchPlan(id) {
      const res = await fetchPlan(id)
      this.currentPlan = res.data
      return this.currentPlan
    },

    async createPlan(data) {
      const res = await createPlan(data)
      await this.fetchPlans()
      return res.data
    },

    async updatePlan(id, data) {
      const res = await updatePlan(id, data)
      if (this.currentPlan?.id === id) this.currentPlan = res.data
      await this.fetchPlans()
      return res.data
    },

    async deletePlan(id) {
      await deletePlan(id)
      await this.fetchPlans()
    },

    async updatePlanStatus(id, data) {
      const res = await updatePlanStatus(id, data)
      return res.data
    },

    // Records
    async fetchRecords(params = {}) {
      const res = await fetchRecords(params)
      this.records = res.data || []
      return this.records
    },

    async fetchRecord(id) {
      const res = await fetchRecord(id)
      this.currentRecord = res.data
      return this.currentRecord
    },

    async createRecord(data) {
      const res = await createRecord(data)
      return res.data
    },

    // Work Orders
    async fetchWorkOrders(params = {}) {
      this.loading = true
      try {
        const res = await fetchWorkOrders(params)
        this.workOrders = res.data || []
        return this.workOrders
      } finally {
        this.loading = false
      }
    },

    async fetchWorkOrder(id) {
      const res = await fetchWorkOrder(id)
      this.currentWorkOrder = res.data
      return this.currentWorkOrder
    },

    async createWorkOrder(data) {
      const res = await createWorkOrder(data)
      await this.fetchWorkOrders()
      return res.data
    },

    async updateWorkOrder(id, data) {
      const res = await updateWorkOrder(id, data)
      if (this.currentWorkOrder?.id === id) this.currentWorkOrder = res.data
      await this.fetchWorkOrders()
      return res.data
    },

    async updateWorkOrderStatus(id, data) {
      const res = await updateWorkOrderStatus(id, data)
      return res.data
    },

    // Daily Checks
    async fetchDailyChecks(params = {}) {
      const res = await fetchDailyChecks(params)
      this.dailyChecks = res.data || []
      return this.dailyChecks
    },

    async createDailyCheck(data) {
      const res = await createDailyCheck(data)
      return res.data
    },

    // Inspections
    async fetchInspections(params = {}) {
      const res = await fetchInspections(params)
      this.inspections = res.data || []
      return this.inspections
    },

    async fetchInspection(id) {
      const res = await fetchInspection(id)
      this.currentInspection = res.data
      return this.currentInspection
    },

    async createInspection(data) {
      const res = await createInspection(data)
      await this.fetchInspections()
      return res.data
    },

    async updateInspection(id, data) {
      const res = await updateInspection(id, data)
      return res.data
    },

    // V1.35：定期检查审批流步骤流转（确认/验收/审核/归档/重新提交）
    async advanceInspectionStep(id, stepNo, data) {
      const res = await advanceInspectionStep(id, stepNo, data)
      if (this.currentInspection && this.currentInspection.id === id) {
        this.currentInspection = res.data.record
      }
      await this.fetchInspections()
      return res.data
    },

    async fetchRectifications(params = {}) {
      const res = await fetchRectifications(params)
      this.rectifications = res.data || []
      return this.rectifications
    },

    // V1.36：编辑整改项（整改措施/责任人/期限）→ 重拉整改列表
    async updateRectification(id, data) {
      const res = await updateRectification(id, data)
      await this.fetchRectifications()
      return res.data
    },

    // V1.36：标记整改项已关闭 → 重拉整改列表
    async closeRectification(id, data = {}) {
      const res = await fetchRectificationClose(id, data)
      await this.fetchRectifications()
      return res.data
    },

    // Purchases
    async fetchPurchases() {
      const res = await fetchPurchases()
      this.purchases = res.data || []
      return this.purchases
    }
  }
})
