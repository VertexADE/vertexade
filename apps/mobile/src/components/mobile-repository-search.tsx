import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import type { MobileBackend } from '@/platform-service'
import { searchMobileRepositories, type MobileRepositorySearchResult } from '@/mobile-workspace-service'
import { colors } from '@/theme'
import { mobileWorkspaceStyles as styles } from './mobile-workspace-styles'

export function MobileRepositorySearch({
  serviceUrl,
  backend,
  added,
  onSelect,
}: {
  serviceUrl: string
  backend: MobileBackend
  added: string[]
  onSelect(repository: MobileRepositorySearchResult): Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MobileRepositorySearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState('')
  const [error, setError] = useState('')
  const [source, setSource] = useState<'authenticated' | 'public'>('authenticated')

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setError('')
      return
    }
    let active = true
    const timer = setTimeout(() => {
      setLoading(true)
      setError('')
      void searchMobileRepositories(backend.serviceUrl || serviceUrl, backend.id, query)
        .then((page) => {
          if (!active) return
          setResults(page.repositories)
          setSource(page.source)
        })
        .catch((reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : 'Repositories could not be searched')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [backend, query, serviceUrl])

  async function choose(repository: MobileRepositorySearchResult) {
    setAdding(repository.id)
    try {
      await onSelect(repository)
    } finally {
      setAdding('')
    }
  }

  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>Find a repository</Text>
      <Text style={styles.inputHint}>Private and organization repositories are shown first. Public results appear only as fallback.</Text>
      <TextInput
        testID="create-repository-search"
        accessibilityLabel="Search accessible repositories"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Search owner or repository…"
        placeholderTextColor={colors.muted}
        style={styles.search}
        value={query}
        onChangeText={setQuery}
      />
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {source === 'public' && results.length ? <Text style={styles.inputHint}>Public GitHub fallback</Text> : null}
      {results.length ? (
        <View style={styles.options}>
          {results.map((repository) => {
            const exists = added.some((name) => name.toLowerCase() === repository.id.toLowerCase())
            return (
              <Pressable
                key={repository.id}
                accessibilityRole="button"
                accessibilityState={{ disabled: exists || Boolean(adding) }}
                disabled={exists || Boolean(adding)}
                onPress={() => void choose(repository)}
                style={({ pressed }) => [styles.option, pressed && styles.pressed, exists && styles.disabled]}
              >
                <Text style={styles.optionText}>{repository.name}</Text>
                <Text style={styles.optionMeta}>{exists ? 'Already added' : repository.private ? 'Private repository' : repository.description || 'Public repository'}</Text>
                {adding === repository.id ? <ActivityIndicator color={colors.accent} /> : null}
              </Pressable>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}
