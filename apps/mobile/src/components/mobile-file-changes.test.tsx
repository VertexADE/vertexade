import { fireEvent, render, screen } from '@testing-library/react-native'
import { MobileFileChanges, patchesByFile } from './mobile-file-changes'

jest.mock('./mobile-diff', () => ({ MobileDiff: ({ patch }: { patch: string }) => {
  const { Text } = require('react-native') as typeof import('react-native')
  return <Text>{patch}</Text>
} }))

const patch = `diff --git a/src/one.ts b/src/one.ts
--- a/src/one.ts
+++ b/src/one.ts
@@ -1 +1 @@
-one
+first
diff --git a/src/two.ts b/src/two.ts
--- a/src/two.ts
+++ b/src/two.ts
@@ -1 +1 @@
-two
+second`

test('splits, switches, and collapses file patches lazily', () => {
  expect([...patchesByFile(patch)]).toHaveLength(2)
  render(<MobileFileChanges additions={2} deletions={2} files={[
    { path: 'src/one.ts', additions: 1, deletions: 1, status: 'modified', binary: false },
    { path: 'src/two.ts', additions: 1, deletions: 1, status: 'modified', binary: false },
  ]} patch={patch} />)
  expect(screen.getByText(/\+first/)).toBeOnTheScreen()
  expect(screen.queryByText(/\+second/)).not.toBeOnTheScreen()
  fireEvent.press(screen.getByTestId('changed-file-src/two.ts'))
  expect(screen.getByText(/\+second/)).toBeOnTheScreen()
  fireEvent.press(screen.getByLabelText('Previous changed file'))
  expect(screen.getByText(/\+first/)).toBeOnTheScreen()
  fireEvent.press(screen.getByText('1 of 2 files'))
  expect(screen.getByLabelText('Search changed files')).toBeOnTheScreen()
  fireEvent.changeText(screen.getByLabelText('Search changed files'), 'two')
  fireEvent.press(screen.getByText('src/two.ts'))
  expect(screen.getByText(/\+second/)).toBeOnTheScreen()
  fireEvent.press(screen.getByTestId('toggle-selected-file-diff'))
  expect(screen.queryByText(/\+second/)).not.toBeOnTheScreen()
})

test('renders changed files relative to the worktree', () => {
  render(<MobileFileChanges
    additions={1}
    deletions={0}
    files={[{
      path: '/Users/dominicvonk/.vertex-ade/work-items/W-0012/vertexade/src/one.ts',
      additions: 1,
      deletions: 0,
      status: 'modified',
      binary: false,
    }]}
    patch=""
    worktreePath="/Users/dominicvonk/.vertex-ade/work-items/W-0012"
  />)

  expect(screen.getByText('vertexade/src/one.ts')).toBeOnTheScreen()
  expect(screen.queryByText('/Users/dominicvonk/.vertex-ade/work-items/W-0012/vertexade/src/one.ts')).not.toBeOnTheScreen()
})
