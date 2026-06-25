import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkPromptTextFile,
  MAX_PROMPT_TEXT_FILE_BYTES,
  readPromptTextFile,
} from "../prompt-file-read";

describe("readPromptTextFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-file-read-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads ordinary UTF-8 text files", async () => {
    const filePath = path.join(tmpDir, "notes.txt");
    fs.writeFileSync(filePath, "hello\nworld", "utf-8");

    await expect(readPromptTextFile(filePath)).resolves.toEqual({
      content: "hello\nworld",
    });
  });

  it("preflights ordinary UTF-8 text files", async () => {
    const filePath = path.join(tmpDir, "notes.txt");
    fs.writeFileSync(filePath, "hello\nworld", "utf-8");

    await expect(checkPromptTextFile(filePath)).resolves.toEqual({
      ok: true,
      size: 11,
    });
  });

  it("preflights known binary extensions as unsupported", async () => {
    const filePath = path.join(tmpDir, "brief.docx");
    fs.writeFileSync(filePath, Buffer.from("PK\u0003\u0004[Content_Types].xml"));

    const result = await checkPromptTextFile(filePath);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("binary");
    expect(result.error).toContain("brief.docx");
  });

  it("preflights files over the prompt attachment size limit as unsupported", async () => {
    const filePath = path.join(tmpDir, "huge.txt");
    fs.writeFileSync(filePath, "x".repeat(MAX_PROMPT_TEXT_FILE_BYTES + 1), "utf-8");

    const result = await checkPromptTextFile(filePath);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("too large");
  });

  it("rejects Office documents instead of decoding zipped bytes as text", async () => {
    const filePath = path.join(tmpDir, "brief.docx");
    fs.writeFileSync(filePath, Buffer.from("PK\u0003\u0004[Content_Types].xml"));

    const result = await readPromptTextFile(filePath);

    expect(result.content).toBeUndefined();
    expect(result.error).toContain("binary");
    expect(result.error).toContain("brief.docx");
  });

  it("rejects files over the prompt attachment size limit", async () => {
    const filePath = path.join(tmpDir, "huge.txt");
    fs.writeFileSync(filePath, "x".repeat(MAX_PROMPT_TEXT_FILE_BYTES + 1), "utf-8");

    const result = await readPromptTextFile(filePath);

    expect(result.content).toBeUndefined();
    expect(result.error).toContain("too large");
  });

  it("rejects unknown binary files by content", async () => {
    const filePath = path.join(tmpDir, "payload.dat");
    fs.writeFileSync(filePath, Buffer.from([0x48, 0x00, 0x49]));

    const result = await readPromptTextFile(filePath);

    expect(result.content).toBeUndefined();
    expect(result.error).toContain("binary");
  });
});
