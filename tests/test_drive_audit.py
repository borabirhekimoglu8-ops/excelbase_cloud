"""Tests for the local work-folder scanner.

The scanner exists so this analysis never leaves the machine, so the tests
that matter most are the ones about what it refuses to read: no cell beyond
the header row, no document contents, and no crash on the locked or corrupt
file that every real folder contains.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from openpyxl import Workbook

from backend.driveaudit.scanner import (
    MAX_FILES,
    build_findings,
    normalize_column,
    read_headers,
    scan_folder,
)


def write_xlsx(path: Path, rows: list[list[object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    book = Workbook()
    sheet = book.active
    for row in rows:
        sheet.append(row)
    book.save(path)


@pytest.fixture()
def drive(tmp_path: Path) -> Path:
    """A folder shaped like a real operation: dated folders, forms, scans."""
    root = tmp_path / "Drive"
    pax = ["Sıra", "Ad Soyad", "Pasaport No", "Acente", "Komisyon"]
    for day in ("2026-07-01", "2026-07-02", "2026-07-03"):
        write_xlsx(root / day / f"pax-{day}.xlsx", [pax, [1, "Ali", "U1", "Mavi", "50"]])
        (root / day / "pasaport.pdf").write_bytes(b"%PDF-1.4 fake")
        (root / day / "foto.jpg").write_bytes(b"\xff\xd8\xff fake")
    # A second, different template.
    write_xlsx(root / "muhasebe" / "tahsilat.xlsx", [["Fis No", "Tutar", "Tahsilat Tipi"], ["F1", "10", "nakit"]])
    return root


def test_it_counts_what_is_there_without_opening_documents(drive):
    report = scan_folder(drive)

    assert report.by_kind["tablo"] == 4
    assert report.by_kind["belge"] == 3
    assert report.by_kind["gorsel"] == 3
    assert report.dated_folders == 3


def test_files_sharing_a_header_row_are_recognised_as_one_template(drive):
    report = scan_folder(drive)

    biggest = report.templates[0]
    assert biggest.count == 3
    assert "pasaport no" in biggest.headers
    # The second template is present but separate.
    assert any(group.count == 1 for group in report.templates)


def test_columns_the_app_cannot_hold_are_reported_with_their_weight(drive):
    report = scan_folder(drive)
    unknown = dict(report.unknown_columns)

    # "Komisyon" and "Acente" have nowhere to go in the passenger record.
    assert unknown.get("Komisyon") == 3
    assert unknown.get("Acente") == 3
    # "Pasaport No" does, so it is not reported as a gap.
    assert not any(name.lower().startswith("pasaport") for name in unknown)


def test_a_finding_carries_an_instruction_that_names_no_file_contents(drive):
    report = scan_folder(drive)

    assert report.findings, "gerçek bir klasörden en az bir bulgu çıkmalı"
    for finding in report.findings:
        assert finding.suggestion
        # Cell values must never reach the sentence the operator approves.
        assert "Ali" not in finding.suggestion
        assert "U1" not in finding.suggestion


def test_a_record_type_takes_the_name_of_the_folder_not_of_the_day(tmp_path):
    """The files sit in Operasyon/2026-07-01/. "2026-07-01" says when the work
    happened; "Operasyon" says what kind of record it is."""
    root = tmp_path / "Drive"
    headers = ["Sıra", "Ad Soyad", "Pasaport No", "Acente"]
    for day in ("2026-07-01", "2026-07-02", "2026-07-03"):
        write_xlsx(root / "Operasyon" / day / "pax.xlsx", [headers, [1, "Ali", "U1", "Mavi"]])

    report = scan_folder(root)

    assert report.entities[0].name == "Operasyon"
    assert "Operasyon" in report.entities[0].suggestion


def test_a_suggestion_spells_the_columns_the_way_the_operator_does(tmp_path):
    """Grouping folds case and Turkish letters so that "Satışı Yapan" and
    "SATISI YAPAN" land in one template. The sentence handed to the
    development panel must still say "Satışı Yapan" -- it becomes a field
    label, and the folded key would ship a misspelt one."""
    root = tmp_path / "Drive"
    headers = ["Tarih", "Hat", "Satışı Yapan", "Tutar"]
    for month in ("ocak", "subat", "mart"):
        write_xlsx(root / f"{month}.xlsx", [headers, ["01.07.2026", "IST-AMS", "Bora", "10"]])

    report = scan_folder(root)
    template = next(finding for finding in report.findings if finding.kind == "template")

    assert "Satışı Yapan" in template.suggestion
    assert "satisi yapan" not in template.suggestion
    assert any("Satışı Yapan" in line for line in template.evidence)


def test_only_the_header_row_is_read(tmp_path):
    # A sheet whose rows hold passport numbers: none of them may appear in the
    # report, because only the first row is ever touched.
    path = tmp_path / "liste.xlsx"
    write_xlsx(path, [
        ["Ad Soyad", "Pasaport No"],
        ["Ayşe Demir", "U9876543"],
        ["Mehmet Kaya", "U1234567"],
    ])

    headers = read_headers(path)

    assert headers == ["Ad Soyad", "Pasaport No"]
    assert "U9876543" not in str(scan_folder(tmp_path).as_dict())


def test_a_corrupt_or_locked_file_does_not_end_the_scan(tmp_path):
    # Every real folder has one of these; the scan has to survive it.
    (tmp_path / "bozuk.xlsx").write_bytes(b"not a workbook at all")
    write_xlsx(tmp_path / "iyi.xlsx", [["Ad", "Soyad"], ["Ali", "Yılmaz"]])

    report = scan_folder(tmp_path)

    assert report.by_kind["tablo"] == 2
    assert read_headers(tmp_path / "bozuk.xlsx") == []


def test_the_same_column_written_four_ways_counts_once():
    # Turkish exports vary endlessly; without folding, one column looks like
    # four and every count in the report is wrong.
    keys = {normalize_column(value) for value in ("Pasaport No", "PASAPORT NO", "Pasaport_No", "pasaport  no")}
    assert keys == {"pasaport no"}


def test_a_header_row_further_down_is_still_found(tmp_path):
    # Real exports carry a title and a blank line above the header.
    path = tmp_path / "baslikli.xlsx"
    write_xlsx(path, [["GATE VISA PAX LIST"], [], ["Ad Soyad", "Pasaport No", "Acente"]])

    assert read_headers(path) == ["Ad Soyad", "Pasaport No", "Acente"]


def test_csv_headers_survive_a_semicolon_export_and_a_bom(tmp_path):
    # Turkish Excel writes semicolons and a BOM; the BOM would otherwise stick
    # to the first column name and make it look like a column of its own.
    path = tmp_path / "liste.csv"
    path.write_bytes("﻿Ad Soyad;Pasaport No;Acente\nAli;U1;Mavi\n".encode("utf-8"))

    assert read_headers(path) == ["Ad Soyad", "Pasaport No", "Acente"]


def test_scanning_something_that_is_not_a_folder_says_so(tmp_path):
    with pytest.raises(NotADirectoryError):
        scan_folder(tmp_path / "yok")


def test_findings_are_ordered_by_how_much_evidence_backs_them():
    from backend.driveaudit.scanner import TemplateGroup

    findings = build_findings(
        templates=[TemplateGroup(headers=("a", "b"), files=tuple(f"f{i}" for i in range(40)))],
        unknown_columns=[("Komisyon", 4)],
        by_kind={"tablo": 40, "belge": 0, "gorsel": 0},
        dated_folders=0,
    )

    assert findings
    assert findings == sorted(findings, key=lambda entry: entry.weight, reverse=True)


def test_a_huge_folder_stops_rather_than_running_forever(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.driveaudit.scanner.MAX_FILES", 5)
    for index in range(12):
        (tmp_path / f"dosya{index}.pdf").write_bytes(b"x")

    report = scan_folder(tmp_path)

    assert report.truncated is True
    assert report.files_seen == 5
