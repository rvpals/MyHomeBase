import { getOverrideMap, groupedIconSlots } from "@/lib/icons";
import { DEFAULT_ICON_SET_ID, getIconSet, getSetting } from "@/lib/settings";
import { deps } from "@/lib/wiring";
import { IconsView } from "./view";

// A server page so the per-slot overrides can be read for the *saved* icon set. The set
// picker itself is a draft field on the admin shell (it commits on "Save Settings"), but
// an override is stored the moment it is uploaded — so uploads have to attach to the set
// that is actually live, not to an unsaved pick. `IconsView` says so on screen when the
// two disagree.
export default function IconsPage() {
  const savedSetId = getSetting(deps.settingsRepo, "icon_set")?.value ?? DEFAULT_ICON_SET_ID;
  const savedSet = getIconSet(savedSetId);

  return (
    <IconsView
      savedSetId={savedSet.id}
      savedSetName={savedSet.name}
      slotGroups={groupedIconSlots()}
      overrides={getOverrideMap(deps.iconOverridesRepo, savedSet.id)}
    />
  );
}
