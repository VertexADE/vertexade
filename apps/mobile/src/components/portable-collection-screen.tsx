import { FlatList, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import type { ModuleCatalogEntry, PortableCollectionSurface } from '@vertexade/platform-contracts'
import { readPortablePath } from '@vertexade/platform-contracts/portable'
import { colors } from '@/theme'
import { PortableCollectionActionModal as ActionModal } from './portable-collection-action-modal'
import { CollectionChip as Chip, CollectionDetailsModal as DetailsModal, CollectionRecordCard as RecordCard, CollectionScreenState as ScreenState } from './portable-collection-presentation'
import { portableCollectionStyles as styles } from './portable-collection-styles'
import { portableRecords as records } from './portable-collection-projection'
import { usePortableCollection } from './use-portable-collection'

export function PortableCollectionScreen({ module, server, surface }: {
  module: ModuleCatalogEntry
  server: string
  surface: PortableCollectionSurface
}) {
  const {
    extension, data, loading, error, query, setQuery, view, setView, sort, setSort, axis, setAxis,
    facets, setFacets, sourceValues, setSourceValues, detail, setDetail, detailData, detailLoading,
    actionTarget, setActionTarget, load, fieldNames, visible, groups, configured, actionsFor,
    collectionActions, facetOptions, openDetails,
  } = usePortableCollection({ module, server, surface })
  if (loading && !data) return <ScreenState loading title={`Loading ${surface.title}`} text="Reading the extension data source…" />
  if (error && !data) return <ScreenState title="Surface unavailable" text={error} action="Retry" onAction={() => void load(true)} />
  if (!configured) return <ScreenState title={`${module.name} needs setup`} text={`${surface.setup?.message || 'Configure this extension before using it.'} Open VertexADE web settings to continue.`} />

  return <View style={styles.screen}>
    <View style={styles.header}>
      <Text style={styles.eyebrow}>PORTABLE COLLECTION</Text>
      <Text style={styles.title}>{surface.title}</Text>
      {surface.description ? <Text style={styles.subtitle}>{surface.description}</Text> : null}
      <TextInput accessibilityLabel="Search records" placeholder="Search records…" placeholderTextColor={colors.muted} style={styles.search} value={query} onChangeText={setQuery} />
      {collectionActions.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{collectionActions.map((action) => <Chip active={false} key={action.id} label={action.label} onPress={() => setActionTarget({ item: null, action })} />)}</ScrollView> : null}
      {(surface.sourceControls || []).map((control) => <View key={control.id} style={styles.inputGroup}><Text style={styles.inputLabel}>{control.label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{records(readPortablePath(data, control.optionsPath)).map((option) => {
        const value = String(readPortablePath(option, control.optionValuePath) || '')
        return <Chip active={sourceValues[control.id] === value} key={value} label={String(readPortablePath(option, control.optionLabelPath) || value)} onPress={() => setSourceValues((current) => ({ ...current, [control.id]: value }))} />
      })}</ScrollView></View>)}
      {(surface.facets || []).map((facet) => <View key={facet.id} style={styles.inputGroup}><Text style={styles.inputLabel}>{facet.label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}><Chip active={!facets[facet.id]} label="All" onPress={() => setFacets((current) => ({ ...current, [facet.id]: '' }))} />{facetOptions[facet.id]?.map((value) => <Chip active={facets[facet.id] === value} key={value} label={value} onPress={() => setFacets((current) => ({ ...current, [facet.id]: value }))} />)}</ScrollView></View>)}
      <View style={styles.row}>
        <Chip active={view === 'list'} label="List" onPress={() => setView('list')} />
        {surface.views.kanban?.enabled ? <Chip active={view === 'kanban'} label="Kanban" onPress={() => { setView('kanban'); setAxis((current) => current || fieldNames[0] || '') }} /> : null}
        <Chip active={false} label={loading ? 'Refreshing…' : 'Refresh'} onPress={() => void load(true)} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}><Chip active={sort === 'title'} label="Sort: title" onPress={() => setSort('title')} />{fieldNames.map((field) => <Chip active={sort === field} key={field} label={`Sort: ${field}`} onPress={() => setSort(field)} />)}</ScrollView>
      {view === 'kanban' ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{fieldNames.map((field) => <Chip active={axis === field} key={field} label={field} onPress={() => setAxis(field)} />)}</ScrollView> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
    {view === 'list' ? <FlatList
      contentContainerStyle={styles.list}
      data={visible}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load(true)} tintColor={colors.accent} />}
      renderItem={({ item }) => <RecordCard actions={actionsFor(item)} item={item} onAction={(action) => setActionTarget({ item, action })} onDetails={(value) => void openDetails(value)} />}
      ListEmptyComponent={<ScreenState title="No records found" text={query ? 'Try a different search.' : 'The connected collection is empty.'} />}
    /> : <ScrollView horizontal contentContainerStyle={styles.board} showsHorizontalScrollIndicator={false}>{groups.map((group) => <View key={group.name} style={styles.column}>
      <View style={styles.columnHeader}><Text numberOfLines={1} style={styles.columnTitle}>{group.name}</Text><Text style={styles.count}>{group.items.length}</Text></View>
      <ScrollView contentContainerStyle={styles.columnItems}>{group.items.map((item) => <RecordCard compact actions={actionsFor(item)} item={item} key={item.id} onAction={(action) => setActionTarget({ item, action })} onDetails={(value) => void openDetails(value)} />)}</ScrollView>
    </View>)}</ScrollView>}
    <DetailsModal actions={detail ? actionsFor(detail) : []} data={detailData} loading={detailLoading} item={detail} onAction={(action) => { if (detail) setActionTarget({ item: detail, action }); setDetail(null) }} onClose={() => setDetail(null)} />
    {actionTarget ? <ActionModal action={actionTarget.action} data={data || {}} extension={extension} item={actionTarget.item} server={server} onClose={() => setActionTarget(null)} onCompleted={load} /> : null}
  </View>
}
