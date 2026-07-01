export interface SourceFile {
  id: string
  name: string
  data: Uint8Array
  pageCount: number
}

export interface PageRef {
  id: string
  sourceId: string
  sourcePageIndex: number
  rotation: 0 | 90 | 180 | 270
}

export interface DocGroup {
  id: string
  name: string
  pages: PageRef[]
}

export interface DropTarget {
  groupId: string
  index: number
}
