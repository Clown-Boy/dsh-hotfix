import { create } from 'zustand'
import { API_ORIGIN, ApiError, request } from '../../services/api/client.js'
import { useSettings } from '../../services/settings.js'

export interface BalanceInfo {
  currency: string
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

export interface BalanceData {
  is_available: boolean
  balance_infos: BalanceInfo[]
}

interface BalanceCachePayload {
  keyHash: string
  data: BalanceData
  updatedAt: number
}

interface BalanceStoreState {
  keyHash: string
  data: BalanceData | null
  updatedAt: number | null
  loading: boolean
  error: string | null
  refreshBalance: () => Promise<void>
}

const CACHE_KEY = 'ds-chat-demo-balance-cache'

export const hashApiKey = (apiKey: string): string => {
  let hash = 2166136261
  for (let i = 0; i < apiKey.length; i++) {
    hash ^= apiKey.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

const loadInitialCache = (): { keyHash: string; data: BalanceData | null; updatedAt: number | null } => {
  const currentKey = (useSettings.getState().apiKey ?? '').trim()
  if (!currentKey) {
    return { keyHash: '', data: null, updatedAt: null }
  }
  const currentHash = hashApiKey(currentKey)
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) {
      return { keyHash: currentHash, data: null, updatedAt: null }
    }
    const parsed = JSON.parse(raw) as Partial<BalanceCachePayload>
    if (
      parsed.keyHash === currentHash &&
      parsed.data &&
      typeof parsed.data.is_available === 'boolean' &&
      Array.isArray(parsed.data.balance_infos) &&
      typeof parsed.updatedAt === 'number'
    ) {
      return { keyHash: currentHash, data: parsed.data, updatedAt: parsed.updatedAt }
    }
  } catch {
    // 忽略损坏的本地缓存
  }
  return { keyHash: currentHash, data: null, updatedAt: null }
}

const saveCache = (payload: BalanceCachePayload) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch {
    // 忽略存储配额限制
  }
}

const clearCache = () => {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // 忽略存储异常
  }
}

const isValidBalanceResponse = (value: unknown): value is BalanceData => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return typeof record.is_available === 'boolean' && Array.isArray(record.balance_infos)
}

const initial = loadInitialCache()

export const useBalanceStore = create<BalanceStoreState>((set, get) => ({
  keyHash: initial.keyHash,
  data: initial.data,
  updatedAt: initial.updatedAt,
  loading: false,
  error: null,
  refreshBalance: async () => {
    const apiKey = (useSettings.getState().apiKey ?? '').trim()
    if (!apiKey) {
      clearCache()
      set({ keyHash: '', data: null, updatedAt: null, loading: false, error: '请先配置 API Key' })
      return
    }
    if (get().loading) {
      return
    }
    const nextHash = hashApiKey(apiKey)
    const sameKey = get().keyHash === nextHash
    set({
      keyHash: nextHash,
      data: sameKey ? get().data : null,
      updatedAt: sameKey ? get().updatedAt : null,
      loading: true,
      error: null,
    })

    try {
      const response = await request(`${API_ORIGIN}/user/balance`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      const json: unknown = await response.json()
      if (!isValidBalanceResponse(json)) {
        throw new ApiError('protocol', '余额接口返回格式异常')
      }
      const now = Date.now()
      saveCache({ keyHash: nextHash, data: json, updatedAt: now })
      set({
        keyHash: nextHash,
        data: json,
        updatedAt: now,
        loading: false,
        error: null,
      })
    } catch (error) {
      let message = '查询余额失败'
      if (error instanceof ApiError) {
        message = error.status === 401 ? 'API Key 无效或已过期' : error.message
      } else if (error instanceof Error && error.message) {
        message = error.message
      }
      set({ loading: false, error: message })
    }
  },
}))

// API Key 变更或清除时自动重置已展示的旧余额
useSettings.subscribe((state) => {
  const trimmed = (state.apiKey ?? '').trim()
  const nextHash = trimmed ? hashApiKey(trimmed) : ''
  const current = useBalanceStore.getState()
  if (current.keyHash !== nextHash) {
    if (!nextHash) {
      clearCache()
    }
    useBalanceStore.setState({
      keyHash: nextHash,
      data: null,
      updatedAt: null,
      loading: false,
      error: null,
    })
  }
})

export const formatCurrencySymbol = (currency: string): string => {
  if (currency === 'CNY') {
    return '¥'
  }
  if (currency === 'USD') {
    return '$'
  }
  return `${currency} `
}

export const formatPrimaryBalance = (data: BalanceData): string => {
  if (data.balance_infos.length === 0) {
    return '0.00'
  }
  return data.balance_infos
    .map((item) => `${formatCurrencySymbol(item.currency)}${item.total_balance}`)
    .join(' / ')
}

export const formatClockTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
