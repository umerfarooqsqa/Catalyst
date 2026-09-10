import "server-only";

/**
 * Extract plain text from an uploaded requirements document.
 * Supported: PDF (pdf-parse v2 / pdf.js), DOCX (mammoth), and plain .txt/.md.
 * Node-only — call from a Route Handler, never the edge runtime.
 */
export async function extractDocumentText(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";

  if (ext === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  if (ext === "txt" || ext === "md") {
    return buffer.toString("utf8");
  }

  throw new Error(
    `Unsupported file type ".${ext}" — upload a PDF, DOCX, TXT or MD file`,
  );
}
