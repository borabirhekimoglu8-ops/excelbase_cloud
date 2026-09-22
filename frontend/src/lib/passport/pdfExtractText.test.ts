import { describe, expect, it } from "vitest";

import { extractTextFromPdf, rowsFromPdfText } from "./pdfExtractText";

const LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
const LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

function minimalTextPdf(lines: string[]): Blob {
  const stream = [
    "BT",
    "/F1 10 Tf",
    "50 150 Td",
    ...lines.flatMap((line, index) => [
      ...(index ? ["0 -14 Td"] : []),
      `(${line}) Tj`,
    ]),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n`;
  source += "0000000000 65535 f \n";
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([source], { type: "application/pdf" });
}

describe("PDF text-layer extraction", () => {
  it("reads MRZ text operators and creates a verified row without rasterizing", async () => {
    const pdf = minimalTextPdf([LINE1, LINE2]);
    const text = await extractTextFromPdf(pdf);
    expect(text).toContain(LINE1);
    expect(text).toContain(LINE2);

    const rows = await rowsFromPdfText(pdf, "sentetik.pdf");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      filename: "sentetik.pdf",
      lastName: "ERIKSSON",
      passportNo: "L898902C3",
      status: "ok",
    });
  });
});
