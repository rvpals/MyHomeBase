// Builds a small SVG icon for a category or tag from its *name*, with no network
// call and no AI service — a keyword table plus a deterministic fallback.
//
// Why SVG when @/lib/shared/image-upload deliberately refuses it: that allowlist
// guards bytes *a user supplied*, which are served back from this app's own
// origin and so would be a stored-XSS vector. These bytes are ours. The markup
// comes from the fixed templates below, the only place a name reaches the output
// is one XML-escaped text node, and `isSafeGeneratedIconSvg` re-checks the result
// before anything is stored. The upload allowlist stays closed; this is a
// separate, narrower door.
//
// Pure: no I/O, no react/next imports (see ARCHITECTURE.md).

/** The canvas every glyph is drawn on. Fixed, so the paths below can be literal. */
const VIEWBOX = 64;

/** Exactly what a generated icon's root element looks like. The guard re-checks this. */
const SVG_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" width="${VIEWBOX}" height="${VIEWBOX}" role="img">`;

/** The mime type generated icons are stored and served as. */
export const GENERATED_ICON_MIME_TYPE = "image/svg+xml";

/**
 * A glyph: the inner markup drawn on top of the tinted tile, and the keywords
 * that select it.
 *
 * `body` is a template taking the stroke colour, because the tile's tint is
 * derived from the name — one glyph therefore renders in many colours rather
 * than needing a variant per hue. Shapes only: path/circle/rect/line, no text
 * (the fallback owns the one text node), no href, no script.
 */
interface Glyph {
  id: string;
  keywords: readonly string[];
  body: (stroke: string) => string;
}

// Stroke-drawn line art at a consistent weight, so a row of generated icons reads
// as one set rather than a scrapbook. Kept deliberately simple — these render at
// 20-48px, where detail is mud.
const STROKE = (stroke: string) =>
  `fill="none" stroke="${stroke}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"`;

