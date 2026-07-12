import packageJson from "../../../../package.json";

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Administration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">About</h1>

      <div className="mt-8 rounded-xl border border-line bg-paper-raised p-5 text-sm text-ink">
        <p className="font-display text-lg">{packageJson.name}</p>
        <p className="mt-1 text-muted">Version {packageJson.version}</p>
      </div>
    </div>
  );
}
