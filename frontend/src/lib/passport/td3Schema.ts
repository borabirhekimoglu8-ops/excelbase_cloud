import type { Cell } from "./mrzGrid";

const WEIGHTS = [7, 3, 1] as const;
const MAX_FIELD_SOLUTIONS = 50_000;
const MAX_LINE_SOLUTIONS = 100_000;

export const TD3_LOOKALIKES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "0": ["O"],
  O: ["0"],
  "1": ["I"],
  I: ["1"],
  "2": ["Z"],
  Z: ["2"],
  "5": ["S"],
  S: ["5"],
  "6": ["G"],
  G: ["6"],
  "8": ["B"],
  B: ["8"],
});

export const LOOKALIKES = TD3_LOOKALIKES;

export type Td3Line1Decode = {
  line: string;
  documentCode: string;
  issuingState: string;
  surname: string;
  givenNames: string;
  verified: boolean;
  verifiedFields: {
    documentCode: boolean;
    issuingState: boolean;
    names: boolean;
  };
  disputedCells: number[];
};

export type Td3Line2Decode = {
  line: string;
  passportNumber: string;
  nationality: string;
  birthDate: string;
  sex: "M" | "F" | "X" | "";
  expiryDate: string;
  personalNumber: string;
  verified: boolean;
  verifiedFields: {
    passportNumber: boolean;
    nationality: boolean;
    birthDate: boolean;
    sex: boolean;
    expiryDate: boolean;
    personalNumber: boolean;
    composite: boolean;
  };
  disputedCells: number[];
};

function charValue(character: string): number {
  if (character >= "0" && character <= "9") return Number(character);
  if (character >= "A" && character <= "Z") return character.charCodeAt(0) - 55;
  if (character === "<") return 0;
  return -1;
}

export function icaoCheckDigit(value: string): string {
  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    const numeric = charValue(value[index] ?? "");
    if (numeric < 0) return "";
    sum += numeric * WEIGHTS[index % WEIGHTS.length];
  }
  return String(sum % 10);
}

function displayLine(cells: readonly Cell[]): string {
  return Array.from({ length: 44 }, (_, index) => cells[index]?.candidates[0]?.value ?? "?").join("");
}

function disputed(cells: readonly Cell[]): number[] {
  return cells.filter((cell) => cell.disputed || cell.candidates.length > 1).map((cell) => cell.index);
}

function valuesForCell(cell: Cell | undefined, alphabet: string): string[] {
  if (!cell) return [];
  const allowed = new Set(alphabet);
  const values = new Set<string>();
  for (const candidate of cell.candidates) {
    const value = candidate.value.toUpperCase();
    if (allowed.has(value)) values.add(value);
    for (const replacement of TD3_LOOKALIKES[value] ?? []) {
      if (allowed.has(replacement)) values.add(replacement);
    }
  }
  return [...values];
}

type Enumeration = {
  values: string[];
  truncated: boolean;
};

function enumerateField(
  cells: readonly Cell[],
  start: number,
  end: number,
  alphabet: string,
): Enumeration {
  let values = [""];
  for (let index = start; index < end; index += 1) {
    const choices = valuesForCell(cells[index], alphabet);
    if (!choices.length) return { values: [], truncated: false };
    if (values.length * choices.length > MAX_FIELD_SOLUTIONS) {
      return { values: [], truncated: true };
    }
    values = values.flatMap((prefix) => choices.map((choice) => `${prefix}${choice}`));
  }
  return { values: [...new Set(values)], truncated: false };
}

function unique(values: readonly string[]): string {
  const distinct = [...new Set(values)];
  return distinct.length === 1 ? distinct[0] : "";
}

function validUtcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date;
}

