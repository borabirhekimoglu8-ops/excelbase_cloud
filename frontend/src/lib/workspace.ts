export const WORK_FILE_STATUSES = ["open", "waiting", "blocked", "done", "archived"] as const;
export const WORK_FILE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const CODE_RECORD_STATUSES = ["active", "inactive", "expired", "archived"] as const;
export const OFFICE_DOCUMENT_CATEGORIES = [
  "letter",
  "passenger_list",
  "official_form",
  "contract",
  "invoice",
  "correspondence",
  "spreadsheet",
  "other",
] as const;
export const WORKSPACE_TASK_STATUSES = ["todo", "doing", "waiting", "done"] as const;
export const WORKSPACE_TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type WorkFileStatus = (typeof WORK_FILE_STATUSES)[number];
export type WorkFilePriority = (typeof WORK_FILE_PRIORITIES)[number];
export type CodeRecordStatus = (typeof CODE_RECORD_STATUSES)[number];
export type OfficeDocumentCategory = (typeof OFFICE_DOCUMENT_CATEGORIES)[number];
export type WorkspaceTaskStatus = (typeof WORKSPACE_TASK_STATUSES)[number];
export type WorkspaceTaskPriority = (typeof WORKSPACE_TASK_PRIORITIES)[number];
export type WorkspaceEntityType = "work_file" | "code_record" | "office_document" | "task" | "note";

export type WorkspaceEntityBase = {
  entity_type: WorkspaceEntityType;
  schema_version: 1;
  id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string;
};

export type WorkFile = WorkspaceEntityBase & {
  entity_type: "work_file";
  file_no: string;
  title: string;
  category: string;
  status: WorkFileStatus;
  priority: WorkFilePriority;
  owner: string;
  company: string;
  route: string;
  description: string;
  start_date: string;
  due_date: string;
  tags: string[];
  passenger_record_uids: string[];
};

export type WorkFileInput = {
  file_no?: string;
  title: string;
  category?: string;
  status?: WorkFileStatus;
  priority?: WorkFilePriority;
  owner?: string;
  company?: string;
  route?: string;
  description?: string;
  start_date?: string;
  due_date?: string;
  tags?: string[];
  passenger_record_uids?: string[];
};

export type WorkFileFilters = {
  search?: string;
  status?: WorkFileStatus;
  category?: string;
  company?: string;
  route?: string;
};

export type CodeRecord = WorkspaceEntityBase & {
  entity_type: "code_record";
  code: string;
  title: string;
  category: string;
  status: CodeRecordStatus;
  description: string;
  valid_from: string;
  valid_to: string;
  tags: string[];
  work_file_id: string;
};

export type CodeRecordInput = {
  code: string;
  title: string;
  category?: string;
  status?: CodeRecordStatus;
  description?: string;
  valid_from?: string;
  valid_to?: string;
  tags?: string[];
  work_file_id?: string;
};

export type CodeRecordFilters = {
  search?: string;
  status?: CodeRecordStatus;
  category?: string;
  work_file_id?: string;
};

export type OfficeDocument = WorkspaceEntityBase & {
  entity_type: "office_document";
  title: string;
  filename: string;
  mime: string;
  size: number;
  category: OfficeDocumentCategory;
  document_date: string;
  binary_id: string;
  work_file_id: string;
  passenger_record_uids: string[];
  tags: string[];
};

export type OfficeDocumentUploadInput = {
  title?: string;
  category?: OfficeDocumentCategory;
  document_date?: string;
  work_file_id?: string;
  passenger_record_uids?: string[];
  tags?: string[];
};

export type OfficeDocumentFilters = {
  search?: string;
  category?: OfficeDocumentCategory;
  work_file_id?: string;
  passenger_record_uid?: string;
};

export type WorkspaceTask = WorkspaceEntityBase & {
  entity_type: "task";
  title: string;
  description: string;
  status: WorkspaceTaskStatus;
  priority: WorkspaceTaskPriority;
  due_at: string;
  completed_at: string;
  assignee: string;
  work_file_id: string;
  passenger_record_uid: string;
  code_record_id: string;
  document_id: string;
  tags: string[];
};

