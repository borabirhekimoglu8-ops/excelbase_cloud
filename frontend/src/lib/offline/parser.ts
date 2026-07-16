import * as XLSX from "@e965/xlsx";
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  type Entry,
} from "@zip.js/zip.js";

export type ParsedPassengerRow = {
  no: string;
  first_name: string;
  last_name: string;
  full_name: string;
  passport_no: string;
  voucher: string;
  departure_date: string;
  arrival_date: string;
  adult_fee: string;
  child_fee: string;
  source_file: string;
  sheet: string;
};

export type ParsedFile = {
  filename: string;
  rows: ParsedPassengerRow[];
  warnings: string[];
  error?: string;
};

export type ParseSelectedFileResult = {
  files: ParsedFile[];
  rows: ParsedPassengerRow[];
  warnings: string[];
  errors: string[];
};

export type ParserLimits = {
  /** A single user-selected file. This is a byte limit, never a file-count limit. */
  maxInputBytes: number;
  /** One member after decompression. */
  maxEntryBytes: number;
  /** All members after decompression. */
  maxArchiveUncompressedBytes: number;
  /** Uncompressed workbook package parts before handing the file to SheetJS. */
  maxWorkbookUncompressedBytes: number;
  /** Checked for entries larger than minRatioCheckBytes. */
  maxCompressionRatio: number;
  minRatioCheckBytes: number;
};

export const DEFAULT_PARSER_LIMITS: ParserLimits = {
  maxInputBytes: 100 * 1024 * 1024,
  maxEntryBytes: 100 * 1024 * 1024,
  maxArchiveUncompressedBytes: 300 * 1024 * 1024,
  maxWorkbookUncompressedBytes: 150 * 1024 * 1024,
  maxCompressionRatio: 200,
  minRatioCheckBytes: 1024 * 1024,
};

type CellValue = string | number | boolean | Date | null | undefined;
type Matrix = CellValue[][];
type CanonicalField =
  | "NO"
  | "NAME"
  | "SURNAME"
  | "FULL_NAME"
  | "PASSPORT"
  | "VOUCHER"
  | "DEPARTURE"
  | "ARRIVAL"
  | "ADULT"
  | "CHILD";

type ContentKind = "workbook" | "text" | "archive" | "unsupported";

class ParserError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ParserError";
    this.code = code;
  }
}

const CANDIDATE_EXTENSIONS = new Set(["csv", "xlsx", "xls", "xlsm", "ods"]);
const NESTED_ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz"]);

const ALIASES: Record<CanonicalField, Set<string>> = {
  NO: new Set(["no", "#", "sira", "sira no", "sira numarasi", "number"]),
  NAME: new Set(["name", "ad", "adi", "isim", "first name", "firstname", "given name"]),
  SURNAME: new Set(["surname", "soyad", "soyadi", "soyisim", "last name", "lastname", "family name"]),
  FULL_NAME: new Set([
    "full name",
    "name surname",
    "ad soyad",
    "adi soyadi",
    "yolcu adi soyadi",
    "yolcu ad soyad",
    "passenger name",
  ]),
  PASSPORT: new Set([
    "passport",
    "passport no",
    "passport number",
    "passport numarasi",
    "pasaport",
    "pasaport no",
    "pasaport numarasi",
    "document no",
    "document number",
    "doc no",
  ]),
  VOUCHER: new Set(["voucher", "voucher no", "pnr", "bilet", "ticket", "reservation", "rezervasyon"]),
  DEPARTURE: new Set([
    "departure",
    "departure date",
    "depart",
    "gidis",
    "gidis tarihi",
    "cikis",
    "cikis tarihi",
  ]),
  ARRIVAL: new Set([
    "arrival",
    "arrival date",
    "arrive",
    "varis",
    "varis tarihi",
    "donus",
    "donus tarihi",
  ]),
  ADULT: new Set([
    "adult",
    "adult fee",
    "adult visa fee",
    "yetiskin",
    "yetiskin ucreti",
    "vize ucreti yetiskin",
  ]),
  CHILD: new Set([
    "child",
    "child fee",
    "child visa fee",
    "cocuk",
    "cocuk ucreti",
    "vize ucreti cocuk",
  ]),
};

function mergeLimits(limits?: Partial<ParserLimits>): ParserLimits {
  return { ...DEFAULT_PARSER_LIMITS, ...(limits ?? {}) };
}

