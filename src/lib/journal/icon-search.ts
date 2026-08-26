// Maps a category or tag *name* to a concrete Iconify icon name.
//
// Why a hand-kept table rather than just calling Iconify's /search: search is
// keyword-matching over icon names, and a household journal's vocabulary is not
// icon vocabulary. Real examples from this app's own data — "Mortgage",
// "Escrow", "401K", "Audit", "PTAC" and "Telehealth" all return *zero* results
// from a naive `?query=` against Material Design Icons. Left to search alone,
// every one of those falls through to a letter tile, which is the thing the
// icons exist to replace. So: an explicit synonym table first, search second.
//
// The icon set is fixed to Material Design Icons (`mdi`) so a row of icons reads
// as one family rather than a scrapbook of a dozen drawing styles. MDI is
// Apache-2.0, which is what makes it legitimate to fetch the bytes once and
// store them (see icon-fetch.ts).
//
// Pure: no I/O, no react/next imports (see ARCHITECTURE.md). The fetching lives
// in icon-fetch.ts, so this whole file is a table plus string matching.

import { normalizeIconName } from "./generated-icons";

/** The one icon set we draw from. Every name below is `mdi:<icon>`. */
export const ICON_SET_PREFIX = "mdi";

/**
 * Vocabulary -> icon. Every icon name here has been checked to resolve against
 * the live API; a typo would silently become a letter tile, so treat adding a
 * row as requiring that check.
 *
 * Keys are matched after `normalizeIconName`, i.e. lowercased with punctuation
 * and digits stripped — which is why "Oil_Change" is keyed as "oil change".
 * Names whose meaning lives in a digit ("401K", "A1C") can't be keyed here at
 * all; they go in `SPECIAL_CASES`.
 */
