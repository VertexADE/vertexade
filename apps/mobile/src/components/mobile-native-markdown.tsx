import { type ReactNode, useMemo, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { parseMarkdown, type BlockNode, type InlineNode, type ListItemNode } from '@tanstack/markdown'
import { colors } from '@/theme'
import { MobileSymbol } from './mobile-symbol'

type Tone = 'default' | 'onAccent'

export function MobileNativeMarkdown({ content, tone, onOpenLink }: { content: string; tone: Tone; onOpenLink(url: string): void }) {
  const document = useMemo(() => parseMarkdown(content.replace(/<!--[\s\S]*?-->/g, ''), { allowHtml: true, frontmatter: false }), [content])
  return <View style={nativeStyles.root}>{document.children.map((node, index) => renderBlock(node, `${node.type}-${index}`, tone, onOpenLink))}</View>
}

function renderBlock(node: BlockNode, key: string, tone: Tone, onOpenLink: (url: string) => void): ReactNode {
  const textStyle = tone === 'onAccent' ? nativeStyles.onAccent : nativeStyles.text
  switch (node.type) {
    case 'paragraph':
      return <Text key={key} selectable style={[nativeStyles.paragraph, textStyle]}>{renderInline(node.children, tone, onOpenLink)}</Text>
    case 'heading':
      return <Text key={key} selectable style={[nativeStyles.heading, headingStyle(node.depth), textStyle]}>{renderInline(node.children, tone, onOpenLink)}</Text>
    case 'code':
      return <ScrollView key={key} horizontal showsHorizontalScrollIndicator={false} style={nativeStyles.codeBlock}><Text selectable style={nativeStyles.codeBlockText}>{node.value}</Text></ScrollView>
    case 'list':
      return <View key={key} style={nativeStyles.list}>{node.items.map((item, index) => renderListItem(item, index, node.ordered, node.start || 1, key, tone, onOpenLink))}</View>
    case 'blockquote':
      return <View key={key} style={nativeStyles.blockquote}>{node.children.map((child, index) => renderBlock(child, `${key}-${index}`, tone, onOpenLink))}</View>
    case 'thematicBreak':
      return <View key={key} style={nativeStyles.rule} />
    case 'table':
      return <ScrollView key={key} horizontal showsHorizontalScrollIndicator={false} style={nativeStyles.table}><View>{[node.header, ...node.rows].map((row, rowIndex) => <View key={`${key}-row-${rowIndex}`} style={nativeStyles.tableRow}>{row.map((cell, cellIndex) => <Text key={`${key}-cell-${cellIndex}`} style={[nativeStyles.tableCell, rowIndex === 0 && nativeStyles.tableHeader, textStyle]}>{renderInline(cell.children, tone, onOpenLink)}</Text>)}</View>)}</View></ScrollView>
    case 'html':
      return <NativeHtmlBlock key={key} value={node.value} tone={tone} onOpenLink={onOpenLink} />
    case 'callout':
      return <View key={key} style={nativeStyles.callout}><Text style={[nativeStyles.calloutTitle, textStyle]}>{node.title}</Text>{node.children.map((child, index) => renderBlock(child, `${key}-${index}`, tone, onOpenLink))}</View>
    case 'footnotes':
      return <View key={key}>{node.items.map((item) => <View key={`${key}-${item.id}`} style={nativeStyles.footnote}><Text style={[nativeStyles.footnoteNumber, textStyle]}>{item.number}.</Text><View style={nativeStyles.flex}>{item.children.map((child, index) => renderBlock(child, `${key}-${item.id}-${index}`, tone, onOpenLink))}</View></View>)}</View>
    case 'component':
      return <View key={key}>{node.children.map((child, index) => renderBlock(child, `${key}-${index}`, tone, onOpenLink))}</View>
  }
}

function renderListItem(item: ListItemNode, index: number, ordered: boolean, start: number, parentKey: string, tone: Tone, onOpenLink: (url: string) => void) {
  return <View key={`${parentKey}-${index}`} style={nativeStyles.listItem}><Text style={[nativeStyles.listMarker, tone === 'onAccent' ? nativeStyles.onAccent : nativeStyles.text]}>{item.checked === true ? '☑' : item.checked === false ? '☐' : ordered ? `${start + index}.` : '•'}</Text><View style={nativeStyles.flex}>{item.children.map((child, childIndex) => renderBlock(child, `${parentKey}-${index}-${childIndex}`, tone, onOpenLink))}</View></View>
}

function renderInline(nodes: InlineNode[], tone: Tone, onOpenLink: (url: string) => void): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`
    switch (node.type) {
      case 'text': return node.value
      case 'strong': return <Text key={key} style={nativeStyles.strong}>{renderInline(node.children, tone, onOpenLink)}</Text>
      case 'emphasis': return <Text key={key} style={nativeStyles.emphasis}>{renderInline(node.children, tone, onOpenLink)}</Text>
      case 'strike': return <Text key={key} style={nativeStyles.strike}>{renderInline(node.children, tone, onOpenLink)}</Text>
      case 'inlineCode': return <Text key={key} style={[nativeStyles.inlineCode, tone === 'onAccent' && nativeStyles.inlineCodeAccent]}>{node.value}</Text>
      case 'link': return <Text key={key} accessibilityRole="link" onPress={() => onOpenLink(node.href)} style={[nativeStyles.link, tone === 'onAccent' && nativeStyles.onAccent]}>{renderInline(node.children, tone, onOpenLink)}</Text>
      case 'image': return <Image key={key} accessibilityLabel={node.alt} resizeMode="contain" source={{ uri: node.src }} style={nativeStyles.image} />
      case 'break': return '\n'
      case 'footnoteReference': return <Text key={key} style={nativeStyles.superscript}>[{node.number}]</Text>
      case 'inlineHtml': return plainHtml(node.value)
    }
  })
}

function NativeHtmlBlock({ value, tone, onOpenLink }: { value: string; tone: Tone; onOpenLink(url: string): void }) {
  const [expanded, setExpanded] = useState(false)
  const details = value.match(/^\s*<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>\s*$/i)
  if (!details) return <Text selectable style={[nativeStyles.paragraph, tone === 'onAccent' ? nativeStyles.onAccent : nativeStyles.text]}>{plainHtml(value)}</Text>
  const body = parseMarkdown(details[2].trim(), { allowHtml: true, frontmatter: false })
  return <View style={nativeStyles.details}><Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((current) => !current)} style={nativeStyles.detailsSummary}><Text style={[nativeStyles.detailsTitle, tone === 'onAccent' ? nativeStyles.onAccent : nativeStyles.text]}>{plainHtml(details[1])}</Text><MobileSymbol name={expanded ? 'chevron.down' : 'chevron.right'} fallback={expanded ? '⌄' : '›'} color={tone === 'onAccent' ? '#ffffff' : colors.muted} size={12} /></Pressable>{expanded ? <View style={nativeStyles.detailsBody}>{body.children.map((node, index) => renderBlock(node, `details-${index}`, tone, onOpenLink))}</View> : null}</View>
}

function plainHtml(value: string) {
  return value.replace(/<!--[\s\S]*?-->/g, '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&').trim()
}

function headingStyle(depth: number) {
  if (depth === 1) return nativeStyles.heading1
  if (depth === 2) return nativeStyles.heading2
  return nativeStyles.heading3
}

const nativeStyles = StyleSheet.create({
  blockquote: { borderLeftColor: colors.accent, borderLeftWidth: 3, paddingLeft: 10 },
  callout: { backgroundColor: '#111820', borderColor: '#34404d', borderLeftColor: colors.accent, borderLeftWidth: 3, borderRadius: 10, borderWidth: 1, padding: 10 },
  calloutTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  codeBlock: { backgroundColor: '#05070a', borderColor: '#28313c', borderRadius: 8, borderWidth: 1, marginVertical: 5, padding: 10 },
  codeBlockText: { color: '#d5dee8', fontFamily: 'Menlo', fontSize: 12, lineHeight: 18 },
  details: { borderColor: '#28313c', borderRadius: 10, borderWidth: 1, marginVertical: 5, overflow: 'hidden' },
  detailsBody: { borderTopColor: '#28313c', borderTopWidth: 1, padding: 10 },
  detailsSummary: { alignItems: 'center', flexDirection: 'row', minHeight: 44, paddingHorizontal: 12 },
  detailsTitle: { flex: 1, fontSize: 15, fontWeight: '600' },
  emphasis: { fontStyle: 'italic' },
  flex: { flex: 1, minWidth: 0 },
  footnote: { flexDirection: 'row', gap: 6 },
  footnoteNumber: { fontSize: 12 },
  heading: { fontWeight: '700', lineHeight: 24, marginBottom: 5, marginTop: 8 },
  heading1: { fontSize: 22, lineHeight: 28 },
  heading2: { fontSize: 19, lineHeight: 25 },
  heading3: { fontSize: 17, lineHeight: 23 },
  image: { height: 180, width: '100%' },
  inlineCode: { backgroundColor: '#151b22', borderRadius: 4, color: '#d5dee8', fontFamily: 'Menlo', fontSize: 12 },
  inlineCodeAccent: { backgroundColor: 'rgba(0,0,0,0.18)', color: '#ffffff' },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  list: { gap: 2, marginVertical: 4 },
  listItem: { alignItems: 'flex-start', flexDirection: 'row' },
  listMarker: { lineHeight: 22, minWidth: 24 },
  onAccent: { color: '#ffffff' },
  paragraph: { fontSize: 15, lineHeight: 22, marginVertical: 3 },
  root: { alignSelf: 'stretch', minHeight: 22 },
  rule: { backgroundColor: '#28313c', height: StyleSheet.hairlineWidth, marginVertical: 10 },
  strike: { textDecorationLine: 'line-through' },
  strong: { fontWeight: '700' },
  superscript: { fontSize: 10 },
  table: { borderColor: '#34404d', borderWidth: 1, marginVertical: 5 },
  tableCell: { borderBottomColor: '#34404d', borderBottomWidth: StyleSheet.hairlineWidth, minWidth: 120, padding: 7 },
  tableHeader: { backgroundColor: '#151b22', fontWeight: '700' },
  tableRow: { flexDirection: 'row' },
  text: { color: colors.text },
})