function extension(filename: string): string {
  const leaf = filename.replaceAll("\\", "/").split("/").pop() ?? filename;
  const dot = leaf.lastIndexOf(".");
  return dot >= 0 ? leaf.slice(dot + 1).toLocaleLowerCase("en-US") : "";
}

function asBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function isZip(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  );
}

function isOleWorkbook(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

function normalizedCell(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalField(value: unknown): CanonicalField | null {
  const normalized = normalizedCell(value);
  if (!normalized) return null;
  for (const field of Object.keys(ALIASES) as CanonicalField[]) {
    if (ALIASES[field].has(normalized)) return field;
  }

  // Real exports often add punctuation or a harmless suffix such as "(USD)".
  if (/passport|pasaport/.test(normalized) && /no|number|numarasi/.test(normalized)) return "PASSPORT";
  if (/voucher/.test(normalized)) return "VOUCHER";
  if (/departure|gidis/.test(normalized)) return "DEPARTURE";
  if (/arrival|varis/.test(normalized)) return "ARRIVAL";
  if (/adult|yetiskin/.test(normalized)) return "ADULT";
  if (/child|cocuk/.test(normalized)) return "CHILD";
  return null;
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return !text || text.toLocaleLowerCase("en-US") === "nan";
}

function textValue(value: unknown): string {
  if (isBlank(value)) return "";
  if (value instanceof Date) return dateToIso(value) ?? "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function validDateParts(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function datePartsToIso(year: number, month: number, day: number): string | null {
  if (!validDateParts(year, month, day)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateToIso(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  // SheetJS creates workbook dates using local components in some browsers and
  // UTC components in others. Local components preserve the date printed in the cell.
  return datePartsToIso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function normalizeDate(value: unknown): string {
  if (isBlank(value)) return "";
  if (value instanceof Date) return dateToIso(value) ?? textValue(value);

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value) as { y?: number; m?: number; d?: number } | null;
    const iso = parsed?.y && parsed?.m && parsed?.d ? datePartsToIso(parsed.y, parsed.m, parsed.d) : null;
    return iso ?? textValue(value);
  }

  const text = textValue(value);
  const isoMatch = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D.*)?$/);
  if (isoMatch) {
    return datePartsToIso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])) ?? text;
  }

  // As in the Python application, non-ISO numeric dates are interpreted day-first.
  const dayFirst = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\D.*)?$/);
  if (dayFirst) {
    let year = Number(dayFirst[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return datePartsToIso(year, Number(dayFirst[2]), Number(dayFirst[1])) ?? text;
  }

  // Numeric strings appear in some CSV exports as Excel date serials.
  if (/^\d{5}(?:\.\d+)?$/.test(text)) {
    const parsed = XLSX.SSF.parse_date_code(Number(text)) as { y?: number; m?: number; d?: number } | null;
    const iso = parsed?.y && parsed?.m && parsed?.d ? datePartsToIso(parsed.y, parsed.m, parsed.d) : null;
    if (iso) return iso;
  }

  return text;
}

function trimMatrix(matrix: Matrix): Matrix {
  const rows = matrix.filter((row) => Array.isArray(row) && row.some((cell) => !isBlank(cell)));
  if (!rows.length) return [];
  let lastColumn = 0;
  for (const row of rows) {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      if (!isBlank(row[index])) {
        lastColumn = Math.max(lastColumn, index + 1);
        break;
      }
    }
  }
  return rows.map((row) => row.slice(0, lastColumn));
}

function fieldMapForRows(mainRow: CellValue[], subRow?: CellValue[]): Map<CanonicalField, number> {
  const mapping = new Map<CanonicalField, number>();
  const width = Math.max(mainRow.length, subRow?.length ?? 0);
  for (let column = 0; column < width; column += 1) {
    const sub = canonicalField(subRow?.[column]);
    const main = canonicalField(mainRow[column]);
    // The Gate Visa template uses DATE/VISA FEE in row 3 and the actual field
    // names (DEPARTURE/ARRIVAL/ADULT/CHILD) in row 4.
    const field = sub ?? main;
    if (field && !mapping.has(field)) mapping.set(field, column);
  }
  return mapping;
}

