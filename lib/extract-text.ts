import "server-only";

/**
 * Extract plain text from an uploaded requirements document.
 * Supported: PDF (unpdf), DOCX (mammoth), and plain .txt/.md.
 * Call from a Route Handler.
 *
 * PDFs use `unpdf`, a serverless build of PDF.js, NOT `pdf-parse`: pdf-parse v2
 * needs a browser-style `DOMMatrix` (supplied in Node only by the native
 * `@napi-rs/canvas` add-on), so on Cloudflare Workers every PDF failed with
 * "DOMMatrix is not defined". unpdf needs neither.
 */
export async function extractDocumentText(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";

  if (ext === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
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
