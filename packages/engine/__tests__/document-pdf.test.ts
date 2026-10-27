import { DocumentPdfError, extractDocumentPdf, MAX_DOCUMENT_PDF_BYTES } from "../src/document-pdf";

// byte offset も生成するので、成功 fixture は正しい xref を持つ PDF になる。
const pdf = (
  content: string,
  options: { font?: string; filter?: string; encrypted?: boolean } = {},
): Uint8Array => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} ${options.filter ?? ""} >>\nstream\n${content}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /${options.font ?? "Helvetica"} /Encoding /WinAnsiEncoding >>`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${offsets.length} /Root 1 0 R ${options.encrypted ? "/Encrypt 6 0 R" : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
};

const expectCode = async (bytes: Uint8Array, code: DocumentPdfError["code"]): Promise<void> => {
  await expect(extractDocumentPdf(bytes)).rejects.toBeInstanceOf(DocumentPdfError);
  await expect(extractDocumentPdf(bytes)).rejects.toMatchObject({ code });
};

describe("limited Worker-compatible document PDF probe", () => {
  test("標準 ASCII フォントの無圧縮 PDF から合成設定を抽出する", async () => {
    expect(
      await extractDocumentPdf(pdf("BT /F1 12 Tf 40 720 Td (The synthetic clock is blue.) Tj ET")),
    ).toBe("The synthetic clock is blue.");
  });

  test("TJ 配列・ゼロ調整・literal escape を扱う", async () => {
    expect(
      await extractDocumentPdf(
        pdf("BT /F1 12 Tf [(Synthetic) 0 ( \\(clock\\) is \\142lue.)] TJ ET"),
      ),
    ).toBe("Synthetic (clock) is blue.");
  });

  test("PDF の行継続を文字として保存せん", async () => {
    expect(await extractDocumentPdf(pdf("BT /F1 12 Tf (syn\\\nthetic) Tj ET"))).toBe("synthetic");
  });

  test("鍵付き PDF は本文を返さず明示エラーになる", async () => {
    await expectCode(
      pdf("BT /F1 12 Tf (SECRET_SENTINEL) Tj ET", { encrypted: true }),
      "encrypted_pdf",
    );
  });

  test("画像のみの PDF は OCR や外部処理へ送らず明示エラーになる", async () => {
    const image = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 >>\nendobj\n%%EOF",
    );
    await expectCode(image, "image_only_pdf");
    await expectCode(pdf("q 1 0 0 1 0 0 cm Q"), "image_only_pdf");
  });

  test.each([
    ["compressed", "BT /F1 12 Tf (blue) Tj ET", { filter: "/Filter /FlateDecode" }],
    ["nonstandard font", "BT /F1 12 Tf (blue) Tj ET", { font: "Symbol" }],
    ["unicode hex string", "BT /F1 12 Tf <FEFF9752> Tj ET", {}],
    ["unmapped font", "BT /F2 12 Tf (blue) Tj ET", {}],
    ["unselected font", "BT (blue) Tj ET", {}],
    ["unhandled operator", "BT /F1 12 Tf (blue) ' ET", {}],
    ["nested literal", "BT /F1 12 Tf (synthetic (blue)) Tj ET", {}],
    ["missing font size", "BT /F1 Tf (ACCEPTED_WITHOUT_SIZE) Tj ET", {}],
    ["zero font size", "BT /F1 0 Tf (blue) Tj ET", {}],
    ["nonzero TJ spacing", "BT /F1 12 Tf [(The) -500 (clock) -500 (is) -500 (blue)] TJ ET", {}],
  ])("%s を推測変換せず不支持にする", async (_label, content, options) => {
    await expectCode(
      pdf(String(content), typeof options === "object" ? options : {}),
      "unsupported_pdf",
    );
  });

  test("壊れた header・EOF・長さを拒否する", async () => {
    await expectCode(new TextEncoder().encode("not a PDF"), "invalid_pdf");
    await expectCode(new TextEncoder().encode("%PDF-1.4\n"), "invalid_pdf");
    const malformed = new TextDecoder()
      .decode(pdf("BT /F1 12 Tf (blue) Tj ET"))
      .replace(/\/Length \d+/, "/Length 2");
    await expectCode(new TextEncoder().encode(malformed), "invalid_pdf");
    await expectCode(pdf("BT /F1 12 Tf BT (blue) Tj ET"), "invalid_pdf");
    await expectCode(pdf("ET BT /F1 12 Tf (blue) Tj ET"), "invalid_pdf");
    await expectCode(pdf("BT /F1 12 Tf (blue) Tj"), "invalid_pdf");
  });

  test("入力上限より大きな PDF を走査する前に拒否する", async () => {
    await expectCode(new Uint8Array(MAX_DOCUMENT_PDF_BYTES + 1), "pdf_too_large");
  });

  test("存在しない Root・Catalog・page tree へ差し替えた PDF を拒否する", async () => {
    const source = new TextDecoder().decode(pdf("BT /F1 12 Tf (blue) Tj ET"));
    for (const [before, after] of [
      ["/Root 1 0 R", "/Root 999 0 R"],
      ["/Pages 2 0 R", "/Pages 999 0 R"],
      ["/Parent 2 0 R", "/Parent 999 0 R"],
    ]) {
      await expectCode(new TextEncoder().encode(source.replace(before, after)), "invalid_pdf");
    }
  });

  test("未閉鎖 object header の大量反復でも線形走査で拒否する", async () => {
    const source = "%PDF-1.4\n" + "1 0 obj\n".repeat(128_000) + "%%EOF";
    await expectCode(new TextEncoder().encode(source), "invalid_pdf");
  });
});
