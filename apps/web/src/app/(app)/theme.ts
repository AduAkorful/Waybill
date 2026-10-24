'use client'

import { useEffect, useState } from 'react'

export type SiteTheme = 'light' | 'dark'

function read(): SiteTheme {
  const set = document.documentElement.getAttribute('data-theme')
  if (set === 'light' || set === 'dark') return set
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** The theme the page is showing now (the toggle's choice, or the system's), so third-party UI can match it. */
export function useSiteTheme(): SiteTheme {
  const [theme, setTheme] = useState<SiteTheme>('light')
  useEffect(() => {
    const update = () => setTheme(read())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', update)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', update)
    }
  }, [])
  return theme
}
