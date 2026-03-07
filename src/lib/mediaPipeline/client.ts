import { ApiError, uploadAttachmentWithProgress, uploadMediaSessionWithProgress } from 'combox-api'

export interface MediaUploadInput {
  file: File
  onProgress?: (percent: number) => void
}

export interface MediaUploadResult {
  attachment: {
    id: string
    filename: string
    mime_type: string
    kind: string
  }
  url: string
  previewUrl?: string
  protocol: 'hls-session' | 'multipart-legacy'
}

export interface MediaPipelineClient {
  uploadFile(input: MediaUploadInput): Promise<MediaUploadResult>
}

class LegacyMultipartMediaPipelineClient implements MediaPipelineClient {
  async uploadFile(input: MediaUploadInput): Promise<MediaUploadResult> {
    const uploaded = await uploadAttachmentWithProgress(input.file, input.onProgress)
    return {
      attachment: uploaded.attachment,
      url: uploaded.url,
      previewUrl: uploaded.preview_url,
      protocol: 'multipart-legacy',
    }
  }
}

class SessionFirstMediaPipelineClient implements MediaPipelineClient {
  private readonly legacy = new LegacyMultipartMediaPipelineClient()

  async uploadFile(input: MediaUploadInput): Promise<MediaUploadResult> {
    try {
      const uploaded = await uploadMediaSessionWithProgress(input.file, input.onProgress)
      return {
        attachment: uploaded.attachment,
        url: uploaded.url,
        previewUrl: uploaded.preview_url,
        protocol: 'hls-session',
      }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      if (!['not_found', 'request_failed', 'internal'].includes(error.code)) throw error
      return this.legacy.uploadFile(input)
    }
  }
}

export const mediaPipelineClient: MediaPipelineClient = new SessionFirstMediaPipelineClient()
