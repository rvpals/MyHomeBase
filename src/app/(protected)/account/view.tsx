"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { IconSelect, type IconSelectOption } from "@/components/icon-select";
import { NavStylePreview } from "@/components/nav-style-preview";
import { CLOCK_FACE_OPTIONS, type ClockFace, type ClockFaceOptions } from "@/lib/clock";
import {
  FLOATING_COMPONENTS,
  PUCK_CORNERS,
  type FloatingId,
  type FloatingState,
  type PuckCorner,
} from "@/lib/floating";
import type { User } from "@/lib/user";
import {
  COMPACT_NAV_STYLES,
  type CompactNavStyle,
  type UserPreferences,
  type WeatherLocation,
} from "@/lib/user-preferences";
import type { TemperatureUnit } from "@/lib/weather";
import type { Viewport } from "@/lib/viewport";
import { WeatherLocationField } from "./location-field";
import {
  changeOwnPasswordAction,
  removeOwnAvatarAction,
  saveFloatingCornerAction,
  saveFloatingStateAction,
  saveOwnPreferencesAction,
  uploadOwnAvatarAction,
} from "./actions";
import { PAGE_CONTAINER } from "../page-container";

/** A module the user may pick as their favorite. Plain data from the page. */
export interface AccountModuleOption {
  slug: string;
  name: string;
  hasImage: boolean;
  imageVersion?: string;
}

