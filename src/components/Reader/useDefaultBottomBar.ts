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
  const toolMenuRef = useRef<HTMLDivElement>(null)
  const fontMenuRef = useRef<HTMLDivElement>(null)
  const toolMenuId = `${menuIdPrefix}-tool-menu`
  const fontMenuId = `${menuIdPrefix}-font-menu`
  const closeMenus = useCallback(() => {
    setToolMenuAnchor(null)
    setFontMenuAnchor(null)
  }, [])
  const closeMenusAndRestoreFocus = useCallback(() => {
    const activeAnchor = toolMenuAnchor ?? fontMenuAnchor
    closeMenus()
    activeAnchor?.focus()
  }, [closeMenus, fontMenuAnchor, toolMenuAnchor])

  useEffect(() => {
    if (!toolMenuAnchor) return
    const frame = window.requestAnimationFrame(() => {
      toolMenuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [toolMenuAnchor])

  useEffect(() => {
    if (!fontMenuAnchor) return
    const frame = window.requestAnimationFrame(() => {
      fontMenuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [fontMenuAnchor])

  useEffect(() => {
    if (!toolMenuAnchor && !fontMenuAnchor) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (
        toolMenuAnchor?.contains(target) ||
        fontMenuAnchor?.contains(target) ||
        toolMenuRef.current?.contains(target) ||
        fontMenuRef.current?.contains(target)
      ) {
        return
      }
      closeMenus()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenusAndRestoreFocus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeMenus, closeMenusAndRestoreFocus, fontMenuAnchor, toolMenuAnchor])

  return {
    toolMenuId,
    fontMenuId,
    toolMenuRef,
    fontMenuRef,
    toolMenuAnchor,
    fontMenuAnchor,
    setToolMenuAnchor,
    setFontMenuAnchor,
    closeMenus,
    closeMenusAndRestoreFocus
  }
}