function headerStrength(mapping: Map<CanonicalField, number>): number {
  const hasName = mapping.has("NAME") && mapping.has("SURNAME");
  const hasFullName = mapping.has("FULL_NAME");
  if (!hasName && !hasFullName) return -1;
  let score = hasName ? 8 : 5;
  for (const field of ["PASSPORT", "VOUCHER", "DEPARTURE", "ARRIVAL", "ADULT", "CHILD", "NO"] as const) {
    if (mapping.has(field)) score += 1;
  }
  return score;
}

function findHeader(matrix: Matrix): { index: number; subIndex: number | null; mapping: Map<CanonicalField, number> } {
  let best: { index: number; subIndex: number | null; mapping: Map<CanonicalField, number>; score: number } | null = null;
  const limit = Math.min(matrix.length, 30);
  for (let index = 0; index < limit; index += 1) {
    const single = fieldMapForRows(matrix[index]);
    const singleScore = headerStrength(single);
    if (singleScore >= 0 && (!best || singleScore > best.score)) {
      best = { index, subIndex: null, mapping: single, score: singleScore };
    }

    if (index + 1 < matrix.length) {
      const double = fieldMapForRows(matrix[index], matrix[index + 1]);
      const doubleScore = headerStrength(double);
      const hasUsefulSubheader = matrix[index + 1].some((value) => {
        const field = canonicalField(value);
        return field === "DEPARTURE" || field === "ARRIVAL" || field === "ADULT" || field === "CHILD";
      });
      if (hasUsefulSubheader && doubleScore >= 0 && (!best || doubleScore > best.score)) {
        best = { index, subIndex: index + 1, mapping: double, score: doubleScore };
      }
    }
  }

  if (!best) {
    throw new ParserError(
      "header_not_found",
      "Yolcu başlıkları bulunamadı. NAME / SURNAME veya yolcu adı-soyadı başlığı gerekli.",
    );
  }
  return best;
}

function getCell(row: CellValue[], mapping: Map<CanonicalField, number>, field: CanonicalField): CellValue {
  const index = mapping.get(field);
  return index === undefined ? "" : row[index];
}

function matrixToPassengers(matrixInput: Matrix, sourceFile: string, sheet: string): ParsedPassengerRow[] {
  const matrix = trimMatrix(matrixInput);
  if (!matrix.length) return [];
  const header = findHeader(matrix);
  const start = (header.subIndex ?? header.index) + 1;
  const rows: ParsedPassengerRow[] = [];

  for (const row of matrix.slice(start)) {
    if (!row.some((cell) => !isBlank(cell))) continue;
    const firstName = textValue(getCell(row, header.mapping, "NAME"));
    const lastName = textValue(getCell(row, header.mapping, "SURNAME"));
    const explicitFullName = textValue(getCell(row, header.mapping, "FULL_NAME"));
    const fullName = explicitFullName || [firstName, lastName].filter(Boolean).join(" ").trim();

    const parsed: ParsedPassengerRow = {
      no: textValue(getCell(row, header.mapping, "NO")),
      first_name: firstName || explicitFullName,
      last_name: lastName,
      full_name: fullName,
      passport_no: textValue(getCell(row, header.mapping, "PASSPORT")),
      voucher: textValue(getCell(row, header.mapping, "VOUCHER")),
      departure_date: normalizeDate(getCell(row, header.mapping, "DEPARTURE")),
      arrival_date: normalizeDate(getCell(row, header.mapping, "ARRIVAL")),
      adult_fee: textValue(getCell(row, header.mapping, "ADULT")),
      child_fee: textValue(getCell(row, header.mapping, "CHILD")),
      source_file: sourceFile,
      sheet,
    };

    const hasData = Object.entries(parsed).some(
      ([key, value]) => key !== "source_file" && key !== "sheet" && value !== "",
    );
    if (!hasData) continue;

    // A repeated header midway through a sheet is not a passenger.
    if (canonicalField(parsed.first_name) === "NAME" && canonicalField(parsed.last_name) === "SURNAME") continue;
    rows.push(parsed);
  }
  return rows;
}