function AvatarSection({ user }: { user: User }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  // The native input is visually hidden so "Choose file" can be a real Button,
  // which also means we render the chosen filename ourselves.
  const [fileName, setFileName] = useState<string | undefined>(undefined);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(undefined);
    try {
      const formData = new FormData(event.currentTarget);
      const result = await uploadOwnAvatarAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Failed to upload image.");
        return;
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      setFileName(undefined);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemove() {
    setIsSaving(true);
    setError(undefined);
    try {
      const result = await removeOwnAvatarAction();
      if (!result.ok) setError(result.error ?? "Failed to remove image.");
      else router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-paper-raised p-5">
      <h2 className="font-display text-lg font-semibold text-ink">Avatar</h2>
      <div className="mt-4 flex items-center gap-4">
        <Avatar
          userId={user.id}
          avatarMimeType={user.avatarMimeType}
          fallbackText={user.fullName}
          version={user.updatedAt}
          size="md"
        />
        <form onSubmit={handleUpload} className="flex-1">
          <input
            ref={fileInputRef}
            type="file"
            name="avatar"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            onChange={(event) => setFileName(event.target.files?.[0]?.name)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={isSaving}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose file
            </Button>
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? "Saving…" : "Upload"}
            </Button>
            {user.avatarMimeType && (
              <Button variant="danger" size="sm" disabled={isSaving} onClick={handleRemove}>
                Remove
              </Button>
            )}
          </div>
          <p className="mt-2 truncate text-xs text-muted">{fileName ?? "No file chosen"}</p>
        </form>
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-muted">PNG, JPEG, WEBP, or GIF. Up to 2 MB.</p>
    </div>
  );
}

function PasswordSection() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSuccess(false);
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setIsSaving(true);
    try {
      const result = await changeOwnPasswordAction(password);
      if (!result.ok) {
        setError(result.error ?? "Failed to change password.");
        return;
      }
      setPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-paper-raised p-5">
      <h2 className="font-display text-lg font-semibold text-ink">Password</h2>
      <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">New password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Confirm password</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          />
        </label>
        {error && <p className="text-sm text-red-400 sm:col-span-2">{error}</p>}
        {success && <p className="text-sm text-emerald-400 sm:col-span-2">Password updated.</p>}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving…" : "Save password"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function PreferencesSection({
  preferences,
  modules,
}: {
  preferences: UserPreferences;
  modules: AccountModuleOption[];
}) {
  const router = useRouter();
  const [favoriteModuleSlug, setFavoriteModuleSlug] = useState(
    preferences.favoriteModuleSlug ?? "",
  );
  const [openOnStartup, setOpenOnStartup] = useState(preferences.openFavoriteModuleOnStartup);
  const [navStyle, setNavStyle] = useState<CompactNavStyle>(preferences.compactNavStyle);
  // `?? null` because the field's "nothing chosen" is null, while the resolved
  // preference expresses it as undefined — see `saveUserPreferences`, which collapses
  // the two again on the way back in.
  const [weatherLocation, setWeatherLocation] = useState<WeatherLocation | null>(
    preferences.weatherLocation ?? null,
  );
  const [weatherUnit, setWeatherUnit] = useState<TemperatureUnit>(preferences.weatherUnit);
  // The clock's four settings travel as one object, matching `ClockFaceOptions` — the
  // shape both the home card and the floating clock read.
  const [clock, setClock] = useState<ClockFaceOptions>(preferences.clock);
  const [error, setError] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const options: IconSelectOption[] = modules.map((appModule) => ({
    value: appModule.slug,
    label: appModule.name,
    // Only modules with uploaded artwork get an icon URL; the rest indent to
    // stay aligned. The version is the cache-buster, as on the home carousel.
    iconUrl: appModule.hasImage
      ? `/api/modules/${appModule.slug}/carousel-image?v=${appModule.imageVersion ?? ""}`
      : undefined,
  }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSuccess(false);
    setIsSaving(true);
    try {
      const result = await saveOwnPreferencesAction({
        favoriteModuleSlug,
        openFavoriteModuleOnStartup: openOnStartup,
        compactNavStyle: navStyle,
        weatherLocation,
        weatherUnit,
        clock,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to save preferences.");
        return;
      }
      setSuccess(true);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-paper-raised p-5">
      <h2 className="font-display text-lg font-semibold text-ink">Preferences</h2>
      <p className="mt-1 text-sm text-muted">Yours alone — these don&rsquo;t affect other users.</p>

      <form onSubmit={handleSubmit} className="mt-4">
        {modules.length === 0 ? (
          // No modules to favorite, but the navigation setting below still
          // applies — so the form renders either way rather than the whole
          // section collapsing to this one message.
          <p className="text-sm text-muted">
            You don&rsquo;t have access to any modules yet, so there&rsquo;s nothing to favorite.
            Ask an administrator to grant you access.
          </p>
        ) : (
          /* Stacks below 1024px via max-lg: — the desktop two-column layout is
             left untouched. */
          <div className="card-grid gap-4">
            <label className="block text-sm" htmlFor="favorite-module">
              <span className="mb-1 block font-medium text-ink">Favorite module</span>
              <IconSelect
                id="favorite-module"
                options={options}
                value={favoriteModuleSlug}
                onChange={setFavoriteModuleSlug}
                // Strict picker: a favorite must be a real module, so free text
                // would only let someone type a slug that can't be saved.
                allowFreeText={false}
                clearLabel="— none —"
                placeholder="— none —"
                disabled={isSaving}
              />
            </label>

            <label className="block text-sm" htmlFor="open-on-startup">
              <span className="mb-1 block font-medium text-ink">
                Open favorite module when starting up
              </span>
              <select
                id="open-on-startup"
                value={openOnStartup ? "yes" : "no"}
                onChange={(event) => setOpenOnStartup(event.target.value === "yes")}
                disabled={isSaving}
                className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
          </div>
        )}

        {modules.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            {openOnStartup && favoriteModuleSlug
              ? "After logging in you'll go straight to this module. Turn this off to see the home screen again."
              : "With this on, logging in takes you straight to your favorite module instead of the home screen."}
          </p>
        )}

        <NavStyleField value={navStyle} onChange={setNavStyle} disabled={isSaving} />

        <WeatherLocationField
          value={weatherLocation}
          onChange={setWeatherLocation}
          disabled={isSaving}
        />

        <label className="mt-4 block text-sm" htmlFor="weather-unit">
          <span className="mb-1 block font-medium text-ink">Temperature unit</span>
          <select
            id="weather-unit"
            value={weatherUnit}
            onChange={(event) => setWeatherUnit(event.target.value as TemperatureUnit)}
            disabled={isSaving}
            className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
          >
            <option value="fahrenheit">Fahrenheit (°F)</option>
            <option value="celsius">Celsius (°C)</option>
          </select>
        </label>

        <ClockField value={clock} onChange={setClock} disabled={isSaving} />

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {success && <p className="mt-3 text-sm text-emerald-400">Preferences saved.</p>}

        <div className="mt-4">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving…" : "Save preferences"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * The compact navigation picker: one card per style, each showing a picture of
 * the bar, what it does, and what it trades away.
 *
 * Radio inputs rather than a `<select>`, because the whole point is comparing
 * two pictures — a dropdown would hide the option you aren't on, which is the
 * one you're trying to evaluate. The native inputs stay in the markup (visually
 * hidden, not removed) so the group is one tab stop with arrow-key movement and
 * announces as a radio group, which a div-with-onClick would not.
 */
function NavStyleField({
  value,
  onChange,
  disabled,
}: {
  value: CompactNavStyle;
  onChange: (style: CompactNavStyle) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="mt-6 border-0 p-0" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-ink">Phone navigation</legend>
      <p className="mb-3 text-xs text-muted">
        How the module and section menus share the bottom bar on a narrow screen. Both keep every
        menu on one edge, and both are the same height — only the split differs. This has no
        effect on a desktop, where the menus are side columns.
      </p>

      {/* One column below 1024px so each card keeps its full width for the
          description; two across on the desktop for comparison at a glance. */}
      <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        {COMPACT_NAV_STYLES.map((style) => {
          const selected = style.id === value;
          return (
            <label
              key={style.id}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                selected
                  ? "border-brass-dark bg-brass-soft/40"
                  : "border-line bg-paper hover:border-muted"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="compact-nav-style"
                value={style.id}
                checked={selected}
                onChange={() => onChange(style.id)}
                disabled={disabled}
                className="peer sr-only"
              />
              {/* `peer-focus-visible` puts the focus ring on the card, since the
                  input itself is visually hidden — without it, keyboard movement
                  through the group would be invisible. */}
              <NavStylePreview
                style={style.id}
                selected={selected}
                className="peer-focus-visible:ring-2 peer-focus-visible:ring-brass"
              />
              <div className="min-w-0">
                <div
                  className={`text-sm font-medium ${selected ? "text-brass-dark" : "text-ink"}`}
                >
                  {style.label}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{style.description}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{style.tradeoff}</p>
              </div>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function AccountView({
  user,
  viewport,
  viewportPinned,
  preferences,
  modules,
  enabledFloating,
}: {
  user: User;
  viewport: Viewport;
  viewportPinned: boolean;
  preferences: UserPreferences;
  modules: AccountModuleOption[];
  /** Which floating components an admin has made available to the household. */
  enabledFloating: readonly FloatingId[];
}) {
  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        {user.username}
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">My Account</h1>
      <div className="mt-3 h-px w-full bg-line" />

      <div className="mt-8">
        <AvatarSection user={user} />
        {!user.googleEmail && <PasswordSection />}
        <PreferencesSection preferences={preferences} modules={modules} />
        <FloatingComponentsSection
          enabled={enabledFloating}
          states={preferences.floating}
          corners={preferences.floatingCorners}
        />

        {/* Read-only here. The switch itself lives in the top bar, because it
            is the one control that drives the whole UI's layout and belongs
            where it is always reachable — two controls for one setting would
            only invite them to disagree. This says what the current state is
            and how to change it. */}
        <section className="mt-8">
          <h2 className="font-display text-lg text-ink">Layout</h2>
          <p className="mt-1 text-sm text-muted">
            Currently the <span className="font-medium text-ink">{viewport}</span> layout
            {viewportPinned
              ? ", pinned by you — it stays this way on every device until you change it."
              : ", chosen automatically from your screen width."}{" "}
            Switch it with the layout button in the toolbar
            {viewportPinned ? "; right-click it to go back to matching your screen." : "."}
          </p>
        </section>
      </div>
    </div>
  );
}

/**
 * The Clock card's display settings: which face, and what to show around it.
 *
 * One fieldset rather than four loose controls, because they describe one object —
 * and the copy says where they apply, since the same settings drive the home screen's
 * card *and* the floating clock. A reader who only knows one of the two would
 * otherwise be surprised by the other changing.
 *
 * Radio inputs for the face and checkboxes for the toggles, all native: three
 * booleans and a two-way choice is exactly what the platform controls are for, and
 * they come keyboard- and screen-reader-correct for free.
 */
function ClockField({
  value,
  onChange,
  disabled,
}: {
  value: ClockFaceOptions;
  onChange: (next: ClockFaceOptions) => void;
  disabled: boolean;
}) {
  const toggles = [
    { key: "showWeekday", label: "Show weekday", hint: "Monday, Tuesday…" },
    { key: "showDate", label: "Show date", hint: "13 September 2026" },
    {
      key: "showWeather",
      label: "Show weather",
      hint: "Needs a location set above.",
    },
  ] as const;

  return (
    <fieldset className="mt-4 rounded-md border border-line p-3">
      <legend className="px-1 text-sm font-medium text-ink">Clock</legend>
      <p className="text-xs text-muted">
        Applies to the Clock card on the home screen and to the Floating Clock.
      </p>

      <div className="mt-3 flex flex-wrap gap-4">
        {CLOCK_FACE_OPTIONS.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              name="clock-face"
              value={option.value}
              checked={value.face === option.value}
              onChange={() => onChange({ ...value, face: option.value as ClockFace })}
              disabled={disabled}
              className="mt-1"
            />
            <span>
              <span className="block font-medium text-ink">{option.label}</span>
              <span className="block text-xs text-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {toggles.map((toggle) => (
          <label key={toggle.key} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={value[toggle.key]}
              onChange={(event) => onChange({ ...value, [toggle.key]: event.target.checked })}
              disabled={disabled}
              className="mt-1"
            />
            <span>
              <span className="block text-ink">{toggle.label}</span>
              <span className="block text-xs text-muted">{toggle.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Floating Components: open, park or close each one available to this reader.
 *
 * Its own section rather than a field in the Preferences form, and that is the point of
 * the whole design. The floating state is written the moment a reader picks a shape, by
 * the same `saveFloatingStateAction` the window's own `_` and `✕` buttons call — so this
 * panel and the buttons on the window can't disagree, and there is no Save to forget.
 * Folding it into the form would have meant either the form wrote window positions or
 * the buttons wrote preferences.
 *
 * **This is where a closed component comes back.** `✕` is deliberately final elsewhere;
 * without this panel a reader who dismissed their clock would have no way to retrieve
 * it, which is why it must live on a page every reader can reach rather than in
 * Administration.
 */
function FloatingComponentsSection({
  enabled,
  states,
  corners,
}: {
  enabled: readonly FloatingId[];
  states: Record<FloatingId, FloatingState>;
  corners: Record<FloatingId, PuckCorner>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(states);
  const [cornerDraft, setCornerDraft] = useState(corners);
  const [pending, setPending] = useState<FloatingId | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const available = FLOATING_COMPONENTS.filter((component) => enabled.includes(component.id));

  async function choose(id: FloatingId, state: FloatingState) {
    // Optimistic, like the layer's own transitions: the radio moves at once and the
    // write follows. The stakes are a window position, and the alternative is a
    // control that lags a round-trip behind every click.
    setDraft((current) => ({ ...current, [id]: state }));
    setPending(id);
    setError(undefined);
    try {
      const result = await saveFloatingStateAction({ id, state });
      if (!result.ok) {
        setDraft((current) => ({ ...current, [id]: states[id] }));
        setError(result.error ?? "Failed to save.");
        return;
      }
      // The layer is mounted by the protected layout, so a refresh is what makes the
      // window actually appear or vanish on this very page.
      router.refresh();
    } finally {
      setPending(undefined);
    }
  }

  /**
   * Moves one component's puck to another corner.
   *
   * Optimistic and saved immediately, like the shape above — there is no Save button
   * in this panel, so a control that waited for a round trip would just look stuck.
   */
  async function chooseCorner(id: FloatingId, corner: PuckCorner) {
    setCornerDraft((current) => ({ ...current, [id]: corner }));
    setPending(id);
    setError(undefined);
    try {
      const result = await saveFloatingCornerAction({ id, corner });
      if (!result.ok) {
        setCornerDraft((current) => ({ ...current, [id]: corners[id] }));
        setError(result.error ?? "Failed to save the corner.");
        return;
      }
      router.refresh();
    } finally {
      setPending(undefined);
    }
  }

  const choices = [
    { state: "open" as const, label: "Open", hint: "Showing as a window." },
    { state: "minimized" as const, label: "Corner", hint: "A small image in the corner." },
    { state: "closed" as const, label: "Closed", hint: "Not shown at all." },
  ];

  return (
    <div className="mt-6 rounded-xl border border-line bg-paper-raised p-5">
      <h2 className="font-display text-lg font-semibold text-ink">Floating Components</h2>
      <p className="mt-1 text-sm text-muted">
        Components that float over every page. Yours alone — and saved as soon as you
        choose, so there&rsquo;s nothing to submit.
      </p>

      {available.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No floating components are available. An administrator turns these on in
          Administration &rsaquo; Display Settings &rsaquo; Floating Components.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {available.map((component) => (
            <li key={component.id} className="rounded-md border border-line p-3">
              <p className="text-sm font-medium text-ink">{component.label}</p>
              <p className="mt-0.5 text-xs text-muted">{component.description}</p>

              <div className="mt-2 flex flex-wrap gap-4">
                {choices.map((choice) => (
                  <label
                    key={choice.state}
                    className="flex cursor-pointer items-start gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      name={`floating-${component.id}`}
                      checked={draft[component.id] === choice.state}
                      onChange={() => choose(component.id, choice.state)}
                      disabled={pending === component.id}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-ink">{choice.label}</span>
                      <span className="block text-xs text-muted">{choice.hint}</span>
                    </span>
                  </label>
                ))}
              </div>

              {/* Where the small image parks when minimized. A `<select>` rather than
                  four radios: unlike the shape above there is nothing to compare, it
                  is just a position, and four more radios per component would crowd
                  the panel. */}
              <label className="mt-3 block text-xs">
                <span className="mb-1 block font-medium text-ink">Dock the corner image in</span>
                <select
                  value={cornerDraft[component.id]}
                  onChange={(event) =>
                    void chooseCorner(component.id, event.target.value as PuckCorner)
                  }
                  disabled={pending === component.id}
                  className="w-full max-w-xs rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
                >
                  {PUCK_CORNERS.map((corner) => (
                    <option key={corner.id} value={corner.id}>
                      {corner.label}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
