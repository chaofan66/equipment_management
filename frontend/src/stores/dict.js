import { defineStore } from 'pinia'
import {
  fetchCategories,
  fetchDictCategory,
  updateDictCategory,
  fetchDeviceTypeTree,
  fetchDeptWorkshopTree,
  fetchTypeCodeMap,
  fetchDeptCodeMap,
  fetchWorkshopCodeMap,
  updateDeviceTypeTree,
  updateDeptWorkshopTree
} from '@/api/dict'

export const useDictStore = defineStore('dict', {
  state: () => ({
    categories: [],
    categoryData: {},
    deviceTypeTree: {},
    deptWorkshopTree: {},
    typeCodeMap: {},
    deptCodeMap: {},
    workshopCodeMap: {},
    loaded: false
  }),

  actions: {
    async loadAll() {
      try {
        const [catRes, treeRes, deptRes] = await Promise.all([
          fetchCategories(),
          fetchDeviceTypeTree(),
          fetchDeptWorkshopTree()
        ])
        this.categories = catRes.data || []
        this.deviceTypeTree = treeRes.data || {}
        this.deptWorkshopTree = deptRes.data || {}
        this.loaded = true
      } catch (e) {
        console.error('Failed to load dict data:', e)
      }
    },

    async loadCategory(category) {
      if (this.categoryData[category]) return this.categoryData[category]
      try {
        const res = await fetchDictCategory(category)
        this.categoryData[category] = res.data || []
        return this.categoryData[category]
      } catch (e) {
        console.error(`Failed to load dict category ${category}:`, e)
        return []
      }
    },

    async loadLookups() {
      try {
        const [typeRes, deptRes, wsRes] = await Promise.all([
          fetchTypeCodeMap(),
          fetchDeptCodeMap(),
          fetchWorkshopCodeMap()
        ])
        this.typeCodeMap = typeRes.data || {}
        this.deptCodeMap = deptRes.data || {}
        this.workshopCodeMap = wsRes.data || {}
      } catch (e) {
        console.error('Failed to load lookup maps:', e)
      }
    },

    async saveCategory(category, items) {
      await updateDictCategory(category, items)
      this.categoryData[category] = items
    },

    async saveDeviceTypeTree(tree) {
      await updateDeviceTypeTree(tree)
      this.deviceTypeTree = tree
    },

    async saveDeptWorkshopTree(tree) {
      await updateDeptWorkshopTree(tree)
      this.deptWorkshopTree = tree
    },

    getCategoryData(category) {
      return this.categoryData[category] || []
    }
  }
})
