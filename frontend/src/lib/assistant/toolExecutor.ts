/**
 * Runs Claude's tool calls against the encrypted local vault.
 *
 * This is the only place the assistant touches operational data, and the only
 * place the pseudonymity rule is actually enforced: the server publishes
 * schemas that have no field for a name or passport number, but nothing stops
 * a projection here from putting one in a result string. Every projection in
 * this file is therefore an explicit allowlist of non-identifying fields --
 * never a spread of the record.
 */

import {
  Passenger,
  createWorkspaceNote,
  createWorkspaceTask,
  deletePassenger,
  fetchPassengers,
  fetchSummary,
  fetchWorkFiles,
  fetchWorkspaceTasks,
  mergeDuplicates,
  toggleWorkspaceTask,
  updatePassenger,
} from "@/lib/api";
import type { DateScope } from "@/lib/api";
import { forgetFact, listMemories, rememberFact } from "@/lib/assistant/memory";

export type AssistantToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  writes: boolean;
  confirm: boolean;
};

export type AssistantToolResult = {
  tool_use_id: string;
  content: string;
  is_error: boolean;
};

const PASSENGER_PREFIX = "p_";
const TASK_PREFIX = "t_";
const MEMORY_PREFIX = "m_";

/** Fields the model may never receive, guarded at the point of projection. */
const MAX_RESULT_ITEMS = 100;

export class AssistantToolError extends Error {}

function passengerRef(passenger: Passenger): string {
  return `${PASSENGER_PREFIX}${passenger.id}`;
}

function passengerId(ref: unknown): number {
  const text = String(ref ?? "");
  if (!text.startsWith(PASSENGER_PREFIX)) {
    throw new AssistantToolError(`Geçersiz yolcu referansı: ${text.slice(0, 32)}`);
  }
  const id = Number.parseInt(text.slice(PASSENGER_PREFIX.length), 10);
  if (!Number.isInteger(id)) {
    throw new AssistantToolError(`Geçersiz yolcu referansı: ${text.slice(0, 32)}`);
  }
  return id;
}

function taskId(ref: unknown): string {
  const text = String(ref ?? "");
  if (!text.startsWith(TASK_PREFIX) || text.length <= TASK_PREFIX.length) {
    throw new AssistantToolError(`Geçersiz görev referansı: ${text.slice(0, 32)}`);
  }
  return text.slice(TASK_PREFIX.length);
}

/**
 * Project a passenger down to what the model is allowed to reason about.
 * Name, passport number, voucher, fees, filenames and photos are all omitted:
 * the model works with the reference and the operational state.
 */
function projectPassenger(passenger: Passenger) {
  return {
    ref: passengerRef(passenger),
    departure: passenger.departure_date || "",
    arrival: passenger.arrival_date || "",
    record_date: passenger.record_date || "",
    status: passenger.record_status,
    issues: passenger.issues ?? [],
    duplicate: Boolean(passenger.duplicate),
    has_photo: Boolean(passenger.photo),
    document_count: passenger.documents?.length ?? 0,
  };
}

function scopeFrom(input: Record<string, unknown>, fallback: DateScope): DateScope {
  const scope = input.scope as { range?: string } | undefined;
  if (!scope?.range) return fallback;
  return { ...fallback, range: scope.range as DateScope["range"] };
}

function limitFrom(input: Record<string, unknown>): number {
  const raw = Number(input.limit ?? 25);
  if (!Number.isFinite(raw)) return 25;
  return Math.max(1, Math.min(MAX_RESULT_ITEMS, Math.trunc(raw)));
}

/** Map a flag the model set onto the stored field that represents it. */
function flagUpdates(flags: Record<string, unknown>): Partial<Passenger> {
  const updates: Partial<Passenger> = {};
  if (typeof flags.has_passport === "boolean") {
    // An empty passport field is what "missing" means in the vault; the model
    // may only clear it, never invent a number.
    if (!flags.has_passport) updates.passport_no = "";
  }
  if (typeof flags.has_voucher === "boolean") {
    if (!flags.has_voucher) updates.voucher = "";
  }
  if (Object.keys(updates).length === 0) {
    throw new AssistantToolError(
      "Bu bayrak kasada doğrudan güncellenemiyor; fotoğraf ve ücret alanları uygulama üzerinden değiştirilir.",
    );
  }
  return updates;
}

