import type { AssistantChatTurn } from "@/lib/assistant/client";

export const ASSISTANT_MESSAGE_MAX_CHARS = 4_000;
export const ASSISTANT_HISTORY_CHAR_BUDGET = 6_000;

export type AssistantConversationMessage = AssistantChatTurn & {
  id: string;
  status: "pending" | "complete" | "failed";
  inputTokens?: number;
  outputTokens?: number;
};

export type AssistantConversationState = {
  messages: AssistantConversationMessage[];
  draft: string;
  privacyAcknowledged: boolean;
};

export function emptyAssistantConversation(
  privacyAcknowledged = false,
): AssistantConversationState {
  return {
    messages: [],
    draft: "",
    privacyAcknowledged,
  };
}

/**
 * Build provider history from complete user/assistant pairs only.
 *
 * Packing newest pairs backwards keeps the conversation coherent while
 * reserving space in the server's total input budget for the current message
 * and aggregate context.
 */
export function packAssistantHistory(
  messages: readonly AssistantConversationMessage[],
  characterBudget = ASSISTANT_HISTORY_CHAR_BUDGET,
): AssistantChatTurn[] {
  const pairs: Array<[AssistantChatTurn, AssistantChatTurn]> = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (
      user.status === "complete"
      && assistant.status === "complete"
      && user.role === "user"
      && assistant.role === "assistant"
    ) {
      pairs.push([
        { role: "user", content: user.content },
        { role: "assistant", content: assistant.content },
      ]);
      index += 1;
    }
  }

  const selected: Array<[AssistantChatTurn, AssistantChatTurn]> = [];
  let usedCharacters = 0;
  for (let index = pairs.length - 1; index >= 0; index -= 1) {
    const pair = pairs[index];
    const pairCharacters = pair[0].content.length + pair[1].content.length;
    if (usedCharacters + pairCharacters > Math.max(0, characterBudget)) break;
    selected.unshift(pair);
    usedCharacters += pairCharacters;
  }
  return selected.flatMap((pair) => pair);
}
