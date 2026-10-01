<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '../../i18n/i18n'
import {
  perChatEnabled,
  useUserSettings,
  type BoolSettingKey,
  type PerChatKind,
} from './userSettingsMeta'
import {
  computeBadgePreview,
  loadUnreadSnapshot,
  syncNotificationBridge,
  type UnreadSnapshot,
} from './settingsEffects'
import './settingsShared.css'

const { t } = useI18n()
const { values, pending, error, load, set } = useUserSettings()
const snapshot = ref<UnreadSnapshot>({ unreadByChat: {}, mutedIds: [] })

const badge = computed(() => computeBadgePreview(values, snapshot.value))

async function toggle(key: BoolSettingKey, next: boolean | null): Promise<void> {
  await set(key, next)
  syncNotificationBridge(values)
}

function kindOn(kind: PerChatKind): boolean {
  return perChatEnabled(values, kind)
}

onMounted(() => {
  void load().then(() => syncNotificationBridge(values))
  void loadUnreadSnapshot().then((snap) => {
    snapshot.value = snap
  })
})
</script>

<template>
  <div class="tgPage">
    <section class="tgCard tgCardPad">
      <div class="settingsCard__title">{{ t('settings.tg.notif.global', undefined, 'Global notifications') }}</div>
      <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.notifications_enabled', undefined, 'Notifications') }}</div>
          <div class="toggleRow__sub">
            {{ t('settings.tg.notif.master_hint', undefined, 'Master switch: when off, nothing below can notify you.') }}
          </div>
        </div>
        <v-switch
          :model-value="values.notifications_enabled"
          :disabled="pending.notifications_enabled"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('notifications_enabled', $event)"
        />
      </div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.notif.preview_name', undefined, 'Show sender name') }}</div>
          <div class="toggleRow__sub">
            {{ t('settings.tg.notif.preview_and', undefined, 'Works only together with message previews.') }}
          </div>
        </div>
        <v-switch
          :model-value="values.notification_preview_name"
          :disabled="pending.notification_preview_name"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('notification_preview_name', $event)"
        />
      </div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.notif.preview_text', undefined, 'Show message text') }}</div>
          <div class="toggleRow__sub">
            {{ t('settings.tg.notif.preview_and', undefined, 'Works only together with message previews.') }}
          </div>
        </div>
        <v-switch
          :model-value="values.notification_preview_text"
          :disabled="pending.notification_preview_text"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('notification_preview_text', $event)"
        />
      </div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.notification_previews', undefined, 'Message previews') }}</div>
          <div class="toggleRow__sub">
            {{ t('settings.tg.notif.previews_hint', undefined, 'Master for the two chips above: hides name and text when off.') }}
          </div>
        </div>
        <v-switch
          :model-value="values.notification_previews"
          :disabled="pending.notification_previews"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('notification_previews', $event)"
        />
      </div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.sounds_enabled', undefined, 'Sounds') }}</div>
          <div class="toggleRow__sub">
            {{ t('settings.sounds_enabled_hint', undefined, 'Play a sound for incoming messages.') }}
          </div>
        </div>
        <v-switch
          :model-value="values.sounds_enabled"
          :disabled="pending.sounds_enabled"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('sounds_enabled', $event)"
        />
      </div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.voice_autoplay', undefined, 'Autoplay voice messages') }}</div>
          <div class="toggleRow__sub">{{ t('settings.voice_autoplay_hint', undefined, 'Play voice notes as soon as they arrive in the chat.') }}</div>
        </div>
        <v-switch
          :model-value="values.voice_autoplay"
          :disabled="pending.voice_autoplay"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('voice_autoplay', $event)"
        />
      </div>
    </section>

    <section class="tgCard">
      <div class="tgSectionLabel">{{ t('settings.tg.notif.per_chat', undefined, 'Notify me about') }}</div>
      <div class="tgHint">
        {{ t('settings.tg.notif.per_chat_hint', undefined, 'Each type additionally requires the master switch above (logical AND).') }}
      </div>

      <div class="toggleRow tgInset">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.notif.private', undefined, 'Private chats') }}</div>
          <div class="toggleRow__sub">{{ kindOn('private') ? t('settings.tg.notif.on_now', undefined, 'Notifies now') : t('settings.tg.notif.off_now', undefined, 'Silent now') }}</div>
        </div>
        <v-switch
          :model-value="values.notifications_private"
          :disabled="pending.notifications_private"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('notifications_private', $event)"
        />
      </div>

      <div class="toggleRow tgInset">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.notif.groups', undefined, 'Groups') }}</div>
          <div class="toggleRow__sub">{{ kindOn('groups') ? t('settings.tg.notif.on_now', undefined, 'Notifies now') : t('settings.tg.notif.off_now', undefined, 'Silent now') }}</div>
        </div>
        <v-switch
          :model-value="values.notifications_groups"
          :disabled="pending.notifications_groups"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('notifications_groups', $event)"
        />
      </div>

      <div class="toggleRow tgInset">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.notif.channels', undefined, 'Channels') }}</div>
          <div class="toggleRow__sub">{{ kindOn('channels') ? t('settings.tg.notif.on_now', undefined, 'Notifies now') : t('settings.tg.notif.off_now', undefined, 'Silent now') }}</div>
        </div>
        <v-switch
          :model-value="values.notifications_channels"
          :disabled="pending.notifications_channels"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('notifications_channels', $event)"
        />
      </div>

      <div class="toggleRow tgInset">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.notif.reactions', undefined, 'Reactions') }}</div>
          <div class="toggleRow__sub">{{ kindOn('reactions') ? t('settings.tg.notif.on_now', undefined, 'Notifies now') : t('settings.tg.notif.off_now', undefined, 'Silent now') }}</div>
        </div>
        <v-switch
          :model-value="values.notifications_reactions"
          :disabled="pending.notifications_reactions"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('notifications_reactions', $event)"
        />
      </div>
    </section>

    <section class="tgCard tgCardPad">
      <div class="settingsCard__title">{{ t('settings.tg.notif.events', undefined, 'Events') }}</div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.notif.contact_joined', undefined, 'Contact joined') }}</div>
          <div class="toggleRow__sub">{{ t('settings.tg.notif.contact_joined_hint', undefined, 'Notify when one of your contacts joins ComBox.') }}</div>
        </div>
        <v-switch
          :model-value="values.events_contact_joined"
          :disabled="pending.events_contact_joined"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('events_contact_joined', $event)"
        />
      </div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.notif.pinned', undefined, 'Pinned messages') }}</div>
          <div class="toggleRow__sub">{{ t('settings.tg.notif.pinned_hint', undefined, 'Notify when a message is pinned in your chats.') }}</div>
        </div>
        <v-switch
          :model-value="values.events_pinned"
          :disabled="pending.events_pinned"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('events_pinned', $event)"
        />
      </div>
    </section>

    <section class="tgCard tgCardPad">
      <div class="settingsCard__title">{{ t('settings.tg.notif.calls', undefined, 'Calls') }}</div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.notif.calls_accept', undefined, 'Accept calls') }}</div>
          <div class="toggleRow__sub">{{ t('settings.tg.notif.calls_accept_hint', undefined, 'When off, incoming calls are not shown to you.') }}</div>
        </div>
        <v-switch
          :model-value="values.calls_accept"
          :disabled="pending.calls_accept"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('calls_accept', $event)"
        />
      </div>
    </section>

    <section class="tgCard tgCardPad">
      <div class="settingsCard__title">{{ t('settings.tg.notif.badge', undefined, 'Unread badge') }}</div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.badge_enabled', undefined, 'Unread badge') }}</div>
          <div class="toggleRow__sub">
            {{ t('settings.tg.notif.badge_master_hint', undefined, 'Master switch: hides the counter completely when off.') }}
          </div>
        </div>
        <v-switch
          :model-value="values.badge_enabled"
          :disabled="pending.badge_enabled"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('badge_enabled', $event)"
        />
      </div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.notif.badge_muted', undefined, 'Include muted chats') }}</div>
          <div class="toggleRow__sub">{{ t('settings.tg.notif.badge_muted_hint', undefined, 'Count muted chats in the badge too.') }}</div>
        </div>
        <v-switch
          :model-value="values.badge_include_muted"
          :disabled="pending.badge_include_muted"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('badge_include_muted', $event)"
        />
      </div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.notif.badge_folders', undefined, 'Count per folder') }}</div>
          <div class="toggleRow__sub">{{ t('settings.tg.notif.badge_folders_hint', undefined, 'Show the counter on folder tabs as well.') }}</div>
        </div>
        <v-switch
          :model-value="values.badge_folders_count"
          :disabled="pending.badge_folders_count"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('badge_folders_count', $event)"
        />
      </div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.notif.badge_messages', undefined, 'Count messages') }}</div>
          <div class="toggleRow__sub">{{ t('settings.tg.notif.badge_messages_hint', undefined, 'Count messages instead of chats.') }}</div>
        </div>
        <v-switch
          :model-value="values.badge_count_messages"
          :disabled="pending.badge_count_messages"
          hide-details
          inset
          color="primary"
          @update:model-value="toggle('badge_count_messages', $event)"
        />
      </div>

      <div class="tgSample" aria-live="polite">
        <div class="tgSampleTitle">
          {{
            badge.visible
              ? t('settings.tg.notif.badge_now', { count: badge.count }, 'Badge now: {count}')
              : t('settings.tg.notif.badge_hidden', undefined, 'Badge hidden')
          }}
        </div>
        <div class="tgSampleMeta">
          {{
            t(
              'settings.tg.notif.badge_formula',
              {
                unit: badge.unit,
                folders: badge.perFolder
                  ? t('settings.tg.notif.badge_per_folder', undefined, 'per folder')
                  : t('settings.tg.notif.badge_total', undefined, 'total'),
                muted: badge.includesMuted
                  ? t('settings.tg.notif.badge_with_muted', undefined, 'muted included')
                  : t('settings.tg.notif.badge_without_muted', undefined, 'muted excluded'),
              },
              'Computed live from your unread chats: {unit}, {folders}, {muted}',
            )
          }}
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tgInset {
  margin: 0 8px;
}

.toggleRow.tgInset + .toggleRow.tgInset {
  margin-top: 10px;
}
</style>