async function run(
  call: AssistantToolCall,
  dateScope: DateScope,
): Promise<unknown> {
  const input = (call.input ?? {}) as Record<string, unknown>;

  switch (call.name) {
    case "dashboard_summary": {
      const summary = await fetchSummary(scopeFrom(input, dateScope));
      return {
        passenger_count: summary.passenger_count,
        ready_count: summary.ready_count,
        missing_count: summary.missing_count,
        readiness_percent: summary.readiness_percent,
        with_photo: summary.with_photo,
        duplicates: summary.duplicates,
      };
    }
    case "search_passengers": {
      const issue = typeof input.issue === "string" ? input.issue : "";
      const passengers = await fetchPassengers({ scope: scopeFrom(input, dateScope) });
      const matching = issue
        ? passengers.filter((passenger) => (
          issue === "duplicate" ? passenger.duplicate : passenger.issues?.includes(issue)
        ))
        : passengers;
      return {
        total: matching.length,
        // Bounded so a large vault cannot blow the request budget.
        passengers: matching.slice(0, limitFrom(input)).map(projectPassenger),
      };
    }
    case "get_passenger_checklist": {
      const id = passengerId(input.ref);
      const passenger = (await fetchPassengers({})).find((item) => item.id === id);
      if (!passenger) throw new AssistantToolError("Yolcu bulunamadı.");
      return projectPassenger(passenger);
    }
    case "passenger_statistics": {
      const passengers = await fetchPassengers({ scope: scopeFrom(input, dateScope) });
      const counts: Record<string, number> = { duplicate: 0 };
      for (const passenger of passengers) {
        if (passenger.duplicate) counts.duplicate += 1;
        for (const issue of passenger.issues ?? []) {
          counts[issue] = (counts[issue] ?? 0) + 1;
        }
      }
      return { total: passengers.length, issues: counts };
    }
    case "list_document_metadata": {
      const id = passengerId(input.ref);
      const passenger = (await fetchPassengers({})).find((item) => item.id === id);
      if (!passenger) throw new AssistantToolError("Yolcu bulunamadı.");
      // Type and size only: filenames can carry a passport number or a name.
      return {
        ref: passengerRef(passenger),
        documents: (passenger.documents ?? []).map((document) => ({
          category: document.category ?? "",
          size_bytes: document.size ?? 0,
          created_at: document.created_at ?? "",
        })),
      };
    }
    case "list_tasks": {
      const status = typeof input.status === "string" ? input.status : "all";
      const tasks = await fetchWorkspaceTasks({});
      const matching = tasks.filter((task) => (
        status === "all" ? true : status === "done" ? task.status === "done" : task.status !== "done"
      ));
      return {
        total: matching.length,
        tasks: matching.slice(0, limitFrom(input)).map((task) => ({
          ref: `${TASK_PREFIX}${task.id}`,
          title: task.title,
          status: task.status,
          due_at: task.due_at ?? "",
        })),
      };
    }
    case "list_work_files": {
      const workFiles = await fetchWorkFiles({});
      return {
        total: workFiles.length,
        work_files: workFiles.slice(0, limitFrom(input)).map((workFile) => ({
          ref: `w_${workFile.id}`,
          title: workFile.title,
          status: workFile.status,
        })),
      };
    }

    // ------------------------------------------------------------- memory
    case "remember": {
      const entry = await rememberFact(String(input.text ?? ""));
      return { ok: true, ref: `${MEMORY_PREFIX}${entry.id}` };
    }
    case "forget": {
      const text = String(input.ref ?? "");
      if (!text.startsWith(MEMORY_PREFIX)) {
        throw new AssistantToolError(`Geçersiz hatıra referansı: ${text.slice(0, 32)}`);
      }
      const removed = await forgetFact(text.slice(MEMORY_PREFIX.length));
      if (!removed) throw new AssistantToolError("Böyle bir hatıra yok.");
      return { ok: true };
    }

    // ------------------------------------------------------------- writes
    case "update_passenger_flags": {
      const id = passengerId(input.ref);
      const flags = (input.flags ?? {}) as Record<string, unknown>;
      await updatePassenger(id, flagUpdates(flags));
      return { ok: true, ref: `${PASSENGER_PREFIX}${id}` };
    }
    case "create_task": {
      const title = String(input.title ?? "").trim();
      if (!title) throw new AssistantToolError("Görev başlığı boş olamaz.");
      const task = await createWorkspaceTask({
        title,
        description: String(input.detail ?? "").trim(),
      });
      return { ok: true, ref: `${TASK_PREFIX}${task.id}` };
    }
    case "complete_task": {
      const id = taskId(input.ref);
      await toggleWorkspaceTask(id, true);
      return { ok: true, ref: `${TASK_PREFIX}${id}` };
    }
    case "create_note": {
      const title = String(input.title ?? "").trim();
      if (!title) throw new AssistantToolError("Not başlığı boş olamaz.");
      // Notes in the vault carry a body only, so the title becomes its first
      // line rather than being silently dropped.
      const body = String(input.body ?? "").trim();
      const note = await createWorkspaceNote({
        body: body ? `${title}\n\n${body}` : title,
      });
      return { ok: true, ref: `n_${note.id}` };
    }
    case "delete_passenger": {
      const id = passengerId(input.ref);
      const result = await deletePassenger(id);
      return { ok: true, passenger_count: result.passenger_count ?? null };
    }
    case "merge_duplicates": {
      const result = await mergeDuplicates(String(input.passport_key ?? ""));
      return { ok: true, removed: result.removed, passenger_count: result.passenger_count };
    }
    default:
      throw new AssistantToolError(`Bilinmeyen araç: ${call.name.slice(0, 40)}`);
  }
}

/**
 * Execute one call and shape it as a tool result.
 *
 * A failure is reported back to the model rather than thrown: the model can
 * then choose another approach, which is what `is_error` exists for. Only the
 * message is returned -- never a stack, which could carry vault contents.
 */
export async function executeAssistantTool(
  call: AssistantToolCall,
  dateScope: DateScope,
): Promise<AssistantToolResult> {
  try {
    const output = await run(call, dateScope);
    return { tool_use_id: call.id, content: JSON.stringify(output), is_error: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Araç çalıştırılamadı.";
    return {
      tool_use_id: call.id,
      content: message.slice(0, 400),
      is_error: true,
    };
  }
}

/** Human-readable summary of a pending call, for the confirmation prompt. */
export function describeToolCall(call: AssistantToolCall): string {
  const input = (call.input ?? {}) as Record<string, unknown>;
  switch (call.name) {
    case "delete_passenger":
      return `${String(input.ref ?? "")} numaralı yolcu kaydını kalıcı olarak silecek.`;
    case "merge_duplicates":
      return "Yinelenen yolcu kayıtlarını birleştirecek. Bu işlem geri alınamaz.";
    default:
      return `${call.name} çalıştırılacak.`;
  }
}
