// Per-section guidance for the Attendance module. Each section gets only the
// text that applies to it — the whole document above every screen is noise
// between the heading and the content.

import type { AttendanceSection } from "./attendance-sections";

export function AttendanceInstructions({ section }: { section: AttendanceSection }) {
  switch (section) {
    case "main":
      return (
        <div className="flex flex-col gap-2 text-sm text-muted">
          <p>
            Pick a class, then tap each student who is here — everyone starts absent. Press{" "}
            <strong className="text-ink">Save attendance</strong> to record the register. There
            is one register per class per day, so saving again for the same class on the same
            day <em>updates</em> what you already saved rather than adding a second one. To
            correct an earlier day, use <strong className="text-ink">Edit records</strong>.
          </p>
          <p>
            The <strong className="text-ink">⚡</strong> button on a student notes what happened
            to them today — late, extra credit, or anything else from the{" "}
            <strong className="text-ink">Student actions</strong> screen. An action is separate
            from present and absent, so you can mark someone late whether or not they turned up.
            Noted codes appear on the student and are saved with the session, and the report
            prints them.
          </p>
        </div>
      );

    case "rosters":
      return (
        <div className="flex flex-col gap-2 text-sm text-muted">
          <p>
            Add students to the school-wide roster here. Only a first and last name are required.
            To put several students in a class at once, tick them in the grid and use{" "}
            <strong className="text-ink">Add to class</strong> in the toolbar. A student can be in
            as many classes as you like.
          </p>
          <p>
            <strong className="text-ink">Import a roster (CSV)</strong> takes a school export
            straight from the file. A single <em>Name</em> column holding{" "}
            <span className="font-mono text-xs">Last,First Middle</span> is split on the first
            comma, so a multi-word surname survives; blank separator lines between students are
            ignored. Name the class on the form and it is created for you — or reused if you
            already have one by that name — with everyone imported enrolled into it.
          </p>
        </div>
      );

    case "classes":
      return (
        <p className="text-sm text-muted">
          Create a class, then use <strong className="text-ink">Students</strong> on its row to see
          who is in it and add more from the roster. Deleting a class leaves its saved attendance
          intact — past reports keep the class name they were taken under.
        </p>
      );

    case "actions":
      return (
        <div className="flex flex-col gap-2 text-sm text-muted">
          <p>
            These are the things the <strong className="text-ink">⚡</strong> button on the home
            screen offers. Each one has a name, a short code (what the report prints), an
            optional description, and an icon.
          </p>
          <p>
            <strong className="text-ink">Retire</strong> an action you have stopped using: it
            drops out of the picker but stays readable on the registers that already recorded
            it. Deleting is only possible for an action that has never been recorded — otherwise
            past sessions would lose what their codes meant.
          </p>
        </div>
      );

    case "edit":
      return (
        <div className="flex flex-col gap-2 text-sm text-muted">
          <p>
            Pick a class to list every day it has a register for, then press{" "}
            <strong className="text-ink">Edit</strong> on a day to open it. The marks and noted
            actions come back as they were saved; change them and press{" "}
            <strong className="text-ink">Update attendance</strong>. There is one register per
            class per day, so this corrects that day rather than adding another.
          </p>
          <p>
            To remove a day altogether — a class registered by mistake, say — tick it in the
            grid and use <strong className="text-ink">Delete registers</strong>. You can tick
            several at once. This is not the same as marking everybody absent: an absent
            register says the class met and nobody came, while a deleted one says the class
            never met, and the detail report tells those apart. Deleting takes every mark and
            noted action with it and <strong className="text-ink">cannot be undone</strong>.
          </p>
          <p>
            Only days that already have a register appear here. To take attendance for a new
            day, use the <strong className="text-ink">Home screen</strong>.
          </p>
        </div>
      );

    case "report":
      return (
        <div className="flex flex-col gap-2 text-sm text-muted">
          <p>
            Pick a class and a date to see who was present and who was absent, then press{" "}
            <strong className="text-ink">Print</strong>. Any actions noted that session print as
            codes beside the student, with a count of each above the lists. Names and codes are
            shown as they were when attendance was taken, so a later rename doesn&apos;t change
            an old report.
          </p>
          <p>
            <strong className="text-ink">Export CSV</strong> downloads whatever is on screen as a
            spreadsheet file — a row per student for the <em>Brief</em> sheet, or a row per
            student and a column per date for <em>Detail</em>. In the detail file a cell reads{" "}
            <span className="font-mono text-xs">P</span> or{" "}
            <span className="font-mono text-xs">A</span> with any codes after it, and a blank
            cell means attendance was never taken for that student that day — which is not the
            same as being absent.
          </p>
        </div>
      );

    case "configuration":
      return (
        <p className="text-sm text-muted">
          Set the class the home screen opens on, whether the report starts on today&apos;s date,
          and whether the home screen&apos;s cards name a student surname-first.
        </p>
      );

    default:
      return null;
  }
}
