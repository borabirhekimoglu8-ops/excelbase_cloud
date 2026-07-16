use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use calamine::{Data, DataType, Reader, open_workbook_auto};
use encoding_rs::{UTF_8, WINDOWS_1252, WINDOWS_1254};

use crate::model::{
    CoreError, ImportSummary, InputFormat, PassengerRecord, file_sha256, normalize_header,
};

const OLE_MAGIC: [u8; 8] = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const SNIFF_LIMIT: u64 = 64 * 1024;

#[derive(Debug, Clone, Copy, Default)]
struct ColumnMap {
    no: Option<usize>,
    name: Option<usize>,
    surname: Option<usize>,
    full_name: Option<usize>,
    passport: Option<usize>,
    voucher: Option<usize>,
    departure: Option<usize>,
    arrival: Option<usize>,
    adult_fee: Option<usize>,
    child_fee: Option<usize>,
}

impl ColumnMap {
    fn has_identity(self) -> bool {
        self.name.is_some()
            || self.surname.is_some()
            || self.full_name.is_some()
            || self.passport.is_some()
    }
}

pub(crate) fn sniff_path(path: &Path) -> Result<InputFormat, CoreError> {
    let file = File::open(path).map_err(CoreError::io)?;
    let metadata = file.metadata().map_err(CoreError::io)?;
    if metadata.len() == 0 {
        return Err(CoreError::Unsupported {
            reason: "Dosya boş".to_owned(),
        });
    }

    let mut prefix = Vec::with_capacity(metadata.len().min(SNIFF_LIMIT) as usize);
    file.take(SNIFF_LIMIT)
        .read_to_end(&mut prefix)
        .map_err(CoreError::io)?;

    if prefix.starts_with(&OLE_MAGIC) {
        return Ok(InputFormat::Xls);
    }
    if prefix.starts_with(b"PK\x03\x04")
        || prefix.starts_with(b"PK\x05\x06")
        || prefix.starts_with(b"PK\x07\x08")
    {
        return sniff_zip_container(path);
    }

    if looks_like_text_table(&prefix) {
        return Ok(InputFormat::Csv);
    }

    Err(CoreError::Unsupported {
        reason: "XLSX, XLS, ODS, CSV veya ZIP imzası bulunamadı".to_owned(),
    })
}

fn sniff_zip_container(path: &Path) -> Result<InputFormat, CoreError> {
    let file = File::open(path).map_err(CoreError::io)?;
    let mut archive = zip::ZipArchive::new(file).map_err(CoreError::parse)?;
    let mut has_xlsx_content = false;
    let mut ods_mimetype = false;
    let mut mimetype_index = None;

    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(CoreError::parse)?;
        let name = entry.name().replace('\\', "/").to_ascii_lowercase();
        if name == "xl/workbook.xml" {
            has_xlsx_content = true;
        }
        if name == "mimetype" && entry.size() <= 256 {
            mimetype_index = Some(index);
        }
    }
    if let Some(index) = mimetype_index {
        let mut entry = archive.by_index(index).map_err(CoreError::parse)?;
        let mut mimetype = String::new();
        entry
            .read_to_string(&mut mimetype)
            .map_err(CoreError::parse)?;
        ods_mimetype = mimetype.trim() == "application/vnd.oasis.opendocument.spreadsheet";
    }

    if has_xlsx_content {
        Ok(InputFormat::Xlsx)
    } else if ods_mimetype {
        Ok(InputFormat::Ods)
    } else {
        Ok(InputFormat::Zip)
    }
}

fn looks_like_text_table(prefix: &[u8]) -> bool {
    if prefix.contains(&0) {
        return false;
    }
    let (decoded, _, had_errors) = UTF_8.decode(prefix);
    if had_errors && decoded.chars().filter(|ch| ch.is_control()).count() > 4 {
        return false;
    }
    decoded.lines().any(|line| {
        let trimmed = line.trim();
        !trimmed.is_empty()
            && [',', ';', '\t', '|']
                .iter()
                .any(|delimiter| trimmed.matches(*delimiter).count() >= 1)
    })
}

