// Favourite photographs from the terminal — the same use-cases the home screen's
// random photo card drives.
//
//   npm run cli -- fav-photos list
//   npm run cli -- fav-photos add "2019/2019-06 June/IMG_20190609_143501.jpg" "Strawberry festival"
//   npm run cli -- fav-photos note "2019/2019-06 June/IMG_20190609_143501.jpg" "Corrected note"
//   npm run cli -- fav-photos remove "2019/2019-06 June/IMG_20190609_143501.jpg"
//
// Paths are relative to the configured photo root (the Journal module's `photo_root`),
// which is what the table stores — quote them, the folder names contain spaces.

import {
  addFavPhoto,
  listFavPhotos,
  removeFavPhoto,
  setFavPhotoNote,
  type FavPhoto,
} from "@/lib/fav-photos";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";

const USAGE = `Usage:
  fav-photos list
  fav-photos add <relative-path> [note]
  fav-photos note <relative-path> <note>
  fav-photos remove <relative-path>`;

function printRow(favorite: FavPhoto): void {
  console.log(`  ${favorite.createdAt}  ${favorite.relativePath}`);
  if (favorite.note !== "") console.log(`${" ".repeat(23)}note: ${favorite.note}`);
}

export async function favPhotosCommand(args: string[]): Promise<void> {
  const [action, relativePath, ...rest] = args;
  const note = rest.join(" ");

  // Every write is wrapped, because the schema throws on a bad path or an over-long
  // note and a CLI should print that as a message with an exit code, not a stack.
  try {
    switch (action) {
      case undefined:
      case "list": {
        const favorites = listFavPhotos(deps.favPhotoRepo);
        if (favorites.length === 0) {
          console.log("No favourite photos yet — press the heart on the home screen's photo card.");
          return;
        }
        console.log(`${favorites.length} favourite photo${favorites.length === 1 ? "" : "s"}:`);
        favorites.forEach(printRow);
        return;
      }

      case "add": {
        if (!relativePath) throw new Error("A relative path is required.");
        const added = addFavPhoto(deps.favPhotoRepo, relativePath, note);
        console.log(added ? `Favourited ${relativePath}` : `Already a favourite: ${relativePath}`);
        return;
      }

      case "note": {
        if (!relativePath) throw new Error("A relative path is required.");
        const written = setFavPhotoNote(deps.favPhotoRepo, relativePath, note);
        if (!written) {
          console.error(`Not a favourite, so there is no note to write: ${relativePath}`);
          process.exitCode = 1;
          return;
        }
        console.log(note === "" ? `Cleared the note on ${relativePath}` : `Noted ${relativePath}`);
        return;
      }

      case "remove": {
        if (!relativePath) throw new Error("A relative path is required.");
        const removed = removeFavPhoto(deps.favPhotoRepo, relativePath);
        console.log(removed ? `Removed ${relativePath}` : `Wasn't a favourite: ${relativePath}`);
        return;
      }

      default:
        console.error(`Unknown action: ${action}`);
        console.error(USAGE);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
