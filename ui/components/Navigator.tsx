'use client'

import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import {
  useListDocuments,
  getGetDocumentThumbnailUrl,
} from '@/lib/api/documents/documents'
import { useEditorUiStore } from '@/lib/stores/editorUiStore'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'

const THUMBNAIL_DPR =
  typeof window !== 'undefined'
    ? Math.min(Math.ceil(window.devicePixelRatio || 1), 3)
    : 2

// Fixed row height: thumbnail (aspect 3:4 in ~150px width ≈ 200px) + page number + padding
const ROW_HEIGHT = 230
const OVERSCAN = 5

export function Navigator() {
  const { data: documents = [] } = useListDocuments()
  const totalPages = documents.length
  const currentDocumentId = useEditorUiStore((state) => state.currentDocumentId)
  const selectedDocumentIds = useEditorUiStore((state) => state.selectedDocumentIds)
  const handleDocumentSelection = useEditorUiStore((state) => state.handleDocumentSelection)
  const currentDocumentIndex = documents.findIndex(
    (d) => d.id === currentDocumentId,
  )
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const { t } = useTranslation()

  const virtualizer = useVirtualizer({
    count: totalPages,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  })

  return (
    <div
      data-testid='navigator-panel'
      data-total-pages={totalPages}
      className='bg-muted/50 flex h-full min-h-0 w-full flex-col border-r'
    >
      <div className='border-border flex flex-col gap-1 border-b px-2 py-1.5'>
        <div className='flex items-center justify-between'>
          <p className='text-muted-foreground text-xs tracking-wide uppercase'>
            {t('navigator.title')}
          </p>
          {totalPages > 0 && (
            <Button
              variant='ghost'
              size='sm'
              className='h-auto px-1.5 py-0.5 text-[10px]'
              onClick={() => {
                if (selectedDocumentIds.size === totalPages) {
                  useEditorUiStore.setState({ selectedDocumentIds: new Set() })
                } else {
                  useEditorUiStore.setState({
                    selectedDocumentIds: new Set(documents.map((d) => d.id)),
                  })
                }
              }}
            >
              {selectedDocumentIds.size === totalPages
                ? t('navigator.deselectAll', 'Deselect All')
                : t('navigator.selectAll', 'Select All')}
            </Button>
          )}
        </div>
        <div className='flex items-center justify-between'>
          <p className='text-foreground text-xs font-semibold'>
            {totalPages
              ? t('navigator.pages', { count: totalPages })
              : t('navigator.empty')}
          </p>
          {selectedDocumentIds.size > 0 && (
            <span className='text-muted-foreground text-[10px]'>
              {selectedDocumentIds.size} selected
            </span>
          )}
        </div>
      </div>

      <div className='text-muted-foreground flex items-center gap-1.5 px-2 py-1.5 text-xs'>
        {totalPages > 0 ? (
          <span className='bg-secondary text-secondary-foreground px-2 py-0.5 font-mono text-[10px]'>
            #{currentDocumentIndex + 1}
          </span>
        ) : (
          <span>{t('navigator.prompt')}</span>
        )}
      </div>

      <ScrollArea className='min-h-0 flex-1' viewportRef={viewportRef}>
        <div
          className='relative w-full'
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const doc = documents[virtualRow.index]
            return (
              <div
                key={doc?.id ?? virtualRow.index}
                className='absolute left-0 w-full px-1.5 pb-1'
                style={{
                  height: ROW_HEIGHT,
                  top: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <PagePreview
                  index={virtualRow.index}
                  documentId={doc?.id}
                  selected={doc?.id === currentDocumentId}
                  checked={doc ? selectedDocumentIds.has(doc.id) : false}
                  onSelect={(e) => {
                    if (doc) {
                      handleDocumentSelection(doc.id, virtualRow.index, documents, {
                        shiftKey: e.shiftKey,
                        ctrlKey: e.ctrlKey || e.metaKey,
                      })
                    }
                  }}
                />
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

type PagePreviewProps = {
  index: number
  documentId?: string
  selected: boolean
  checked: boolean
  onSelect: (e: React.MouseEvent | React.KeyboardEvent) => void
}

function PagePreview({
  index,
  documentId,
  selected,
  checked,
  onSelect,
}: PagePreviewProps) {
  const src = documentId
    ? getGetDocumentThumbnailUrl(documentId, { size: 200 * THUMBNAIL_DPR })
    : undefined

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(e)
        }
      }}
      data-testid={`navigator-page-${index}`}
      data-page-index={index}
      data-selected={selected}
      className='bg-card hover:bg-accent hover:text-accent-foreground data-[selected=true]:border-primary relative flex h-full w-full cursor-pointer flex-col gap-0.5 rounded border border-transparent p-1.5 text-left shadow-sm transition-colors'
    >
      <div className='absolute top-2 left-2 z-10'>
        <Checkbox
          checked={checked}
          onCheckedChange={() => {
            // Checkbox click is handled by the parent div's onClick
          }}
          className='bg-background/80 data-[state=checked]:bg-primary shadow-sm'
          tabIndex={-1}
        />
      </div>
      <div className='flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded'>
        {src ? (
          <img
            src={src}
            alt={`Page ${index + 1}`}
            loading='lazy'
            className='max-h-full max-w-full rounded object-contain'
          />
        ) : (
          <div className='bg-muted h-full w-full rounded' />
        )}
      </div>
      <div className='text-muted-foreground flex shrink-0 items-center text-xs'>
        <div className='text-foreground mx-auto font-semibold'>{index + 1}</div>
      </div>
    </div>
  )
}
