import { useState } from 'react'
import { Text, View } from 'react-native'
import { openMobileHttpUrl } from '@/mobile-linking'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { normalizeMobileMarkdown } from './mobile-markdown-normalize'
import { MobileNativeMarkdown } from './mobile-native-markdown'

export function MobileMarkdown({ content, emptyText, tone = 'default' }: { content: string; emptyText: string; tone?: 'default' | 'onAccent' }) {
  const [linkError, setLinkError] = useState('')
  if (!content.trim())
    return (
      <Text selectable style={styles.body}>
        {emptyText}
      </Text>
    )

  return (
    <View style={styles.markdown}>
      <MobileNativeMarkdown
        content={normalizeMobileMarkdown(content)}
        tone={tone}
        onOpenLink={(url) => void openMobileHttpUrl(url, setLinkError)}
      />
      {linkError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {linkError}
        </Text>
      ) : null}
    </View>
  )
}
