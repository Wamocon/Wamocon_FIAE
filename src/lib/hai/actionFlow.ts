/**
 * Action step of the HAI pipeline, shared by the blocking and the streaming
 * path.
 *
 * The pipeline never executes a write. A detected action becomes a proposal
 * (PendingAction) that the client shows as a confirmation card. Only the
 * confirmed call of /api/hai/action executes it, and that route checks the
 * role, the responsibility and the parameters again. The proposal is a display
 * only, it carries no authority.
 */

import { detectActionIntent } from './actions';
import {
  describeAction,
  isActionAllowedForRole,
  isWriteAction,
  sanitizeActionParameters,
  type PendingAction,
} from './actionPolicy';

/** Intents below this confidence are treated as normal chat. */
export const ACTION_CONFIDENCE_THRESHOLD = 0.7;

export interface ActionFlowContext {
  userRole?: 'TRAINER' | 'TRAINEE';
  currentEnablerId?: string;
  currentCourseId?: string;
  enablerTitle?: string;
}

/** Fits PipelineResult: a proposal or a plain answer, nothing was executed. */
export interface ActionFlowResult {
  response: string;
  intent: 'action';
  citations: [];
  actionResult?: { success: boolean; actionType: string };
  pendingAction?: PendingAction;
}

function answer(
  response: string,
  actionType: string,
  extra: Partial<ActionFlowResult> = {}
): ActionFlowResult {
  return {
    response,
    intent: 'action',
    citations: [],
    actionResult: { success: false, actionType },
    ...extra,
  };
}

/**
 * Turn an action in the message into a proposal. Returns null when the
 * message holds no action, so the pipeline answers it as usual.
 */
export async function handleActionMessage(
  userMessage: string,
  context: ActionFlowContext
): Promise<ActionFlowResult | null> {
  if (!context.userRole) return null;

  const intent = detectActionIntent(userMessage, {
    userRole: context.userRole,
    currentEnablerId: context.currentEnablerId,
    currentCourseId: context.currentCourseId,
  });
  if (!intent || intent.confidence < ACTION_CONFIDENCE_THRESHOLD) return null;

  // Reading actions change nothing, they are answered like normal chat
  if (!isWriteAction(intent.type)) return null;

  if (!isActionAllowedForRole(intent.type, context.userRole)) {
    return answer(
      context.userRole === 'TRAINER'
        ? 'Diese Aktion ist nur für Auszubildende möglich.'
        : 'Diese Aktion ist nur für Trainer möglich.',
      intent.type
    );
  }

  const checked = sanitizeActionParameters(intent.type, intent.parameters);
  if (!checked.ok) return answer(checked.message, intent.type);

  const description = describeAction(intent.type, checked.parameters, {
    enablerTitle: context.enablerTitle,
  });
  return {
    response: `Ich habe diese Aktion vorbereitet:\n\n**${description}**\n\nSie wird erst ausgeführt, wenn du sie bestätigst. Ohne Bestätigung ändert sich nichts.`,
    intent: 'action',
    citations: [],
    pendingAction: {
      type: intent.type,
      parameters: checked.parameters,
      description,
    },
  };
}
