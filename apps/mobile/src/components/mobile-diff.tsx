import { View } from 'react-native'
import { DiffsView, type Theme } from 'react-native-diffs'
import { mobileDetailStyles as styles } from './mobile-detail-styles'

const theme: Theme = {
  fonts: {
    codeSize: 12,
  },
  colors: {
    body: '#E8EDF2',
    code: '#D5DEE8',
    codeBackground: '#05070A',
    highlight: '#67E8C5',
    emphasis: '#9EABB9',
    selectionTint: '#45D6B2',
  },
  diff: {
    displayMode: 'unified',
    scrollBehavior: 'bothAxes',
    changeHighlightStyle: 'both',
    lineNumberStyle: 'dual',
    showsChangeMarkers: true,
    contextCollapseThreshold: 12,
    visibleContextLines: 4,
    backgroundColor: '#05070A',
    gutterBackground: '#11161C',
    gutterText: '#728092',
    addedLineBackground: '#1B5E4938',
    removedLineBackground: '#7F1D2D35',
    addedHighlightBackground: '#2DD4A866',
    removedHighlightBackground: '#FB718555',
    hunkHeaderBackground: '#151B22',
    hunkHeaderText: '#9EABB9',
    fileHeaderBackground: '#11161C',
    fileHeaderText: '#E8EDF2',
    fileMetadataText: '#67E8C5',
    separatorColor: '#28313C',
    borderColor: '#28313C',
    borderWidth: 0,
  },
}

export function MobileDiff({ patch }: { patch: string }) {
  return (
    <View style={styles.diffViewer}>
      <DiffsView content={patch} colorScheme="dark" contentInset={{ top: 8, bottom: 8 }} showsBlockHeaders={false} style={styles.diffNativeView} theme={theme} />
    </View>
  )
}
