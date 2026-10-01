// Administration -> Display Settings -> Chrome Style.
//
// A server component: it reads the saved style so the picker starts on the real
// value with no fetch-then-populate flicker, and hands it to the client view
// below. One settings row, so the read is a single lookup.
//
// The picker itself is a draft field on the admin shell — it commits on "Save
// Settings", like the color theme and icon set pickers — so the value read here
// is the *saved* one, which is what the view compares its draft against.

import { getSetting, resolveChromeStyle } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import { PAGE_CONTAINER } from "../../../page-container";
import { ChromeStyleView } from "./view";

export default function ChromeStylePage() {
  const savedStyle = resolveChromeStyle(getSetting(deps.settingsRepo, "chrome_style")?.value);

  return (
    <div className={PAGE_CONTAINER}>
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Display Settings
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Chrome Style</h1>
      <p className="mt-2 text-sm text-muted">
        How the application&apos;s frame is drawn — the header carrying the breadcrumb, and
        the navigation tree down the left on a desktop. This is one choice for the whole
        application, not per person. Each style only changes shading, never spacing, so
        nothing moves on the page whichever you pick.
      </p>

      <ChromeStyleView savedStyle={savedStyle} />
    </div>
  );
}
