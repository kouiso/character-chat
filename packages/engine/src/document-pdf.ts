export type DocumentPdfErrorCode =
  | "invalid_pdf"
  | "encrypted_pdf"
  | "image_only_pdf"
  | "unsupported_pdf"
  | "pdf_too_large";

export class DocumentPdfError extends Error {
  readonly code: DocumentPdfErrorCode;
  constructor(code: DocumentPdfErrorCode) {
    super(code);
    this.name = "DocumentPdfError";
    this.code = code;
  }
}

export const MAX_DOCUMENT_PDF_BYTES = 2 * 1024 * 1024;

type Token = { kind: "string" | "word" | "number" | "bracket"; value: string };
type PdfObject = { id: string; body: string };

const fail = (code: DocumentPdfErrorCode): never => {
  throw new DocumentPdfError(code);
};
const WHITESPACE = new Set(["\0", "\t", "\n", "\f", "\r", " "]);
const isWhitespace = (value: string): boolean => WHITESPACE.has(value);
const isDelimiter = (value: string): boolean => isWhitespace(value) || /[%()/<>[\]]/.test(value);

const escapedLiteral = (source: string, start: number): { value: string; next: number } => {
  const escaped: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
  const value = source[start];
  if (/[0-7]/.test(value)) {
    const octal = source.slice(start, start + 3).match(/^[0-7]{1,3}/)?.[0] ?? "";
    return { value: String.fromCharCode(Number.parseInt(octal, 8)), next: start + octal.length };
  }
  if (value === "\r") return { value: "", next: start + (source[start + 1] === "\n" ? 2 : 1) };
  if (value === "\n") return { value: "", next: start + 1 };
  return { value: escaped[value] ?? value, next: start + 1 };
};

const readLiteral = (source: string, start: number): { token: Token; next: number } => {
  let value = "";
  let cursor = start + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === ")") return { token: { kind: "string", value }, next: cursor + 1 };
    if (char === "(") fail("unsupported_pdf");
    if (char === "\\") {
      const escaped = escapedLiteral(source, cursor + 1);
      value += escaped.value;
      cursor = escaped.next;
    } else {
      value += char;
      cursor += 1;
    }
  }
  return fail("invalid_pdf");
};

const readWord = (source: string, start: number): { token: Token; next: number } => {
  let cursor = start + 1;
  while (cursor < source.length && !isDelimiter(source[cursor])) cursor += 1;
  const value = source.slice(start, cursor);
  return {
    token: { kind: /^[+-]?(?:\d*\.\d+|\d+)$/.test(value) ? "number" : "word", value },
    next: cursor,
  };
};

const readToken = (source: string, cursor: number): { token: Token; next: number } => {
  const char = source[cursor];
  if (char === "[" || char === "]")
    return { token: { kind: "bracket", value: char }, next: cursor + 1 };
  if (char === "<" || char === ">" || char === ")") fail("unsupported_pdf");
  return char === "(" ? readLiteral(source, cursor) : readWord(source, cursor);
};

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (isWhitespace(char)) {
      cursor += 1;
      continue;
    }
    if (char === "%") {
      const end = source.indexOf("\n", cursor);
      cursor = end < 0 ? source.length : end + 1;
      continue;
    }
    const read = readToken(source, cursor);
    tokens.push(read.token);
    cursor = read.next;
  }
  return tokens;
};

const parseObjects = (source: string): PdfObject[] => {
  const objects: PdfObject[] = [];
  const ids = new Set<string>();
  let open: { id: string; start: number } | null = null;
  let cursor = 0;
  while (cursor < source.length) {
    const newline = source.indexOf("\n", cursor);
    const end = newline < 0 ? source.length : newline;
    const line = source.slice(cursor, end).replace(/\r$/, "");
    const header = line.match(/^(\d+) 0 obj$/);
    if (header) {
      if (open || ids.has(header[1])) fail("invalid_pdf");
      open = { id: header[1], start: end + 1 };
    } else if (line === "endobj") {
      const current = open ?? fail("invalid_pdf");
      objects.push({
        id: current.id,
        body: source.slice(current.start, cursor).replace(/\r?\n$/, ""),
      });
      ids.add(current.id);
      open = null;
    }
    cursor = end + 1;
  }
  if (open) fail("invalid_pdf");
  if (objects.length === 0) fail("unsupported_pdf");
  return objects;
};