const SYNONYMS: Readonly<Record<string, string>> = {
  // --- Appointments and the calendar
  appointment: "calendar-check",
  appointments: "calendar-check",
  appoin: "calendar-check",
  appointmen: "calendar-check",
  booking: "calendar-check",
  schedule: "calendar-check",
  reminder: "bell-outline",
  visit: "calendar-account",
  checkup: "clipboard-pulse-outline",
  telehealth: "monitor-account",
  meet: "account-group-outline",
  meeting: "account-group-outline",
  date: "calendar-heart",

  // --- Paperwork
  document: "file-document-outline",
  paperwork: "file-document-multiple-outline",
  form: "form-select",
  application: "file-sign",
  statement: "file-chart-outline",
  letter: "email-outline",
  transcript: "file-certificate-outline",
  record: "folder-outline",
  records: "folder-multiple-outline",
  report: "file-chart-outline",
  certificate: "certificate-outline",
  contract: "file-sign",
  registration: "clipboard-edit-outline",
  enrollment: "clipboard-account-outline",
  activation: "toggle-switch-outline",
  membership: "card-account-details-outline",
  survey: "clipboard-list-outline",
  evaluation: "clipboard-check-outline",
  audit: "file-search-outline",
  closing: "file-check-outline",
  escrow: "safe-square-outline",
  immigration: "passport",
  passport: "passport",
  visa: "passport",
  license: "card-account-details-outline",
  note: "note-text-outline",
  message: "message-text-outline",
  email: "email-outline",
  wechat: "wechat",
  package: "package-variant-closed",
  mail: "mailbox-outline",

  // --- Money
  bank: "bank",
  banking: "bank",
  account: "wallet-outline",
  loan: "hand-coin-outline",
  mortgage: "home-city",
  credit: "credit-card-outline",
  debit: "credit-card-outline",
  card: "credit-card-outline",
  payment: "cash-check",
  bill: "receipt-text-outline",
  fee: "cash-minus",
  cash: "cash-multiple",
  money: "cash-multiple",
  wage: "cash-clock",
  salary: "cash-clock",
  compensation: "cash-clock",
  finance: "finance",
  financial: "finance",
  invest: "chart-line",
  investment: "chart-line",
  stock: "chart-line",
  dividend: "cash-plus",
  retirement: "beach",
  roth: "chart-line",
  contribution: "cash-plus",
  tax: "calculator",
  taxes: "calculator",
  purchase: "cart-outline",
  shopping: "cart-outline",
  ticket: "ticket-confirmation-outline",
  gift: "gift-outline",
  donation: "hand-heart-outline",

  // --- Health
  medical: "medical-bag",
  health: "heart-pulse",
  doctor: "stethoscope",
  hospital: "hospital-building",
  dentist: "tooth-outline",
  dental: "tooth-outline",
  lab: "test-tube",
  labs: "test-tube",
  labcorp: "test-tube",
  bloodwork: "blood-bag",
  blood: "blood-bag",
  // A1C is a blood test. Digits are stripped by normalizeIconName, so it
  // arrives as the two words "a" and "c" and is matched by SPECIAL_CASES
  // rather than keyed here — a bare "a" key would hit any name containing one.
  endocrinology: "test-tube",
  screening: "clipboard-pulse-outline",
  vaccine: "needle",
  vaccination: "needle",
  flu: "virus-outline",
  sick: "emoticon-sick-outline",
  illness: "virus-outline",
  medication: "pill",
  prescription: "pill",
  pharmacy: "pill",
  allergy: "allergy",
  injury: "bandage",
  accident: "car-emergency",
  emergency: "hospital-box-outline",
  eye: "eye-outline",
  vision: "eye-outline",
  height: "human-male-height",
  weight: "scale-bathroom",
  exam: "clipboard-text-outline",
  procedure: "medical-bag",
  intervention: "hand-heart-outline",
  episode: "pulse",
  outburst: "weather-lightning",
  therapy: "account-heart-outline",

  // --- School
  school: "school-outline",
  education: "school-outline",
  daycare: "teddy-bear",
  preschool: "teddy-bear",
  kindergarten: "teddy-bear",
  college: "school-outline",
  training: "book-education-outline",
  course: "book-education-outline",
  homework: "notebook-edit-outline",
  science: "flask-outline",
  library: "library-outline",
  reading: "book-open-page-variant-outline",
  book: "book-open-page-variant-outline",
  milestone: "flag-checkered",

  // --- Home, car, repairs
  home: "home-outline",
  house: "home-outline",
  repair: "wrench-outline",
  maintenance: "wrench-clock",
  plumbing: "pipe-wrench",
  electrical: "flash-outline",
  power: "flash-outline",
  utility: "transmission-tower",
  utilities: "transmission-tower",
  hvac: "air-conditioner",
  inspection: "home-search-outline",
  furniture: "sofa-outline",
  door: "door-closed",
  yard: "grass",
  garden: "flower-outline",
  farm: "barn",
  tree: "tree-outline",
  moving: "truck-outline",
  insurance: "shield-check-outline",
  claim: "file-document-edit-outline",
  medicaid: "shield-plus-outline",
  amerihealth: "shield-plus-outline",
  aid: "hand-heart-outline",

  car: "car-outline",
  toyota: "car-outline",
  camry: "car-outline",
  tire: "tire",
  oil: "oil",
  "oil change": "oil",
  recall: "alert-outline",

  // --- Work
  work: "briefcase-outline",
  job: "briefcase-outline",
  interview: "account-tie-voice",
  conference: "presentation",

  // --- Outings, travel, leisure
  travel: "airplane",
  trip: "map-marker-path",
  flight: "airplane",
  vacation: "beach",
  holiday: "palm-tree",
  hotel: "bed-outline",
  cancun: "palm-tree",
  beach: "beach",
  park: "tree-outline",
  playground: "slide",
  zoo: "elephant",
  museum: "bank-outline",
  mall: "shopping-outline",
  outing: "walk",
  amusement: "ferris-wheel",
  concert: "music",
  movie: "movie-open-outline",
  music: "music",
  photo: "camera-outline",
  art: "palette-outline",
  swim: "swim",
  sports: "basketball",
  sport: "basketball",
  exercise: "run",
  activity: "run",
  halloween: "halloween",
  birthday: "cake-variant-outline",
  celebration: "party-popper",
  party: "party-popper",
  gathering: "account-group-outline",
  lunch: "food-outline",
  dinner: "silverware-fork-knife",
  food: "food-outline",
  volunteer: "hand-heart-outline",
  trinity: "church",
  church: "church",

  // --- People and relationships
  family: "human-male-female-child",
  friend: "account-heart-outline",
  neighbor: "home-group",
  uncle: "account-outline",
  grandparents: "human-cane",
  computer: "laptop",
  personal: "account-circle-outline",
  parents: "human-male-female-child",
  pet: "paw",

  // --- Catch-alls
  issue: "alert-circle-outline",
  problem: "alert-circle-outline",
  shortage: "alert-outline",
  planning: "clipboard-list-outline",
  plan: "clipboard-list-outline",
  timer: "timer-outline",
  time: "clock-outline",
  old: "archive-outline",
  history: "history",
  thought: "thought-bubble-outline",
  idea: "lightbulb-outline",
  star: "star-outline",
  process: "cog-outline",
  services: "cog-outline",
  service: "cog-outline",
};

