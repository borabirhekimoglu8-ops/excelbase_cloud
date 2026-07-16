use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Component, Path};

use crate::import::{import_path_to_writer, replace_file, temporary_path};
use crate::model::{
    ArchiveInventoryRecord, ArchiveSummary, CoreError, PhotoArchiveSummary, PhotoManifestRecord,
    file_sha256,
};

const MAX_ENTRIES: usize = 10_000;
const MAX_ENTRY_BYTES: u64 = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 200;

#[derive(Debug, Clone)]
struct CheckedEntry {
    index: usize,
    name: String,
    compressed_bytes: u64,
    uncompressed_bytes: u64,
    supported: bool,
    directory: bool,
}

pub(crate) fn inventory_to_ndjson(
    zip_path: &Path,
    output_path: &Path,
) -> Result<ArchiveSummary, CoreError> {
    ensure_distinct(zip_path, output_path)?;
    let file = File::open(zip_path).map_err(CoreError::io)?;
    let mut archive = zip::ZipArchive::new(file).map_err(CoreError::parse)?;
    let entries = preflight(&mut archive)?;
    let temporary = temporary_path(output_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(CoreError::io)?;
    }

    let outcome = (|| {
        let output = File::create(&temporary).map_err(CoreError::io)?;
        let mut writer = BufWriter::new(output);
        for entry in &entries {
            let record = ArchiveInventoryRecord {
                index: entry.index as u64,
                name: entry.name.clone(),
                compressed_bytes: entry.compressed_bytes,
                uncompressed_bytes: entry.uncompressed_bytes,
                supported: entry.supported,
                directory: entry.directory,
            };
            serde_json::to_writer(&mut writer, &record).map_err(CoreError::parse)?;
            writer.write_all(b"\n").map_err(CoreError::io)?;
        }
        writer.flush().map_err(CoreError::io)?;
        writer.get_ref().sync_all().map_err(CoreError::io)?;
        replace_file(&temporary, output_path)?;
        Ok(summary(zip_path, output_path, &entries, 0))
    })();

    if outcome.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    outcome
}

pub(crate) fn import_archive_to_ndjson(
    zip_path: &Path,
    extraction_dir: &Path,
    output_path: &Path,
) -> Result<ArchiveSummary, CoreError> {
    ensure_distinct(zip_path, output_path)?;
    fs::create_dir_all(extraction_dir).map_err(CoreError::io)?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(CoreError::io)?;
    }

    let file = File::open(zip_path).map_err(CoreError::io)?;
    let mut archive = zip::ZipArchive::new(file).map_err(CoreError::parse)?;
    let entries = preflight(&mut archive)?;
    let temporary = temporary_path(output_path);

    let outcome = (|| {
        let output = File::create(&temporary).map_err(CoreError::io)?;
        let mut writer = BufWriter::new(output);
        let mut rows = 0_u64;

        for checked in entries
            .iter()
            .filter(|entry| entry.supported && !entry.directory)
        {
            let staged = staged_path(extraction_dir, checked);
            extract_checked(&mut archive, checked, &staged)?;
            let import_result = import_path_to_writer(&staged, &mut writer);
            let _ = fs::remove_file(&staged);
            let (_, _, imported_rows) = import_result?;
            rows = rows
                .checked_add(imported_rows)
                .ok_or_else(|| CoreError::Parse {
                    reason: "Satır sayısı sınırı aşıldı".to_owned(),
                })?;
        }

        if rows == 0 {
            return Err(CoreError::ZeroRows);
        }
        writer.flush().map_err(CoreError::io)?;
        writer.get_ref().sync_all().map_err(CoreError::io)?;
        replace_file(&temporary, output_path)?;
        Ok(summary(zip_path, output_path, &entries, rows))
    })();

    if outcome.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    outcome
}

