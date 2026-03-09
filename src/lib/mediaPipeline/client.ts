import { ApiError, uploadAttachmentWithProgress, uploadMediaSessionWithProgress } from 'combox-api'
import type { MediaUploadInput, MediaUploadResult } from './types'

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
