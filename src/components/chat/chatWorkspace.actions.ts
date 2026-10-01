import { createChannelActions } from './chatWorkspace.actions.channel'
import { createChatListActions } from './chatWorkspace.actions.list'
import { createGroupActions } from './chatWorkspace.actions.group'
import { createMessageActions } from './chatWorkspace.actions.message'
import type { WorkspaceActionsInput } from './chatWorkspace.actions.shared'

export function setupWorkspaceActions(input: WorkspaceActionsInput) {
  const messageActions = createMessageActions(input)
  const groupActions = createGroupActions(input)
  const channelActions = createChannelActions(input)
  const chatListActions = createChatListActions(input)

  return {
    ...messageActions,
    ...groupActions,
    ...channelActions,
    ...chatListActions,
  }
}
