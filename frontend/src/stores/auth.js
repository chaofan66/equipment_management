import { defineStore } from 'pinia'
import { fetchCurrentUser, switchUser as apiSwitchUser } from '@/api/auth'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    currentUser: null,
    permissions: [],
    role: null,
    loaded: false
  }),

  getters: {
    isLoggedIn: (state) => !!state.currentUser,
    userName: (state) => state.currentUser?.display || '未登录',
    userId: (state) => state.currentUser?.id || ''
  },

  actions: {
    async fetchCurrentUser() {
      try {
        const res = await fetchCurrentUser()
        this.currentUser = res.data
        this.permissions = res.data.permissions || []
        this.role = res.data.role
        this.loaded = true
      } catch (e) {
        console.error('Failed to fetch current user:', e)
      }
    },

    async switchUser(personnelId) {
      const res = await apiSwitchUser(personnelId)
      this.currentUser = res.data
      this.permissions = res.data.permissions || []
      this.role = res.data.role
    },

    hasPermission(perm) {
      if (!perm) return true
      return this.permissions.includes(perm)
    },

    // V1.7：命中任一权限即通过（页面级过滤：某页可见 = 有该页任一权限串）
    hasAnyPermission(perms) {
      if (!perms || !perms.length) return true
      return perms.some(p => this.hasPermission(p))
    }
  }
})
