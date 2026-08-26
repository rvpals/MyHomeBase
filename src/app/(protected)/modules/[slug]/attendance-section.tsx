// Composes one Attendance section: the section nav, a heading with the
// section's description, and the section's own view. Data is loaded per section
// rather than all at once.
//
// A server component, so it can talk to `deps` directly and hand plain data to
// the client views. Mirrors journal-section.tsx and expense-section.tsx.

import { CollapsibleCard } from "@/components/collapsible-card";
import { Comments } from "@/components/comments";
import {
  ATTENDANCE_REPORT_FORMATS,
  buildAttendanceDetailReport,
  getAttendanceReport,
  getAttendanceReportById,
  getAttendanceSheet,
  listClasses,
  listRecordDatesForClass,
  listSessionsForClass,
  listStudentActions,
  listStudents,
  listStudentsInClass,
  resolveAttendanceSettings,
  type AttendanceReportFormat,
  type Student,
} from "@/lib/attendance";
import { listNamedMappings } from "@/lib/csv-import";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { todayIsoLocal } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { AttendanceActionsView } from "./attendance-actions-view";
import { AttendanceClassesView } from "./attendance-classes-view";
import { AttendanceConfigurationView } from "./attendance-configuration-view";
import { AttendanceHomeView } from "./attendance-home-view";
import { AttendanceShell } from "./attendance-shell";
import { AttendanceInstructions } from "./attendance-instructions";
import { AttendanceReportView } from "./attendance-report-view";
import { AttendanceRostersView } from "./attendance-rosters-view";
import { ATTENDANCE_SECTION_INFO, type AttendanceSection } from "./attendance-sections";

const ATTENDANCE_MODULE_SLUG = "attendance";

function loadSettings() {
  const attendanceModule = getModuleBySlug(deps.moduleRepo, ATTENDANCE_MODULE_SLUG);
  return resolveAttendanceSettings(
    attendanceModule ? listModuleSettingsFor(deps.moduleSettingsRepo, attendanceModule.id) : [],
  );
}

/**
 * The class a screen should open on: whatever the URL asks for, else the
 * configured default, else nothing.
 *
 * A configured default that names a deleted class is ignored rather than
 * throwing — deleting a class doesn't reach into the settings rows.
 */
function resolveSelectedClassId(
  requestedClassId: number | undefined,
  classes: { id: number }[],
  defaultClassId: number | undefined,
): number | undefined {
  const exists = (id: number | undefined) =>
    id !== undefined && classes.some((item) => item.id === id);

  if (exists(requestedClassId)) return requestedClassId;
  if (exists(defaultClassId)) return defaultClassId;
  return undefined;
}

