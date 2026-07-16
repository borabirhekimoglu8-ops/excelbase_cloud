use std::fs::{self, File};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::Path;

use rust_xlsxwriter::{Format, Workbook};

use crate::import::{replace_file, temporary_path};
use crate::model::{APP_HEADERS, CoreError, ExportSummary, PassengerRecord, file_sha256};

const XLSX_MAX_DATA_ROWS: u64 = 1_048_575;

pub(crate) fn ndjson_to_csv(
    input_path: &Path,
    output_path: &Path,
) -> Result<ExportSummary, CoreError> {
    ensure_export_paths(input_path, output_path)?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(CoreError::io)?;
    }
    let temporary = temporary_path(output_path);

    let outcome = (|| {
        let file = File::create(&temporary).map_err(CoreError::io)?;
        let mut output = BufWriter::new(file);
        output
            .write_all(&[0xef, 0xbb, 0xbf])
            .map_err(CoreError::io)?;
        let mut csv = csv::WriterBuilder::new()
            .has_headers(false)
            .delimiter(b';')
            .from_writer(output);
        csv.write_record(APP_HEADERS).map_err(CoreError::export)?;
        let rows = for_each_record(input_path, |record, _| {
            csv.write_record(record.values()).map_err(CoreError::export)
        })?;
        if rows == 0 {
            return Err(CoreError::ZeroRows);
        }
        csv.flush().map_err(CoreError::export)?;
        drop(csv);
        File::open(&temporary)
            .and_then(|file| file.sync_all())
            .map_err(CoreError::io)?;
        replace_file(&temporary, output_path)?;
        Ok(ExportSummary {
            input_path: input_path.to_string_lossy().into_owned(),
            output_path: output_path.to_string_lossy().into_owned(),
            rows,
            sha256: file_sha256(output_path)?,
        })
    })();

    if outcome.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    outcome
}

pub(crate) fn ndjson_to_xlsx(
    input_path: &Path,
    output_path: &Path,
) -> Result<ExportSummary, CoreError> {
    ensure_export_paths(input_path, output_path)?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(CoreError::io)?;
    }
    let temporary = temporary_path(output_path);

    let outcome = (|| {
        let mut workbook = Workbook::new();
        let worksheet = workbook.add_worksheet_with_constant_memory();
        worksheet.set_name("Yolcular").map_err(CoreError::export)?;
        for column in 0..APP_HEADERS.len() {
            worksheet
                .set_column_width(column as u16, 18)
                .map_err(CoreError::export)?;
        }
        let header_format = Format::new().set_bold();
        for (column, header) in APP_HEADERS.iter().enumerate() {
            worksheet
                .write_string_with_format(0, column as u16, *header, &header_format)
                .map_err(CoreError::export)?;
        }

        let rows = for_each_record(input_path, |record, index| {
            if index >= XLSX_MAX_DATA_ROWS {
                return Err(CoreError::Export {
                    reason: format!(
                        "XLSX satır sınırı aşıldı; en fazla {XLSX_MAX_DATA_ROWS} yolcu aktarılabilir"
                    ),
                });
            }
            for (column, value) in record.values().iter().enumerate() {
                worksheet
                    .write_string((index + 1) as u32, column as u16, *value)
                    .map_err(CoreError::export)?;
            }
            Ok(())
        })?;
        if rows == 0 {
            return Err(CoreError::ZeroRows);
        }
        workbook.save(&temporary).map_err(CoreError::export)?;
        File::open(&temporary)
            .and_then(|file| file.sync_all())
            .map_err(CoreError::io)?;
        replace_file(&temporary, output_path)?;
        Ok(ExportSummary {
            input_path: input_path.to_string_lossy().into_owned(),
            output_path: output_path.to_string_lossy().into_owned(),
            rows,
            sha256: file_sha256(output_path)?,
        })
    })();

    if outcome.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    outcome
}

fn for_each_record(
    input_path: &Path,
    mut callback: impl FnMut(&PassengerRecord, u64) -> Result<(), CoreError>,
) -> Result<u64, CoreError> {
    let input = File::open(input_path).map_err(CoreError::io)?;
    let reader = BufReader::new(input);
    let mut rows = 0_u64;
    for (line_number, line) in reader.lines().enumerate() {
        let line = line.map_err(CoreError::io)?;
        if line.trim().is_empty() {
            continue;
        }
        let record: PassengerRecord =
            serde_json::from_str(&line).map_err(|error| CoreError::Parse {
                reason: format!("NDJSON satırı {}: {error}", line_number + 1),
            })?;
        callback(&record.finish(), rows)?;
        rows += 1;
    }
    Ok(rows)
}

fn ensure_export_paths(input: &Path, output: &Path) -> Result<(), CoreError> {
    if input == output {
        return Err(CoreError::Export {
            reason: "NDJSON girdi ve dışa aktarma yolu aynı olamaz".to_owned(),
        });
    }
    Ok(())
}
