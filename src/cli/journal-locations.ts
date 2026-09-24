import {
  countImportCandidates,
  countLocationsByCategory,
  countLocationsByTag,
  createSavedLocation,
  deleteLocationTaxonomy,
  deleteSavedLocation,
  findLocationDuplicates,
  listSavedLocations,
  mergeSavedLocations,
  promoteToSavedLocation,
  runImportBatch,
  saveLocationTaxonomy,
  searchSavedLocations,
  updateSavedLocation,
  type SavedLocationWithUsage,
} from "@/lib/journal-locations";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Reads and writes the Journal's saved-location library — the same use-cases the
 * Location Manager drives, so the two cannot diverge.
 *
 *   journal-locations --list
 *   journal-locations --search "coffee"
 *   journal-locations --search "" --category "Restaurant" --tag "Weekend"
 *   journal-locations --add "Small World Coffee" --lat 40.3499 --lon -74.6593 \
 *                     --address "14 Witherspoon St" --category "Restaurant"
 *   journal-locations --update 4 --name "Small World" --lat 40.35 --lon -74.66
 *   journal-locations --delete 4
 *   journal-locations --promote --lat 40.1 --lon -74.2 --name "Grandma's" --entry-location 42
 *   journal-locations --find-duplicates
 *   journal-locations --find-duplicates 0.9
 *   journal-locations --find-duplicates --within 200
 *   journal-locations --merge 12 --into-from 34,56
 *   journal-locations --import-from-entries
 *   journal-locations --import-from-entries --no-addresses
 *   journal-locations --categories
 *   journal-locations --add-category "Trailhead" --description "Where a walk starts"
 *   journal-locations --delete-tag "Weekend"
 *
 * The point of this command is the ARCHITECTURE.md contract that every use-case is
 * reachable from a terminal. It is also the practical way to seed a library in bulk:
 * a shell loop over `--add` beats typing a hundred places into a form.
 *
 * `--category` and `--tag` may each be repeated in spirit but `parseFlags` keeps only
 * the last of a repeated key, so multiples are given comma-separated:
 * `--category "Restaurant,Cafe"`.
 */