function rowWarnings(rows: ParsedPassengerRow[]): string[] {
  const warnings: string[] = [];
  const missingNames = rows.filter((row) => !row.full_name).length;
  const missingPassports = rows.filter((row) => !row.passport_no).length;
  if (missingNames) warnings.push(`${missingNames} satırda yolcu adı/soyadı boş.`);
  if (missingPassports) warnings.push(`${missingPassports} satırda pasaport no boş.`);

  const invalidDateOrder = rows.filter(
    (row) => /^\d{4}-\d{2}-\d{2}$/.test(row.departure_date) &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.arrival_date) &&
      row.arrival_date < row.departure_date,
  ).length;
  if (invalidDateOrder) warnings.push(`${invalidDateOrder} satırda varış tarihi gidiş tarihinden önce.`);

  const seen = new Map<string, number>();
  for (const row of rows) {
    const passport = row.passport_no.replace(/[^A-Za-z0-9]/g, "").toLocaleUpperCase("en-US");
    if (!passport) continue;
    const key = `${passport}|${row.departure_date}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicateCount = [...seen.values()].filter((count) => count > 1).length;
  if (duplicateCount) warnings.push(`${duplicateCount} pasaport/tarih anahtarı dosya içinde tekrarlanıyor.`);
  return warnings;
}

function parseWorkbook(filename: string, bytes: Uint8Array): ParsedFile {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      dense: true,
      WTF: false,
    });
  } catch (error) {
    throw new ParserError(
      "invalid_workbook",
      `Tablo dosyası açılamadı: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const rows: ParsedPassengerRow[] = [];
  const warnings: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    try {
      const matrix = XLSX.utils.sheet_to_json<CellValue[]>(worksheet, {
        header: 1,
        defval: "",
        raw: true,
        blankrows: false,
      }) as Matrix;
      const sheetRows = matrixToPassengers(matrix, filename, sheetName);
      rows.push(...sheetRows);
    } catch (error) {
      warnings.push(`${sheetName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!rows.length) {
    throw new ParserError(
      "no_passenger_rows",
      "Dosyada okunabilir yolcu verisi bulunamadı.",
    );
  }
  warnings.push(...rowWarnings(rows));
  return { filename, rows, warnings };
}

function decodeText(bytes: Uint8Array): string | null {
  if (!bytes.length || bytes.includes(0)) return null;
  const encodings = ["utf-8", "windows-1254", "iso-8859-9"];
  for (const encoding of encodings) {
    try {
      const decoded = new TextDecoder(encoding, { fatal: encoding === "utf-8" }).decode(bytes).replace(/^\uFEFF/, "");
      const controlCharacters = [...decoded].filter((character) => {
        const code = character.charCodeAt(0);
        return code < 32 && character !== "\n" && character !== "\r" && character !== "\t";
      }).length;
      if (decoded.trim() && controlCharacters / Math.max(decoded.length, 1) < 0.01) return decoded;
    } catch {
      // Try the next browser-supported encoding.
    }
  }
  return null;
}

function parseTextTable(filename: string, text: string): ParsedFile {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(text, {
      type: "string",
      raw: true,
      cellDates: true,
      cellFormula: false,
      WTF: false,
    });
  } catch (error) {
    throw new ParserError(
      "invalid_text_table",
      `Metin tablosu açılamadı: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const rows: ParsedPassengerRow[] = [];
  const warnings: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    try {
      const matrix = XLSX.utils.sheet_to_json<CellValue[]>(worksheet, {
        header: 1,
        defval: "",
        raw: true,
        blankrows: false,
      }) as Matrix;
      rows.push(...matrixToPassengers(matrix, filename, "CSV"));
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!rows.length) {
    throw new ParserError("no_passenger_rows", "Metin dosyasında okunabilir yolcu verisi bulunamadı.");
  }
  warnings.push(...rowWarnings(rows));
  return { filename, rows, warnings };
}

function pathProblem(filename: string): string | null {
  if (!filename || filename.includes("\0")) return "ZIP üyesinin adı geçersiz.";
  const normalized = filename.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.startsWith("//") || /^[A-Za-z]:\//.test(normalized)) {
    return "Mutlak ZIP yolu güvenlik nedeniyle reddedildi.";
  }
  if (normalized.split("/").some((part) => part === "..")) {
    return "Üst dizine çıkan ZIP yolu güvenlik nedeniyle reddedildi.";
  }
  return null;
}

function isSymlink(entry: Entry): boolean {
  return entry.unixMode !== undefined && (entry.unixMode & 0o170000) === 0o120000;
}

function sizeProblem(entry: Entry, limits: ParserLimits): string | null {
  if (entry.uncompressedSize > limits.maxEntryBytes) {
    return `ZIP üyesi açıldığında izin verilen ${limits.maxEntryBytes} baytı aşıyor.`;
  }
  const denominator = Math.max(entry.compressedSize, 1);
  const ratio = entry.uncompressedSize / denominator;
  if (entry.uncompressedSize >= limits.minRatioCheckBytes && ratio > limits.maxCompressionRatio) {
    return `ZIP sıkıştırma oranı güvenlik sınırını aşıyor (${ratio.toFixed(1)}x).`;
  }
  return null;
}

async function zipEntryNames(
  bytes: Uint8Array,
  limits: ParserLimits,
  enforceWorkbookSafety: boolean,
): Promise<string[]> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
  const names: string[] = [];
  let totalSize = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (enforceWorkbookSafety) {
        const unsafe = pathProblem(entry.filename);
        if (unsafe) throw new ParserError("unsafe_zip_path", `${entry.filename}: ${unsafe}`);
        if (isSymlink(entry)) throw new ParserError("unsafe_zip_link", `${entry.filename}: Sembolik bağlantı reddedildi.`);
        totalSize += entry.uncompressedSize;
        if (totalSize > limits.maxWorkbookUncompressedBytes) {
          throw new ParserError("workbook_too_large", "Tablo paketinin açılmış boyutu güvenlik sınırını aşıyor.");
        }
        const entrySizeProblem = sizeProblem(entry, limits);
        if (entrySizeProblem) throw new ParserError("unsafe_compression", `${entry.filename}: ${entrySizeProblem}`);
      }
      names.push(entry.filename.replaceAll("\\", "/").toLocaleLowerCase("en-US"));
    }
  } finally {
    await reader.close();
  }
  return names;
}

