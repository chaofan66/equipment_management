import { defineStore } from 'pinia'
import {
  fetchPersonnel, fetchPersonnelById, createPersonnel, updatePersonnel, deletePersonnel,
  fetchRoles, fetchRole, updateRole, fetchPermissionCatalog,
  fetchTeams,
  fetchParams, updateParams
} from '@/api/config'

export const useConfigStore = defineStore('config', {
  state: () => ({
    personnel: [],
    currentPerson: null,
    roles: [],
    currentRole: null,
    permissionCatalog: {},
    teams: [],
    params: null,
    loading: false
  }),

  actions: {
    // Personnel
    async fetchPersonnel(params = {}) {
      this.loading = true
      try {
        const res = await fetchPersonnel(params)
        this.personnel = res.data || []
        return this.personnel
      } finally {
        this.loading = false
      }
    },

    async fetchPersonnelById(id) {
      const res = await fetchPersonnelById(id)
      this.currentPerson = res.data
      return this.currentPerson
    },

    async createPersonnel(data) {
      const res = await createPersonnel(data)
      await this.fetchPersonnel()
      return res.data
    },

    async updatePersonnel(id, data) {
      const res = await updatePersonnel(id, data)
      await this.fetchPersonnel()
      return res.data
    },

    async deletePersonnel(id) {
      await deletePersonnel(id)
      await this.fetchPersonnel()
    },

    // 系统角色（V1.9：11 系统角色 = 10 职责 + 系统管理员 + 系统操作权限目录）
    async fetchRoles() {
      const res = await fetchRoles()
      this.roles = res.data || []
      return this.roles
    },

    async fetchRole(id) {
      const res = await fetchRole(id)
      this.currentRole = res.data
      return this.currentRole
    },

    async updateRole(id, data) {
      const res = await updateRole(id, data)
      await this.fetchRoles()
      return res.data
    },

    async fetchPermissionCatalog() {
      const res = await fetchPermissionCatalog()
      this.permissionCatalog = res.data || {}
      return this.permissionCatalog
    },

    async fetchTeams() {
      const res = await fetchTeams()
      this.teams = res.data || []
      return this.teams
    },

    // Params
    async fetchParams() {
      const res = await fetchParams()
      this.params = res.data
      return this.params
    },

    async updateParams(data) {
      const res = await updateParams(data)
      this.params = res.data
      return this.params
    }
  }
})