pub(crate) fn import_path_to_ndjson(
    input_path: &Path,
    output_path: &Path,
) -> Result<ImportSummary, CoreError> {
    ensure_distinct_paths(input_path, output_path)?;
    let temporary = temporary_path(output_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(CoreError::io)?;
    }

    let outcome = (|| {
        let file = File::create(&temporary).map_err(CoreError::io)?;
        let mut writer = BufWriter::new(file);
        let (format, sheets, rows) = import_path_to_writer(input_path, &mut writer)?;
        if rows == 0 {
            return Err(CoreError::ZeroRows);
        }
        writer.flush().map_err(CoreError::io)?;
        writer.get_ref().sync_all().map_err(CoreError::io)?;
        replace_file(&temporary, output_path)?;

        Ok(ImportSummary {
            input_path: input_path.to_string_lossy().into_owned(),
            output_path: output_path.to_string_lossy().into_owned(),
            format,
            sheets,
            rows,
            sha256: file_sha256(input_path)?,
        })
    })();

    if outcome.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    outcome
}

pub(crate) fn import_path_to_writer(
    input_path: &Path,
    writer: &mut impl Write,
) -> Result<(InputFormat, u32, u64), CoreError> {
    let format = sniff_path(input_path)?;
    match format {
        InputFormat::Csv => {
            let rows = import_csv(input_path, writer)?;
            Ok((format, 1, rows))
        }
        InputFormat::Xlsx | InputFormat::Xls | InputFormat::Ods => {
            let (sheets, rows) = import_workbook(input_path, writer)?;
            Ok((format, sheets, rows))
        }
        InputFormat::Zip => Err(CoreError::Unsupported {
            reason: "Arşiv için import_zip_to_ndjson kullanılmalı".to_owned(),
        }),
    }
}

fn import_csv(path: &Path, writer: &mut impl Write) -> Result<u64, CoreError> {
    let bytes = fs::read(path).map_err(CoreError::io)?;
    let text = decode_text(&bytes);
    let delimiter = detect_delimiter(&text);
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter)
        .from_reader(text.as_bytes());
    let mut rows = Vec::new();
    for record in reader.records() {
        rows.push(
            record
                .map_err(CoreError::parse)?
                .iter()
                .map(clean_cell)
                .collect::<Vec<_>>(),
        );
    }
    import_table(&rows, file_name(path), "CSV", writer)
}

fn import_workbook(path: &Path, writer: &mut impl Write) -> Result<(u32, u64), CoreError> {
    let mut workbook = open_workbook_auto(path).map_err(CoreError::parse)?;
    let sheet_names = workbook.sheet_names().to_vec();
    let mut imported_sheets = 0_u32;
    let mut total_rows = 0_u64;

    for sheet_name in sheet_names {
        let range = workbook
            .worksheet_range(&sheet_name)
            .map_err(CoreError::parse)?;
        let rows = range
            .rows()
            .map(|row| row.iter().map(cell_to_string).collect())
            .collect::<Vec<Vec<String>>>();
        let count = import_table(&rows, file_name(path), &sheet_name, writer)?;
        if count > 0 {
            imported_sheets += 1;
            total_rows += count;
        }
    }
    Ok((imported_sheets, total_rows))
}

fn import_table(
    rows: &[Vec<String>],
    source_file: String,
    sheet: &str,
    writer: &mut impl Write,
) -> Result<u64, CoreError> {
    let Some((header_index, subheader_index)) = detect_headers(rows) else {
        return Ok(0);
    };
    let headers = rows
        .get(header_index)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let subheaders = subheader_index
        .and_then(|index| rows.get(index))
        .map(Vec::as_slice);
    let columns = map_columns(headers, subheaders);
    if !columns.has_identity() {
        return Ok(0);
    }

    let data_start = subheader_index.unwrap_or(header_index) + 1;
    let mut count = 0_u64;
    for row in rows.iter().skip(data_start) {
        if row.iter().all(|cell| cell.trim().is_empty()) || looks_like_repeated_header(row) {
            continue;
        }
        let record = record_from_row(row, columns, &source_file, sheet).finish();
        if record.is_empty() || !has_passenger_data(&record) {
            continue;
        }
        serde_json::to_writer(&mut *writer, &record).map_err(CoreError::parse)?;
        writer.write_all(b"\n").map_err(CoreError::io)?;
        count += 1;
    }
    Ok(count)
}

