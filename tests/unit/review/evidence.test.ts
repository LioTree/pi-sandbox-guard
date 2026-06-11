import { describe, expect, it } from "vitest";
import { collectTranscriptEvidence } from "../../../src/review/evidence";

describe("review transcript evidence", () => {
  it("preserves tool call arguments and tool result names", () => {
    const transcript = collectTranscriptEvidence(
      contextWithEntries([
        { type: "message", message: { role: "user", content: "Install dependencies." } },
        {
          type: "message",
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                name: "bash",
                id: "call-1",
                arguments: { command: "npm install", bypassSandbox: true },
              },
            ],
          },
        },
        {
          type: "message",
          message: {
            role: "toolResult",
            toolName: "bash",
            content: [{ type: "text", text: "npm ERR! 403 Forbidden" }],
            isError: true,
          },
        },
      ]),
      2_000,
    );

    expect(transcript).toContain("[1] user: Install dependencies.");
    expect(transcript).toContain("[toolCall bash]");
    expect(transcript).toContain('"command": "npm install"');
    expect(transcript).toContain('"bypassSandbox": true');
    expect(transcript).toContain("[3] toolResult bash: npm ERR! 403 Forbidden");
  });

  it("truncates oversized entries without dropping the entry context", () => {
    const content = "prefix-" + "x".repeat(8_000) + "-hidden-tail";
    const transcript = collectTranscriptEvidence(
      contextWithEntries([{ type: "message", message: { role: "user", content } }]),
      3_000,
    );

    expect(transcript).toContain("[1] user: prefix-");
    expect(transcript).toContain("[...truncated]");
    expect(transcript).not.toContain("-hidden-tail");
  });

  it("keeps original entry numbers when entries are omitted", () => {
    const entries: unknown[] = [{ type: "message", message: { role: "user", content: "first request" } }];
    for (let i = 0; i < 45; i++) {
      entries.push({ type: "message", message: { role: "assistant", content: `assistant ${i}` } });
    }

    const transcript = collectTranscriptEvidence(contextWithEntries(entries), 2_000);

    expect(transcript).toContain("conversation entries omitted");
    expect(transcript).toContain("[1] user: first request");
    expect(transcript).not.toContain("[2] assistant: assistant 0");
    expect(transcript).toContain("[7] assistant: assistant 5");
    expect(transcript).toContain("[46] assistant: assistant 44");
  });
});

function contextWithEntries(entries: unknown[]): any {
  return {
    sessionManager: {
      getEntries: () => entries,
    },
  };
}