const referencedObject = (objects: PdfObject[], body: string, reference: RegExp): PdfObject => {
  const id = body.match(reference)?.[1];
  const object = objects.find((candidate) => candidate.id === id);
  if (!object) return fail("invalid_pdf");
  return object;
};

const onlyPage = (objects: PdfObject[], source: string): PdfObject => {
  const trailerStart = source.lastIndexOf("\ntrailer\n");
  const trailerEnd = source.indexOf("\nstartxref\n", trailerStart);
  if (trailerStart < 0 || trailerEnd < trailerStart) fail("invalid_pdf");
  const catalog = referencedObject(
    objects,
    source.slice(trailerStart, trailerEnd),
    /\/Root\s+(\d+)\s+0\s+R/,
  );
  if (!/\/Type\s*\/Catalog\b/.test(catalog.body)) fail("invalid_pdf");
  const tree = referencedObject(objects, catalog.body, /\/Pages\s+(\d+)\s+0\s+R/);
  if (!/\/Type\s*\/Pages\b/.test(tree.body)) fail("invalid_pdf");
  const page = referencedObject(objects, tree.body, /\/Kids\s*\[\s*(\d+)\s+0\s+R\s*]/);
  const parent = referencedObject(objects, page.body, /\/Parent\s+(\d+)\s+0\s+R/);
  if (parent.id !== tree.id || !/\/Count\s+1(?:\s|\/|>|$)/.test(tree.body)) fail("unsupported_pdf");
  if (!/\/Type\s*\/Page\b/.test(page.body)) fail("invalid_pdf");
  if (objects.filter((object) => /\/Type\s*\/Page\b/.test(object.body)).length !== 1)
    fail("unsupported_pdf");
  return page;
};

const streamOf = (object: PdfObject): string => {
  if (/\/Filter\b/.test(object.body)) fail("unsupported_pdf");
  const start = object.body.indexOf("stream\n");
  if (start < 0) fail("unsupported_pdf");
  const length = object.body.match(/\/Length\s+(\d+)\s*(?:>>|\/)/)?.[1];
  if (length === undefined) fail("unsupported_pdf");
  const content = object.body.slice(start + 7, start + 7 + Number(length));
  if (!object.body.slice(start + 7 + Number(length)).match(/^\r?\nendstream$/)) fail("invalid_pdf");
  return content;
};

const isSupportedFont = (font: PdfObject): boolean => {
  const knownEncoding =
    !/\/Encoding\b/.test(font.body) ||
    /\/Encoding\s*\/(?:WinAnsiEncoding|StandardEncoding)\b/.test(font.body);
  return (
    /\/Subtype\s*\/Type1\b/.test(font.body) &&
    /\/BaseFont\s*\/(?:Helvetica|Courier|Times-Roman)(?:\s|\/|>|$)/.test(font.body) &&
    !/\/ToUnicode\b|\/Differences\b|\/FontDescriptor\b/.test(font.body) &&
    knownEncoding
  );
};

const fontNames = (objects: PdfObject[], source: string): Set<string> => {
  const fonts = objects.filter((object) => /\/Type\s*\/Font\b/.test(object.body));
  const supported = fonts.filter(isSupportedFont);
  if (fonts.length === 0 || supported.length !== fonts.length) fail("unsupported_pdf");
  const ids = new Set(supported.map((font) => font.id));
  return new Set(
    [...source.matchAll(/\/([\dA-Za-z]+)\s+(\d+)\s+0\s+R/g)]
      .filter((match) => ids.has(match[2]))
      .map((match) => `/${match[1]}`),
  );
};

