import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useSearchPanel } from '../../components/search/searchPanelState.js'
import {
  closeMobileSider,
  openMobileSider,
  useMobileSider,
} from '../../components/sider/mobileSiderState.js'
import { Sider } from '../../components/sider/Sider.js'
import styles from './MobileDrawerSwipe.module.css'

const DRAWER_TRANSITION_MS = 220
const MIN_SWIPE_DISTANCE = 48
const FLICK_SWIPE_DISTANCE = 36
const FLICK_MAX_DURATION_MS = 300

const hasBlockingOverlay = (): boolean =>
  document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false
  }
  return target.closest('input, textarea, [contenteditable="true"]') !== null
}

const isInsideHorizontallyScrollable = (target: EventTarget | null): boolean => {
  for (
    let element = target instanceof Element ? target : null;
    element && element !== document.body;
    element = element.parentElement
  ) {
    const style = getComputedStyle(element)
    const canScrollX =
      /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 2
    if (canScrollX) {
      return true
    }
  }
  return false
}

/**
 * 移动端侧边抽屉左右滑动手势：
 * - 关闭状态：仅在屏幕左半屏起点右滑打开抽屉（避开弹窗、输入框及可横向滚动内容）
 * - 打开状态：任意位置左滑关闭抽屉
 */
export const useMobileDrawerSwipe = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) {
      return
    }

    let active = false
    let wasOpen = false
    let startX = 0
    let startY = 0
    let lastX = 0
    let lastY = 0
    let startTime = 0
    let moved = false

    const reset = () => {
      active = false
      moved = false
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        reset()
        return
      }
      if (hasBlockingOverlay()) {
        reset()
        return
      }

      const touch = event.touches[0]
      if (!touch) {
        reset()
        return
      }

      wasOpen = useMobileSider.getState().open
      if (!wasOpen) {
        // 仅允许在屏幕左半屏起点右滑打开，避免常规操作误触
        if (touch.clientX > window.innerWidth * 0.5) {
          reset()
          return
        }
        if (useSearchPanel.getState().entry !== null) {
          reset()
          return
        }
        if (isEditableTarget(event.target) || isInsideHorizontallyScrollable(event.target)) {
          reset()
          return
        }
      }

      active = true
      moved = false
      startX = touch.clientX
      startY = touch.clientY
      lastX = touch.clientX
      lastY = touch.clientY
      startTime = Date.now()
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!active || event.touches.length !== 1) {
        return
      }
      const touch = event.touches[0]
      if (!touch) {
        return
      }
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      // 若明显偏向垂直滚动，立即放弃本次水平手势判定
      if (!moved && Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx) * 0.85) {
        reset()
        return
      }

      moved = true
      lastX = touch.clientX
      lastY = touch.clientY
    }

    const onTouchEnd = () => {
      if (!active || !moved) {
        reset()
        return
      }

      const dx = lastX - startX
      const dy = lastY - startY
      const elapsed = Date.now() - startTime
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)

      reset()

      const isFlick = elapsed <= FLICK_MAX_DURATION_MS && absDx >= FLICK_SWIPE_DISTANCE
      const isSwipe = absDx >= MIN_SWIPE_DISTANCE
      if ((!isSwipe && !isFlick) || absDx <= absDy * 1.4) {
        return
      }

      const selectedText = window.getSelection()?.toString() ?? ''
      if (!wasOpen && selectedText.length > 0) {
        return
      }

      if (!wasOpen && dx > 0) {
        openMobileSider()
      } else if (wasOpen && dx < 0) {
        closeMobileSider()
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('touchcancel', reset, { passive: true })

    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', reset)
    }
  }, [enabled])
}

/**
 * 带滑入/滑出过渡动画的移动端侧边抽屉容器（保持对上游 Sider.tsx 零侵入）。
 */
export const AnimatedMobileSider = () => {
  const open = useMobileSider((state) => state.open)
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setVisible(true)
        })
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }

    setVisible(false)
    const timer = setTimeout(() => {
      setMounted(false)
    }, DRAWER_TRANSITION_MS)
    return () => clearTimeout(timer)
  }, [open])

  if (!mounted) {
    return null
  }

  return (
    <>
      <div
        className={clsx(
          styles.mask,
          visible && styles.maskVisible,
          !open && styles.maskClosing
        )}
        onClick={closeMobileSider}
      />
      <div className={clsx(styles.drawer, visible && styles.drawerVisible)}>
        <Sider mobile />
      </div>
    </>
  )
}
