export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown file size";
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = "B";
  for (const nextUnit of units) {
    value /= 1000;
    unit = nextUnit;
    if (value < 1000 || nextUnit === units.at(-1)) break;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

export function documentSizeMetadata(document) {
  if (Number.isFinite(document?.characterCount)) {
    return { label: "Characters", value: `${document.characterCount} characters` };
  }
  return { label: "File size", value: formatFileSize(document?.size) };
}
