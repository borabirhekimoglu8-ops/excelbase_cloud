use std::fs::{self, File};
use std::io::Write;

use excelbase_core::{
    CoreError, InputFormat, export_ndjson_to_csv, export_ndjson_to_xlsx, extract_photo_zip,
    identity_key, import_to_ndjson, import_zip_to_ndjson, inventory_zip_to_ndjson, sniff_format,
};
use rust_xlsxwriter::{ExcelDateTime, Format, Workbook};
use tempfile::tempdir;
use zip::write::SimpleFileOptions;

fn passenger_line() -> &'static str {
    r#"{"No":"1","Ad":"AYŞE","Soyad":"YILMAZ","Yolcu Adı Soyadı":"AYŞE YILMAZ","Pasaport No":"TR123456","Voucher":"V-1","Gidiş Tarihi":"2026-07-18","Varış Tarihi":"2026-07-25","Vize Ücreti Yetişkin":"25","Vize Ücreti Çocuk":"0","Kaynak Dosya":"test.csv","Sayfa":"CSV","Foto":""}"#
}

#[test]
fn generated_xlsx_exports_and_imports_round_trip() {
    let directory = tempdir().unwrap();
    let ndjson = directory.path().join("passengers.ndjson");
    let xlsx = directory.path().join("passengers.xlsx");
    let imported = directory.path().join("imported.ndjson");
    fs::write(&ndjson, format!("{}\n", passenger_line())).unwrap();

    let exported = export_ndjson_to_xlsx(
        ndjson.to_string_lossy().into_owned(),
        xlsx.to_string_lossy().into_owned(),
    )
    .unwrap();
    assert_eq!(exported.rows, 1);
    assert_eq!(
        sniff_format(xlsx.to_string_lossy().into_owned()).unwrap(),
        InputFormat::Xlsx
    );

    let summary = import_to_ndjson(
        xlsx.to_string_lossy().into_owned(),
        imported.to_string_lossy().into_owned(),
    )
    .unwrap();
    assert_eq!(summary.rows, 1);
    let output = fs::read_to_string(imported).unwrap();
    assert!(output.contains("AYŞE"));
    assert!(output.contains("TR123456"));
    assert!(output.contains("2026-07-18"));
    let row: serde_json::Value = serde_json::from_str(output.trim()).unwrap();
    let object = row.as_object().unwrap();
    assert_eq!(object.len(), 13);
    for key in [
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
    ] {
        assert!(object.contains_key(key), "missing V7 key: {key}");
    }
    assert_eq!(object["Vize Ücreti Yetişkin"], "25");
}

#[test]
fn real_excel_date_cell_is_iso_date_not_serial_number() {
    let directory = tempdir().unwrap();
    let xlsx = directory.path().join("real-date.xlsx");
    let imported = directory.path().join("imported.ndjson");
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    for (column, header) in ["NAME", "SURNAME", "PASSPORT NUMBER", "DEPARTURE", "ARRIVAL"]
        .iter()
        .enumerate()
    {
        worksheet.write_string(0, column as u16, *header).unwrap();
    }
    worksheet.write_string(1, 0, "ALICE").unwrap();
    worksheet.write_string(1, 1, "TEST").unwrap();
    worksheet.write_string(1, 2, "P123456").unwrap();
    let date_format = Format::new().set_num_format("yyyy-mm-dd");
    let departure = ExcelDateTime::from_ymd(2026, 7, 18).unwrap();
    let arrival = ExcelDateTime::from_ymd(2026, 7, 25)
        .unwrap()
        .and_hms(14, 30, 0.0)
        .unwrap();
    worksheet
        .write_datetime_with_format(1, 3, &departure, &date_format)
        .unwrap();
    worksheet
        .write_datetime_with_format(1, 4, &arrival, &date_format)
        .unwrap();
    workbook.save(&xlsx).unwrap();

    let summary = import_to_ndjson(
        xlsx.to_string_lossy().into_owned(),
        imported.to_string_lossy().into_owned(),
    )
    .unwrap();
    assert_eq!(summary.rows, 1);
    let row: serde_json::Value =
        serde_json::from_str(fs::read_to_string(imported).unwrap().trim()).unwrap();
    assert_eq!(row["Gidiş Tarihi"], "2026-07-18");
    assert_eq!(row["Varış Tarihi"], "2026-07-25");
    assert_ne!(row["Gidiş Tarihi"], "46200");
}

#[test]
fn csv_export_is_importable() {
    let directory = tempdir().unwrap();
    let ndjson = directory.path().join("passengers.ndjson");
    let csv = directory.path().join("passengers.csv");
    let imported = directory.path().join("imported.ndjson");
    fs::write(&ndjson, format!("{}\n", passenger_line())).unwrap();

    export_ndjson_to_csv(
        ndjson.to_string_lossy().into_owned(),
        csv.to_string_lossy().into_owned(),
    )
    .unwrap();
    let exported = fs::read(&csv).unwrap();
    assert!(exported.starts_with(&[0xef, 0xbb, 0xbf]));
    assert!(String::from_utf8_lossy(&exported).contains("No;Ad;Soyad"));
    let summary = import_to_ndjson(
        csv.to_string_lossy().into_owned(),
        imported.to_string_lossy().into_owned(),
    )
    .unwrap();
    assert_eq!(summary.rows, 1);
}

