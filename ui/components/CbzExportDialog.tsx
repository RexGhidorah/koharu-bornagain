'use client'

import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useScene } from '@/hooks/useScene'
import { getGetPageThumbnailUrl } from '@/lib/api/default/default'
import type { CbzExportMetadata } from '@/lib/api/schemas'
import { exportCurrentProjectAs } from '@/lib/io/pagesIo'

interface CbzExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CbzExportDialog({ open, onOpenChange }: CbzExportDialogProps) {
  const { t } = useTranslation()
  const { scene } = useScene()
  const [coverPage, setCoverPage] = useState<string | null>(null)
  const [chapterStarts, setChapterStarts] = useState<Record<string, string>>({})
  const [exporting, setExporting] = useState(false)

  const pages = useMemo(() => {
    if (!scene?.pages) return []
    return Object.entries(scene.pages).map(([id, page]) => ({ ...page, id }))
  }, [scene?.pages])

  if (!pages.length) {
    return null
  }

  const toggleCover = (id: string) => {
    setCoverPage((prev) => (prev === id ? null : id))
  }

  const handleAddChapter = (id: string) => {
    const defaultTitle = `Chapter ${Object.keys(chapterStarts).length + 1}`
    const title = prompt(t('menu.enterChapterTitle', 'Enter chapter title:'), defaultTitle)
    if (title) {
      setChapterStarts((prev) => ({ ...prev, [id]: title }))
    }
  }

  const handleRemoveChapter = (id: string) => {
    setChapterStarts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const chapters = Object.entries(chapterStarts).map(([startPage, title]) => ({
        startPage,
        title,
      }))
      const cbzMetadata: CbzExportMetadata = {
        coverPage,
        chapters,
      }
      await exportCurrentProjectAs('cbz', undefined, cbzMetadata)
      onOpenChange(false)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[80vh] max-w-4xl flex-col'>
        <DialogHeader>
          <DialogTitle>{t('menu.exportCbz', 'Export to CBZ')}</DialogTitle>
        </DialogHeader>

        <div className='flex flex-1 flex-col gap-4 overflow-hidden'>
          <p className='text-sm text-muted-foreground'>
            {t('menu.cbzExportDesc', 'Select the cover page and where chapters begin.')}
          </p>

          <ScrollArea className='flex-1 rounded-md border p-4'>
            <div className='grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6'>
              {pages.map((page, index) => {
                const isCover = coverPage === page.id
                const isChapterStart = !!chapterStarts[page.id]
                const chapterTitle = chapterStarts[page.id]

                return (
                  <div key={page.id} className='group relative flex flex-col gap-2'>
                    <div
                      className={`relative aspect-[1/1.4] overflow-hidden rounded-md border-2 ${isCover ? 'border-primary' : isChapterStart ? 'border-blue-500' : 'border-transparent'}`}
                    >
                      <img
                        src={getGetPageThumbnailUrl(page.id)}
                        alt={`Page ${index + 1}`}
                        className='h-full w-full object-cover'
                      />
                      {isCover && (
                        <div className='absolute top-1 left-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground'>
                          Cover
                        </div>
                      )}
                      {isChapterStart && (
                        <div className='absolute top-1 right-1 max-w-[80%] truncate rounded bg-blue-500 px-2 py-1 text-xs text-white'>
                          {chapterTitle}
                        </div>
                      )}
                    </div>

                    <div className='flex justify-center gap-1'>
                      <Button
                        variant={isCover ? 'default' : 'outline'}
                        size='sm'
                        className='h-6 px-2 py-0 text-xs'
                        onClick={() => toggleCover(page.id)}
                      >
                        Cover
                      </Button>
                      <Button
                        variant={isChapterStart ? 'secondary' : 'outline'}
                        size='sm'
                        className='h-6 px-2 py-0 text-xs'
                        onClick={() =>
                          isChapterStart ? handleRemoveChapter(page.id) : handleAddChapter(page.id)
                        }
                      >
                        {isChapterStart ? 'Remove Chapter' : '+ Chapter'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={exporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
