/**
 * Filtering and summarising the Gate Visa day folders.
 *
 * Folders are what the Excel imports become: one per day, holding that day's
 * passengers with their PDFs and photos. The counts already exist per folder;
 * what was missing was any way to ask a question across them -- which days are
 * still incomplete, how much of the operation is photographed, where the
 * missing documents are concentrated.
 *
 * Pure over an array of folders, so the arithmetic is testable without the
 * vault or the network.
 */

import type { RecordFolder } from "@/lib/api";

export type GateVisaTotals = {
  folders: number;
  passengers: number;
  ready: number;
  review: number;
  draft: number;
  withPhoto: number;
  documents: number;
  /** 0..100, share of passengers marked ready. */
  readinessPercent: number;
  /** 0..100, share of passengers that have a photo. */
  photoPercent: number;
  /** Passengers not yet ready: the work actually left to do. */
  outstanding: number;
};

export type GateVisaFilter = {
  /** Matches the folder's date key, so "2026-07" narrows to a month. */
  query: string;
  /** Only folders with passengers still not ready. */
  onlyIncomplete: boolean;
  /** Only folders with at least one passenger missing a photo. */
  onlyMissingPhoto: boolean;
  /** Only folders with no documents attached at all. */
  onlyMissingDocuments: boolean;
};

export const emptyGateVisaFilter = (): GateVisaFilter => ({
  query: "",
  onlyIncomplete: false,
  onlyMissingPhoto: false,
  onlyMissingDocuments: false,
});

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export function gateVisaTotals(folders: RecordFolder[]): GateVisaTotals {
  const sum = (pick: (folder: RecordFolder) => number) =>
    folders.reduce((total, folder) => total + pick(folder), 0);

  const passengers = sum((folder) => folder.count);
  const ready = sum((folder) => folder.ready_count);
  const withPhoto = sum((folder) => folder.with_photo);
  return {
    folders: folders.length,
    passengers,
    ready,
    review: sum((folder) => folder.review_count),
    draft: sum((folder) => folder.draft_count),
    withPhoto,
    documents: sum((folder) => folder.document_count),
    readinessPercent: percent(ready, passengers),
    photoPercent: percent(withPhoto, passengers),
    outstanding: Math.max(0, passengers - ready),
  };
}

export function folderIsIncomplete(folder: RecordFolder): boolean {
  return folder.review_count + folder.draft_count > 0;
}

export function filterGateVisaFolders(
  folders: RecordFolder[],
  filter: GateVisaFilter,
): RecordFolder[] {
  const query = filter.query.trim().toLocaleLowerCase("tr");
  return folders.filter((folder) => {
    if (query && !folder.date_key.toLocaleLowerCase("tr").includes(query)) return false;
    if (filter.onlyIncomplete && !folderIsIncomplete(folder)) return false;
    // A folder with no passengers has nothing missing; flagging it as "missing
    // photos" would send the operator to an empty day.
    if (filter.onlyMissingPhoto && (folder.count === 0 || folder.with_photo >= folder.count)) {
      return false;
    }
    if (filter.onlyMissingDocuments && (folder.count === 0 || folder.document_count > 0)) {
      return false;
    }
    return true;
  });
}

export type GateVisaDayStat = {
  dateKey: string;
  passengers: number;
  ready: number;
  outstanding: number;
  withPhoto: number;
  documents: number;
  readinessPercent: number;
};

export function gateVisaDayStats(folders: RecordFolder[]): GateVisaDayStat[] {
  return folders.map((folder) => ({
    dateKey: folder.date_key,
    passengers: folder.count,
    ready: folder.ready_count,
    outstanding: Math.max(0, folder.count - folder.ready_count),
    withPhoto: folder.with_photo,
    documents: folder.document_count,
    readinessPercent: percent(folder.ready_count, folder.count),
  }));
}

/**
 * The days with the most passengers still not ready.
 *
 * Ranked by outstanding work rather than by size or date: the biggest day is
 * not necessarily the one that needs attention, and the newest one is not
 * either.
 */
export function busiestOutstandingDays(
  folders: RecordFolder[],
  limit = 5,
): GateVisaDayStat[] {
  return gateVisaDayStats(folders)
    .filter((day) => day.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding || a.dateKey.localeCompare(b.dateKey))
    .slice(0, limit);
}
