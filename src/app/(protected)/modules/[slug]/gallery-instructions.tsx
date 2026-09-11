// Per-section reference for the Picture Gallery module. Each section shows only the
// part that applies to it; Home screen carries the module-wide overview. Pure content,
// no state, rendered inside a collapsed CollapsibleCard so it's there when wanted and
// out of the way when not. Mirrors games-instructions.tsx.

import type { GallerySection } from "./gallery-sections";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-display text-base text-ink">{title}</h3>
      <div className="mt-1 flex flex-col gap-2 text-sm text-muted">{children}</div>
    </section>
  );
}

function HomeScreenInstructions() {
  return (
    <>
      <p className="text-sm text-muted">
        One photograph, drawn at random from the whole journal archive. The picture is the
        card — click it to open the viewer on the folder it came from, with the rest of that
        day&apos;s pictures beside it.
      </p>
      <Section title="How this module is laid out">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">Home screen</strong> — the random photograph, redrawn
            whenever you ask.
          </li>
          <li>
            <strong className="text-ink">Favorite photos</strong> — every picture you&apos;ve
            kept, as a list you can select from.
          </li>
          <li>
            <strong className="text-ink">Albums</strong> — collections you put together
            yourself, from any folders, in any order.
          </li>
        </ul>
      </Section>
      <Section title="The card's buttons">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            The <strong className="text-ink">heart</strong> keeps this photograph, or stops
            keeping it. A filled heart means it&apos;s in your favorites.
          </li>
          <li>
            The <strong className="text-ink">folder</strong> opens the viewer on the folder
            this picture came from — the same thing clicking the picture does.
          </li>
          <li>
            The <strong className="text-ink">circular arrow</strong> draws another photograph
            without reloading the page. It stays busy until the new picture is actually on
            screen.
          </li>
          <li>
            The <strong className="text-ink">stack</strong> goes to Favorite photos, badged
            with how many you&apos;ve kept.
          </li>
        </ul>
      </Section>
      <Section title="Where the photographs come from">
        <p>
          The folder configured in the Journal module&apos;s configuration screen. Nothing is
          copied — this module reads that archive over the network share, so if the card says
          the folder can&apos;t be found or read, that&apos;s the path to check.
        </p>
      </Section>
    </>
  );
}

function FavoritesInstructions() {
  return (
    <>
      <p className="text-sm text-muted">
        Every photograph kept from the Home screen&apos;s heart button. Favorites are shared
        by the whole household rather than being per-person — a picture one person keeps is
        one everybody sees.
      </p>
      <Section title="What you can do here">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">Slideshow</strong> plays the whole list, five seconds
            a picture.
          </li>
          <li>
            <strong className="text-ink">Tick a few rows</strong> to download them as a single
            zip, or to remove them in one go.
          </li>
          <li>
            <strong className="text-ink">Add a note</strong> to a favorite to record why you
            kept it.
          </li>
        </ul>
      </Section>
      <Section title="Removing a favorite">
        <p>
          Removing a photograph here only forgets it — the file itself stays in the archive
          untouched, and it can be drawn again on the Home screen.
        </p>
      </Section>
    </>
  );
}

function AlbumsInstructions() {
  return (
    <>
      <p className="text-sm text-muted">
        An album is a set of photographs you choose — from any folder, in any order. Like
        favorites, albums are shared by the whole household rather than being per-person.
      </p>
      <Section title="Making one">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">New album</strong> asks for a name and, if you
            want one, a description. Names have to be different from each other.
          </li>
          <li>
            To put a picture in it, open any photograph and press the{" "}
            <strong className="text-ink">+</strong> button in the top bar. That menu lists
            every album, and can make a new one on the spot without losing your place.
          </li>
          <li>
            A photograph can be in as many albums as you like, and putting it in one
            neither moves nor copies the file.
          </li>
        </ul>
      </Section>
      <Section title="What you can do with one">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">Open</strong> it to see every picture in it; click
            any one to open the viewer and arrow through the album.
          </li>
          <li>
            <strong className="text-ink">Slideshow</strong> plays the album from the start,
            in the album&apos;s own order.
          </li>
          <li>
            <strong className="text-ink">Export</strong> downloads every picture as one zip
            file. Tick some of them first and the button exports just those.
          </li>
        </ul>
      </Section>
      <Section title="Deleting an album, and removing a photo from one">
        <p>
          Neither touches your photographs. Deleting an album removes the album only, and
          removing a picture from an album just unfiles it — in both cases every file stays
          in the archive exactly where it was.
        </p>
      </Section>
    </>
  );
}

export function GalleryInstructions({ section }: { section: GallerySection }) {
  if (section === "favorites") return <FavoritesInstructions />;
  if (section === "albums") return <AlbumsInstructions />;
  return <HomeScreenInstructions />;
}
