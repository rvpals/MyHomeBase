"use client";

// Taking attendance: pick a class from the dropdown, tap the students who are
// here, note anything about the day with the ⚡ button, save.
//
// Nobody is marked to begin with. Tapping toggles a student present, and at save
// time everyone still unmarked is recorded absent — so the screen starts empty
// without a saved session ever being ambiguous about who was missing.
//
// The ⚡ button opens the action picker for one student: Late, Extra Credit, or
// whatever else the Student actions screen holds. Actions are independent of
// present/absent — a student can be marked late while still absent (they never
// turned up and the register notes why) — so the picker never touches the status.
//
// Each save is its own timestamped session, so a class registered twice in a day
// keeps both. Earlier sessions show above the sheet as history.
//
// The tap list is one-off UI for this screen rather than a registered component —
// nothing else in the app marks a list of people present. If a second caller
// appears, that's the moment to promote it.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AttendanceActionIcon } from "@/components/attendance-action-icon";
import { Button } from "@/components/button";
import { Comments } from "@/components/comments";
import { Modal } from "@/components/modal";
import type {
  AttendanceSheet,
  AttendanceStatus,
  Student,
  StudentAction,
} from "@/lib/attendance";
import { saveAttendanceAction } from "./attendance-actions";

const SELECT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted";

/**
 * A student's name on the register.
 *
 * The display face, bold and italic and a size up from the rest of the row — the
 * name is what a teacher's eye is scanning for, so it gets the emphasis and the
 * identifiers around it stay quiet. `font-display` rather than a handwriting
 * face: design.md restricts type to the theme's display/body/mono trio, and a
 * fourth family would be the one thing on the page that ignores the theme.
 */
const NAME_CLASS = "font-display text-lg font-bold italic text-ink";

/** Same, sized for a card in the grid — `.tile-grid` keeps those 5–7rem wide. */
const CARD_NAME_CLASS = "font-display text-[13px] font-bold italic leading-tight text-ink";

/** Which layout the register uses. Persisted, so it survives a reload. */
type RegisterView = "list" | "card";

const VIEW_STORAGE_KEY = "myhomebase:attendance-register-view";

/** A student's display name. Mirrors `formatStudentName` in the lib. */
function studentName(student: Student): string {
  return `${student.firstName} ${student.lastName}`.trim();
}

export function AttendanceHomeView({
  classes,
  sheet,
  actions,
  selectedClassId,
  today,
}: {
  classes: { id: number; name: string; enrolledCount: number }[];
  /** The chosen class's roster, or undefined when no class is selected. */
  sheet?: AttendanceSheet;
  /** The pickable actions, in catalog order. Empty is a valid state. */
  actions: StudentAction[];
  selectedClassId?: number;
  /** Today, as the server's local calendar day. */
  today: string;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6">
      {classes.length > 0 && (
        <label className="flex max-w-sm flex-col gap-1">
          <span className={LABEL_CLASS}>Class</span>
          {/* The selection lives in the URL, so a teacher can bookmark their
              first-period register and land straight on it. */}
          <select
            value={selectedClassId ?? ""}
            onChange={(event) =>
              router.push(
                event.target.value
                  ? `/modules/attendance?classId=${event.target.value}`
                  : "/modules/attendance",
              )
            }
            className={SELECT_CLASS}
          >
            <option value="">Pick a class…</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.enrolledCount})
              </option>
            ))}
          </select>
        </label>
      )}

      {sheet ? (
        <RegisterPanel
          key={`${sheet.classId}:${sheet.attendanceDate}`}
          sheet={sheet}
          actions={actions}
          today={today}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          {classes.length === 0
            ? "No classes yet — create one on the Classes screen first."
            : "Pick a class above to start taking attendance."}
        </p>
      )}
    </div>
  );
}

/**
 * The register: a titled container holding the view switch and the student list.
 */