export type WorkspaceTaskInput = {
  title: string;
  description?: string;
  status?: WorkspaceTaskStatus;
  priority?: WorkspaceTaskPriority;
  due_at?: string;
  completed_at?: string;
  assignee?: string;
  work_file_id?: string;
  passenger_record_uid?: string;
  code_record_id?: string;
  document_id?: string;
  tags?: string[];
};

export type WorkspaceTaskFilters = {
  search?: string;
  status?: WorkspaceTaskStatus;
  priority?: WorkspaceTaskPriority;
  work_file_id?: string;
  passenger_record_uid?: string;
};

export type WorkspaceNote = WorkspaceEntityBase & {
  entity_type: "note";
  body: string;
  pinned: boolean;
  author: string;
  work_file_id: string;
  passenger_record_uid: string;
  code_record_id: string;
  document_id: string;
  tags: string[];
};

export type WorkspaceNoteInput = {
  body: string;
  pinned?: boolean;
  author?: string;
  work_file_id?: string;
  passenger_record_uid?: string;
  code_record_id?: string;
  document_id?: string;
  tags?: string[];
};

export type WorkspaceNoteFilters = {
  search?: string;
  work_file_id?: string;
  passenger_record_uid?: string;
  pinned?: boolean;
};

export type UnifiedDocumentMetadata = {
  id: string;
  source: "office" | "passenger";
  title: string;
  filename: string;
  mime: string;
  size: number;
  category: string;
  document_date: string;
  created_at: string;
  updated_at: string;
  work_file_id: string;
  passenger_record_uid: string;
  passenger_record_uids: string[];
  passenger_id: number | null;
  passenger_name: string;
};

export type UnifiedDocumentFilters = OfficeDocumentFilters & {
  source?: "office" | "passenger";
};

type PassengerDocumentLike = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  category?: string;
  created_at: string;
};

type PassengerDocumentOwner = {
  id: number;
  record_uid: string;
  full_name: string;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function searchFold(value: unknown): string {
  return clean(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (letter) => ({
      ç: "c",
      ğ: "g",
      ı: "i",
      ö: "o",
      ş: "s",
      ü: "u",
    }[letter] ?? letter))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeWorkspaceSearch(value: unknown): string {
  return searchFold(value);
}

export function normalizeWorkspaceCode(value: unknown): string {
  return clean(value)
    .toLocaleUpperCase("tr-TR")
    .replace(/\s+/g, " ")
    .replace(/\s*([/._-])\s*/g, "$1");
}

export function normalizeWorkspaceTags(values: readonly unknown[] | undefined): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const tag = clean(value);
    const key = searchFold(tag);
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    output.push(tag);
  }
  return output;
}

export function workFileSearchText(workFile: WorkFile): string {
  return searchFold([
    workFile.file_no,
    workFile.title,
    workFile.category,
    workFile.owner,
    workFile.company,
    workFile.route,
    workFile.description,
    ...workFile.tags,
  ].join(" "));
}

export function codeRecordSearchText(record: CodeRecord): string {
  return searchFold([
    record.code,
    record.title,
    record.category,
    record.description,
    ...record.tags,
  ].join(" "));
}

export function officeDocumentToUnified(document: OfficeDocument): UnifiedDocumentMetadata {
  return {
    id: document.id,
    source: "office",
    title: document.title,
    filename: document.filename,
    mime: document.mime,
    size: document.size,
    category: document.category,
    document_date: document.document_date,
    created_at: document.created_at,
    updated_at: document.updated_at,
    work_file_id: document.work_file_id,
    passenger_record_uid: document.passenger_record_uids[0] ?? "",
    passenger_record_uids: [...document.passenger_record_uids],
    passenger_id: null,
    passenger_name: "",
  };
}

export function passengerDocumentToUnified(
  passenger: PassengerDocumentOwner,
  document: PassengerDocumentLike,
): UnifiedDocumentMetadata {
  return {
    id: `passenger:${passenger.record_uid}:${document.id}`,
    source: "passenger",
    title: document.filename,
    filename: document.filename,
    mime: document.mime,
    size: document.size,
    category: document.category ?? "other",
    document_date: document.created_at.slice(0, 10),
    created_at: document.created_at,
    updated_at: document.created_at,
    work_file_id: "",
    passenger_record_uid: passenger.record_uid,
    passenger_record_uids: passenger.record_uid ? [passenger.record_uid] : [],
    passenger_id: passenger.id,
    passenger_name: passenger.full_name,
  };
}