function SectionBody({
  section,
  requestedClassId,
  requestedDate,
  requestedRecordId,
  requestedFormat,
}: {
  section: AttendanceSection;
  requestedClassId?: number;
  requestedDate?: string;
  requestedRecordId?: number;
  /** Raw `?format=`; validated here rather than in the route. */
  requestedFormat?: string;
}) {
  switch (section) {
    case "main": {
      const classes = listClasses(deps.attendanceRepo);
      const settings = loadSettings();
      const today = todayIsoLocal();
      const selectedClassId = resolveSelectedClassId(
        requestedClassId,
        classes,
        settings.defaultClassId,
      );

      return (
        <AttendanceHomeView
          classes={classes.map((item) => ({
            id: item.id,
            name: item.name,
            enrolledCount: item.enrolledCount,
          }))}
          sheet={
            selectedClassId
              ? getAttendanceSheet(deps.attendanceRepo, selectedClassId, today)
              : undefined
          }
          // Only pickable actions: the register must not offer one the teacher
          // has retired. The management screen asks for the retired ones too.
          actions={listStudentActions(deps.attendanceRepo)}
          selectedClassId={selectedClassId}
          today={today}
        />
      );
    }

    case "rosters":
      return (
        <AttendanceRostersView
          students={listStudents(deps.attendanceRepo)}
          classes={listClasses(deps.attendanceRepo)}
          importMappings={listNamedMappings(deps.csvImportMappingRepo, "Roster")}
        />
      );

    case "classes": {
      const classes = listClasses(deps.attendanceRepo);
      // Each class's roster, so the "Students" dialog opens with the list
      // already in hand rather than fetching per click.
      const rosterByClassId: Record<number, Student[]> = {};
      for (const item of classes) {
        rosterByClassId[item.id] = listStudentsInClass(deps.attendanceRepo, item.id);
      }

      return (
        <AttendanceClassesView
          classes={classes}
          students={listStudents(deps.attendanceRepo)}
          rosterByClassId={rosterByClassId}
        />
      );
    }

    case "actions":
      return (
        <AttendanceActionsView
          actions={listStudentActions(deps.attendanceRepo, { includeRetired: true })}
        />
      );

    case "report": {
      const classes = listClasses(deps.attendanceRepo);
      const settings = loadSettings();
      const selectedClassId = resolveSelectedClassId(
        requestedClassId,
        classes,
        settings.defaultClassId,
      );

      // An unrecognised ?format= reads as "brief" rather than failing: the value
      // comes off a URL a reader may have typed or truncated, and the default
      // shape is always a legitimate answer.
      const format: AttendanceReportFormat = ATTENDANCE_REPORT_FORMATS.includes(
        requestedFormat as AttendanceReportFormat,
      )
        ? (requestedFormat as AttendanceReportFormat)
        : "brief";

      // The whole-term grid. Read only for the detail format -- it pulls every
      // session the class has, which the brief sheet has no use for.
      const detailReport =
        format === "detail" && selectedClassId
          ? buildAttendanceDetailReport(deps.attendanceRepo, selectedClassId)
          : undefined;

      const sessions = selectedClassId
        ? listSessionsForClass(deps.attendanceRepo, selectedClassId)
        : [];
      const recordedDates = [...new Set(sessions.map((session) => session.attendanceDate))];

      // The URL wins; otherwise today, unless the reader has asked for the most
      // recent day with attendance instead.
      const fallbackDate =
        settings.reportDefaultsToToday || recordedDates.length === 0
          ? todayIsoLocal()
          : recordedDates[0];
      const selectedDate = requestedDate ?? fallbackDate;

      const sessionsOnDate = sessions.filter(
        (session) => session.attendanceDate === selectedDate,
      );

      // A specific session if the URL names one *and* it belongs to the selected
      // class and date — otherwise the day's latest. Checking membership rather
      // than trusting the id stops a hand-edited URL reporting another class's
      // register under this class's heading.
      const requestedSession =
        requestedRecordId !== undefined &&
        sessionsOnDate.some((session) => session.recordId === requestedRecordId)
          ? requestedRecordId
          : undefined;

      const report =
        !selectedClassId || format !== "brief"
          ? undefined
          : requestedSession !== undefined
            ? getAttendanceReportById(deps.attendanceRepo, requestedSession)
            : getAttendanceReport(deps.attendanceRepo, {
                classId: selectedClassId,
                attendanceDate: selectedDate,
              });

      return (
        <AttendanceReportView
          classes={classes}
          format={format}
          report={report}
          detailReport={detailReport}
          selectedClassId={selectedClassId}
          selectedDate={selectedDate}
          recordedDates={recordedDates}
          sessionsOnDate={sessionsOnDate}
        />
      );
    }

    case "configuration":
      return (
        <AttendanceConfigurationView
          settings={loadSettings()}
          classes={listClasses(deps.attendanceRepo)}
        />
      );

    default:
      return null;
  }
}

export async function AttendanceSection({
  section,
  requestedClassId,
  requestedDate,
  requestedRecordId,
  requestedFormat,
}: {
  section: AttendanceSection;
  /** From ?classId= — which class the home screen and report open on. */
  requestedClassId?: number;
  /** From ?date= — which day the report shows. */
  requestedDate?: string;
  /** From ?recordId= — which of the day's sessions the report shows. */
  requestedRecordId?: number;
  /** Raw `?format=`; validated here rather than in the route. */
  requestedFormat?: string;
}) {
  // Defensive: an unknown section would otherwise crash on info.label. The route
  // already validates, so this only catches a future caller getting it wrong.
  const info = ATTENDANCE_SECTION_INFO[section] ?? ATTENDANCE_SECTION_INFO.main;

  return (
    // The two-tier shell: a module rail, a section panel and a utility header,
    // all placed by `AttendanceShell`. See design.md, "Navigation: the two-tier
    // shell".
    //
    // `async` because the shell reads cookies for the session and the pinned
    // layout, which `next/headers` only exposes as a promise.
    <AttendanceShell>
      <h2 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
        {info.label}
        {/* On the home screen the instruction rides beside the title as a chip
            rather than filling a card above the register. The register is the
            reason a teacher is on this screen every morning, and after the first
            week the guidance is read once and then in the way — a chip costs a
            line of nothing and keeps the register at the top of the page. Every
            other section keeps the card, where the copy is genuinely reference
            material rather than a reminder. */}
        {section === "main" && (
          <Comments
            title="Instruction"
            content={<AttendanceInstructions section={section} />}
          />
        )}
      </h2>
      <p className="mt-1 text-sm text-muted">{info.description}</p>
      <div className="mt-3 h-px w-full bg-line" />

      {/* No `no-print` needed: everything outside `.print-sheet` is already
          hidden by the @media print block in globals.css. */}
      {section !== "main" && (
        <div className="mt-6">
          <CollapsibleCard title="Instruction">
            <AttendanceInstructions section={section} />
          </CollapsibleCard>
        </div>
      )}

      <div className="mt-6">
        <SectionBody
          section={section}
          requestedClassId={requestedClassId}
          requestedDate={requestedDate}
          requestedRecordId={requestedRecordId}
          requestedFormat={requestedFormat}
        />
      </div>
    </AttendanceShell>
  );
}
