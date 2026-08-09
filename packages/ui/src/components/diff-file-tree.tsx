import { MessageSquareText } from 'lucide-react'
import { FileTree, FileTreeFile, FileTreeFolder, FileTreeName } from '@vertexade/ui/components/ai-elements/file-tree'
import { Badge } from '@vertexade/ui/components/ui/badge'
import type { DiffFile } from '@vertexade/ui/lib/dashboard-types'
import { cn } from '@vertexade/ui/lib/utils'

const statusCode = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' }

type DiffFileNode = {
  kind: 'file'
  name: string
  path: string
  file: DiffFile
  index: number
}

type DiffFolderNode = {
  kind: 'folder'
  name: string
  path: string
  fileCount: number
  children: DiffTreeNode[]
}

export type DiffTreeNode = DiffFileNode | DiffFolderNode

type MutableFolder = {
  name: string
  path: string
  fileCount: number
  folders: Map<string, MutableFolder>
  files: DiffFileNode[]
}

function folder(name: string, path: string): MutableFolder {
  return { name, path, fileCount: 0, folders: new Map(), files: [] }
}

function materialize(node: MutableFolder): DiffTreeNode[] {
  const folders: DiffFolderNode[] = [...node.folders.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => ({
      kind: 'folder',
      name: item.name,
      path: item.path,
      fileCount: item.fileCount,
      children: materialize(item),
    }))
  const files = [...node.files].sort((left, right) => left.name.localeCompare(right.name))
  return [...folders, ...files]
}

export function buildDiffFileTree(files: DiffFile[]) {
  const root = folder('', '')

  for (const [index, file] of files.entries()) {
    const parts = file.path.split('/').filter(Boolean)
    const name = parts.pop() || file.path
    let parent = root
    let parentPath = ''

    for (const part of parts) {
      parentPath = parentPath ? `${parentPath}/${part}` : part
      let child = parent.folders.get(part)
      if (!child) {
        child = folder(part, parentPath)
        parent.folders.set(part, child)
      }
      child.fileCount += 1
      parent = child
    }

    parent.files.push({ kind: 'file', name, path: file.path, file, index })
  }

  return materialize(root)
}

function folderPaths(nodes: DiffTreeNode[]): string[] {
  return nodes.flatMap((node) => (node.kind === 'folder' ? [node.path, ...folderPaths(node.children)] : []))
}

function annotationCount(annotations: Array<{ path: string }>, path: string) {
  return annotations.filter((annotation) => annotation.path === path).length
}

type DiffFileTreeProps = {
  files: DiffFile[]
  selectedIndex: number
  annotations: Array<{ path: string }>
  onSelect: (index: number) => void
}

export function DiffFileTree({ files, selectedIndex, annotations, onSelect }: DiffFileTreeProps) {
  const nodes = buildDiffFileTree(files)
  const indexByPath = new Map(files.map((file, index) => [file.path, index]))

  function renderNode(node: DiffTreeNode) {
    if (node.kind === 'folder') {
      return (
        <FileTreeFolder count={node.fileCount} key={node.path} name={node.name} path={node.path}>
          {node.children.map(renderNode)}
        </FileTreeFolder>
      )
    }

    const comments = annotationCount(annotations, node.path)
    return (
      <FileTreeFile
        className="gap-2 py-1.5 text-xs text-muted-foreground"
        key={`${node.path}-${node.index}`}
        name={node.name}
        path={node.path}
        title={node.path}
      >
        <Badge
          className={cn(
            'size-5 shrink-0 justify-center p-0 font-mono text-xs',
            node.file.status === 'added' && 'text-emerald-400',
            node.file.status === 'deleted' && 'text-red-400',
            node.file.status === 'renamed' && 'text-blue-400',
          )}
          variant="outline"
        >
          {node.file.binary ? 'B' : statusCode[node.file.status] || 'M'}
        </Badge>
        <FileTreeName>{node.name}</FileTreeName>
        <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap font-mono">
          {comments > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-blue-400"
              title={`${comments} inline annotation${comments === 1 ? '' : 's'}`}
            >
              <MessageSquareText className="size-3" />
              {comments}
            </span>
          )}
          <span className="text-emerald-400">+{node.file.additions}</span>
          <span className="text-red-400">−{node.file.deletions}</span>
        </span>
      </FileTreeFile>
    )
  }

  return (
    <FileTree
      className="rounded-none border-0 bg-transparent"
      defaultExpanded={new Set(folderPaths(nodes))}
      onSelect={(path) => {
        const index = indexByPath.get(path)
        if (index !== undefined) onSelect(index)
      }}
      selectedPath={files[selectedIndex]?.path}
    >
      {nodes.map(renderNode)}
    </FileTree>
  )
}
