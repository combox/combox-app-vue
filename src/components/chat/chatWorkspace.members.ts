import { getUserByID, listChatMembers, type ChatMemberProfile } from 'combox-api'
import { normalizePeerProfile } from './chatWorkspace.helpers'

type ChatMembersList = Awaited<ReturnType<typeof listChatMembers>>

export async function enrichChatMembers(items: ChatMembersList): Promise<ChatMemberProfile[]> {
  return Promise.all(
    items.map(async (member) => {
      try {
        const profile = await getUserByID(member.user_id)
        const normalized = normalizePeerProfile(profile)
        return {
          ...member,
          profile: normalized
            ? {
                id: normalized.id,
                email: normalized.email || '',
                username: normalized.username || '',
                first_name: normalized.first_name || '',
                last_name: normalized.last_name,
                birth_date: normalized.birth_date,
                avatar_data_url: normalized.avatar_data_url,
              }
            : undefined,
        }
      } catch {
        return { ...member, profile: undefined }
      }
    }),
  )
}