async function classifyContent(bytes: Uint8Array, limits: ParserLimits): Promise<ContentKind> {
  if (isOleWorkbook(bytes)) return "workbook";
  if (isZip(bytes)) {
    // First inspect names without applying workbook-wide checks. A normal import
    // archive may contain one unsafe member; parseArchive must report that member
    // and continue with the valid ones.
    const names = await zipEntryNames(bytes, limits, false);
    const nameSet = new Set(names);
    const isOpenXml = nameSet.has("[content_types].xml") && names.some((name) => name.startsWith("xl/"));
    const isOds = nameSet.has("content.xml") && nameSet.has("mimetype") && names.some((name) => name.startsWith("meta"));
    if (isOpenXml || isOds) {
      await zipEntryNames(bytes, limits, true);
      return "workbook";
    }
    return "archive";
  }
  return decodeText(bytes) ? "text" : "unsupported";
}

async function parseOneTable(filename: string, bytes: Uint8Array, limits: ParserLimits): Promise<ParsedFile> {
  const kind = await classifyContent(bytes, limits);
  if (kind === "workbook") return parseWorkbook(filename, bytes);
  if (kind === "text") {
    const text = decodeText(bytes);
    if (text === null) throw new ParserError("invalid_text", "Metin dosyası çözümlenemedi.");
    return parseTextTable(filename, text);
  }
  if (kind === "archive") {
    throw new ParserError("nested_archive", "İç içe ZIP/arşiv dosyaları güvenlik nedeniyle işlenmez.");
  }
  throw new ParserError("unsupported_content", "Dosya içeriği desteklenen bir tablo biçimi değil.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExpectedTableName(filename: string): boolean {
  return CANDIDATE_EXTENSIONS.has(extension(filename));
}

function isExpectedNestedArchiveName(filename: string): boolean {
  return NESTED_ARCHIVE_EXTENSIONS.has(extension(filename));
}

async function parseArchive(
  archiveName: string,
  bytes: Uint8Array,
  limits: ParserLimits,
): Promise<ParsedFile[]> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { useWebWorkers: false });
  const files: ParsedFile[] = [];
  let declaredTotal = 0;
  try {
    // Intentionally sequential: at most one decompressed workbook exists in memory.
    for await (const entry of reader.getEntriesGenerator()) {
      if (entry.directory) continue;
      const displayedName = `${archiveName} / ${entry.filename}`;
      const unsafe = pathProblem(entry.filename);
      if (unsafe) {
        files.push({ filename: displayedName, rows: [], warnings: [], error: unsafe });
        continue;
      }
      if (isSymlink(entry)) {
        files.push({ filename: displayedName, rows: [], warnings: [], error: "Sembolik ZIP bağlantısı reddedildi." });
        continue;
      }
      if (entry.encrypted) {
        files.push({ filename: displayedName, rows: [], warnings: [], error: "Şifreli ZIP üyesi desteklenmiyor." });
        continue;
      }

      declaredTotal += entry.uncompressedSize;
      if (declaredTotal > limits.maxArchiveUncompressedBytes) {
        files.push({
          filename: displayedName,
          rows: [],
          warnings: [],
          error: "ZIP içeriğinin toplam açılmış boyutu güvenlik sınırını aşıyor.",
        });
        break;
      }
      const entrySizeProblem = sizeProblem(entry, limits);
      if (entrySizeProblem) {
        files.push({ filename: displayedName, rows: [], warnings: [], error: entrySizeProblem });
        continue;
      }

      let memberBytes: Uint8Array;
      try {
        memberBytes = await entry.getData(new Uint8ArrayWriter(), {
          checkSignature: true,
          useWebWorkers: false,
        });
      } catch (error) {
        files.push({
          filename: displayedName,
          rows: [],
          warnings: [],
          error: `ZIP üyesi açılamadı: ${errorMessage(error)}`,
        });
        continue;
      }

      if (memberBytes.byteLength > limits.maxEntryBytes) {
        files.push({ filename: displayedName, rows: [], warnings: [], error: "ZIP üyesi boyut sınırını aşıyor." });
        continue;
      }

      try {
        const kind = await classifyContent(memberBytes, limits);
        if (kind === "archive" || isExpectedNestedArchiveName(entry.filename)) {
          files.push({
            filename: displayedName,
            rows: [],
            warnings: [],
            error: "İç içe ZIP/arşiv dosyaları güvenlik nedeniyle işlenmez.",
          });
          continue;
        }
        if (kind === "unsupported" && !isExpectedTableName(entry.filename)) {
          // Non-table attachments (for example photos) are not list-import failures.
          continue;
        }
        const parsed = await parseOneTable(entry.filename, memberBytes, limits);
        files.push(parsed);
      } catch (error) {
        files.push({ filename: displayedName, rows: [], warnings: [], error: errorMessage(error) });
      }
    }
  } catch (error) {
    files.push({
      filename: archiveName,
      rows: [],
      warnings: [],
      error: `ZIP dizini okunamadı: ${errorMessage(error)}`,
    });
  } finally {
    await reader.close();
  }
  if (!files.length) {
    files.push({
      filename: archiveName,
      rows: [],
      warnings: [],
      error: "ZIP içinde desteklenen yolcu tablosu bulunamadı.",
    });
  }
  return files;
}