export async function journalLocationsCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  const names = (value: string | undefined): string[] =>
    value === undefined || value === "" ? [] : value.split(",").map((name) => name.trim());

  const categories = names(flags.category);
  const tags = names(flags.tag);

  /** Reads a required coordinate flag, or reports which one is missing. */
  const coordinate = (key: "lat" | "lon"): number | undefined => {
    const raw = flags[key];
    if (raw === undefined || raw === "") {
      console.error(`--${key} is required.`);
      process.exitCode = 1;
      return undefined;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      console.error(`--${key} must be a number, got "${raw}".`);
      process.exitCode = 1;
      return undefined;
    }
    return parsed;
  };

  const printLocations = (places: SavedLocationWithUsage[]): void => {
    if (places.length === 0) {
      console.log("No saved locations.");
      return;
    }
    for (const place of places) {
      // The id leads because --update, --delete and a journal entry's provenance
      // all reference it, and a terminal has no other way to find it.
      const label = place.name === "" ? "(unnamed)" : place.name;
      console.log(
        `  ${String(place.id).padStart(4)}  ${label}  ` +
          `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}  (used ${place.usageCount}x)`,
      );
      if (place.address !== "") console.log(`        ${place.address}`);
      if (place.description !== "") console.log(`        ${place.description}`);
      const labels = [...place.categories, ...place.tags];
      if (labels.length > 0) console.log(`        [${labels.join(", ")}]`);
    }
  };

  // ---- Reads ------------------------------------------------------------------------

  if (flags.list !== undefined) {
    printLocations(listSavedLocations(deps.savedLocationRepo));
    return;
  }

  if (flags.search !== undefined) {
    printLocations(
      searchSavedLocations(deps.savedLocationRepo, { query: flags.search, categories, tags }),
    );
    return;
  }

  if (flags.categories !== undefined) {
    for (const row of countLocationsByCategory(deps.savedLocationRepo)) {
      console.log(`  ${String(row.count).padStart(4)}  ${row.name}`);
    }
    return;
  }

  if (flags.tags !== undefined) {
    for (const row of countLocationsByTag(deps.savedLocationRepo)) {
      console.log(`  ${String(row.count).padStart(4)}  ${row.name}`);
    }
    return;
  }

  // ---- Place writes -----------------------------------------------------------------

  if (flags.add !== undefined) {
    const latitude = coordinate("lat");
    const longitude = coordinate("lon");
    if (latitude === undefined || longitude === undefined) return;
    const created = createSavedLocation(deps.savedLocationRepo, {
      name: flags.add,
      latitude,
      longitude,
      description: flags.description ?? "",
      address: flags.address ?? "",
      categories,
      tags,
    });
    console.log(`Saved location ${created.id}: ${created.name || "(unnamed)"}`);
    return;
  }

  if (flags.update !== undefined) {
    const latitude = coordinate("lat");
    const longitude = coordinate("lon");
    if (latitude === undefined || longitude === undefined) return;
    // An update replaces the whole row, exactly as the web form does — so the
    // caller resubmits every field rather than patching one.
    const updated = updateSavedLocation(deps.savedLocationRepo, {
      id: Number(flags.update),
      name: flags.name ?? "",
      latitude,
      longitude,
      description: flags.description ?? "",
      address: flags.address ?? "",
      categories,
      tags,
    });
    console.log(`Updated location ${updated.id}.`);
    return;
  }

  if (flags.delete !== undefined) {
    deleteSavedLocation(deps.savedLocationRepo, Number(flags.delete));
    console.log(`Deleted location ${flags.delete}. Entries that used it keep their coordinates.`);
    return;
  }

  if (flags["find-duplicates"] !== undefined) {
    // A read: this only ever reports. Merging is the separate --merge flag, so
    // there is no way to delete a row by mistyping a scan.
    const raw = flags["find-duplicates"];
    const threshold = raw === "" ? undefined : Number(raw);
    // How far apart two pins may still be one place. The use-case clamps it
    // and falls back on a non-number, so a typo widens nothing silently.
    const withinRaw = flags.within;
    const within = withinRaw === undefined || withinRaw === "" ? undefined : Number(withinRaw);
    const groups = findLocationDuplicates(deps.savedLocationRepo, threshold, within);
    if (groups.length === 0) {
      console.log("No duplicate locations found.");
      return;
    }
    for (const group of groups) {
      console.log(
        `\n${group.label || "Unnamed places at one spot"} — ` +
          `${group.locations.length} copies, ${Math.round(group.confidence * 100)}% ` +
          `${group.label === "" ? "proximity" : "name match"}`,
      );
      for (const place of group.locations) {
        console.log(
          `  #${place.id}  ${place.name || "(unnamed)"}  used ${place.usageCount}x  ` +
            `${place.metresFromFirst}m from first`,
        );
      }
    }
    console.log(
      `\n${groups.length} ${groups.length === 1 ? "group" : "groups"}. ` +
        "Merge one with: --merge <keepId> --into-from <id,id>",
    );
    return;
  }

  if (flags.merge !== undefined) {
    const removeRaw = flags["into-from"];
    if (removeRaw === undefined || removeRaw.trim() === "") {
      console.error("--merge needs --into-from with the ids to merge away, e.g. --into-from 4,7");
      process.exitCode = 1;
      return;
    }
    const removeIds = removeRaw
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isFinite(value));
    const result = mergeSavedLocations(deps.savedLocationRepo, {
      keepId: Number(flags.merge),
      removeIds,
    });
    console.log(
      `Merged ${result.removedCount} into location ${result.location.id}. ` +
        `${result.movedCount} entry ${result.movedCount === 1 ? "location" : "locations"} repointed.`,
    );
    return;
  }

  if (flags.promote !== undefined) {
    const latitude = coordinate("lat");
    const longitude = coordinate("lon");
    if (latitude === undefined || longitude === undefined) return;
    const entryLocation = flags["entry-location"];
    const created = promoteToSavedLocation(deps.savedLocationRepo, {
      name: flags.name ?? "",
      latitude,
      longitude,
      description: flags.description ?? "",
      address: flags.address ?? "",
      categories,
      tags,
      entryLocationId:
        entryLocation === undefined || entryLocation === "" ? undefined : Number(entryLocation),
    });
    console.log(`Promoted to location ${created.id}.`);
    return;
  }

  // ---- Building the library from existing entries ------------------------------------

  if (flags["import-from-entries"] !== undefined) {
    // Addresses on by default, matching the web modal. `--no-addresses` skips
    // the geocoder entirely, which turns a five-minute run into a moment.
    const withAddresses = flags["no-addresses"] === undefined;
    const total = countImportCandidates(deps.savedLocationRepo);
    if (total === 0) {
      console.log("Nothing to import - every coordinate in the journal is already saved.");
      return;
    }
    console.log(
      `Importing ${total} distinct place(s) from the journal` +
        (withAddresses ? ", looking up each address (about 1 per second)." : "."),
    );

    let completed = 0;
    let created = 0;
    let addressed = 0;
    for (;;) {
      const batch = await runImportBatch(deps.savedLocationRepo, deps.geocodingClient, {
        withAddresses,
      });
      completed += batch.processedCount;
      created += batch.createdCount;
      addressed += batch.addressCount;
      // The terminal's progress bar: one line per batch, same "n of m" the web
      // modal shows.
      console.log(`  ${completed} of ${total} places...`);
      if (batch.remainingCount === 0 || batch.processedCount === 0) break;
    }
    console.log(
      `Done. Created ${created} location(s)` +
        (withAddresses ? `; ${addressed} got an address.` : "."),
    );
    return;
  }

  // ---- Taxonomy writes --------------------------------------------------------------

  if (flags["add-category"]) {
    const saved = saveLocationTaxonomy(deps.savedLocationRepo, "category", {
      name: flags["add-category"],
      description: flags.description ?? "",
    });
    console.log(`Saved location category "${saved.name}".`);
    return;
  }

  if (flags["add-tag"]) {
    const saved = saveLocationTaxonomy(deps.savedLocationRepo, "tag", {
      name: flags["add-tag"],
      description: flags.description ?? "",
    });
    console.log(`Saved location tag "${saved.name}".`);
    return;
  }

  if (flags["delete-category"]) {
    deleteLocationTaxonomy(deps.savedLocationRepo, "category", flags["delete-category"]);
    console.log(`Deleted location category "${flags["delete-category"]}".`);
    return;
  }

  if (flags["delete-tag"]) {
    deleteLocationTaxonomy(deps.savedLocationRepo, "tag", flags["delete-tag"]);
    console.log(`Deleted location tag "${flags["delete-tag"]}".`);
    return;
  }

  console.error(
    "Usage: journal-locations --list | --search <text> | --add <name> --lat <n> --lon <n> |\n" +
      "       --update <id> ... | --delete <id> | --promote --lat <n> --lon <n> |\n" +
      "       --find-duplicates [score] [--within <metres>] | --merge <id> --into-from <ids> |\n" +
      "       --categories | --tags | --add-category <name> | --add-tag <name> |\n" +
      "       --delete-category <name> | --delete-tag <name>",
  );
  process.exitCode = 1;
}