const GLYPHS: readonly Glyph[] = [
  {
    id: "travel",
    keywords: [
      "travel",
      "trip",
      "flight",
      "flying",
      "plane",
      "airplane",
      "vacation",
      "holiday",
      "abroad",
      "journey",
      "tour",
      "tourism",
    ],
    body: (c) => `<path ${STROKE(c)} d="M8 34l48-16-10 18 6 14-10-6-10 8-2-12z"/>`,
  },
  {
    id: "food",
    keywords: [
      "food",
      "eat",
      "eating",
      "meal",
      "dinner",
      "lunch",
      "breakfast",
      "restaurant",
      "cooking",
      "cook",
      "recipe",
      "kitchen",
      "brunch",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M20 12v40M14 12v10a6 6 0 0012 0V12"/><path ${STROKE(c)} d="M44 12v40M38 12c0 8 12 8 12 0"/>`,
  },
  {
    id: "drink",
    keywords: ["drink", "coffee", "tea", "cafe", "beer", "wine", "cocktail"],
    body: (c) => `<path ${STROKE(c)} d="M18 16h28l-4 22a10 10 0 01-20 0zM30 48v8M22 56h16"/>`,
  },
  {
    id: "work",
    keywords: [
      "work",
      "job",
      "office",
      "career",
      "business",
      "meeting",
      "project",
      "client",
      "task",
    ],
    body: (c) =>
      `<rect ${STROKE(c)} x="10" y="22" width="44" height="28" rx="4"/><path ${STROKE(c)} d="M24 22v-6h16v6M10 34h44"/>`,
  },
  {
    id: "family",
    keywords: [
      "family",
      "kids",
      "children",
      "child",
      "parents",
      "mom",
      "dad",
      "baby",
      "people",
      "friends",
      "friend",
      "together",
    ],
    body: (c) =>
      `<circle ${STROKE(c)} cx="24" cy="22" r="8"/><circle ${STROKE(c)} cx="44" cy="26" r="6"/><path ${STROKE(c)} d="M10 52c0-9 6-14 14-14s14 5 14 14M40 52c0-7 4-11 10-11s6 3 6 8"/>`,
  },
  {
    id: "home",
    keywords: ["home", "house", "apartment", "flat", "moving", "chores", "garden"],
    body: (c) => `<path ${STROKE(c)} d="M10 30L32 12l22 18M16 30v22h32V30M27 52V38h10v14"/>`,
  },
  {
    id: "health",
    keywords: [
      "health",
      "doctor",
      "medical",
      "hospital",
      "dentist",
      "fitness",
      "workout",
      "exercise",
      "wellness",
      "therapy",
    ],
    body: (c) => `<path ${STROKE(c)} d="M32 54S8 40 8 26a13 13 0 0124-7 13 13 0 0124 7c0 14-24 28-24 28z"/>`,
  },
  {
    id: "sport",
    keywords: [
      "sport",
      "sports",
      "running",
      "football",
      "soccer",
      "basketball",
      "tennis",
      "swimming",
      "cycling",
      "hiking",
      "climbing",
    ],
    body: (c) =>
      `<circle ${STROKE(c)} cx="32" cy="32" r="22"/><path ${STROKE(c)} d="M32 10c-8 8-8 36 0 44M32 10c8 8 8 36 0 44M10 32h44"/>`,
  },
  {
    id: "music",
    keywords: ["music", "song", "songs", "concert", "band", "album", "piano", "guitar", "singing"],
    body: (c) =>
      `<circle ${STROKE(c)} cx="20" cy="46" r="7"/><circle ${STROKE(c)} cx="46" cy="40" r="7"/><path ${STROKE(c)} d="M27 46V18l26-5v27"/>`,
  },
  {
    id: "photo",
    keywords: ["photo", "photos", "photography", "camera", "picture", "pictures", "snapshot"],
    body: (c) =>
      `<rect ${STROKE(c)} x="8" y="18" width="48" height="34" rx="5"/><circle ${STROKE(c)} cx="32" cy="35" r="10"/><path ${STROKE(c)} d="M24 18l4-6h8l4 6"/>`,
  },
  {
    id: "book",
    keywords: [
      "book",
      "books",
      "reading",
      "study",
      "school",
      "learning",
      "course",
      "class",
      "notes",
      "writing",
      "diary",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M32 18C26 13 16 12 10 14v34c6-2 16-1 22 4 6-5 16-6 22-4V14c-6-2-16-1-22 4zM32 18v34"/>`,
  },
  {
    id: "money",
    keywords: [
      "money",
      "finance",
      "budget",
      "expense",
      "expenses",
      "shopping",
      "bank",
      "salary",
      "invest",
      "investment",
      "savings",
      "bill",
      "bills",
    ],
    body: (c) =>
      `<circle ${STROKE(c)} cx="32" cy="32" r="22"/><path ${STROKE(c)} d="M40 24c-2-3-5-4-8-4-5 0-8 3-8 6s3 5 8 6 8 3 8 6-3 6-8 6c-3 0-6-1-8-4M32 14v36"/>`,
  },
  {
    id: "idea",
    keywords: [
      "idea",
      "ideas",
      "thought",
      "thoughts",
      "reflection",
      "goal",
      "goals",
      "plan",
      "planning",
      "dream",
      "dreams",
      "inspiration",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M32 8a16 16 0 00-9 29v7h18v-7a16 16 0 00-9-29z"/><path ${STROKE(c)} d="M26 52h12M28 58h8"/>`,
  },
  {
    id: "nature",
    keywords: [
      "nature",
      "outdoors",
      "park",
      "tree",
      "trees",
      "forest",
      "beach",
      "mountain",
      "mountains",
      "camping",
      "walking",
    ],
    body: (c) => `<path ${STROKE(c)} d="M32 8l16 24H16zM32 22l20 24H12zM32 46v10"/>`,
  },
  {
    id: "weather",
    keywords: [
      "weather",
      "sunny",
      "summer",
      "rain",
      "rainy",
      "snow",
      "winter",
      "storm",
      "cloud",
      "cloudy",
    ],
    body: (c) =>
      `<circle ${STROKE(c)} cx="32" cy="32" r="11"/><path ${STROKE(c)} d="M32 8v6M32 50v6M8 32h6M50 32h6M16 16l4 4M44 44l4 4M48 16l-4 4M20 44l-4 4"/>`,
  },
  {
    id: "celebration",
    keywords: [
      "birthday",
      "party",
      "celebration",
      "anniversary",
      "wedding",
      "christmas",
      "festival",
      "gift",
    ],
    body: (c) =>
      `<rect ${STROKE(c)} x="10" y="26" width="44" height="26" rx="4"/><path ${STROKE(c)} d="M32 26v26M10 38h44M32 26c-6 0-10-3-10-7s8-2 10 7c2-9 10-11 10-7s-4 7-10 7z"/>`,
  },
  {
    id: "pet",
    keywords: ["pet", "pets", "dog", "cat", "animal", "animals", "puppy", "kitten"],
    body: (c) =>
      `<circle ${STROKE(c)} cx="18" cy="22" r="6"/><circle ${STROKE(c)} cx="32" cy="16" r="6"/><circle ${STROKE(c)} cx="46" cy="22" r="6"/><path ${STROKE(c)} d="M32 52c-9 0-15-5-15-11s6-11 15-11 15 5 15 11-6 11-15 11z"/>`,
  },
  {
    id: "tech",
    keywords: [
      "tech",
      "technology",
      "code",
      "coding",
      "computer",
      "software",
      "programming",
      "laptop",
      "gadget",
    ],
    body: (c) =>
      `<rect ${STROKE(c)} x="10" y="14" width="44" height="30" rx="4"/><path ${STROKE(c)} d="M6 52h52M26 26l-6 5 6 5M38 26l6 5-6 5"/>`,
  },
  {
    id: "place",
    keywords: ["place", "places", "location", "city", "town", "address", "visit"],
    body: (c) =>
      `<path ${STROKE(c)} d="M32 56s16-16 16-28a16 16 0 10-32 0c0 12 16 28 16 28z"/><circle ${STROKE(c)} cx="32" cy="27" r="6"/>`,
  },
  {
    id: "time",
    keywords: [
      "time",
      "daily",
      "routine",
      "morning",
      "evening",
      "night",
      "weekend",
      "history",
      "memory",
      "memories",
    ],
    body: (c) => `<circle ${STROKE(c)} cx="32" cy="32" r="22"/><path ${STROKE(c)} d="M32 18v15l11 7"/>`,
  },
  {
    id: "car",
    keywords: ["car", "driving", "road", "roadtrip", "commute", "traffic", "train", "transport"],
    body: (c) =>
      `<path ${STROKE(c)} d="M8 40v-8l6-12h36l6 12v8M8 40h48M8 40v6h8v-6M48 40v6h8v-6"/><circle ${STROKE(c)} cx="20" cy="40" r="4"/><circle ${STROKE(c)} cx="44" cy="40" r="4"/>`,
  },
  {
    id: "mail",
    keywords: ["mail", "email", "letter", "message", "phone", "contact", "chat"],
    body: (c) =>
      `<rect ${STROKE(c)} x="8" y="18" width="48" height="30" rx="4"/><path ${STROKE(c)} d="M8 22l24 16 24-16"/>`,
  },
  {
    id: "star",
    keywords: [
      "star",
      "favourite",
      "favorite",
      "important",
      "highlight",
      "special",
      "milestone",
      "achievement",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M32 8l7.5 15.5L56 26 44 37.5l3 17L32 46l-15 8.5 3-17L8 26l16.5-2.5z"/>`,
  },
  // --- Appointments, paperwork and admin. A household journal is mostly these,
  // and the first 23 glyphs covered none of them.
  {
    id: "appointment",
    keywords: [
      "appointment",
      "appointments",
      "appoint",
      "booking",
      "schedule",
      "scheduled",
      "reminder",
      "visit",
      "checkup",
      "consult",
      "consultation",
      "telehealth",
      "followup",
    ],
    body: (c) =>
      `<rect ${STROKE(c)} x="10" y="16" width="44" height="38" rx="4"/><path ${STROKE(c)} d="M10 28h44M22 16v-8M42 16v-8"/><path ${STROKE(c)} d="M23 40l6 6 12-12"/>`,
  },
  {
    id: "document",
    keywords: [
      "document",
      "paperwork",
      "form",
      "application",
      "statement",
      "letter",
      "transcript",
      "record",
      "records",
      "report",
      "certificate",
      "contract",
      "agreement",
      "notice",
      "registration",
      "enrollment",
      "renewal",
      "activation",
      "membership",
      "survey",
      "evaluation",
      "assessment",
      "process",
      "procedure",
      "closing",
      "escrow",
      "immigration",
      "passport",
      "visa",
      "license",
      "permit",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M18 8h20l12 12v36a4 4 0 01-4 4H18a4 4 0 01-4-4V12a4 4 0 014-4z"/><path ${STROKE(c)} d="M38 8v12h12M24 36h16M24 46h16"/>`,
  },
  {
    id: "insurance",
    keywords: [
      "insurance",
      "claim",
      "claims",
      "coverage",
      "policy",
      "medicaid",
      "medicare",
      "amerihealth",
      "deductible",
      "benefit",
      "benefits",
      "aid",
      "protection",
      "warranty",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M32 8l20 8v16c0 12-8 22-20 26-12-4-20-14-20-26V16z"/><path ${STROKE(c)} d="M32 24v14M25 31h14"/>`,
  },
  // --- Money, in more detail than the single "money" glyph allowed.
  {
    id: "bank",
    keywords: [
      "bank",
      "banking",
      "account",
      "loan",
      "mortgage",
      "credit",
      "debit",
      "card",
      "payment",
      "bill",
      "billing",
      "fee",
      "cash",
      "wage",
      "salary",
      "compensation",
      "deposit",
      "withdrawal",
      "transfer",
      "refund",
      "balance",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M8 26L32 12l24 14M14 26v22M50 26v22M8 54h48"/><path ${STROKE(c)} d="M24 48V34M40 48V34"/>`,
  },
  {
    id: "invest",
    keywords: [
      "invest",
      "investment",
      "investments",
      "stock",
      "stocks",
      "dividend",
      "retirement",
      "ira",
      "roth",
      "pension",
      "portfolio",
      "fund",
      "contribution",
      "brokerage",
      "shares",
      "growth",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M10 46l12-14 10 8 14-20"/><path ${STROKE(c)} d="M36 20h12v12"/><path ${STROKE(c)} d="M8 56h48"/>`,
  },
  {
    id: "tax",
    keywords: ["tax", "taxes", "audit", "irs", "filing", "deduction", "withholding"],
    body: (c) =>
      `<rect ${STROKE(c)} x="14" y="10" width="36" height="44" rx="4"/><path ${STROKE(c)} d="M22 22h20M24 34h4M24 44h4M36 34h4M36 44h4"/>`,
  },
  // --- Health, split out of the one "health" glyph.
  {
    id: "lab",
    keywords: [
      "lab",
      "labs",
      "labcorp",
      "bloodwork",
      "blood",
      "test",
      "tests",
      "sample",
      "screening",
      "biopsy",
      "panel",
      "cholesterol",
      "glucose",
      "endocrinology",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M26 8h12v20l10 20a6 6 0 01-5 9H21a6 6 0 01-5-9l10-20z"/><path ${STROKE(c)} d="M19 42h26"/>`,
  },
  {
    id: "medication",
    keywords: [
      "medication",
      "medicine",
      "prescription",
      "pill",
      "pills",
      "vaccine",
      "vaccination",
      "shot",
      "immunization",
      "dose",
      "pharmacy",
      "refill",
      "antibiotic",
    ],
    body: (c) =>
      `<rect ${STROKE(c)} x="8" y="24" width="48" height="16" rx="8"/><path ${STROKE(c)} d="M32 24v16"/>`,
  },
  {
    id: "injury",
    keywords: [
      "injury",
      "injured",
      "accident",
      "emergency",
      "urgent",
      "hurt",
      "wound",
      "fracture",
      "sprain",
      "burn",
      "sick",
      "illness",
      "allergy",
      "allergies",
      "episode",
      "outburst",
      "intervention",
    ],
    body: (c) => `<path ${STROKE(c)} d="M22 10h20v12h12v20H42v12H22V42H10V22h12z"/>`,
  },
  {
    id: "eye",
    keywords: ["eye", "eyes", "vision", "optometry", "glasses", "ophthalmology", "sight"],
    body: (c) =>
      `<path ${STROKE(c)} d="M6 32c8-12 16-18 26-18s18 6 26 18c-8 12-16 18-26 18S14 44 6 32z"/><circle ${STROKE(c)} cx="32" cy="32" r="7"/>`,
  },
  {
    id: "growth-chart",
    keywords: ["height", "weight", "measurement", "percentile"],
    body: (c) =>
      `<path ${STROKE(c)} d="M20 56V12a6 6 0 0112 0v44z"/><path ${STROKE(c)} d="M20 24h6M20 34h6M20 44h6M32 34h20"/>`,
  },
  // --- School and learning.
  {
    id: "school",
    keywords: [
      "school",
      "education",
      "class",
      "classes",
      "teacher",
      "student",
      "homework",
      "exam",
      "grade",
      "grades",
      "daycare",
      "preschool",
      "kindergarten",
      "college",
      "university",
      "tuition",
      "semester",
      "training",
      "course",
      "lesson",
      "tutor",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M32 12L6 24l26 12 26-12z"/><path ${STROKE(c)} d="M16 30v14c0 4 7 8 16 8s16-4 16-8V30"/>`,
  },
  {
    id: "science",
    keywords: ["science", "experiment", "chemistry", "biology", "physics", "research"],
    body: (c) =>
      `<circle ${STROKE(c)} cx="32" cy="32" r="6"/><path ${STROKE(c)} d="M32 8c8 0 14 10 14 24S40 56 32 56s-14-10-14-24S24 8 32 8z"/><path ${STROKE(c)} d="M12 20c4-6 14-4 24 2s16 14 12 20"/>`,
  },
  // --- Home, car and the things that break.
  {
    id: "repair",
    keywords: [
      "repair",
      "maintenance",
      "plumbing",
      "electrical",
      "hvac",
      "inspection",
      "service",
      "services",
      "contractor",
      "handyman",
      "install",
      "installation",
      "replacement",
      "door",
      "roof",
      "leak",
      "furnace",
      "boiler",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M40 8a12 12 0 00-9 20L14 45a6 6 0 008 8l17-17a12 12 0 001-28z"/>`,
  },
  {
    id: "utility",
    keywords: [
      "utility",
      "utilities",
      "power",
      "electric",
      "electricity",
      "water",
      "sewer",
      "internet",
      "cable",
      "outage",
      "meter",
    ],
    body: (c) => `<path ${STROKE(c)} d="M36 6L16 36h12l-4 22 22-32H34z"/>`,
  },
  {
    id: "furniture",
    keywords: ["furniture", "couch", "sofa", "chair", "table", "mattress", "desk", "shelf"],
    body: (c) =>
      `<path ${STROKE(c)} d="M10 34v-8a6 6 0 016-6h32a6 6 0 016 6v8"/><path ${STROKE(c)} d="M6 34h52v14H6z"/><path ${STROKE(c)} d="M12 48v6M52 48v6"/>`,
  },
  {
    id: "yard",
    keywords: ["yard", "lawn", "farm", "landscaping", "fence", "planting"],
    body: (c) =>
      `<path ${STROKE(c)} d="M32 56V30"/><path ${STROKE(c)} d="M32 30c0-10-6-16-14-16 0 10 6 16 14 16zM32 30c0-10 6-16 14-16 0 10-6 16-14 16z"/><path ${STROKE(c)} d="M12 56h40"/>`,
  },
  {
    id: "tire",
    keywords: [
      "tire",
      "tires",
      "wheel",
      "brake",
      "brakes",
      "recall",
      "toyota",
      "camry",
      "honda",
      "mileage",
    ],
    body: (c) =>
      `<circle ${STROKE(c)} cx="32" cy="32" r="22"/><circle ${STROKE(c)} cx="32" cy="32" r="8"/><path ${STROKE(c)} d="M32 10v14M32 40v14M10 32h14M40 32h14"/>`,
  },
  // --- People, places and outings.
  {
    id: "person",
    keywords: [
      "person",
      "neighbor",
      "neighbour",
      "uncle",
      "aunt",
      "cousin",
      "grandparents",
      "grandma",
      "grandpa",
      "relative",
      "colleague",
      "contact",
    ],
    body: (c) =>
      `<circle ${STROKE(c)} cx="32" cy="22" r="10"/><path ${STROKE(c)} d="M12 56c0-11 9-18 20-18s20 7 20 18"/>`,
  },
  {
    id: "outing",
    keywords: [
      "outing",
      "zoo",
      "museum",
      "playground",
      "mall",
      "library",
      "amusement",
      "fair",
      "aquarium",
      "picnic",
      "hike",
      "hiking",
      "camping",
      "gathering",
      "meetup",
      "lunch",
      "dinner",
      "brunch",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M8 52l16-32 10 18 6-10 16 24z"/><circle ${STROKE(c)} cx="46" cy="16" r="6"/>`,
  },
  {
    id: "hotel",
    keywords: [
      "hotel",
      "motel",
      "resort",
      "airbnb",
      "lodging",
      "reservation",
      "cancun",
      "cruise",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M8 50V22a4 4 0 014-4h40a4 4 0 014 4v28"/><path ${STROKE(c)} d="M4 50h56M20 34h24M20 42h24"/>`,
  },
  {
    id: "movie",
    keywords: ["movie", "movies", "film", "cinema", "theater", "theatre", "series", "streaming"],
    body: (c) =>
      `<rect ${STROKE(c)} x="8" y="16" width="48" height="32" rx="4"/><path ${STROKE(c)} d="M8 26h48M20 16v10M36 16v10M20 38h24"/>`,
  },
  {
    id: "art",
    keywords: ["art", "craft", "drawing", "painting", "creative", "design", "sketch", "coloring"],
    body: (c) =>
      `<path ${STROKE(c)} d="M32 8a24 24 0 000 48c4 0 6-3 6-6s-2-5-2-8 3-6 6-6h4a14 14 0 0010-14c0-8-10-14-24-14z"/><circle ${STROKE(c)} cx="22" cy="26" r="3"/><circle ${STROKE(c)} cx="32" cy="20" r="3"/>`,
  },
  {
    id: "swim",
    keywords: ["swim", "swimming", "pool", "surf", "snorkel", "lifeguard"],
    body: (c) =>
      `<circle ${STROKE(c)} cx="42" cy="20" r="6"/><path ${STROKE(c)} d="M8 34l8-4 10 6 10-6 10 6 10-4"/><path ${STROKE(c)} d="M8 48l8-4 10 6 10-6 10 6 10-4"/>`,
  },
  // --- Work, admin and communication.
  {
    id: "interview",
    keywords: [
      "interview",
      "hiring",
      "recruiter",
      "resume",
      "offer",
      "onboarding",
      "conference",
      "presentation",
      "performance",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M8 14h32a4 4 0 014 4v14a4 4 0 01-4 4H20l-12 10z"/><path ${STROKE(c)} d="M50 26h6v14a4 4 0 01-4 4h-4l-6 8V44"/>`,
  },
  {
    id: "message",
    keywords: ["message", "email", "wechat", "text", "call", "phone", "voicemail", "chat"],
    body: (c) =>
      `<rect ${STROKE(c)} x="8" y="14" width="48" height="34" rx="4"/><path ${STROKE(c)} d="M8 20l24 16 24-16"/>`,
  },
  {
    id: "package",
    keywords: [
      "package",
      "delivery",
      "shipment",
      "parcel",
      "order",
      "shipping",
      "tracking",
      "purchase",
      "shopping",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M8 22l24-10 24 10v22L32 54 8 44z"/><path ${STROKE(c)} d="M8 22l24 10 24-10M32 32v22"/>`,
  },
  {
    id: "ticket",
    keywords: ["ticket", "tickets", "admission", "pass", "boarding", "voucher", "coupon"],
    body: (c) =>
      `<path ${STROKE(c)} d="M8 20h48v10a6 6 0 000 12v10H8V42a6 6 0 000-12z"/><path ${STROKE(c)} d="M32 22v20"/>`,
  },
  {
    id: "gift",
    keywords: ["gift", "gifts", "present", "donation", "charity", "volunteer", "giving"],
    body: (c) =>
      `<rect ${STROKE(c)} x="8" y="24" width="48" height="10" rx="2"/><path ${STROKE(c)} d="M12 34v20h40V34M32 24v30"/><path ${STROKE(c)} d="M32 24c-8 0-12-3-12-7s7-5 12 7c5-12 12-11 12-7s-4 7-12 7z"/>`,
  },
  {
    id: "problem",
    keywords: [
      "problem",
      "issue",
      "issues",
      "shortage",
      "complaint",
      "dispute",
      "error",
      "delay",
      "trouble",
      "concern",
      "warning",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M32 10l24 42H8z"/><path ${STROKE(c)} d="M32 26v12M32 44v2"/>`,
  },
  {
    id: "activity",
    keywords: [
      "activity",
      "activities",
      "exercise",
      "workout",
      "gym",
      "running",
      "walk",
      "yoga",
      "fitness",
      "practice",
    ],
    body: (c) =>
      `<path ${STROKE(c)} d="M12 26h6v12h-6zM46 26h6v12h-6z"/><path ${STROKE(c)} d="M18 32h28M22 20h4v24h-4zM38 20h4v24h-4z"/>`,
  },
  {
    id: "planning",
    keywords: [
      "planning",
      "plan",
      "goal",
      "goals",
      "todo",
      "checklist",
      "list",
      "preparation",
      "note",
      "notes",
      "thought",
      "thoughts",
    ],
    body: (c) =>
      `<rect ${STROKE(c)} x="12" y="10" width="40" height="44" rx="4"/><path ${STROKE(c)} d="M20 24l4 4 8-8M20 40l4 4 8-8M38 24h8M38 40h8"/>`,
  },
];

/** Every glyph id, for tests and for anything wanting to show the palette. */
export const GENERATED_ICON_GLYPH_IDS: readonly string[] = GLYPHS.map((glyph) => glyph.id);

/**
 * Splits a name into comparable words: lowercased, punctuation and digits gone.
 *
 * "Trip: Zurich 2019!" -> ["trip", "zurich"]. Digits are dropped rather than kept
 * because a year is never a keyword, and keeping it would only ever add noise.
 */
export function normalizeIconName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s-]+/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word !== "");
}

/**
 * Stable 32-bit hash of a string (FNV-1a). Used for the tile colour, so a given
 * name always produces the same icon — regenerating is idempotent, and two
 * screens showing the same tag never disagree.
 */
function hashName(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    // >>> 0 keeps this an unsigned 32-bit multiply rather than drifting into
    // float territory, which is what makes the hash stable across runs.
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The glyph a name selects, or undefined when nothing matches.
 *
 * Three passes, most specific first: the whole name as one keyword, then any word
 * of it, then a keyword contained in the name (so "roadtrip" finds "road") — and
 * failing all three, nothing, so the caller draws the initial tile instead.
 */
export function matchIconGlyph(name: string): string | undefined {
  const words = normalizeIconName(name);
  if (words.length === 0) return undefined;
  const joined = words.join("");
  const wordSet = new Set(words);

  for (const glyph of GLYPHS) {
    if (glyph.keywords.includes(joined)) return glyph.id;
  }
  for (const glyph of GLYPHS) {
    if (glyph.keywords.some((keyword) => wordSet.has(keyword))) return glyph.id;
  }
  for (const glyph of GLYPHS) {
    // Only keywords long enough to be meaningful — a 2-3 letter one would match
    // half the dictionary ("bar" inside "barcelona", "tea" inside "team").
    if (glyph.keywords.some((keyword) => keyword.length >= 4 && joined.includes(keyword))) {
      return glyph.id;
    }
  }
  return undefined;
}

/** Escapes the five XML specials. The fallback's initial is the only untrusted text. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * The one character the fallback tile shows: the first letter or digit of the
 * name, upper case. A name with neither (an emoji-only tag, say) gets a dot
 * rather than an empty tile — and the dot is ours, so it can't carry markup.
 */
function initialFor(name: string): string {
  const letter = name.trim().match(/\p{L}|\p{N}/u);
  return letter ? letter[0].toUpperCase() : "•";
}

/**
 * Tile background / stroke pair, both derived from the name's hash.
 *
 * Exported as `iconTileColors` so a *fetched* icon (icon-fetch.ts) is tinted by
 * the same name-hash as a hand-drawn one, and a row mixing the two still reads
 * as one set.
 */
export function iconTileColors(name: string): { fill: string; stroke: string } {
  const hue = hashName(name.toLowerCase()) % 360;
  // Fixed saturation and lightness: the hue moves, so every generated icon sits
  // at the same weight and none of them fights the brass UI around it.
  return { fill: `hsl(${hue} 62% 92%)`, stroke: `hsl(${hue} 58% 34%)` };
}

/**
 * The generated icon for a name: a tinted rounded tile with either a matched
 * glyph or the name's initial on it.
 *
 * Deterministic — same name in, byte-identical SVG out.
 */
/**
 * Mounts finished glyph markup on the tinted tile.
 *
 * Shared with icon-fetch.ts so the tile — its size, radius and tint — is defined
 * once. A caller passing unvetted markup must still put the result through
 * `isSafeGeneratedIconSvg`; this only assembles.
 */
export function wrapIconBody(name: string, body: string): string {
  const { fill } = iconTileColors(name);
  return `${SVG_OPEN}<rect x="2" y="2" width="60" height="60" rx="14" fill="${fill}"/>${body}</svg>`;
}

export function buildGeneratedIconSvg(name: string): string {
  if (name.trim() === "") throw new Error("Cannot generate an icon for an empty name.");

  const { stroke } = iconTileColors(name);

  const glyphId = matchIconGlyph(name);
  const glyph = GLYPHS.find((candidate) => candidate.id === glyphId);

  const content = glyph
    ? glyph.body(stroke)
    : // No keyword matched, so the name itself is the icon. `escapeXml` plus the
      // single-character `initialFor` means the name can't reach the output as
      // markup even when it is something like `</svg><script>`.
      `<text x="32" y="33" text-anchor="middle" dominant-baseline="central" font-family="Georgia, serif" font-size="34" font-weight="700" fill="${stroke}">${escapeXml(initialFor(name))}</text>`;

  return wrapIconBody(name, content);
}

/** Elements a generated icon may contain. Anything else fails the guard. */
const ALLOWED_ELEMENTS = new Set([
  "svg",
  "rect",
  "circle",
  "ellipse",
  "line",
  "path",
  "polyline",
  "polygon",
  "g",
  "text",
]);

/**
 * Whether `svg` is something this module could have produced and is safe to store
 * and serve.
 *
 * Belt to `buildGeneratedIconSvg`'s braces: the builder already can't emit script,
 * but this runs on the string that is actually about to be written to the DB, so a
 * future edit to a glyph body can't quietly introduce an `onload=` without a test
 * going red. The rules are deliberately blunt — an allowlist of elements, and a
 * flat refusal of the attributes and elements that make an SVG active.
 */
export function isSafeGeneratedIconSvg(svg: string): boolean {
  if (!svg.startsWith(SVG_OPEN) || !svg.endsWith("</svg>")) return false;
  // Comments, CDATA and processing instructions have no business here and are the
  // usual smuggling routes past a naive element scan.
  if (/<!|<\?|]]>/.test(svg)) return false;
  // Event handlers, script, external references, embedded HTML, style (which can
  // carry url() and @import), and the animation elements that can retarget an
  // attribute at a URL.
  if (/\son\w+\s*=/i.test(svg)) return false;
  if (/<\s*\/?\s*(script|foreignObject|iframe|use|image|a|style|animate|set|handler)\b/i.test(svg)) {
    return false;
  }
  if (/(href|xlink:href|src|style|filter|mask|clip-path)\s*=/i.test(svg)) return false;
  if (/javascript:|data:|url\s*\(/i.test(svg)) return false;

  // Every element name in the string must be one we allow.
  for (const match of svg.matchAll(/<\s*\/?\s*([a-zA-Z][\w:-]*)/g)) {
    if (!ALLOWED_ELEMENTS.has(match[1])) return false;
  }
  return true;
}