function aggregate(files: ParsedFile[]): ParseSelectedFileResult {
  const rows = files.flatMap((file) => file.rows);
  const warnings = files.flatMap((file) =>
    file.warnings.map((warning) => `${file.filename}: ${warning}`),
  );
  const errors = files.flatMap((file) => (file.error ? [`${file.filename}: ${file.error}`] : []));
  return { files, rows, warnings, errors };
}

export async function parsePassengerBytes(
  filename: string,
  input: ArrayBuffer | Uint8Array,
  limitOverrides?: Partial<ParserLimits>,
): Promise<ParseSelectedFileResult> {
  const limits = mergeLimits(limitOverrides);
  const bytes = asBytes(input);
  if (!bytes.length) {
    return aggregate([{ filename, rows: [], warnings: [], error: "Dosya boş." }]);
  }
  if (bytes.byteLength > limits.maxInputBytes) {
    return aggregate([{
      filename,
      rows: [],
      warnings: [],
      error: `Dosya ${limits.maxInputBytes} baytlık güvenlik sınırını aşıyor.`,
    }]);
  }

  try {
    const kind = await classifyContent(bytes, limits);
    if (kind === "archive") return aggregate(await parseArchive(filename, bytes, limits));
    const parsed = await parseOneTable(filename, bytes, limits);
    return aggregate([parsed]);
  } catch (error) {
    return aggregate([{ filename, rows: [], warnings: [], error: errorMessage(error) }]);
  }
}

export async function parseSelectedFile(
  file: Pick<File, "name" | "arrayBuffer">,
  limitOverrides?: Partial<ParserLimits>,
): Promise<ParseSelectedFileResult> {
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (error) {
    return aggregate([{
      filename: file.name,
      rows: [],
      warnings: [],
      error: `Dosya okunamadı: ${errorMessage(error)}`,
    }]);
  }
  return parsePassengerBytes(file.name, bytes, limitOverrides);
}
