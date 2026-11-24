import clsx from 'clsx'
import { Button } from '../../components/base/Button.js'
import { openSettings } from '../../components/settings/settingsDialogState.js'
import { useSettings } from '../../services/settings.js'
import {
  formatClockTime,
  formatCurrencySymbol,
  formatPrimaryBalance,
  useBalanceStore,
} from './balanceStore.js'
import styles from './Balance.module.css'

const RefreshIcon = ({ spinning = false }: { spinning?: boolean }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    className={spinning ? styles.spin : undefined}
  >
    <path
      d="M13.5 8a5.5 5.5 0 1 1-1.35-3.6M13.5 2.75v2.6h-2.6"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const StatusBadge = ({ available }: { available: boolean }) => (
  <span className={available ? styles.badgeAvailable : styles.badgeUnavailable}>
    {available ? '可用' : '余额不足'}
  </span>
)

/**
 * 设置 -> 数据管理页（API Key 下方）的详细余额模块：支持手动刷新与构成明细展示。
 */
export const SettingsBalanceCell = () => {
  const apiKey = useSettings((state) => (state.apiKey ?? '').trim())
  const data = useBalanceStore((state) => state.data)
  const updatedAt = useBalanceStore((state) => state.updatedAt)
  const loading = useBalanceStore((state) => state.loading)
  const error = useBalanceStore((state) => state.error)
  const refreshBalance = useBalanceStore((state) => state.refreshBalance)

  return (
    <div className={styles.settingsCell}>
      <div className={styles.settingsInfo}>
        <div className={styles.settingsTitleRow}>
          <span>账户余额</span>
          {data ? <StatusBadge available={data.is_available} /> : null}
        </div>
        {data ? (
          <>
            <div className={styles.settingsValue}>{formatPrimaryBalance(data)}</div>
            {data.balance_infos.map((info) => {
              const symbol = formatCurrencySymbol(info.currency)
              return (
                <div key={info.currency} className={styles.settingsMeta}>
                  {info.currency}：充值 {symbol}
                  {info.topped_up_balance} · 赠金 {symbol}
                  {info.granted_balance}
                </div>
              )
            })}
            {updatedAt ? (
              <div className={styles.settingsMeta}>上次刷新：{formatClockTime(updatedAt)}</div>
            ) : null}
          </>
        ) : (
          <div className={styles.settingsMeta}>
            {apiKey ? '点击右侧按钮手动查询当前 API Key 余额' : '请先在上方保存 API Key 后再查询'}
          </div>
        )}
        {error ? <div className={styles.settingsError}>{error}</div> : null}
      </div>

      <Button
        variant="outlined"
        size="m"
        className={styles.refreshButton}
        disabled={loading || !apiKey}
        onClick={() => void refreshBalance()}
      >
        <RefreshIcon spinning={loading} />
        {loading ? '查询中...' : '刷新余额'}
      </Button>
    </div>
  )
}

/**
 * 左侧边栏「设置」入口上方的醒目总余额展示卡片：支持一键手动刷新。
 */
export const SiderBalanceCard = () => {
  const apiKey = useSettings((state) => (state.apiKey ?? '').trim())
  const data = useBalanceStore((state) => state.data)
  const updatedAt = useBalanceStore((state) => state.updatedAt)
  const loading = useBalanceStore((state) => state.loading)
  const error = useBalanceStore((state) => state.error)
  const refreshBalance = useBalanceStore((state) => state.refreshBalance)

  return (
    <div className={styles.siderCard}>
      <div className={styles.siderTop}>
        <div className={styles.siderTitleGroup}>
          <span className={styles.siderLabel}>账户余额</span>
          {data ? <StatusBadge available={data.is_available} /> : null}
        </div>
        <button
          type="button"
          className={clsx(styles.siderRefreshBtn)}
          aria-label="刷新余额"
          title="手动刷新余额"
          disabled={loading}
          onClick={() => {
            if (!apiKey) {
              openSettings('data')
              return
            }
            void refreshBalance()
          }}
        >
          <RefreshIcon spinning={loading} />
        </button>
      </div>

      <div className={styles.siderAmountRow}>
        {data ? (
          <span className={styles.siderAmount}>{formatPrimaryBalance(data)}</span>
        ) : !apiKey ? (
          <button
            type="button"
            className={styles.siderPlaceholderBtn}
            onClick={() => openSettings('data')}
          >
            去配置 API Key
          </button>
        ) : (
          <button
            type="button"
            className={styles.siderPlaceholderBtn}
            disabled={loading}
            onClick={() => void refreshBalance()}
          >
            {loading ? '正在查询余额...' : '点击查询余额'}
          </button>
        )}
      </div>

      {error ? (
        <div className={styles.siderError}>{error}</div>
      ) : data && updatedAt ? (
        <div className={styles.siderSubtext}>手动刷新于 {formatClockTime(updatedAt)}</div>
      ) : null}
    </div>
  )
}
