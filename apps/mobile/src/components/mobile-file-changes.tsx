import { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { MobileDiffFile } from '@/mobile-detail-service'
import { colors } from '@/theme'
import { MobileDiff } from './mobile-diff'
import { MobileSymbol } from './mobile-symbol'
import { MobileModalSafeArea } from './mobile-modal-safe-area'
import { MobileSheetHeader } from './mobile-sheet-header'
import { mobileDetailStyles as styles } from './mobile-detail-styles'
import { displayMobileFilePath } from './mobile-file-path'

export function MobileFileChanges({ additions, deletions, files, patch, worktreePath }: {
  additions: number
  deletions: number
  files: MobileDiffFile[]
  patch: string
  worktreePath?: string
}) {
  const patches = useMemo(() => patchesByFile(patch), [patch])
  const [selectedPath, setSelectedPath] = useState(files[0]?.path || '')
  const [collapsed, setCollapsed] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  useEffect(() => {
    if (!files.some((file) => file.path === selectedPath)) setSelectedPath(files[0]?.path || '')
  }, [files, selectedPath])
  const selected = files.find((file) => file.path === selectedPath)
  const selectedPatch = patches.get(selectedPath) || patches.get(displayMobileFilePath(selectedPath, worktreePath)) || ''

  return <View style={styles.changeOverview}>
    <View style={styles.changeMetrics}>
      <ChangeMetric value={files.length} label={files.length === 1 ? 'file' : 'files'} />
      <Text style={styles.additions}>+{additions}</Text>
      <Text style={styles.deletions}>−{deletions}</Text>
    </View>
    <FilePicker files={files} selectedPath={selectedPath} worktreePath={worktreePath} onBrowse={() => setBrowserOpen(true)} onSelect={(path) => { setSelectedPath(path); setCollapsed(false) }} />
    <SelectedFilePanel file={selected} patch={selectedPatch} collapsed={collapsed} worktreePath={worktreePath} onToggle={() => setCollapsed((value) => !value)} />
    <FileBrowser files={files} selectedPath={selectedPath} visible={browserOpen} worktreePath={worktreePath} onClose={() => setBrowserOpen(false)} onSelect={(path) => { setSelectedPath(path); setCollapsed(false); setBrowserOpen(false) }} />
  </View>
}

function FilePicker({ files, selectedPath, worktreePath, onSelect, onBrowse }: { files: MobileDiffFile[]; selectedPath: string; worktreePath?: string; onSelect(path: string): void; onBrowse(): void }) {
  const index = Math.max(0, files.findIndex((file) => file.path === selectedPath))
  return <><View style={styles.fileNavigation}><Pressable accessibilityLabel="Previous changed file" disabled={index <= 0} onPress={() => onSelect(files[index - 1]!.path)} style={[styles.fileNavigationButton, index <= 0 && styles.disabled]}><MobileSymbol name="chevron.left" fallback="‹" color={colors.accent} size={16} /></Pressable><Pressable accessibilityRole="button" onPress={onBrowse} style={styles.fileBrowserButton}><Text numberOfLines={1} style={styles.fileBrowserButtonText}>{files.length ? `${index + 1} of ${files.length} files` : 'No files'}</Text><MobileSymbol name="list.bullet" fallback="☷" color={colors.accent} size={15} /></Pressable><Pressable accessibilityLabel="Next changed file" disabled={index >= files.length - 1} onPress={() => onSelect(files[index + 1]!.path)} style={[styles.fileNavigationButton, index >= files.length - 1 && styles.disabled]}><MobileSymbol name="chevron.right" fallback="›" color={colors.accent} size={16} /></Pressable></View><ScrollView horizontal contentContainerStyle={styles.filePicker} showsHorizontalScrollIndicator={false}>
    {files.map((file) => <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: file.path === selectedPath }}
      key={file.path}
      onPress={() => onSelect(file.path)}
      style={[styles.fileChip, file.path === selectedPath && styles.fileChipSelected]}
      testID={`changed-file-${file.path}`}
    >
      <Text numberOfLines={1} style={[styles.fileChipText, file.path === selectedPath && styles.fileChipTextSelected]}>{fileName(displayMobileFilePath(file.path, worktreePath))}</Text>
      <Text style={styles.fileChipMeta}>+{file.additions} −{file.deletions}</Text>
    </Pressable>)}
  </ScrollView></>
}

