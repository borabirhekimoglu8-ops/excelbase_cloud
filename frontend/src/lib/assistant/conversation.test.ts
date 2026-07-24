import { describe, expect, it } from "vitest";

import {
  AssistantConversationMessage,
  emptyAssistantConversation,
  packAssistantHistory,
} from "./conversation";

function message(
  id: string,
  role: AssistantConversationMessage["role"],
  content: string,
  status: AssistantConversationMessage["status"] = "complete",
): AssistantConversationMessage {
  return { id, role, content, status };
}

describe("assistant conversation history", () => {
  it("starts with an isolated empty conversation", () => {
    const first = emptyAssistantConversation(true);
    const second = emptyAssistantConversation();

    first.messages.push(message("u1", "user", "Merhaba"));

    expect(first.privacyAcknowledged).toBe(true);
    expect(second).toEqual({ messages: [], draft: "", privacyAcknowledged: false });
  });

  it("packs only completed user/assistant pairs and omits failed or pending turns", () => {
    const history = packAssistantHistory([
      message("u1", "user", "Birinci soru"),
      message("a1", "assistant", "Birinci yanıt"),
      message("u2", "user", "Başarısız soru", "failed"),
      message("u3", "user", "Bekleyen soru", "pending"),
      message("u4", "user", "İkinci soru"),
      message("a4", "assistant", "İkinci yanıt"),
    ]);

    expect(history).toEqual([
      { role: "user", content: "Birinci soru" },
      { role: "assistant", content: "Birinci yanıt" },
      { role: "user", content: "İkinci soru" },
      { role: "assistant", content: "İkinci yanıt" },
    ]);
  });

  it("keeps newest complete pairs without splitting a pair when the budget is reached", () => {
    const history = packAssistantHistory([
      message("u1", "user", "a".repeat(4)),
      message("a1", "assistant", "b".repeat(4)),
      message("u2", "user", "c".repeat(3)),
      message("a2", "assistant", "d".repeat(3)),
      message("u3", "user", "e".repeat(2)),
      message("a3", "assistant", "f".repeat(2)),
    ], 10);

    expect(history).toEqual([
      { role: "user", content: "ccc" },
      { role: "assistant", content: "ddd" },
      { role: "user", content: "ee" },
      { role: "assistant", content: "ff" },
    ]);
  });
});
