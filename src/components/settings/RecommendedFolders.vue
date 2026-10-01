<script setup lang="ts">
import { ref } from 'vue'
import { createChatFolder, listChatFolders } from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { loadUnreadSnapshot } from './settingsEffects'
import './settingsShared.css'

const emit = defineEmits<{ created: [] }>()

const { t } = useI18n()
const toast = useToast()
const busy = ref(false)

async function addUnreadFolder(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const folders = await listChatFolders()
    if (folders.length >= 12) {
      toast.error(t('settings.folders_limit', { max: 12 }, 'You can keep at most 12 folders'))
      return
    }
    if (folders.some((folder) => folder.name.trim().toLowerCase() === 'unread')) {
      toast.info(t('settings.tg.folders.unread_exists', undefined, 'You already have an Unread folder'))
      return
    }
    const snap = await loadUnreadSnapshot()
    const chatIds = Object.keys(snap.unreadByChat)
    if (chatIds.length === 0) {
      toast.info(t('settings.tg.folders.unread_none', undefined, 'No unread chats right now'))
      return
    }
    await createChatFolder({ name: 'Unread', icon: 'mdi-email-outline', chat_ids: chatIds })
    toast.success(t('settings.tg.folders.unread_added', undefined, 'Unread folder added'))
    emit('created')
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : t('settings.folders_save_failed', undefined, 'Could not save the folder'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="tgCard">
    <div class="tgSectionLabel">{{ t('settings.tg.folders.recommended', undefined, 'Recommended') }}</div>
    <button type="button" class="tgRow" :disabled="busy" @click="addUnreadFolder">
      <span class="tgRowIcon" aria-hidden="true"><v-icon icon="mdi-email-outline" size="20" /></span>
      <span class="tgRowMain">
        <span class="tgRowTitle">{{ t('settings.tg.folders.unread', undefined, 'Unread') }}</span>
        <span class="tgRowSub">{{ t('settings.tg.folders.unread_hint', undefined, 'A folder with the chats that are unread right now') }}</span>
      </span>
      <span class="tgAdd">{{ t('settings.tg.folders.add', undefined, 'Add') }}</span>
    </button>
    <div class="tgHint">
      {{ t('settings.tg.folders.unread_note', undefined, 'Folders have no live filters, so this captures the current unread chats.') }}
    </div>
  </section>
</template>

<style scoped>
.tgRow:disabled {
  opacity: 0.55;
  cursor: default;
}

.tgAdd {
  flex: 0 0 auto;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 13.5px;
  font-weight: 700;
}
</style>