function RegisterPanel({
  sheet,
  actions,
  today,
}: {
  sheet: AttendanceSheet;
  actions: StudentAction[];
  today: string;
}) {
  // Nobody starts marked — the whole point of the change. Unmarked and absent
  // are the same stored fact, so this is a set of who is *here*.
  const [presentIds, setPresentIds] = useState<Set<number>>(new Set());
  // studentId -> the action ids noted for them. Absent from the map means none,
  // which is the common case for most of a register.
  const [actionIdsByStudentId, setActionIdsByStudentId] = useState<Map<number, Set<number>>>(
    new Map(),
  );
  // Which student's action picker is open, if any.
  const [pickerStudentId, setPickerStudentId] = useState<number>();
  const [view, setView] = useState<RegisterView>("list");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  const actionsById = useMemo(
    () => new Map(actions.map((action) => [action.id, action])),
    [actions],
  );

  // Read in an effect rather than in the initializer: touching localStorage
  // during the first render makes the server and client markup disagree.
  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "list" || stored === "card") setView(stored);
  }, []);

  function chooseView(next: RegisterView) {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  function toggle(studentId: number) {
    setPresentIds((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
    setMessage(undefined);
  }

  /**
   * Notes or un-notes one action for one student.
   *
   * Deliberately does *not* touch the present/absent mark. "Late" on someone who
   * never arrived is a real thing a teacher records, so the two facts stay
   * independent — the same independence the stored model has.
   */
  function toggleAction(studentId: number, actionId: number) {
    setActionIdsByStudentId((current) => {
      const next = new Map(current);
      const forStudent = new Set(next.get(studentId) ?? []);

      if (forStudent.has(actionId)) forStudent.delete(actionId);
      else forStudent.add(actionId);

      // Drop the entry entirely rather than leaving an empty set behind, so the
      // map's size is a truthful count of who has something noted.
      if (forStudent.size === 0) next.delete(studentId);
      else next.set(studentId, forStudent);

      return next;
    });
    setMessage(undefined);
  }

  function handleSave() {
    setError(undefined);
    setMessage(undefined);

    // Everyone enrolled gets a row: present if marked, absent otherwise, with
    // whatever actions were noted for them.
    const entries = sheet.students.map((student) => ({
      studentId: student.id,
      status: (presentIds.has(student.id) ? "present" : "absent") as AttendanceStatus,
      actionIds: [...(actionIdsByStudentId.get(student.id) ?? [])],
    }));

    const notedCount = entries.filter((entry) => entry.actionIds.length > 0).length;

    startTransition(async () => {
      const result = await saveAttendanceAction({
        classId: sheet.classId,
        attendanceDate: sheet.attendanceDate,
        entries,
      });

      if (result.ok) {
        setMessage(
          `Saved${result.sessionLabel ? ` session ${result.sessionLabel}` : ""} — ${presentIds.size} present, ${entries.length - presentIds.size} absent${
            notedCount > 0 ? `, ${notedCount} with an action noted` : ""
          }.`,
        );
        // A saved session is history now; clear the sheet so the next register
        // starts empty rather than inheriting the last one's marks.
        setPresentIds(new Set());
        setActionIdsByStudentId(new Map());
      } else {
        setError(result.error);
      }
    });
  }

  const title = `Attendance for "${sheet.className}" on ${sheet.attendanceDate}`;

  if (sheet.students.length === 0) {
    return (
      <section className="rounded-xl border border-line">
        <header className="border-b border-line px-4 py-3">
          <h3 className="font-display text-lg text-ink">{title}</h3>
        </header>
        <p className="p-8 text-center text-sm text-muted">
          {sheet.className} has no students yet — add some from the Rosters screen.
        </p>
      </section>
    );
  }

  const pickerStudent = sheet.students.find((student) => student.id === pickerStudentId);

  const registerProps: RegisterProps = {
    students: sheet.students,
    presentIds,
    actionIdsByStudentId,
    actionsById,
    hasActions: actions.length > 0,
    onToggle: toggle,
    onOpenActions: setPickerStudentId,
    isPending,
  };

  return (
    <section className="rounded-xl border border-line">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <h3 className="font-display text-lg text-ink">{title}</h3>
        <Comments
          title="How to take attendance"
          content={
            <div className="flex flex-col gap-2">
              <p>
                Nobody is marked to begin with. Tap a student to mark them present; anyone left
                unmarked is saved as absent.
              </p>
              <p>
                The ⚡ button on a student notes what happened to them today — late, extra
                credit, or anything else on the Student actions screen. An action is
                independent of present and absent, so you can mark someone late whether or not
                they turned up. Noted actions show as code chips on the student and are saved
                with the session.
              </p>
              <p>
                Each save is its own session, so registering the same class twice in a day keeps
                both rather than replacing the earlier one.
              </p>
            </div>
          }
        />
        <span className="flex-1" />
        <p className="text-sm text-muted">
          {presentIds.size} of {sheet.students.length} present
        </p>
        <ViewSwitch view={view} onChange={chooseView} />
      </header>

      <div className="flex flex-col gap-4 p-4">
        {sheet.attendanceDate !== today && (
          <p className="rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-muted">
            This is {sheet.attendanceDate}, not today.
          </p>
        )}

        {sheet.sessions.length > 0 && <SessionHistory sheet={sheet} />}

        {view === "list" ? <ListView {...registerProps} /> : <CardView {...registerProps} />}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save attendance"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setPresentIds(new Set(sheet.students.map((student) => student.id)))}
            disabled={isPending}
          >
            Mark all present
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setPresentIds(new Set());
              setActionIdsByStudentId(new Map());
            }}
            disabled={isPending}
          >
            Clear
          </Button>
          {message && <p className="text-sm text-emerald-400">{message}</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>

      {pickerStudent && (
        <ActionPicker
          student={pickerStudent}
          actions={actions}
          selectedIds={actionIdsByStudentId.get(pickerStudent.id) ?? new Set()}
          onToggle={(actionId) => toggleAction(pickerStudent.id, actionId)}
          onClose={() => setPickerStudentId(undefined)}
        />
      )}
    </section>
  );
}

/** List ↔ Card. A two-button segmented control, not a select — there are two. */
function ViewSwitch({
  view,
  onChange,
}: {
  view: RegisterView;
  onChange: (next: RegisterView) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-line">
      {(["list", "card"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={view === option}
          className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
            view === option
              ? "bg-brass text-paper"
              : "bg-paper text-muted hover:text-ink"
          }`}
        >
          {option} view
        </button>
      ))}
    </div>
  );
}

/** Sessions already saved today — history, since a save never replaces one. */
function SessionHistory({ sheet }: { sheet: AttendanceSheet }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={LABEL_CLASS}>
        Already saved today ({sheet.sessions.length})
      </span>
      {sheet.sessions.map((session) => {
        const present = session.entries.filter((entry) => entry.status === "present").length;
        // Every action noted in that session, so history shows what was recorded
        // and not just how many turned up.
        const codes = [
          ...new Set(session.entries.flatMap((entry) => entry.actions.map((a) => a.code))),
        ];
        return (
          <span
            key={session.id}
            className="rounded-md bg-brass-soft px-2 py-0.5 font-mono text-xs text-brass-dark"
            title={`Recorded ${session.recordedAt}`}
          >
            {session.sessionLabel} · {present}/{session.entries.length} present
            {codes.length > 0 && ` · ${codes.join(" ")}`}
          </span>
        );
      })}
    </div>
  );
}

interface RegisterProps {
  students: Student[];
  presentIds: Set<number>;
  /** studentId -> the action ids noted for them this session. */
  actionIdsByStudentId: Map<number, Set<number>>;
  actionsById: Map<number, StudentAction>;
  /** Whether the catalog holds anything. False hides the ⚡ button entirely. */
  hasActions: boolean;
  onToggle: (studentId: number) => void;
  onOpenActions: (studentId: number) => void;
  isPending: boolean;
}

/**
 * The ⚡ button that opens one student's action picker.
 *
 * A sibling of the student's tap target rather than inside it — nesting a button
 * in a button is invalid HTML, and the outer one would swallow the tap. That's
 * why each row is a flex container holding two buttons instead of one big one.
 *
 * `h-11 w-11` is 44px, the tap-target floor, at every breakpoint. This is the
 * secondary control on the row, so it stays a quiet outline until something is
 * noted, when it takes the accent to say so at a glance.
 */
function ActionButton({
  count,
  onClick,
  disabled,
  studentLabel,
  compact = false,
}: {
  count: number;
  onClick: () => void;
  disabled: boolean;
  studentLabel: string;
  compact?: boolean;
}) {
  const noted = count > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={noted ? `${count} action${count === 1 ? "" : "s"} noted` : "Note an action"}
      aria-label={`Note an action for ${studentLabel}`}
      className={`flex shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-60 ${
        compact ? "h-6 w-6 text-[11px]" : "h-11 w-11 text-base"
      } ${
        noted
          ? "border-brass bg-brass text-paper"
          : "border-line bg-paper text-muted hover:border-brass hover:text-ink"
      }`}
    >
      {/* The lightning bolt. A glyph rather than an SVG: it's a character in
          every font we ship, and it needs no new icon concept. */}
      <span aria-hidden="true">⚡</span>
    </button>
  );
}

/** The code chips for what a student has picked up, in catalog order. */
function ActionChips({
  actionIds,
  actionsById,
  compact = false,
}: {
  actionIds: Set<number>;
  actionsById: Map<number, StudentAction>;
  compact?: boolean;
}) {
  if (actionIds.size === 0) return null;

  // Catalog order, not click order, so the same two actions always read the same
  // way — matching how the report prints them.
  const chosen = [...actionsById.values()].filter((action) => actionIds.has(action.id));

  return (
    <span className={`flex flex-wrap items-center ${compact ? "gap-0.5" : "gap-1"}`}>
      {chosen.map((action) => (
        <span
          key={action.id}
          title={action.description || action.name}
          className={`flex items-center gap-0.5 rounded bg-brass-soft font-mono font-semibold text-brass-dark ${
            compact ? "px-1 text-[9px]" : "px-1.5 py-0.5 text-[11px]"
          }`}
        >
          <AttendanceActionIcon
            name={action.icon}
            className={compact ? "h-2.5 w-2.5" : "h-3 w-3"}
          />
          {action.code}
        </span>
      ))}
    </span>
  );
}

/** The long thin strip per student. One column on a phone, two once there's room. */
function ListView({
  students,
  presentIds,
  actionIdsByStudentId,
  actionsById,
  hasActions,
  onToggle,
  onOpenActions,
  isPending,
}: RegisterProps) {
  return (
    <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      {students.map((student) => {
        const isPresent = presentIds.has(student.id);
        const actionIds = actionIdsByStudentId.get(student.id) ?? new Set<number>();
        const name = studentName(student);

        return (
          <li key={student.id}>
            {/* The row is a container of two controls, not one control — see
                ActionButton on why the ⚡ can't nest inside the tap target. */}
            <div
              className={`flex items-center gap-2 rounded-xl border pr-2 transition-colors ${
                isPresent
                  ? "border-brass bg-brass-soft"
                  : "border-line bg-paper-raised hover:border-brass"
              }`}
            >
              <button
                type="button"
                onClick={() => onToggle(student.id)}
                aria-pressed={isPresent}
                disabled={isPending}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl px-4 py-3 text-left disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className={`block truncate ${NAME_CLASS}`}>{name}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    {student.studentIdentifier && (
                      <span className="truncate font-mono text-xs text-muted">
                        {student.studentIdentifier}
                      </span>
                    )}
                    <ActionChips actionIds={actionIds} actionsById={actionsById} />
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wide ${
                    isPresent ? "bg-brass text-paper" : "text-muted"
                  }`}
                >
                  {isPresent ? "Present" : "—"}
                </span>
              </button>

              {hasActions && (
                <ActionButton
                  count={actionIds.size}
                  onClick={() => onOpenActions(student.id)}
                  disabled={isPending}
                  studentLabel={name}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A little playing card per student.
 *
 * `aspect-[3/4]` is the poker-card proportion, which is what makes a grid of
 * these read as a hand of cards rather than a wall of tiles.
 *
 * The column count is `.tile-grid`'s (globals.css), not a breakpoint ladder:
 * each card is 5–7rem wide and the browser fits as many as the width allows.
 * That keeps a card the same size on a 402px phone as on a 1440px desktop —
 * where the old `grid-cols-4 sm:6 lg:10` gave a phone ~85px cards and a desktop
 * ~120px ones — and it never leaves a part-card cut off at the edge.
 *
 * The ⚡ sits in the top-right corner opposite the P pip, as a 24px button. Below
 * the 44px floor on purpose: the card itself is the primary target and the corner
 * control is a deliberate, aimed tap — the same trade the corner pip already
 * makes. On a phone the list view is the better register anyway, and it has the
 * full-size button.
 */
function CardView({
  students,
  presentIds,
  actionIdsByStudentId,
  actionsById,
  hasActions,
  onToggle,
  onOpenActions,
  isPending,
}: RegisterProps) {
  return (
    <ul className="tile-grid gap-2">
      {students.map((student) => {
        const isPresent = presentIds.has(student.id);
        const actionIds = actionIdsByStudentId.get(student.id) ?? new Set<number>();
        const initials = `${student.firstName.charAt(0)}${student.lastName.charAt(0)}`.toUpperCase();
        const name = studentName(student);

        return (
          <li key={student.id}>
            {/* `relative` so the ⚡ can be positioned over the card without being
                nested inside its button. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => onToggle(student.id)}
                aria-pressed={isPresent}
                disabled={isPending}
                className={`flex aspect-[3/4] w-full flex-col items-center justify-between rounded-lg border p-1.5 text-center transition-colors disabled:opacity-60 ${
                  isPresent
                    ? "border-brass bg-brass-soft"
                    : "border-line bg-paper-raised hover:border-brass"
                }`}
              >
                {/* Corner pip, like a card's rank. */}
                <span
                  className={`self-start rounded px-1 py-0 font-mono text-[9px] font-semibold ${
                    isPresent ? "bg-brass text-paper" : "text-muted"
                  }`}
                >
                  {isPresent ? "P" : "—"}
                </span>

                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full font-display text-xs ${
                    isPresent ? "bg-brass text-paper" : "bg-paper text-muted"
                  }`}
                >
                  {initials}
                </span>

                <span className="w-full">
                  <span className={`block truncate ${CARD_NAME_CLASS}`}>{name}</span>
                  {actionIds.size > 0 ? (
                    <ActionChips actionIds={actionIds} actionsById={actionsById} compact />
                  ) : (
                    student.studentIdentifier && (
                      <span className="block truncate font-mono text-[9px] text-muted">
                        {student.studentIdentifier}
                      </span>
                    )
                  )}
                </span>
              </button>

              {hasActions && (
                <span className="absolute right-1 top-1">
                  <ActionButton
                    count={actionIds.size}
                    onClick={() => onOpenActions(student.id)}
                    disabled={isPending}
                    studentLabel={name}
                    compact
                  />
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One student's action picker.
 *
 * A `Modal` rather than an inline popover: the register is a dense grid of up to
 * 30 tap targets, and a floating panel anchored to one of them would cover the
 * neighbours it needs to be read against. The dialog also gets the whole width on
 * a phone for free.
 *
 * Nothing is submitted here — toggling updates the register's own state, and the
 * actions are written when the session is saved. So there's no Save button, just
 * Done: the picker is a way of editing the sheet, not a transaction of its own.
 */
function ActionPicker({
  student,
  actions,
  selectedIds,
  onToggle,
  onClose,
}: {
  student: Student;
  actions: StudentAction[];
  selectedIds: Set<number>;
  onToggle: (actionId: number) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={studentName(student)}
      description="What happened today? These are saved with the register."
      size="sm"
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <ul className="flex flex-col gap-2">
        {actions.map((action) => {
          const isSelected = selectedIds.has(action.id);
          return (
            <li key={action.id}>
              <button
                type="button"
                onClick={() => onToggle(action.id)}
                aria-pressed={isSelected}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                  isSelected
                    ? "border-brass bg-brass-soft"
                    : "border-line bg-paper-raised hover:border-brass"
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    isSelected ? "bg-brass text-paper" : "bg-paper text-muted"
                  }`}
                >
                  {/* Falls back to the code when the action has no glyph — an
                      action is perfectly usable as its code alone. */}
                  <AttendanceActionIcon name={action.icon} className="h-5 w-5" />
                  {!action.icon && (
                    <span className="font-mono text-[10px] font-semibold">{action.code}</span>
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{action.name}</span>
                    <span className="shrink-0 rounded bg-brass-soft px-1.5 font-mono text-[11px] font-semibold text-brass-dark">
                      {action.code}
                    </span>
                  </span>
                  {action.description && (
                    <span className="mt-0.5 block text-xs text-muted">{action.description}</span>
                  )}
                </span>

                <span
                  className={`shrink-0 text-xs font-medium uppercase tracking-wide ${
                    isSelected ? "text-brass-dark" : "text-muted"
                  }`}
                >
                  {isSelected ? "Noted" : "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
