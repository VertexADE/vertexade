import { useEffect } from 'react'
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'
import { applyAppearancePreferences, hasStoredAppearancePreferences, readAppearancePreferences } from '../lib/appearance-preferences'

function StoredAppearance() {
  const { setTheme } = useTheme()
  useEffect(() => {
    const appearance = readAppearancePreferences()
    applyAppearancePreferences(appearance)
    if (hasStoredAppearancePreferences()) setTheme(appearance.colorMode)
  }, [setTheme])
  return null
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <StoredAppearance />
      {children}
    </NextThemesProvider>
  )
}
