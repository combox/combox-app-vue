import type { SearchResults } from 'combox-api'

export const EMPTY_SEARCH_RESULTS: SearchResults = { users: [], chats: [] }

export const CHATS_CACHE_KEY = 'combox.vue.chat.chats.v1'
export const GROUP_CHANNELS_CACHE_KEY = 'combox.vue.chat.groupChannels.v1'
export const MSG_CACHE_PREFIX = 'combox.vue.chat.messages.v1:'
export const STATUS_CACHE_PREFIX = 'combox.vue.chat.statuses.v1:'
export const STATUS_GLOBAL_CACHE_KEY = 'combox.vue.chat.statuses.global.v1'
export const SELECTED_CHAT_KEY = 'combox.vue.chat.selected.v2'
export const SELECTED_GROUP_CHANNELS_KEY = 'combox.vue.chat.selectedGroupChannels.v1'
export const PENDING_CHAT_PREFIX = 'u:'
