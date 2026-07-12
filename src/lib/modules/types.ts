import type { ModuleIconName } from "./icon-names";

export interface Module {
  id: number;
  slug: string;
  shortName: string;
  longName: string;
  description?: string;
  sequence: number;
  isVisible: boolean;
  icon: ModuleIconName;
}
