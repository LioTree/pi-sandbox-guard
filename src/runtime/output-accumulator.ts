import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import path from "node:path";
import { truncateTail, type TruncationResult } from "@earendil-works/pi-coding-agent";

export type OutputAccumulatorOptions = {
  maxLines: number;
  maxBytes: number;
  fullOutputDir: string;
  tempFilePrefix?: string;
};

export type OutputSnapshot = {
  content: string;
  truncation: TruncationResult;
  fullOutputPath?: string;
};

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

function tempFilePath(dir: string, prefix: string): string {
  return path.join(dir, `${prefix}-${randomBytes(8).toString("hex")}.log`);
}

export class OutputAccumulator {
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly maxRollingBytes: number;
  private readonly fullOutputDir: string;
  private readonly tempFilePrefix: string;
  private readonly decoder = new TextDecoder();

  private rawChunks: Buffer[] = [];
  private tailText = "";
  private tailBytes = 0;
  private tailStartsAtLineBoundary = true;
  private totalRawBytes = 0;
  private totalDecodedBytes = 0;
  private completedLines = 0;
  private totalLines = 0;
  private currentLineBytes = 0;
  private hasOpenLine = false;
  private finished = false;

  private tempFileStream?: WriteStream;
  private tempFilePath?: string;

  constructor(options: OutputAccumulatorOptions) {
    this.maxLines = options.maxLines;
    this.maxBytes = options.maxBytes;
    this.maxRollingBytes = Math.max(options.maxBytes * 2, 1);
    this.fullOutputDir = options.fullOutputDir;
    this.tempFilePrefix = options.tempFilePrefix ?? "pi-sandbox-guard-output";
  }

  append(data: Buffer): void {
    if (this.finished) {
      throw new Error("cannot append to a finished output accumulator");
    }
    this.totalRawBytes += data.length;
    this.appendDecodedText(this.decoder.decode(data, { stream: true }));

    if (this.tempFileStream || this.shouldUseTempFile()) {
      this.ensureTempFile();
      this.tempFileStream?.write(data);
    } else if (data.length > 0) {
      this.rawChunks.push(data);
    }
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.appendDecodedText(this.decoder.decode());
    if (this.shouldUseTempFile()) {
      this.ensureTempFile();
    }
  }

  snapshot(options: { persistIfTruncated?: boolean } = {}): OutputSnapshot {
    const tail = truncateTail(this.snapshotText(), {
      maxLines: this.maxLines,
      maxBytes: this.maxBytes,
    });
    const truncated = this.totalLines > this.maxLines || this.totalDecodedBytes > this.maxBytes;
    const truncation: TruncationResult = {
      ...tail,
      truncated,
      truncatedBy: truncated ? (tail.truncatedBy ?? (this.totalDecodedBytes > this.maxBytes ? "bytes" : "lines")) : null,
      totalLines: this.totalLines,
      totalBytes: this.totalDecodedBytes,
      maxLines: this.maxLines,
      maxBytes: this.maxBytes,
    };

    if (options.persistIfTruncated && truncation.truncated) {
      this.ensureTempFile();
    }

    return {
      content: truncation.content,
      truncation,
      fullOutputPath: this.tempFilePath,
    };
  }

  async closeTempFile(): Promise<void> {
    if (!this.tempFileStream) return;
    const stream = this.tempFileStream;
    this.tempFileStream = undefined;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        stream.off("finish", onFinish);
        reject(error);
      };
      const onFinish = () => {
        stream.off("error", onError);
        resolve();
      };
      stream.once("error", onError);
      stream.once("finish", onFinish);
      stream.end();
    });
  }

  getLastLineBytes(): number {
    return this.currentLineBytes;
  }

  private appendDecodedText(text: string): void {
    if (text.length === 0) return;

    const bytes = byteLength(text);
    this.totalDecodedBytes += bytes;
    this.tailText += text;
    this.tailBytes += bytes;
    if (this.tailBytes > this.maxRollingBytes * 2) {
      this.trimTail();
    }

    let newlines = 0;
    let lastNewline = -1;
    for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
      newlines++;
      lastNewline = index;
    }
    if (newlines === 0) {
      this.currentLineBytes += bytes;
      this.hasOpenLine = true;
    } else {
      this.completedLines += newlines;
      const tail = text.slice(lastNewline + 1);
      this.currentLineBytes = byteLength(tail);
      this.hasOpenLine = tail.length > 0;
    }
    this.totalLines = this.completedLines + (this.hasOpenLine ? 1 : 0);
  }

  private trimTail(): void {
    const buffer = Buffer.from(this.tailText, "utf-8");
    if (buffer.length <= this.maxRollingBytes) {
      this.tailBytes = buffer.length;
      return;
    }

    let start = buffer.length - this.maxRollingBytes;
    while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) {
      start++;
    }

    this.tailStartsAtLineBoundary = start === 0 ? this.tailStartsAtLineBoundary : buffer[start - 1] === 0x0a;
    this.tailText = buffer.subarray(start).toString("utf-8");
    this.tailBytes = byteLength(this.tailText);
  }

  private snapshotText(): string {
    if (this.tailStartsAtLineBoundary) return this.tailText;
    const firstNewline = this.tailText.indexOf("\n");
    return firstNewline === -1 ? this.tailText : this.tailText.slice(firstNewline + 1);
  }

  private shouldUseTempFile(): boolean {
    return this.totalRawBytes > this.maxBytes || this.totalDecodedBytes > this.maxBytes || this.totalLines > this.maxLines;
  }

  private ensureTempFile(): void {
    if (this.tempFilePath) return;
    mkdirSync(this.fullOutputDir, { recursive: true, mode: 0o700 });
    this.tempFilePath = tempFilePath(this.fullOutputDir, this.tempFilePrefix);
    this.tempFileStream = createWriteStream(this.tempFilePath, { flags: "wx", mode: 0o600 });
    for (const chunk of this.rawChunks) {
      this.tempFileStream.write(chunk);
    }
    this.rawChunks = [];
  }
}
