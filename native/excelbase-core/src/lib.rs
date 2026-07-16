mod archive;
mod export;
mod import;
mod model;

use std::path::Path;

pub use model::{
    ArchiveSummary, CoreError, ExportSummary, ImportSummary, InputFormat, PhotoArchiveSummary,
};

#[uniffi::export]
pub fn sniff_format(path: String) -> Result<InputFormat, CoreError> {
    import::sniff_path(Path::new(&path))
}

#[uniffi::export]
pub fn import_to_ndjson(
    input_path: String,
    output_path: String,
) -> Result<ImportSummary, CoreError> {
    import::import_path_to_ndjson(Path::new(&input_path), Path::new(&output_path))
}

#[uniffi::export]
pub fn inventory_zip_to_ndjson(
    zip_path: String,
    output_path: String,
) -> Result<ArchiveSummary, CoreError> {
    archive::inventory_to_ndjson(Path::new(&zip_path), Path::new(&output_path))
}

#[uniffi::export]
pub fn import_zip_to_ndjson(
    zip_path: String,
    extraction_dir: String,
    output_path: String,
) -> Result<ArchiveSummary, CoreError> {
    archive::import_archive_to_ndjson(
        Path::new(&zip_path),
        Path::new(&extraction_dir),
        Path::new(&output_path),
    )
}

#[uniffi::export]
pub fn extract_photo_zip(
    zip_path: String,
    extraction_dir: String,
) -> Result<PhotoArchiveSummary, CoreError> {
    archive::extract_photo_archive(Path::new(&zip_path), Path::new(&extraction_dir))
}

#[uniffi::export]
pub fn export_ndjson_to_xlsx(
    input_path: String,
    output_path: String,
) -> Result<ExportSummary, CoreError> {
    export::ndjson_to_xlsx(Path::new(&input_path), Path::new(&output_path))
}

#[uniffi::export]
pub fn export_ndjson_to_csv(
    input_path: String,
    output_path: String,
) -> Result<ExportSummary, CoreError> {
    export::ndjson_to_csv(Path::new(&input_path), Path::new(&output_path))
}

#[uniffi::export]
pub fn identity_key(passport: String, departure: String, full_name: String) -> String {
    model::make_identity_key(&passport, &departure, &full_name)
}

uniffi::setup_scaffolding!();
