"use server";

// Thin adapters for the roster CSV import: read a file's text, hand it to the
// lib use-case, revalidate. No parsing or business logic here — that all lives in
// @/lib/attendance/csv-import. Mirrors journal-import-actions.ts.

import { revalidatePath } from "next/cache";
import {
  autoMapAttendanceHeaders,
  importAttendanceRoster,
  type RosterImportResult,
} from "@/lib/attendance";
import {
  createNamedMapping,
  deleteNamedMapping,
  listNamedMappings,
  previewCsv,
  updateNamedMapping,
  type ColumnMapping,
  type CsvPreview,
  type FieldOptionsMap,
  type NamedMapping,
} from "@/lib/csv-import";
import { deps } from "@/lib/wiring";

const ATTENDANCE_MODULE_PATH = "/modules/attendance";
const ROSTER_IMPORT_TYPE = "Roster" as const;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/** Every section a roster import touches: the roster itself, and Classes. */
function revalidateAttendance(): void {
  revalidatePath(ATTENDANCE_MODULE_PATH);
  revalidatePath(`${ATTENDANCE_MODULE_PATH}/rosters`);
  revalidatePath(`${ATTENDANCE_MODULE_PATH}/classes`);
}

export interface RosterPreviewResult extends ActionResult {
  preview?: CsvPreview;
  /** Mapping guessed from the file's headers, offered as a starting point. */
  autoMapping?: ColumnMapping;
  autoFieldOptions?: FieldOptionsMap;
  namedMappings?: NamedMapping[];
}

export async function previewRosterCsvAction(fileText: string): Promise<RosterPreviewResult> {
  try {
    const preview = previewCsv(fileText);
    const { columnMapping, fieldOptions } = autoMapAttendanceHeaders(preview.headers);
    return {
      ok: true,
      preview,
      autoMapping: columnMapping,
      autoFieldOptions: fieldOptions,
      namedMappings: listNamedMappings(deps.csvImportMappingRepo, ROSTER_IMPORT_TYPE),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to preview CSV.");
  }
}

export async function saveRosterMappingAction(
  name: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
): Promise<ActionResult> {
  try {
    createNamedMapping(deps.csvImportMappingRepo, {
      name,
      importType: ROSTER_IMPORT_TYPE,
      columnMapping,
      fieldOptions,
    });
  } catch (error) {
    return toErrorResult(error, "Failed to save mapping.");
  }
  revalidatePath(`${ATTENDANCE_MODULE_PATH}/rosters`);
  return { ok: true };
}

export async function updateRosterMappingAction(
  id: number,
  name: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
): Promise<ActionResult> {
  try {
    updateNamedMapping(deps.csvImportMappingRepo, id, { name, columnMapping, fieldOptions });
  } catch (error) {
    return toErrorResult(error, "Failed to update mapping.");
  }
  revalidatePath(`${ATTENDANCE_MODULE_PATH}/rosters`);
  return { ok: true };
}

export async function deleteRosterMappingAction(id: number): Promise<ActionResult> {
  try {
    deleteNamedMapping(deps.csvImportMappingRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete mapping.");
  }
  revalidatePath(`${ATTENDANCE_MODULE_PATH}/rosters`);
  return { ok: true };
}

export interface RosterImportActionResult extends ActionResult {
  summary?: RosterImportResult;
}

export async function runRosterImportAction(
  fileText: string,
  className: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
): Promise<RosterImportActionResult> {
  try {
    const summary = importAttendanceRoster(deps.attendanceRepo, fileText, {
      className,
      columnMapping,
      fieldOptions,
    });
    revalidateAttendance();
    return { ok: true, summary };
  } catch (error) {
    return toErrorResult(error, "Failed to import the roster.");
  }
}