fn detect_headers(rows: &[Vec<String>]) -> Option<(usize, Option<usize>)> {
    let limit = rows.len().min(30);
    for index in 0..limit {
        let normalized = rows[index]
            .iter()
            .map(|cell| normalize_header(cell))
            .collect::<Vec<_>>();
        let has_name = normalized.iter().any(|cell| cell == "name" || cell == "ad");
        let has_surname = normalized
            .iter()
            .any(|cell| cell == "surname" || cell == "soyad");
        if has_name && has_surname {
            let next = rows.get(index + 1).map(|row| {
                row.iter()
                    .map(|cell| normalize_header(cell))
                    .collect::<Vec<_>>()
            });
            let has_subheader = next.as_ref().is_some_and(|cells| {
                cells.iter().any(|cell| {
                    matches!(
                        cell.as_str(),
                        "departure" | "arrival" | "adult" | "child" | "gidis" | "varis"
                    )
                })
            });
            return Some((index, has_subheader.then_some(index + 1)));
        }
    }

    let mut best: Option<(usize, i32)> = None;
    for (index, row) in rows.iter().take(limit).enumerate() {
        let cells = row
            .iter()
            .filter(|cell| !cell.trim().is_empty())
            .collect::<Vec<_>>();
        if cells.len() < 2 {
            continue;
        }
        let recognized = cells
            .iter()
            .filter(|cell| classify_header(cell, "").is_some())
            .count() as i32;
        let non_numeric = cells
            .iter()
            .filter(|cell| cell.parse::<f64>().is_err())
            .count() as i32;
        let score = recognized * 20 + non_numeric + cells.len() as i32;
        if recognized >= 1 && best.is_none_or(|(_, old)| score > old) {
            best = Some((index, score));
        }
    }
    best.map(|(index, _)| (index, None))
}

fn map_columns(headers: &[String], subheaders: Option<&[String]>) -> ColumnMap {
    let mut map = ColumnMap::default();
    let width = headers
        .len()
        .max(subheaders.map(<[String]>::len).unwrap_or(0));
    for index in 0..width {
        let main = headers.get(index).map(String::as_str).unwrap_or("");
        let sub = subheaders
            .and_then(|values| values.get(index))
            .map(String::as_str)
            .unwrap_or("");
        match classify_header(main, sub) {
            Some("no") if map.no.is_none() => map.no = Some(index),
            Some("name") if map.name.is_none() => map.name = Some(index),
            Some("surname") if map.surname.is_none() => map.surname = Some(index),
            Some("full_name") if map.full_name.is_none() => map.full_name = Some(index),
            Some("passport") if map.passport.is_none() => map.passport = Some(index),
            Some("voucher") if map.voucher.is_none() => map.voucher = Some(index),
            Some("departure") if map.departure.is_none() => map.departure = Some(index),
            Some("arrival") if map.arrival.is_none() => map.arrival = Some(index),
            Some("adult_fee") if map.adult_fee.is_none() => map.adult_fee = Some(index),
            Some("child_fee") if map.child_fee.is_none() => map.child_fee = Some(index),
            _ => {}
        }
    }
    map
}

fn classify_header(main: &str, sub: &str) -> Option<&'static str> {
    let main = normalize_header(main);
    let sub = normalize_header(sub);
    let combined = format!("{main} {sub}").trim().to_owned();

    if matches!(main.as_str(), "no" | "sira" | "#") {
        Some("no")
    } else if matches!(
        main.as_str(),
        "name" | "ad" | "isim" | "first name" | "firstname"
    ) {
        Some("name")
    } else if matches!(
        main.as_str(),
        "surname" | "soyad" | "soyisim" | "last name" | "lastname"
    ) {
        Some("surname")
    } else if matches!(
        main.as_str(),
        "yolcu"
            | "yolcu adi soyadi"
            | "ad soyad"
            | "adi soyadi"
            | "passenger"
            | "passenger name"
            | "full name"
    ) {
        Some("full_name")
    } else if combined.contains("passport")
        || combined.contains("pasaport")
        || matches!(main.as_str(), "doc no" | "document no" | "kimlik")
    {
        Some("passport")
    } else if matches!(
        main.as_str(),
        "voucher" | "pnr" | "bilet" | "ticket" | "reservation" | "rezervasyon"
    ) {
        Some("voucher")
    } else if matches!(sub.as_str(), "departure" | "gidis" | "depart")
        || matches!(
            main.as_str(),
            "departure" | "departure date" | "gidis" | "gidis tarihi" | "sefer tarihi"
        )
    {
        Some("departure")
    } else if matches!(sub.as_str(), "arrival" | "varis" | "arrive")
        || matches!(
            main.as_str(),
            "arrival" | "arrival date" | "varis" | "varis tarihi" | "donus tarihi"
        )
    {
        Some("arrival")
    } else if matches!(sub.as_str(), "adult" | "yetiskin")
        || matches!(
            main.as_str(),
            "adult" | "adult fee" | "yetiskin" | "yetiskin ucreti"
        )
        || main.contains("ucreti yetiskin")
    {
        Some("adult_fee")
    } else if matches!(sub.as_str(), "child" | "cocuk")
        || matches!(
            main.as_str(),
            "child" | "child fee" | "cocuk" | "cocuk ucreti"
        )
        || main.contains("ucreti cocuk")
    {
        Some("child_fee")
    } else {
        None
    }
}