/**
 * Names matched on the *raw* string, before normalization.
 *
 * `normalizeIconName` strips digits, which is right for "Trip 2019" but destroys
 * an alphanumeric term of art: "401K" becomes "k" and "A1C" becomes "a c",
 * neither of which can be keyed in `SYNONYMS` without a one-letter key that
 * would swallow unrelated names. Matched case-insensitively on the whole
 * trimmed name only — these are exact terms, not keywords.
 */
const SPECIAL_CASES: Readonly<Record<string, string>> = {
  "401k": "chart-line",
  a1c: "test-tube",
  k5: "school-outline",
  sat: "school-outline",
  er: "hospital-box-outline",
  ptac: "air-conditioner",
  bms: "office-building-outline",
  ira: "chart-line",
};

/**
 * Icon for a name that looks like a *person's* name and matched nothing else.
 *
 * The journal's tag list is full of these ("Skylar", "Shufen Zhang", "Ting") and
 * no icon set has a glyph for a given name. A generic person beats the letter
 * tile, which is what this whole feature exists to get away from.
 */
const PERSON_ICON = "account";

/** A word we'd rather not treat as a person's name despite matching nothing. */
const NOT_A_PERSON = new Set([
  "misc",
  "other",
  "general",
  "todo",
  "stuff",
  "things",
  "various",
  "unknown",
]);

/**
 * Whether `name` reads as a person's name: one or two capitalised words, no
 * digits, and nothing that matched a synonym.
 *
 * Deliberately conservative — this only ever runs *after* every other pass has
 * failed, so the cost of a false positive is a person glyph on an obscure tag,
 * and the cost of a false negative is the letter tile we're trying to avoid.
 */
export function looksLikePersonName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === "" || /\d/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 2) return false;
  // An ALL-CAPS token is far more likely an acronym (BMS, ER, PTAC) than a name.
  if (trimmed === trimmed.toUpperCase() && trimmed.length <= 4) return false;
  if (words.some((word) => NOT_A_PERSON.has(word.toLowerCase()))) return false;
  return words.every((word) => /^\p{Lu}\p{L}*$/u.test(word));
}

/**
 * The Iconify icon name for a category/tag name, or undefined when nothing fits.
 *
 * Passes, most specific first: the alphanumeric special cases on the raw name,
 * then the whole normalized name, then any single word of it, then the
 * person-name heuristic. Mirrors `matchIconGlyph`'s shape so the two behave
 * predictably alongside each other.
 *
 * Returns a bare icon name without the set prefix; `iconifyIconId` adds it.
 */
export function matchIconName(name: string): string | undefined {
  const special = SPECIAL_CASES[name.trim().toLowerCase()];
  if (special) return special;

  const words = normalizeIconName(name);
  if (words.length === 0) return undefined;

  const joined = words.join(" ");
  if (SYNONYMS[joined]) return SYNONYMS[joined];

  const squashed = words.join("");
  if (SYNONYMS[squashed]) return SYNONYMS[squashed];

  for (const word of words) {
    if (SYNONYMS[word]) return SYNONYMS[word];
  }

  if (looksLikePersonName(name)) return PERSON_ICON;
  return undefined;
}

/** Full Iconify id (`mdi:home-outline`) for a name, or undefined. */
export function iconifyIconId(name: string): string | undefined {
  const icon = matchIconName(name);
  return icon === undefined ? undefined : `${ICON_SET_PREFIX}:${icon}`;
}
