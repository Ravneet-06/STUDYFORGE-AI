import { describe, expect, it } from "vitest";
import { documentSizeMetadata, formatFileSize } from "../apps/web/document-metadata.mjs";

describe("document metadata display", () => {
  it("displays an exact canonical character count", () => {
    expect(documentSizeMetadata({ characterCount: 36168, size: 2981571 })).toEqual({
      label: "Characters",
      value: "36168 characters",
    });
  });

  it("displays the file size for older documents without a canonical count", () => {
    expect(documentSizeMetadata({ size: 2981571 })).toEqual({
      label: "File size",
      value: "2.98 MB",
    });
  });

  it("never labels byte size as characters", () => {
    const metadata = documentSizeMetadata({ size: 2981571 });
    expect(metadata.value).not.toContain("characters");
    expect(formatFileSize(2981571)).toBe("2.98 MB");
  });
});
