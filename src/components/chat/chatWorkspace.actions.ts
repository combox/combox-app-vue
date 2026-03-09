import { createChannelActions } from './chatWorkspace.actions.channel'
import { createGroupActions } from './chatWorkspace.actions.group'
import { createMessageActions } from './chatWorkspace.actions.message'
import type { WorkspaceActionsInput } from './chatWorkspace.actions.shared'

export function setupWorkspaceActions(input: WorkspaceActionsInput) {
  const messageActions = createMessageActions(input)
  const groupActions = createGroupActions(input)
  const channelActions = createChannelActions(input)

  return {
    ...messageActions,
    ...groupActions,
    ...channelActions,
  }
}