#[test]
fn zero_row_csv_is_an_explicit_error() {
    let directory = tempdir().unwrap();
    let csv = directory.path().join("empty.csv");
    let output = directory.path().join("output.ndjson");
    fs::write(&csv, "NAME,SURNAME,PASSPORT NUMBER\n").unwrap();

    let error = import_to_ndjson(
        csv.to_string_lossy().into_owned(),
        output.to_string_lossy().into_owned(),
    )
    .unwrap_err();
    assert!(matches!(error, CoreError::ZeroRows));
    assert!(!output.exists());
}

#[test]
fn zip_traversal_is_rejected_before_extraction() {
    let directory = tempdir().unwrap();
    let archive_path = directory.path().join("unsafe.zip");
    let inventory = directory.path().join("inventory.ndjson");
    let output = File::create(&archive_path).unwrap();
    let mut archive = zip::ZipWriter::new(output);
    archive
        .start_file("../passengers.csv", SimpleFileOptions::default())
        .unwrap();
    archive.write_all(b"NAME,SURNAME\nA,B\n").unwrap();
    archive.finish().unwrap();

    let error = inventory_zip_to_ndjson(
        archive_path.to_string_lossy().into_owned(),
        inventory.to_string_lossy().into_owned(),
    )
    .unwrap_err();
    assert!(matches!(error, CoreError::UnsafeArchive { .. }));
    assert!(!inventory.exists());
}

#[test]
fn zip_with_csv_imports_to_one_ndjson_stream() {
    let directory = tempdir().unwrap();
    let archive_path = directory.path().join("passengers.zip");
    let staging = directory.path().join("staging");
    let output_path = directory.path().join("passengers.ndjson");
    let output = File::create(&archive_path).unwrap();
    let mut archive = zip::ZipWriter::new(output);
    archive
        .start_file("lists/one.csv", SimpleFileOptions::default())
        .unwrap();
    archive
        .write_all(b"NAME,SURNAME,PASSPORT NUMBER\nALICE,TEST,P123456\n")
        .unwrap();
    archive.finish().unwrap();

    let summary = import_zip_to_ndjson(
        archive_path.to_string_lossy().into_owned(),
        staging.to_string_lossy().into_owned(),
        output_path.to_string_lossy().into_owned(),
    )
    .unwrap();
    assert_eq!(summary.entries, 1);
    assert_eq!(summary.supported_files, 1);
    assert_eq!(summary.rows, 1);
    assert!(fs::read_to_string(output_path).unwrap().contains("P123456"));
}

#[test]
fn identity_is_stable_and_normalized() {
    assert_eq!(
        identity_key(
            " tr 12-34 ".to_owned(),
            "2026-07-18".to_owned(),
            "Ayşe Yılmaz".to_owned()
        ),
        identity_key(
            "TR1234".to_owned(),
            "2026 07 18".to_owned(),
            "AYSE YILMAZ".to_owned()
        )
    );
    assert_eq!(
        identity_key(
            "TR1234".to_owned(),
            "2026-07-18".to_owned(),
            "ALICE TEST".to_owned()
        ),
        identity_key(
            "TR1234".to_owned(),
            "2026-07-18".to_owned(),
            "BOB OTHER".to_owned()
        )
    );
}

#[test]
fn photo_zip_extracts_safe_images_and_writes_manifest() {
    let directory = tempdir().unwrap();
    let archive_path = directory.path().join("photos.zip");
    let extraction = directory.path().join("photo-runs");
    let output = File::create(&archive_path).unwrap();
    let mut archive = zip::ZipWriter::new(output);
    archive
        .start_file("passengers/TR123456.jpg", SimpleFileOptions::default())
        .unwrap();
    archive
        .write_all(&[0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
        .unwrap();
    archive.finish().unwrap();

    let summary = extract_photo_zip(
        archive_path.to_string_lossy().into_owned(),
        extraction.to_string_lossy().into_owned(),
    )
    .unwrap();
    assert_eq!(summary.files, 1);
    let manifest = fs::read_to_string(summary.manifest_path).unwrap();
    let row: serde_json::Value = serde_json::from_str(manifest.trim()).unwrap();
    assert_eq!(row["original_name"], "passengers/TR123456.jpg");
    assert!(
        row["path"]
            .as_str()
            .is_some_and(|path| std::path::Path::new(path).exists())
    );
}

#[test]
fn photo_zip_rejects_nested_archives() {
    let directory = tempdir().unwrap();
    let archive_path = directory.path().join("photos.zip");
    let extraction = directory.path().join("photo-runs");
    let output = File::create(&archive_path).unwrap();
    let mut archive = zip::ZipWriter::new(output);
    archive
        .start_file("nested.zip", SimpleFileOptions::default())
        .unwrap();
    archive.write_all(b"PK\x05\x06").unwrap();
    archive.finish().unwrap();

    let error = extract_photo_zip(
        archive_path.to_string_lossy().into_owned(),
        extraction.to_string_lossy().into_owned(),
    )
    .unwrap_err();
    assert!(matches!(error, CoreError::UnsafeArchive { .. }));
}
