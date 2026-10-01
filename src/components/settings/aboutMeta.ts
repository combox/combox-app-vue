/**
 * Real app version, read from package.json (webpack resolves JSON imports).
 * No hardcoded fallback — a missing version surfaces as 'dev', never a lie.
 */
import packageJson from '../../../package.json'

export const APP_VERSION: string = (packageJson as { version?: string }).version || 'dev'

/** Project page, taken from the repository README. */
export const APP_SITE_URL = 'https://github.com/combox/combox-app-vue'