pub(crate) fn extract_photo_archive(
    zip_path: &Path,
    extraction_dir: &Path,
) -> Result<PhotoArchiveSummary, CoreError> {
    fs::create_dir_all(extraction_dir).map_err(CoreError::io)?;
    let file = File::open(zip_path).map_err(CoreError::io)?;
    let mut archive = zip::ZipArchive::new(file).map_err(CoreError::parse)?;
    let entries = preflight(&mut archive)?;

    for entry in entries.iter().filter(|entry| !entry.directory) {
        if is_ignored_metadata(&entry.name) {
            continue;
        }
        if is_nested_archive(&entry.name) {
            return Err(unsafe_archive(format!(
                "İç içe arşiv reddedildi: {}",
                entry.name
            )));
        }
        if !is_photo_name(&entry.name) {
            return Err(unsafe_archive(format!(
                "Fotoğraf arşivinde desteklenmeyen dosya: {}",
                entry.name
            )));
        }
    }

    let run_dir = create_photo_run_dir(zip_path, extraction_dir)?;
    let manifest_path = run_dir.join("photos.ndjson");
    let outcome = (|| {
        let manifest = File::create(&manifest_path).map_err(CoreError::io)?;
        let mut manifest = BufWriter::new(manifest);
        let mut files = 0_u64;
        let mut bytes = 0_u64;

        for entry in entries.iter().filter(|entry| {
            !entry.directory && !is_ignored_metadata(&entry.name) && is_photo_name(&entry.name)
        }) {
            let output = staged_path(&run_dir, entry);
            extract_checked(&mut archive, entry, &output)?;
            if !has_expected_photo_signature(&output, &entry.name)? {
                let _ = fs::remove_file(&output);
                return Err(unsafe_archive(format!(
                    "Fotoğraf uzantısı içerikle uyuşmuyor: {}",
                    entry.name
                )));
            }
            let record = PhotoManifestRecord {
                path: output.to_string_lossy().into_owned(),
                original_name: entry.name.clone(),
                bytes: entry.uncompressed_bytes,
            };
            serde_json::to_writer(&mut manifest, &record).map_err(CoreError::parse)?;
            manifest.write_all(b"\n").map_err(CoreError::io)?;
            files += 1;
            bytes = bytes
                .checked_add(entry.uncompressed_bytes)
                .ok_or_else(|| unsafe_archive("Fotoğraf boyutu taşması"))?;
        }

        if files == 0 {
            return Err(CoreError::Unsupported {
                reason: "Arşivde JPG, PNG, HEIC veya HEIF fotoğraf bulunamadı".to_owned(),
            });
        }
        manifest.flush().map_err(CoreError::io)?;
        manifest.get_ref().sync_all().map_err(CoreError::io)?;
        Ok(PhotoArchiveSummary {
            zip_path: zip_path.to_string_lossy().into_owned(),
            extraction_dir: run_dir.to_string_lossy().into_owned(),
            manifest_path: manifest_path.to_string_lossy().into_owned(),
            files,
            uncompressed_bytes: bytes,
        })
    })();

    if outcome.is_err() {
        let _ = fs::remove_dir_all(&run_dir);
    }
    outcome
}

fn preflight<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<Vec<CheckedEntry>, CoreError> {
    if archive.len() > MAX_ENTRIES {
        return Err(unsafe_archive(format!(
            "Arşiv {} öğe içeriyor; üst sınır {MAX_ENTRIES}",
            archive.len()
        )));
    }

    let mut total = 0_u64;
    let mut checked = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(CoreError::parse)?;
        let name = entry.name().to_owned();
        validate_entry_name(&name)?;
        if entry.encrypted() {
            return Err(unsafe_archive(format!(
                "Şifreli ZIP öğesi reddedildi: {name}"
            )));
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170_000 == 0o120_000)
        {
            return Err(unsafe_archive(format!(
                "Sembolik bağlantı reddedildi: {name}"
            )));
        }

        let size = entry.size();
        let compressed = entry.compressed_size();
        if size > MAX_ENTRY_BYTES {
            return Err(unsafe_archive(format!(
                "Tek dosya sınırı aşıldı: {name} ({size} bayt)"
            )));
        }
        total = total
            .checked_add(size)
            .ok_or_else(|| unsafe_archive("Arşiv boyutu taşması"))?;
        if total > MAX_TOTAL_BYTES {
            return Err(unsafe_archive(format!(
                "Toplam açılmış boyut {MAX_TOTAL_BYTES} bayt sınırını aşıyor"
            )));
        }
        if size > 0 && (compressed == 0 || size / compressed.max(1) > MAX_COMPRESSION_RATIO) {
            return Err(unsafe_archive(format!("Şüpheli sıkıştırma oranı: {name}")));
        }

        let directory = entry.is_dir();
        checked.push(CheckedEntry {
            index,
            supported: !directory && is_supported_name(&name),
            name,
            compressed_bytes: compressed,
            uncompressed_bytes: size,
            directory,
        });
    }
    Ok(checked)
}

