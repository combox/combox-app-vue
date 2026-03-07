export function normalizeAvatarSrc(raw: string | undefined): string {
  const value = (raw || '').trim()
  if (!value) return ''
  if (value.startsWith('s3key:')) return ''
  if (
    value.startsWith('http://')
    || value.startsWith('https://')
    || value.startsWith('data:image/')
    || value.startsWith('blob:')
  ) return value
  return ''
}
