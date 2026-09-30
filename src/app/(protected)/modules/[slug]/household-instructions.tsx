// Per-section reference for the Household module. Each section shows only the part
// that applies to it; the Home screen carries the module-wide overview. Pure content,
// no state, rendered inside a collapsed CollapsibleCard so it's there when wanted and
// out of the way when not. Mirrors tools-instructions.tsx.

import type { HouseholdSection } from "./household-sections";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-display text-base text-ink">{title}</h3>
      <div className="mt-1 flex flex-col gap-2 text-sm text-muted">{children}</div>
    </section>
  );
}

function MainInstructions() {
  return (
    <>
      <p className="text-sm text-muted">
        Where the household&apos;s own paperwork lives — the things that belong to the
        house rather than to any one person.
      </p>
      <Section title="What is here">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">Recipes</strong> — the recipe box. What to cook,
            what went into it, how you made it, and how many times you have.
          </li>
          <li>
            <strong className="text-ink">HSA Tracker</strong> — not built yet. A
            placeholder so the section exists while the rest is designed.
          </li>
        </ul>
      </Section>
    </>
  );
}

function RecipesInstructions() {
  return (
    <>
      <p className="text-sm text-muted">
        The recipe box. Every recipe carries a name, a description, its ingredients and
        directions, free-text notes, a picture, a rating, where it came from, and a count
        of how many times you have made it.
      </p>
      <Section title="Working with one recipe">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong className="text-ink">Click a row</strong> to open the recipe, where the
            picture is added or replaced.
          </li>
          <li>
            <strong className="text-ink">Edit</strong> opens the whole record as a form.
            Ingredients and directions are one item per line.
          </li>
          <li>
            <strong className="text-ink">+1</strong> records that you made it again — one
            click, with no trip through the edit form, so it can&apos;t overwrite a note
            somebody else is mid-way through changing.
          </li>
        </ul>
      </Section>
      <Section title="Working with several at once">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Tick the checkboxes to select rows, then use{" "}
            <strong className="text-ink">Edit</strong> or{" "}
            <strong className="text-ink">Delete</strong> in the toolbar. Select-all covers
            everything matching the current filter, not just the visible page.
          </li>
          <li>
            A bulk edit changes <em>only the fields you tick</em>. Leaving a box unticked
            leaves that field alone on every selected recipe — a blank box can&apos;t wipe
            a column.
          </li>
          <li>
            Tags can be added to, removed from, or replaced across the selection. Name,
            ingredients and directions are deliberately not offered: setting many recipes
            to one name is never what a bulk edit means.
          </li>
          <li>
            Category can be set across the selection too — ticking it and leaving the box
            empty clears the category on all of them, which is the one case where an
            empty box does change something.
          </li>
        </ul>
      </Section>
      <Section title="Finding things">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            The search box looks at the name, the description <em>and</em> the ingredients,
            so &ldquo;what can I make with the buttermilk&rdquo; is the same box as
            &ldquo;where is the pancake recipe&rdquo;.
          </li>
          <li>
            Search, category and tag all live in the address bar, so a filtered list can
            be bookmarked or sent to someone. They combine — a category and a tag
            together narrow to the recipes matching both.
          </li>
          <li>
            Tags are free text, created as you type them on a recipe. Case and spacing
            don&apos;t matter — &ldquo;Weeknight&rdquo; and &ldquo;weeknight&rdquo; are one
            tag.
          </li>
        </ul>
      </Section>
      <Section title="Categories and tags">
        <p>
          A recipe has <strong className="text-ink">one category</strong> — what the dish
          is, like Dinner or Dessert — and <strong className="text-ink">any number of
          tags</strong>, which are cross-cutting labels like <em>freezer</em> or{" "}
          <em>quick</em>. If a word is true of a dish alongside other words, it is a tag.
        </p>
        <p>
          The Category box offers every category you have already used and also accepts a
          new one typed straight in, so the list grows as you cook rather than needing to
          be set up first. Category keeps the capitals you type — &ldquo;Dessert&rdquo;
          stays &ldquo;Dessert&rdquo; — but picking it out is case-insensitive, so you
          cannot accidentally end up with two of them. Leave it blank for uncategorised.
        </p>
      </Section>
      <Section title="Ratings">
        <p>
          A rating is 1 to 10, or blank. Blank means unrated and reads as
          &ldquo;&mdash;&rdquo; in the list — deliberately not 0, which would sort as
          though you had judged it the worst thing in the box.
        </p>
      </Section>
    </>
  );
}

function ImportInstructions() {
  return (
    <>
      <p className="text-sm text-muted">
        Brings recipes in from a spreadsheet. Drop a CSV, say which of its columns is
        which recipe field, and import. The mapping can be saved by name and reused for
        the next file from the same source.
      </p>
      <Section title="Mapping the columns">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Recognized headers (Name, Ingredients, Tags, Rating and so on) are mapped for
            you. Anything unrecognized starts as <strong className="text-ink">Ignore</strong>
            {" "}
            and is yours to set — or to leave out.
          </li>
          <li>
            <strong className="text-ink">Name</strong> is the only column you must map. It
            is also the match key, which is why a nameless row is skipped rather than
            imported as an untitled recipe.
          </li>
          <li>
            <strong className="text-ink">Ingredients</strong> and{" "}
            <strong className="text-ink">Directions</strong> are stored one item per line,
            so those columns get a &ldquo;split on&rdquo; choice. A cell that writes its
            line breaks as a literal <code>\n</code> is handled by the default.
          </li>
        </ul>
      </Section>
      <Section title="Importing twice">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            By default a row whose name you already have is{" "}
            <strong className="text-ink">skipped</strong>, so re-importing the same file
            changes nothing. Names match ignoring case.
          </li>
          <li>
            <strong className="text-ink">Overwrite database from file</strong> replaces the
            matching recipe instead. You are shown exactly which recipes change, and can
            cancel, before anything is written. The whole recipe is replaced, so a blank
            cell clears that field — but the picture is kept.
          </li>
        </ul>
      </Section>
      <Section title="What a CSV cannot carry">
        <p>
          Pictures. Add one to a recipe afterwards by opening it from the Recipes list.
          To remove recipes, select them in that list and use its Delete button.
        </p>
      </Section>
    </>
  );
}

function HsaInstructions() {
  return (
    <p className="text-sm text-muted">
      Not built yet — this section is a placeholder. Nothing is stored for it, and no
      setting here affects anything else in the module.
    </p>
  );
}

export function HouseholdInstructions({ section }: { section: HouseholdSection }) {
  return (
    <div className="flex flex-col gap-4">
      {section === "main" && <MainInstructions />}
      {section === "recipes" && <RecipesInstructions />}
      {section === "recipes-import" && <ImportInstructions />}
      {section === "hsa" && <HsaInstructions />}
    </div>
  );
}
