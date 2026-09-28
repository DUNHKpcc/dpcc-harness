/** Read the local-path suffix written by the composer without changing the prompt sent to the Agent. */
export function parseLocalFileReferences(text: string): { text: string; paths: string[] } {
  const withText = "\n\nAttached local file references:\n";
  const withoutText = "Please use these local file references as needed:\n";
  const markerIndex = text.lastIndexOf(withText);
  const promptIndex = markerIndex < 0 ? text.lastIndexOf(withoutText) : -1;
  const isOnlyReferences = promptIndex >= 0
    && (promptIndex === 0 || text.slice(promptIndex - 2, promptIndex) === "\n\n");
  if (markerIndex < 0 && !isOnlyReferences) return { text, paths: [] };

  const blockStart = isOnlyReferences ? promptIndex + withoutText.length : markerIndex + withText.length;
  const lines = text.slice(blockStart).split("\n");
  const paths: string[] = [];
  let lineCount = 0;
  for (const line of lines) {
    if (!line.startsWith("- ")) break;
    const path = line.slice(2);
    if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path)) break;
    paths.push(path);
    lineCount++;
  }
  if (paths.length === 0) return { text, paths: [] };

  const before = text.slice(0, isOnlyReferences ? promptIndex : markerIndex).trim();
  const after = lines.slice(lineCount).join("\n").trim();
  return { text: [before, after].filter(Boolean).join("\n\n"), paths };
}

export function localFileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}
