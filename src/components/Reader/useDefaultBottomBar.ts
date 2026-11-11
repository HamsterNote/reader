import type { PopoverTheme } from '@hamster-note/components'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

export function useWindowWidth(): number {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleResize = () => setWidth(window.innerWidth)
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return width
}

/**
 * 解析 Reader 的生效主题：显式 `darkMode` 优先，未提供时跟随系统偏好。
 * 底栏、EPUB 引擎与 PDF Text 翻页控件共用这一条规则，避免主题分叉。
 */
export function resolveReaderTheme(
  darkMode: boolean | undefined,
  preferred: PopoverTheme
): PopoverTheme {
  if (darkMode === undefined) return preferred
  return darkMode ? 'dark' : 'light'
}

export function usePrefersColorScheme(): PopoverTheme {
  const [scheme, setScheme] = useState<PopoverTheme>('dark')

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => {
      setScheme(event.matches ? 'dark' : 'light')
    }
    setScheme(mediaQuery.matches ? 'dark' : 'light')
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return scheme
}

export function useBottomBarMenus() {
  const menuIdPrefix = useId()
  const [toolMenuAnchor, setToolMenuAnchor] = useState<HTMLElement | null>(null)
  const [fontMenuAnchor, setFontMenuAnchor] = useState<HTMLElement | null>(null)
  const [zoomMenuAnchor, setZoomMenuAnchor] = useState<HTMLElement | null>(null)
  const toolMenuRef = useRef<HTMLDivElement>(null)
  const fontMenuRef = useRef<HTMLDivElement>(null)
  const zoomMenuRef = useRef<HTMLDivElement>(null)
  const toolMenuId = `${menuIdPrefix}-tool-menu`
  const fontMenuId = `${menuIdPrefix}-font-menu`
  const zoomMenuId = `${menuIdPrefix}-zoom-menu`
  const closeMenus = useCallback(() => {
    setToolMenuAnchor(null)
    setFontMenuAnchor(null)
    setZoomMenuAnchor(null)
  }, [])
  const closeMenusAndRestoreFocus = useCallback(() => {
    const activeAnchor = toolMenuAnchor ?? fontMenuAnchor ?? zoomMenuAnchor
    closeMenus()
    activeAnchor?.focus()
  }, [closeMenus, fontMenuAnchor, toolMenuAnchor, zoomMenuAnchor])

  return {
    toolMenuId,
    fontMenuId,
    zoomMenuId,
    toolMenuRef,
    fontMenuRef,
    zoomMenuRef,
    toolMenuAnchor,
    fontMenuAnchor,
    zoomMenuAnchor,
    setToolMenuAnchor,
    setFontMenuAnchor,
    setZoomMenuAnchor,
    closeMenus,
    closeMenusAndRestoreFocus
  }
}
