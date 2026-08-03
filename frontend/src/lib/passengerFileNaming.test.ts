import { describe, expect, it } from "vitest";

import {
  autoNamedPassengerDocuments,
  passengerDocumentFilename,
  passengerFileBase,
  passengerPhotoFilename,
  photoExtension,
} from "./passengerFileNaming";

describe("passenger file naming", () => {
  const passenger = {
    id: 7,
    departure_date: "21.07.2026",
    first_name: "Ece",
    last_name: "Deniş / Öztürk",
    passport_no: "TR 7654321",
  };

  it("uses departure date, first name, surname and passport number in a portable stem", () => {
    expect(passengerFileBase(passenger)).toBe("2026-07-21_ECE_DENIS_OZTURK_TR7654321");
    expect(passengerPhotoFilename(passenger)).toBe("2026-07-21_ECE_DENIS_OZTURK_TR7654321.jpg");
    expect(passengerDocumentFilename(passenger, "complete_bundle"))
      .toBe("2026-07-21_ECE_DENIS_OZTURK_TR7654321.pdf");
  });

  it("adds stable English category and duplicate suffixes for separate PDFs", () => {
    expect(passengerDocumentFilename(passenger, "passport"))
      .toBe("2026-07-21_ECE_DENIS_OZTURK_TR7654321_PASSPORT.pdf");
    expect(passengerDocumentFilename(passenger, "passport", 2))
      .toBe("2026-07-21_ECE_DENIS_OZTURK_TR7654321_PASSPORT_02.pdf");
  });

  it("uses safe fallbacks and never carries a path from record fields", () => {
    expect(passengerFileBase({
      departure_date: "../../bad",
      full_name: "../",
      passport_no: "C:\\temp\\AUX",
    })).toBe("UNDATED_UNKNOWN_UNKNOWN_CTEMPAUX");
  });

  it("names an exported photo after the format it was actually stored in", () => {
    // Photos are no longer JPG-only; renaming a PNG's bytes to .jpg would hand
    // the operator a file their photo viewer refuses to open.
    expect(passengerPhotoFilename(passenger, "png")).toBe("2026-07-21_ECE_DENIS_OZTURK_TR7654321.png");
    expect(passengerPhotoFilename(passenger, "webp")).toBe("2026-07-21_ECE_DENIS_OZTURK_TR7654321.webp");
    // An unrecognised or missing extension falls back to jpg rather than
    // producing a file with no extension at all.
    expect(passengerPhotoFilename(passenger, "exe")).toBe("2026-07-21_ECE_DENIS_OZTURK_TR7654321.jpg");
  });

  it("reads the extension off a stored photo's own filename", () => {
    expect(photoExtension("BULK1234.PNG")).toBe("png");
    expect(photoExtension("BULK1234.jpeg")).toBe("jpg");
    expect(photoExtension("BULK1234.webp")).toBe("webp");
    expect(photoExtension("no-extension")).toBe("jpg");
  });

  it("keeps source names while regenerating visible names from edited passenger data", () => {
    const [document] = autoNamedPassengerDocuments(
      passenger,
      [{ filename: "../../original.pdf", category: "application_form" as const }],
    );
    expect(document).toMatchObject({
      filename: "2026-07-21_ECE_DENIS_OZTURK_TR7654321_APPLICATION_FORM.pdf",
      source_filename: "../../original.pdf",
      category: "application_form",
    });
  });
});
