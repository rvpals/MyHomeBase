// Color themes from the terminal — the same use-cases the admin screen drives.
//
//   npm run cli -- color-themes list
//   npm run cli -- color-themes show sea-glass
//   npm run cli -- color-themes export sea-glass > sea-glass.json
//   npm run cli -- color-themes import ./my-theme.json
//   npm run cli -- color-themes reset signal-deck
//   npm run cli -- color-themes delete my-theme
//
// `export` and `import` are the reason this exists beyond parity: a theme is twelve
// values, and moving one between installs (dev to the NAS) by retyping hex codes into a
// form is how a colour ends up one digit off.

import { readFileSync } from "node:fs";
import {
  checkThemeContrast,
  createColorTheme,
  deleteColorTheme,
  getColorThemeById,
  listColorThemes,
  resetBuiltinTheme,
  saveColorTheme,
  type StoredColorTheme,
} from "@/lib/color-themes";
import { DEFAULT_COLOR_THEME_ID, getSetting } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  color-themes list
  color-themes show <id>
  color-themes export <id>
  color-themes import <file.json>
  color-themes reset <built-in-id>
  color-themes delete <id>`;

function activeThemeId(): string {
  return getSetting(deps.settingsRepo, "color_theme")?.value ?? DEFAULT_COLOR_THEME_ID;
}

function printTheme(theme: StoredColorTheme, active: boolean): void {
  const marks = [active ? "active" : undefined, theme.isBuiltin ? "built-in" : undefined]
    .filter(Boolean)
    .join(", ");
  console.log(`  ${theme.id.padEnd(18)} ${theme.name}${marks ? ` (${marks})` : ""}`);
}

export async function colorThemesCommand(args: string[]): Promise<void> {
  const [action, argument] = args;

  // Every write is wrapped: the schema throws on a bad hex or an unknown font, and a
  // CLI should print that as a message with an exit code, not a stack.
  try {
    switch (action) {
      case undefined:
      case "list": {
        const themes = listColorThemes(deps.colorThemeRepo);
        const active = activeThemeId();
        console.log(`${themes.length} theme${themes.length === 1 ? "" : "s"}:`);
        for (const theme of themes) printTheme(theme, theme.id === active);
        return;
      }

      case "show": {
        if (!argument) throw new Error("A theme id is required.");
        const theme = getColorThemeById(deps.colorThemeRepo, argument);
        if (!theme) throw new Error(`No theme with the id "${argument}".`);

        console.log(`${theme.name} (${theme.id})${theme.isBuiltin ? " — built-in" : ""}`);
        if (theme.description) console.log(theme.description);
        console.log("\nColors:");
        for (const [key, value] of Object.entries(theme.tokens)) {
          if (key === "fonts") continue;
          console.log(`  ${key.padEnd(14)} ${value}`);
        }
        console.log("\nFonts:");
        console.log(`  display        ${theme.tokens.fonts.display}`);
        console.log(`  body           ${theme.tokens.fonts.body}`);
        console.log(`  mono           ${theme.tokens.fonts.mono}`);

        // Printed for every theme, not only failing ones, for the same reason the
        // builder shows passes: a number that only appears on failure gets ignored.
        console.log("\nContrast:");
        for (const finding of checkThemeContrast(theme.tokens)) {
          const verdict =
            finding.threshold === undefined
              ? "info"
              : finding.fails
                ? `BELOW ${finding.threshold}`
                : "pass";
          console.log(
            `  ${finding.ratio.toFixed(1).padStart(5)}:1  ${verdict.padEnd(9)} ${finding.label}`,
          );
        }
        return;
      }

      case "export": {
        if (!argument) throw new Error("A theme id is required.");
        const theme = getColorThemeById(deps.colorThemeRepo, argument);
        if (!theme) throw new Error(`No theme with the id "${argument}".`);

        // Only the fields `import` reads back — `isBuiltin` and `updatedAt` belong to
        // the install, not the theme, so exporting them would invite a confusing import.
        console.log(
          JSON.stringify(
            {
              id: theme.id,
              name: theme.name,
              description: theme.description,
              tokens: theme.tokens,
            },
            null,
            2,
          ),
        );
        return;
      }

      case "import": {
        if (!argument) throw new Error("A path to a .json file is required.");
        const parsed = JSON.parse(readFileSync(argument, "utf8")) as Record<string, unknown>;
        const input = { ...parsed, sortOrder: 100 };

        // Update when the id already exists, create otherwise — so re-importing an
        // edited file is one command rather than a delete followed by an import.
        const existing = getColorThemeById(deps.colorThemeRepo, String(parsed.id ?? ""));
        const saved = existing
          ? saveColorTheme(deps.colorThemeRepo, {
              ...input,
              sortOrder: existing.sortOrder,
            })
          : createColorTheme(deps.colorThemeRepo, input);

        console.log(`${existing ? "Updated" : "Created"} ${saved.name} (${saved.id}).`);

        const failures = checkThemeContrast(saved.tokens).filter((finding) => finding.fails);
        if (failures.length > 0) {
          // A warning, not a failure — the same warn-only rule the builder follows.
          console.log(`\n${failures.length} contrast pair(s) below target:`);
          for (const finding of failures) {
            console.log(
              `  ${finding.ratio.toFixed(1)}:1 (needs ${finding.threshold}) ${finding.label}`,
            );
          }
        }
        return;
      }

      case "reset": {
        if (!argument) throw new Error("A built-in theme id is required.");
        const reset = resetBuiltinTheme(deps.colorThemeRepo, argument);
        console.log(`Reset ${reset.name} (${reset.id}) to its built-in definition.`);
        return;
      }

      case "delete": {
        if (!argument) throw new Error("A theme id is required.");
        deleteColorTheme(deps.colorThemeRepo, { id: argument }, activeThemeId());
        console.log(`Deleted ${argument}.`);
        return;
      }

      default:
        console.error(`Unknown action "${action}".\n\n${USAGE}`);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