function iso(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function todayUtc(today: Date): Date {
  return new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
}

export function birthDateOracle(raw: string, today = new Date()): string {
  if (!/^\d{6}$/.test(raw)) return "";
  const current = todayUtc(today);
  const yy = Number(raw.slice(0, 2));
  const month = Number(raw.slice(2, 4));
  const day = Number(raw.slice(4, 6));
  const currentCentury = Math.floor(current.getUTCFullYear() / 100) * 100;
  const minimum = new Date(current);
  minimum.setUTCFullYear(minimum.getUTCFullYear() - 120);
  const candidates = [currentCentury + yy, currentCentury - 100 + yy]
    .map((year) => validUtcDate(year, month, day))
    .filter((date): date is Date => Boolean(date && date <= current && date >= minimum));
  return unique(candidates.map(iso));
}

export function expiryDateOracle(raw: string, today = new Date()): string {
  if (!/^\d{6}$/.test(raw)) return "";
  const current = todayUtc(today);
  const yy = Number(raw.slice(0, 2));
  const month = Number(raw.slice(2, 4));
  const day = Number(raw.slice(4, 6));
  const currentCentury = Math.floor(current.getUTCFullYear() / 100) * 100;
  const minimum = new Date(current);
  const maximum = new Date(current);
  minimum.setUTCFullYear(minimum.getUTCFullYear() - 25);
  maximum.setUTCFullYear(maximum.getUTCFullYear() + 25);
  const candidates = [currentCentury - 100 + yy, currentCentury + yy, currentCentury + 100 + yy]
    .map((year) => validUtcDate(year, month, day))
    .filter((date): date is Date => Boolean(date && date >= minimum && date <= maximum));
  return unique(candidates.map(iso));
}

export const isValidBirthDate = birthDateOracle;
export const isValidExpiryDate = expiryDateOracle;

/** Validate all arithmetic rules of an 11-digit Turkish identity number. */
export function tcChecksum(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const odd = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const even = digits[1] + digits[3] + digits[5] + digits[7];
  const tenth = ((odd * 7 - even) % 10 + 10) % 10;
  const eleventh = digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10;
  return digits[9] === tenth && digits[10] === eleventh;
}

function decodedNames(body: string): { surname: string; givenNames: string } | null {
  const separator = body.indexOf("<<");
  if (separator < 1) return null;
  const surnameRaw = body.slice(0, separator);
  const givenRaw = body.slice(separator + 2);
  if (!/^[A-Z]+(?:<[A-Z]+)*$/.test(surnameRaw)) return null;
  if (!/^[A-Z]+(?:<[A-Z]+)*(?:<*)$/.test(givenRaw)) return null;
  const clean = (value: string) => value.replace(/</g, " ").replace(/\s+/g, " ").trim();
  const surname = clean(surnameRaw);
  const givenNames = clean(givenRaw);
  return surname && givenNames ? { surname, givenNames } : null;
}

export function decodeLine1(cells: readonly Cell[]): Td3Line1Decode {
  const line = displayLine(cells);
  const documentCodes = enumerateField(cells, 0, 2, "ABCDEFGHIJKLMNOPQRSTUVWXYZ<");
  const issuingStates = enumerateField(cells, 2, 5, "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  const nameBodies = enumerateField(cells, 5, 44, "ABCDEFGHIJKLMNOPQRSTUVWXYZ<");

  const documentCode = unique(documentCodes.values.filter((value) => /^P[A-Z<]$/.test(value)));
  const issuingState = unique(issuingStates.values);
  const names = nameBodies.truncated
    ? []
    : nameBodies.values.map(decodedNames).filter((value): value is NonNullable<typeof value> => Boolean(value));
  const surname = unique(names.map((value) => value.surname));
  const givenNames = unique(names.map((value) => value.givenNames));
  const namesVerified = Boolean(surname && givenNames);

  return {
    line,
    documentCode,
    issuingState,
    surname: namesVerified ? surname : "",
    givenNames: namesVerified ? givenNames : "",
    verified: Boolean(documentCode && issuingState && namesVerified),
    verifiedFields: {
      documentCode: Boolean(documentCode),
      issuingState: Boolean(issuingState),
      names: namesVerified,
    },
    disputedCells: disputed(cells),
  };
}

type CheckedSolution = {
  raw: string;
  check: string;
  value: string;
};

function solveCheckedField(
  cells: readonly Cell[],
  start: number,
  end: number,
  alphabet: string,
  checkIndex: number,
  oracle: (raw: string) => string,
  optionalEmpty = false,
): { solutions: CheckedSolution[]; truncated: boolean } {
  const fields = enumerateField(cells, start, end, alphabet);
  const checks = valuesForCell(cells[checkIndex], optionalEmpty ? "0123456789<" : "0123456789");
  if (fields.truncated) return { solutions: [], truncated: true };
  const solutions: CheckedSolution[] = [];
  for (const raw of fields.values) {
    const empty = optionalEmpty && /^<+$/.test(raw);
    for (const check of checks) {
      if (empty && check === "<") {
        solutions.push({ raw, check, value: "" });
        continue;
      }
      if (check !== icaoCheckDigit(raw)) continue;
      const value = oracle(raw);
      if (value || empty) solutions.push({ raw, check, value });
    }
  }
  const deduplicated = new Map<string, CheckedSolution>();
  for (const solution of solutions) {
    deduplicated.set(`${solution.raw}|${solution.check}|${solution.value}`, solution);
  }
  return { solutions: [...deduplicated.values()], truncated: false };
}

function project(
  independent: readonly CheckedSolution[],
  global: readonly CheckedSolution[],
): { value: string; verified: boolean } {
  const source = global.length ? global : independent;
  const value = unique(source.map((solution) => solution.value));
  return { value, verified: source.length > 0 && Boolean(value || source.every((item) => !item.value)) };
}

export function decodeLine2(cells: readonly Cell[], today = new Date()): Td3Line2Decode {
  const line = displayLine(cells);
  const passport = solveCheckedField(
    cells,
    0,
    9,
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
    9,
    (raw) => raw.replace(/</g, ""),
  );
  const birth = solveCheckedField(
    cells,
    13,
    19,
    "0123456789",
    19,
    (raw) => birthDateOracle(raw, today),
  );
  const expiry = solveCheckedField(
    cells,
    21,
    27,
    "0123456789",
    27,
    (raw) => expiryDateOracle(raw, today),
  );
  const personal = solveCheckedField(
    cells,
    28,
    42,
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
    42,
    (raw) => raw.replace(/</g, ""),
    true,
  );
  const compositeChecks = valuesForCell(cells[43], "0123456789");

  type CompleteSolution = {
    passport: CheckedSolution;
    birth: CheckedSolution;
    expiry: CheckedSolution;
    personal: CheckedSolution;
  };
  const complete: CompleteSolution[] = [];
  let lineTruncated = passport.truncated || birth.truncated || expiry.truncated || personal.truncated;
  outer:
  for (const passportSolution of passport.solutions) {
    for (const birthSolution of birth.solutions) {
      for (const expirySolution of expiry.solutions) {
        for (const personalSolution of personal.solutions) {
          if (complete.length >= MAX_LINE_SOLUTIONS) {
            lineTruncated = true;
            break outer;
          }
          const composite = `${passportSolution.raw}${passportSolution.check}`
            + `${birthSolution.raw}${birthSolution.check}`
            + `${expirySolution.raw}${expirySolution.check}`
            + `${personalSolution.raw}${personalSolution.check}`;
          if (!compositeChecks.includes(icaoCheckDigit(composite))) continue;
          complete.push({
            passport: passportSolution,
            birth: birthSolution,
            expiry: expirySolution,
            personal: personalSolution,
          });
        }
      }
    }
  }

  const passportField = project(passport.solutions, complete.map((item) => item.passport));
  const birthField = project(birth.solutions, complete.map((item) => item.birth));
  const expiryField = project(expiry.solutions, complete.map((item) => item.expiry));
  const personalField = project(personal.solutions, complete.map((item) => item.personal));

  const nationalities = enumerateField(cells, 10, 13, "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  const nationality = nationalities.truncated ? "" : unique(nationalities.values);
  const sexes = enumerateField(cells, 20, 21, "MF<");
  const rawSex = sexes.truncated ? "" : unique(sexes.values);
  const sex = rawSex === "<" ? "X" : rawSex === "M" || rawSex === "F" ? rawSex : "";
  const compositeVerified = !lineTruncated && complete.length === 1;
  const verifiedFields = {
    passportNumber: passportField.verified,
    nationality: Boolean(nationality),
    birthDate: birthField.verified,
    sex: Boolean(sex),
    expiryDate: expiryField.verified,
    personalNumber: personalField.verified,
    composite: compositeVerified,
  };

  return {
    line,
    passportNumber: passportField.verified ? passportField.value : "",
    nationality,
    birthDate: birthField.verified ? birthField.value : "",
    sex,
    expiryDate: expiryField.verified ? expiryField.value : "",
    personalNumber: personalField.verified ? personalField.value : "",
    verified: Object.values(verifiedFields).every(Boolean),
    verifiedFields,
    disputedCells: disputed(cells),
  };
}
