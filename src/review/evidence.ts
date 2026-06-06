import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function collectTranscriptEvidence(ctx: ExtensionContext, maxChars: number): string {
  const entries = ctx.sessionManager.getEntries();
  const lines: string[] = [];
  for (const entry of entries.slice(-40) as unknown as Array<Record<string, unknown>>) {
    if (entry.type !== "message") {
      continue;
    }
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) {
      continue;
    }
    const role = String(message.role ?? "unknown");
    const content = summarizeContent(message.content);
    if (content) {
      lines.push(`${role}: ${content}`);
    }
  }
  const text = lines.join("\n");
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(text.length - maxChars);
}

function summarizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const record = item as Record<string, unknown>;
        if (record.type === "text" && typeof record.text === "string") {
          return record.text;
        }
        if (record.type === "toolCall") {
          return `[toolCall ${String(record.name ?? "")}]`;
        }
        if (record.type === "image") {
          return "[image]";
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}