const textOperand = (operator: string, operands: Token[]): string => {
  if (operator === "Tj") {
    if (operands.length !== 1 || operands[0].kind !== "string") fail("unsupported_pdf");
    return operands[0].value;
  }
  if (operands[0]?.value !== "[" || operands.at(-1)?.value !== "]") fail("unsupported_pdf");
  const content = operands.slice(1, -1);
  if (content.some((token) => token.kind !== "string" && token.kind !== "number"))
    fail("unsupported_pdf");
  if (content.some((token) => token.kind === "number" && Number(token.value) !== 0))
    fail("unsupported_pdf");
  return content
    .filter((token) => token.kind === "string")
    .map((token) => token.value)
    .join("");
};

const POSITION_OPERATORS = new Set(["Td", "TD", "Tm", "T*", "Tc", "Tw", "Tz", "TL", "Tr", "Ts"]);
type TextState = { inside: boolean; font: boolean; operands: Token[]; parts: string[] };

const isAsciiText = (text: string): boolean =>
  [...text].every((char) => {
    const code = char.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
  });

const appendText = (state: TextState, operator: string): void => {
  if (!state.font) fail("unsupported_pdf");
  const text = textOperand(operator, state.operands);
  if (!isAsciiText(text)) fail("unsupported_pdf");
  state.parts.push(text);
};

const setTextBlock = (state: TextState, inside: boolean): void => {
  if (state.inside === inside) fail("invalid_pdf");
  state.inside = inside;
  state.font = false;
};

const validFont = (operands: Token[], fonts: ReadonlySet<string>): boolean =>
  operands.length === 2 &&
  operands[0].kind === "word" &&
  fonts.has(operands[0].value) &&
  operands[1].kind === "number" &&
  Number.isFinite(Number(operands[1].value)) &&
  Number(operands[1].value) > 0;

const applyTextOperator = (state: TextState, token: Token, fonts: ReadonlySet<string>): void => {
  const operator = token.value;
  if (operator === "BT" || operator === "ET") {
    setTextBlock(state, operator === "BT");
    return;
  }
  if (!state.inside) return;
  if (operator === "Tf") {
    if (!validFont(state.operands, fonts)) fail("unsupported_pdf");
    state.font = true;
    return;
  }
  if (operator === "Tj" || operator === "TJ") {
    appendText(state, operator);
    return;
  }
  if (!POSITION_OPERATORS.has(operator)) fail("unsupported_pdf");
};

const textOf = (content: string, fonts: ReadonlySet<string>): string => {
  const state: TextState = { inside: false, font: false, operands: [], parts: [] };
  for (const token of tokenize(content)) {
    if (token.kind !== "word" || token.value.startsWith("/")) {
      state.operands.push(token);
      continue;
    }
    applyTextOperator(state, token, fonts);
    state.operands = [];
  }
  if (state.inside) fail("invalid_pdf");
  return state.parts.join("\n");
};

// 汎用 parser を依存追加できんため、対応範囲外を推測で本文にして保存せん。
export const extractDocumentPdf = async (bytes: Uint8Array): Promise<string> => {
  if (bytes.byteLength > MAX_DOCUMENT_PDF_BYTES) fail("pdf_too_large");
  const source = new TextDecoder("latin1").decode(bytes);
  if (!/^%PDF-1\.[0-7]\b/.test(source) || !source.trimEnd().endsWith("%%EOF")) fail("invalid_pdf");
  if (/\/Encrypt\b/.test(source)) fail("encrypted_pdf");
  if (/\/Subtype\s*\/Image\b/.test(source) && !/\bBT\b/.test(source)) fail("image_only_pdf");
  const objects = parseObjects(source);
  const fonts = fontNames(objects, source);
  const page = onlyPage(objects, source);
  const content = referencedObject(objects, page.body, /\/Contents\s+(\d+)\s+0\s+R/);
  const text = textOf(streamOf(content), fonts).trim();
  if (text.length === 0) fail("image_only_pdf");
  return text;
};