fn record_from_row(
    row: &[String],
    map: ColumnMap,
    source_file: &str,
    sheet: &str,
) -> PassengerRecord {
    let get = |index: Option<usize>| {
        index
            .and_then(|value| row.get(value))
            .map(|value| value.trim().to_owned())
            .unwrap_or_default()
    };
    PassengerRecord {
        no: get(map.no),
        name: get(map.name),
        surname: get(map.surname),
        full_name: get(map.full_name),
        passport: get(map.passport),
        voucher: get(map.voucher),
        departure: get(map.departure),
        arrival: get(map.arrival),
        adult_fee: get(map.adult_fee),
        child_fee: get(map.child_fee),
        source_file: source_file.to_owned(),
        sheet: sheet.to_owned(),
        photo: String::new(),
    }
}

fn has_passenger_data(record: &PassengerRecord) -> bool {
    [
        &record.name,
        &record.surname,
        &record.full_name,
        &record.passport,
        &record.voucher,
    ]
    .iter()
    .any(|value| !value.trim().is_empty())
}

fn looks_like_repeated_header(row: &[String]) -> bool {
    let normalized = row
        .iter()
        .map(|cell| normalize_header(cell))
        .collect::<Vec<_>>();
    normalized.iter().any(|cell| cell == "name" || cell == "ad")
        && normalized
            .iter()
            .any(|cell| cell == "surname" || cell == "soyad")
}

fn decode_text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_owned();
    }
    for encoding in [WINDOWS_1254, WINDOWS_1252] {
        let (text, _, had_errors) = encoding.decode(bytes);
        if !had_errors {
            return text.into_owned();
        }
    }
    WINDOWS_1254.decode(bytes).0.into_owned()
}

fn detect_delimiter(text: &str) -> u8 {
    let sample = text
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default();
    [b';', b',', b'\t', b'|']
        .into_iter()
        .max_by_key(|delimiter| {
            sample
                .as_bytes()
                .iter()
                .filter(|byte| **byte == *delimiter)
                .count()
        })
        .unwrap_or(b',')
}

fn clean_cell(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('\u{feff}')
        .trim_matches('\0')
        .trim()
        .to_owned()
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::DateTime(_) => cell
            .as_datetime()
            .map(|value| value.date().to_string())
            .unwrap_or_else(|| clean_cell(&cell.to_string())),
        Data::DateTimeIso(value) => iso_date_prefix(value).unwrap_or_else(|| clean_cell(value)),
        _ => clean_cell(&cell.to_string()),
    }
}

fn iso_date_prefix(value: &str) -> Option<String> {
    let prefix = value.get(..10)?;
    let bytes = prefix.as_bytes();
    (bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit()))
    .then(|| prefix.to_owned())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("import")
        .to_owned()
}

pub(crate) fn temporary_path(output: &Path) -> PathBuf {
    let mut name = output
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("output.ndjson")
        .to_owned();
    name.push_str(&format!(".partial-{}", std::process::id()));
    output.with_file_name(name)
}

pub(crate) fn replace_file(temporary: &Path, output: &Path) -> Result<(), CoreError> {
    if output.exists() {
        fs::remove_file(output).map_err(CoreError::io)?;
    }
    fs::rename(temporary, output).map_err(CoreError::io)
}

fn ensure_distinct_paths(input: &Path, output: &Path) -> Result<(), CoreError> {
    if input == output {
        return Err(CoreError::Io {
            reason: "Girdi ve çıktı yolu aynı olamaz".to_owned(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_turkish_headers() {
        assert_eq!(normalize_header(" GİDİŞ Tarihi "), "gidis tarihi");
        assert_eq!(classify_header("Pasaport Numarası", ""), Some("passport"));
    }

    #[test]
    fn detects_semicolon_csv() {
        assert_eq!(detect_delimiter("AD;SOYAD;PASAPORT\nA;B;C"), b';');
    }

    #[test]
    fn normalizes_iso_datetime_to_date() {
        assert_eq!(
            cell_to_string(&Data::DateTimeIso("2026-07-18T14:30:00".to_owned())),
            "2026-07-18"
        );
    }
}
