import type {
  ExtensionContext,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

const MAX_ENTRY_CHARS = 8_000;
const MAX_NON_USER_ENTRIES = 40;

type EvidenceEntry = {
  role: string;
  rendered: string;
  tokenCost: number;
  isUser: boolean;
};

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
  return entry.type === "message";
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
          return renderToolCall(record);
        }
        if (record.type === "image") {
          return "[image]";
        }
        if (record.type === "thinking") {
          return "[thinking]";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function renderToolCall(record: Record<string, unknown>): string {
  const name = typeof record.name === "string" && record.name.length > 0 ? record.name : "unknown";
  const args = record.arguments;
  if (args === undefined) {
    return `[toolCall ${name}]`;
  }
  return `[toolCall ${name}]\n${stringifyEvidence(args)}`;
}

function stringifyEvidence(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateEntry(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + "\n[...truncated]";
}

function collectAllEntries(ctx: ExtensionContext): EvidenceEntry[] {
  const entries = ctx.sessionManager.getEntries();
  const result: EvidenceEntry[] = [];

  for (const entry of entries) {
    if (!isMessageEntry(entry)) continue;
    const message = entry.message;
    const msg = message as unknown as Record<string, unknown>;
    const role = String(msg.role ?? "unknown");
    const toolName = typeof msg.toolName === "string" ? msg.toolName : undefined;
    const content = summarizeContent(msg.content);
    if (!content) continue;

    const truncated = truncateEntry(content, MAX_ENTRY_CHARS);
    const renderedRole = role === "toolResult" && toolName ? `${role} ${toolName}` : role;
    const rendered = `${renderedRole}: ${truncated}`;
    const tokenCost = approxTokens(rendered) + 1;

    result.push({
      role,
      rendered,
      tokenCost,
      isUser: role === "user",
    });
  }

  return result;
}

function selectAndRender(entries: EvidenceEntry[], maxTokens: number): string {
  if (entries.length === 0) return "(empty)";

  const included = new Set<number>();
  let usedTokens = 0;

  const userIndices: number[] = [];
  entries.forEach((e, i) => {
    if (e.isUser) userIndices.push(i);
  });

  if (userIndices.length > 0) {
    included.add(userIndices[0]);
    usedTokens += entries[userIndices[0]].tokenCost;
  }

  const lastUserIdx = userIndices[userIndices.length - 1];
  if (lastUserIdx !== undefined && lastUserIdx !== userIndices[0]) {
    const cost = entries[lastUserIdx].tokenCost;
    if (usedTokens + cost <= maxTokens) {
      included.add(lastUserIdx);
      usedTokens += cost;
    }
  }

  for (let i = userIndices.length - 1; i >= 0; i--) {
    const idx = userIndices[i];
    if (included.has(idx)) continue;
    const cost = entries[idx].tokenCost;
    if (usedTokens + cost > maxTokens) continue;
    included.add(idx);
    usedTokens += cost;
  }

  let nonUserCount = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (included.has(i)) continue;
    if (entries[i].isUser) continue;
    if (nonUserCount >= MAX_NON_USER_ENTRIES) break;
    const cost = entries[i].tokenCost;
    if (usedTokens + cost > maxTokens) break;
    included.add(i);
    usedTokens += cost;
    nonUserCount++;
  }

  const omitted = included.size < entries.length;
  const lines: string[] = [];

  if (omitted) {
    const omittedCount = entries.length - included.size;
    lines.push(
      `[${omittedCount} conversation entries omitted. ` +
        `Showing first and last user turns plus up to ${MAX_NON_USER_ENTRIES} recent non-user entries.]\n`,
    );
  }

  for (let i = 0; i < entries.length; i++) {
    if (included.has(i)) {
      lines.push(`[${i + 1}] ${entries[i].rendered}`);
    }
  }

  return lines.join("\n");
}

export function collectTranscriptEvidence(ctx: ExtensionContext, maxTokens: number): string {
  const entries = collectAllEntries(ctx);
  if (entries.length === 0) return "(empty)";
  return selectAndRender(entries, maxTokens);
}