function FileBrowser({ files, selectedPath, visible, worktreePath, onClose, onSelect }: { files: MobileDiffFile[]; selectedPath: string; visible: boolean; worktreePath?: string; onClose(): void; onSelect(path: string): void }) {
  const [query, setQuery] = useState('')
  const matches = files.filter((file) => file.path.toLowerCase().includes(query.trim().toLowerCase()))
  return <Modal allowSwipeDismissal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={onClose}><MobileModalSafeArea style={styles.fileBrowser}><MobileSheetHeader title="Changed files" subtitle={`${files.length} files in this change`} trailingLabel="Done" onTrailing={onClose} /><TextInput accessibilityLabel="Search changed files" autoCapitalize="none" autoCorrect={false} placeholder="Filter paths" placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} style={styles.fileSearch} /><ScrollView contentContainerStyle={styles.fileBrowserList}>{matches.map((file) => <Pressable key={file.path} accessibilityRole="button" accessibilityState={{ selected: file.path === selectedPath }} onPress={() => onSelect(file.path)} style={[styles.fileBrowserRow, file.path === selectedPath && styles.fileBrowserRowSelected]}><View style={styles.filePanelTitle}><Text numberOfLines={2} style={styles.filePath}>{displayMobileFilePath(file.path, worktreePath)}</Text><Text style={styles.fileStatus}>{file.status || 'modified'}</Text></View><Text style={styles.fileChipMeta}>+{file.additions} −{file.deletions}</Text><MobileSymbol name="chevron.right" fallback="›" color={colors.muted} size={13} /></Pressable>)}</ScrollView></MobileModalSafeArea></Modal>
}

function SelectedFilePanel({ file, patch, collapsed, worktreePath, onToggle }: { file?: MobileDiffFile; patch: string; collapsed: boolean; worktreePath?: string; onToggle(): void }) {
  if (!file) return <Text style={styles.muted}>No changed files have been recorded yet.</Text>
  return <View style={styles.filePanel}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: !collapsed }} onPress={onToggle} style={styles.filePanelHeader} testID="toggle-selected-file-diff">
      <View style={styles.filePanelTitle}>
        <Text numberOfLines={2} style={styles.filePath}>{displayMobileFilePath(file.path, worktreePath)}</Text>
        <Text style={styles.fileStatus}>{file.status || 'modified'}{file.binary ? ' · binary' : ''}</Text>
      </View>
      <MobileSymbol name={collapsed ? 'chevron.down' : 'chevron.up'} fallback={collapsed ? '⌄' : '⌃'} color={colors.muted} size={14} />
    </Pressable>
    {collapsed ? null : <FilePatch file={file} patch={patch} />}
  </View>
}

function FilePatch({ file, patch }: { file: MobileDiffFile; patch: string }) {
  if (file.binary) return <Text style={styles.muted}>Binary file preview is unavailable.</Text>
  return patch ? <MobileDiff patch={patch} /> : <Text style={styles.muted}>No patch is available for this file.</Text>
}

function ChangeMetric({ value, label }: { value: number; label: string }) {
  return <Text style={styles.changeMetric}><Text style={styles.changeMetricValue}>{value}</Text> {label}</Text>
}

function fileName(path: string): string {
  return path.split('/').at(-1) || path
}

export function patchesByFile(patch: string): Map<string, string> {
  const result = new Map<string, string>()
  if (!patch.trim()) return result
  const chunks = patch.split(/(?=^diff --git )/m).filter(Boolean)
  for (const chunk of chunks) {
    const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m)
    const path = header?.[2] || chunk.match(/^\+\+\+ b\/(.+)$/m)?.[1]
    if (path) result.set(path, chunk)
  }
  return result
}
