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
            <strong className="text-ink">Save attendance</strong> to record the session. Saving
            again for the same class on the same day adds a <em>second</em> session rather than
            replacing the first, so a class that meets twice keeps both registers.
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
        <p className="text-sm text-muted">
          Add students to the school-wide roster here. Only a first and last name are required. To
          put several students in a class at once, tick them in the grid and use{" "}
          <strong className="text-ink">Add to class</strong> in the toolbar. A student can be in as
          many classes as you like.
        </p>
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

    case "report":
      return (
        <p className="text-sm text-muted">
          Pick a class and a date to see who was present and who was absent, then press{" "}
          <strong className="text-ink">Print</strong>. Any actions noted that session print as
          codes beside the student, with a count of each above the lists. Names and codes are
          shown as they were when attendance was taken, so a later rename doesn&apos;t change an
          old report.
        </p>
      );

    case "configuration":
      return (
        <p className="text-sm text-muted">
          Set the class the home screen opens on, and whether the report starts on today&apos;s
          date.
        </p>
      );

    default:
      return null;
  }
}
