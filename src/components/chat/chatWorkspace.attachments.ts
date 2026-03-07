import { type MessageItem } from 'combox-api'
import type { Ref } from 'vue'
import type { AttachmentView } from './chatWorkspace.types'

type AttachmentPayload = {
  url: string
  preview_url?: string
  attachment: {
    width?: number
    height?: number
    duration_ms?: number
  }
}

export async function hydrateAttachmentURLs(
  items: MessageItem[],
  urlsByAttachment: Ref<Record<string, AttachmentView>>,
  attachmentRequests: Map<string, Promise<void>>,
  parseMessageContent: (content: string) => { attachments: Array<{ id?: string | null }> },
  getAttachment: (id: string) => Promise<AttachmentPayload>,
) {
  const tokens = new Set<string>()
  for (const item of items) {
    const parsed = parseMessageContent(item.content || '')
    for (const attachment of parsed.attachments) {
      const id = (attachment.id || '').trim()
      if (id && !urlsByAttachment.value[id]) tokens.add(id)
    }
  }
  if (!tokens.size) return
  await Promise.all(
    Array.from(tokens).map(async (id) => {
      if (attachmentRequests.has(id)) {
        await attachmentRequests.get(id)
        return
      }
      const request = (async () => {
        try {
          const payload = await getAttachment(id)
          urlsByAttachment.value = {
            ...urlsByAttachment.value,
            [id]: {
              url: payload.url,
              previewUrl: payload.preview_url || '',
              width: payload.attachment.width || 0,
              height: payload.attachment.height || 0,
              durationMs: payload.attachment.duration_ms || 0,
            },
          }
        } catch {
          urlsByAttachment.value = {
            ...urlsByAttachment.value,
            [id]: { url: '', previewUrl: '', width: 0, height: 0, durationMs: 0 },
          }
        } finally {
          attachmentRequests.delete(id)
        }
      })()
      attachmentRequests.set(id, request)
      await request
    }),
  )
}
