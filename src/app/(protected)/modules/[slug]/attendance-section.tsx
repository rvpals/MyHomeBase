// Composes one Attendance section: the section nav, a heading with the
// section's description, and the section's own view. Data is loaded per section
// rather than all at once.
//
// A server component, so it can talk to `deps` directly and hand plain data to
// the client views. Mirrors journal-section.tsx and expense-section.tsx.

import { CollapsibleCard } from "@/components/collapsible-card";
import {
  getAttendanceReport,
  getAttendanceSheet,
  listClasses,
  listRecordDatesForClass,
  listStudents,
  listStudentsInClass,
  resolveAttendanceSettings,
  type Student,
} from "@/lib/attendance";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { todayIsoLocal } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { AttendanceClassesView } from "./attendance-classes-view";
import { AttendanceConfigurationView } from "./attendance-configuration-view";
import { AttendanceHomeView } from "./attendance-home-view";
import { AttendanceInstructions } from "./attendance-instructions";
import { AttendanceReportView } from "./attendance-report-view";
import { AttendanceRostersView } from "./attendance-rosters-view";
import { ATTENDANCE_SECTION_INFO, type AttendanceSection } from "./attendance-sections";
import { SectionLayout } from "./section-layout";

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
}: {
  section: AttendanceSection;
  requestedClassId?: number;
  requestedDate?: string;
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

    case "report": {
      const classes = listClasses(deps.attendanceRepo);
      const settings = loadSettings();
      const selectedClassId = resolveSelectedClassId(
        requestedClassId,
        classes,
        settings.defaultClassId,
      );

      const recordedDates = selectedClassId
        ? listRecordDatesForClass(deps.attendanceRepo, selectedClassId)
        : [];

      // The URL wins; otherwise today, unless the reader has asked for the most
      // recent day with attendance instead.
      const fallbackDate =
        settings.reportDefaultsToToday || recordedDates.length === 0
          ? todayIsoLocal()
          : recordedDates[0];
      const selectedDate = requestedDate ?? fallbackDate;

      return (
        <AttendanceReportView
          classes={classes}
          report={
            selectedClassId
              ? getAttendanceReport(deps.attendanceRepo, {
                  classId: selectedClassId,
                  attendanceDate: selectedDate,
                })
              : undefined
          }
          selectedClassId={selectedClassId}
          selectedDate={selectedDate}
          recordedDates={recordedDates}
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

export function AttendanceSection({
  section,
  requestedClassId,
  requestedDate,
}: {
  section: AttendanceSection;
  /** From ?classId= — which class the home screen and report open on. */
  requestedClassId?: number;
  /** From ?date= — which day the report shows. */
  requestedDate?: string;
}) {
  // Defensive: an unknown section would otherwise crash on info.label. The route
  // already validates, so this only catches a future caller getting it wrong.
  const info = ATTENDANCE_SECTION_INFO[section] ?? ATTENDANCE_SECTION_INFO.main;
  // Badged at the head of the nav so the reader can see which module they're
  // in. Read here rather than in `AttendanceNav` because both fields are
  // admin-editable, and the nav is a client component.
  const appModule = getModuleBySlug(deps.moduleRepo, ATTENDANCE_MODULE_SLUG);

  return (
    // The nav/body split lives in SectionLayout: it's a bar in `full` and a
    // column in `rail`/`strip`, so which way this lays out is client state that
    // a server component can't hold.
    <SectionLayout
      nav="attendance"
      module={appModule && { name: appModule.shortName, icon: appModule.icon }}
    >
      <h2 className="font-display text-2xl font-semibold text-ink">{info.label}</h2>
      <p className="mt-1 text-sm text-muted">{info.description}</p>
      <div className="mt-3 h-px w-full bg-line" />

      {/* No `no-print` needed: everything outside `.print-sheet` is already
          hidden by the @media print block in globals.css. */}
      <div className="mt-6">
        <CollapsibleCard title="Instruction">
          <AttendanceInstructions section={section} />
        </CollapsibleCard>
      </div>

      <div className="mt-6">
        <SectionBody
          section={section}
          requestedClassId={requestedClassId}
          requestedDate={requestedDate}
        />
      </div>
    </SectionLayout>
  );
}
