use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const APP_HEADERS: [&str; 13] = [
    "No",
    "Ad",
    "Soyad",
    "Yolcu Adı Soyadı",
    "Pasaport No",
    "Voucher",
    "Gidiş Tarihi",
    "Varış Tarihi",
    "Vize Ücreti Yetişkin",
    "Vize Ücreti Çocuk",
    "Kaynak Dosya",
    "Sayfa",
    "Foto",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum InputFormat {
    Xlsx,
    Xls,
    Ods,
    Csv,
    Zip,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct ImportSummary {
    pub input_path: String,
    pub output_path: String,
    pub format: InputFormat,
    pub sheets: u32,
    pub rows: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct ArchiveSummary {
    pub zip_path: String,
    pub output_path: String,
    pub entries: u64,
    pub supported_files: u64,
    pub rows: u64,
    pub uncompressed_bytes: u64,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct PhotoArchiveSummary {
    pub zip_path: String,
    pub extraction_dir: String,
    pub manifest_path: String,
    pub files: u64,
    pub uncompressed_bytes: u64,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct ExportSummary {
    pub input_path: String,
    pub output_path: String,
    pub rows: u64,
    pub sha256: String,
}

#[derive(Debug, Error, uniffi::Error)]
pub enum CoreError {
    #[error("Dosya işlemi başarısız: {reason}")]
    Io { reason: String },
    #[error("Desteklenmeyen veya tanınmayan dosya: {reason}")]
    Unsupported { reason: String },
    #[error("Dosyada aktarılabilir yolcu satırı bulunamadı")]
    ZeroRows,
    #[error("Tablo okunamadı: {reason}")]
    Parse { reason: String },
    #[error("ZIP güvenlik kontrolü başarısız: {reason}")]
    UnsafeArchive { reason: String },
    #[error("Dışa aktarma başarısız: {reason}")]
    Export { reason: String },
}

impl CoreError {
    pub fn io(error: impl std::fmt::Display) -> Self {
        Self::Io {
            reason: error.to_string(),
        }
    }

    pub fn parse(error: impl std::fmt::Display) -> Self {
        Self::Parse {
            reason: error.to_string(),
        }
    }

    pub fn export(error: impl std::fmt::Display) -> Self {
        Self::Export {
            reason: error.to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PassengerRecord {
    #[serde(rename = "No", default)]
    pub no: String,
    #[serde(rename = "Ad", default)]
    pub name: String,
    #[serde(rename = "Soyad", default)]
    pub surname: String,
    #[serde(rename = "Yolcu Adı Soyadı", default)]
    pub full_name: String,
    #[serde(rename = "Pasaport No", default)]
    pub passport: String,
    #[serde(rename = "Voucher", default)]
    pub voucher: String,
    #[serde(rename = "Gidiş Tarihi", default)]
    pub departure: String,
    #[serde(rename = "Varış Tarihi", default)]
    pub arrival: String,
    #[serde(rename = "Vize Ücreti Yetişkin", default)]
    pub adult_fee: String,
    #[serde(rename = "Vize Ücreti Çocuk", default)]
    pub child_fee: String,
    #[serde(rename = "Kaynak Dosya", default)]
    pub source_file: String,
    #[serde(rename = "Sayfa", default)]
    pub sheet: String,
    #[serde(rename = "Foto", default)]
    pub photo: String,
}

impl PassengerRecord {
    pub fn finish(mut self) -> Self {
        if self.full_name.trim().is_empty() {
            self.full_name = format!("{} {}", self.name.trim(), self.surname.trim())
                .trim()
                .to_owned();
        }
        self
    }

    pub fn values(&self) -> [&str; 13] {
        [
            &self.no,
            &self.name,
            &self.surname,
            &self.full_name,
            &self.passport,
            &self.voucher,
            &self.departure,
            &self.arrival,
            &self.adult_fee,
            &self.child_fee,
            &self.source_file,
            &self.sheet,
            &self.photo,
        ]
    }

    pub fn is_empty(&self) -> bool {
        self.values().iter().all(|value| value.trim().is_empty())
    }
}

#[derive(Debug, Serialize)]
pub struct ArchiveInventoryRecord {
    pub index: u64,
    pub name: String,
    pub compressed_bytes: u64,
    pub uncompressed_bytes: u64,
    pub supported: bool,
    pub directory: bool,
}

#[derive(Debug, Serialize)]
pub struct PhotoManifestRecord {
    pub path: String,
    pub original_name: String,
    pub bytes: u64,
}

pub fn normalize_header(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for ch in value.trim().to_lowercase().chars() {
        if ('\u{0300}'..='\u{036f}').contains(&ch) {
            continue;
        }
        let mapped = match ch {
            'ç' => 'c',
            'ğ' => 'g',
            'ı' | 'i' => 'i',
            'ö' => 'o',
            'ş' => 's',
            'ü' => 'u',
            'â' | 'á' | 'à' => 'a',
            'î' => 'i',
            'û' => 'u',
            c if c.is_ascii_alphanumeric() => c,
            _ => ' ',
        };
        output.push(mapped);
    }
    output.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn identity_component(value: &str) -> String {
    normalize_header(value).replace(' ', "").to_uppercase()
}

pub fn make_identity_key(passport: &str, departure: &str, _full_name: &str) -> String {
    let canonical = format!(
        "{}|{}",
        identity_component(passport),
        identity_component(departure)
    );
    let digest = Sha256::digest(canonical.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn file_sha256(path: &std::path::Path) -> Result<String, CoreError> {
    use std::io::Read;

    let mut file = std::fs::File::open(path).map_err(CoreError::io)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(CoreError::io)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}
