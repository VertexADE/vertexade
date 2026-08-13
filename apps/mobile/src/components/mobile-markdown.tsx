import { useState } from 'react'
import { Text, View } from 'react-native'
import { openMobileHttpUrl } from '@/mobile-linking'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import MobileMarkdownView from './mobile-markdown-view'

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
      <MobileMarkdownView
        content={content}
        tone={tone}
        onOpenLink={(url) => void openMobileHttpUrl(url, setLinkError)}
        dom={{
          matchContents: true,
          scrollEnabled: false,
          showsHorizontalScrollIndicator: false,
        }}
      />
      {linkError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {linkError}
        </Text>
      ) : null}
    </View>
  )
}