fn extract_checked<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    checked: &CheckedEntry,
    output_path: &Path,
) -> Result<(), CoreError> {
    let mut entry = archive.by_index(checked.index).map_err(CoreError::parse)?;
    let mut output = File::create(output_path).map_err(CoreError::io)?;
    let copied = std::io::copy(&mut entry, &mut output).map_err(CoreError::io)?;
    output.sync_all().map_err(CoreError::io)?;
    if copied != checked.uncompressed_bytes {
        let _ = fs::remove_file(output_path);
        return Err(CoreError::UnsafeArchive {
            reason: format!(
                "Açılan boyut beklenenden farklı: {} ({} / {})",
                checked.name, copied, checked.uncompressed_bytes
            ),
        });
    }
    Ok(())
}

fn validate_entry_name(name: &str) -> Result<(), CoreError> {
    if name.is_empty() || name.contains('\0') || name.contains('\\') {
        return Err(unsafe_archive(format!("Geçersiz öğe adı: {name:?}")));
    }
    let path = Path::new(name);
    if path.is_absolute() {
        return Err(unsafe_archive(format!("Mutlak yol reddedildi: {name}")));
    }
    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(unsafe_archive(format!("Yol geçişi reddedildi: {name}")));
        }
    }
    Ok(())
}

fn is_supported_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".xlsx", ".xlsm", ".xls", ".ods", ".csv"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn is_photo_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".jpg", ".jpeg", ".png", ".heic", ".heif"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn is_nested_archive(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".zip", ".7z", ".rar", ".tar", ".gz"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn is_ignored_metadata(name: &str) -> bool {
    let normalized = name.replace('\\', "/");
    normalized.starts_with("__MACOSX/")
        || normalized
            .rsplit('/')
            .next()
            .is_some_and(|file| file == ".DS_Store" || file.starts_with("._"))
}

fn has_expected_photo_signature(path: &Path, name: &str) -> Result<bool, CoreError> {
    let mut file = File::open(path).map_err(CoreError::io)?;
    let mut signature = [0_u8; 16];
    let count = file.read(&mut signature).map_err(CoreError::io)?;
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        Ok(count >= 3 && signature[..3] == [0xff, 0xd8, 0xff])
    } else if lower.ends_with(".png") {
        Ok(count >= 8 && signature[..8] == [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a])
    } else {
        let brands = [
            b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1",
        ];
        Ok(count >= 12
            && &signature[4..8] == b"ftyp"
            && brands.iter().any(|brand| signature[8..12] == **brand))
    }
}

fn create_photo_run_dir(zip_path: &Path, base: &Path) -> Result<std::path::PathBuf, CoreError> {
    let digest = file_sha256(zip_path)?;
    let short = digest.get(..12).unwrap_or(&digest);
    for sequence in 0..10_000_u32 {
        let candidate = base.join(format!("excelbase-photos-{short}-{sequence:04}"));
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(CoreError::io(error)),
        }
    }
    Err(CoreError::Io {
        reason: "Fotoğraf çalışma klasörü oluşturulamadı".to_owned(),
    })
}

fn staged_path(extraction_dir: &Path, entry: &CheckedEntry) -> std::path::PathBuf {
    let file_name = Path::new(&entry.name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("import.csv");
    extraction_dir.join(format!("{:05}-{file_name}", entry.index))
}

fn summary(
    zip_path: &Path,
    output_path: &Path,
    entries: &[CheckedEntry],
    rows: u64,
) -> ArchiveSummary {
    ArchiveSummary {
        zip_path: zip_path.to_string_lossy().into_owned(),
        output_path: output_path.to_string_lossy().into_owned(),
        entries: entries.len() as u64,
        supported_files: entries.iter().filter(|entry| entry.supported).count() as u64,
        rows,
        uncompressed_bytes: entries.iter().map(|entry| entry.uncompressed_bytes).sum(),
    }
}

fn ensure_distinct(input: &Path, output: &Path) -> Result<(), CoreError> {
    if input == output {
        return Err(CoreError::Io {
            reason: "ZIP ve çıktı yolu aynı olamaz".to_owned(),
        });
    }
    Ok(())
}

fn unsafe_archive(reason: impl ToString) -> CoreError {
    CoreError::UnsafeArchive {
        reason: reason.to_string(),
    }
}
