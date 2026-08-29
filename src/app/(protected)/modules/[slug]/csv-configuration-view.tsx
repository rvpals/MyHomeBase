// CSV Analysis → Configuration.
//
// A deliberate placeholder: the section exists so the nav has somewhere to point
// while the settings it will hold are still undecided. Nothing here persists yet,
// so there is no table, no migration and no lib module behind it -- when the
// first real setting arrives it brings its own `cfg` table and tests with it.
//
// A server component with no data to fetch, matching the other section views'
// shape rather than reaching for "use client" it does not need.

export function CsvConfigurationView() {
  return (
    <section className="rounded-xl border border-line p-4">
      <h2 className="font-display text-lg text-ink">Nothing to configure yet</h2>
      <p className="mt-1 text-sm text-muted">
        Import and charting defaults will live here. For now everything is set per
        import over on the Dashboard.
      </p>
    </section>
  );
}
