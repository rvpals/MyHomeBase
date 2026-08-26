// Composition root: builds real dependencies (repositories, clients) and hands them
// to use-cases. Both src/app and src/cli import `deps` from here — never construct a
// repository directly in a presentation file.
import path from "node:path";
import Database from "better-sqlite3";
import { SqliteAttendanceRepository } from "./attendance/repository";
import { SqliteAuthEventRepository } from "./auth-events/repository";
import { SqliteSessionRepository } from "./auth/repository";
import { GoogleAuthClient } from "./auth/google-client";
import type { GoogleOAuthClient } from "./auth/ports";
import { FileChangeHistoryRepository } from "./change-history/repository";
import { SqliteCsvAnalyticsRepository } from "./csv-analytics/repository";
import { SqliteCsvImportMappingRepository } from "./csv-import/repository";
import { SqliteDashboardTextureRepository } from "./dashboard-texture/repository";
import { SqliteModuleTextureRepository } from "./module-texture/repository";
import { SqliteDailyQuoteRepository } from "./daily-quote/repository";
import { NodeCsvFolder } from "./expense/csv-folder";
import { SqliteExpenseRepository } from "./expense/repository";
import { NominatimGeocodingClient } from "./geocoding/nominatim-client";
import { OpenMeteoWeatherClient } from "./weather/open-meteo-client";
import { SqliteInvestmentAccountRepository } from "./investment-accounts/repository";
import { SqliteJournalRepository } from "./journal/repository";
import { NodePhotoFileStore } from "./journal-photos/file-store";
import { YahooFinanceClient } from "./market-data/yahoo-finance-client";
import { SqliteModuleSettingsRepository } from "./module-settings/repository";
import { SqliteModuleRepository } from "./modules/repository";
import { LrclibLyricsClient } from "./music/lrclib-client";
import { NodeMusicFileStore } from "./music/file-store";
import { MusicMetadataReader } from "./music/metadata-reader";
import { SqliteMusicRepository } from "./music/repository";
import {
  SqliteMagicCandidateSource,
  SqliteMagicListRepository,
} from "./music-magic/repository";
import { SqliteScheduledRunRepository } from "./scheduled-refresh/repository";
import { SqliteSettingsRepository } from "./settings/repository";
import { SqliteSqlExplorerRepository } from "./sql-explorer/repository";
import { SqliteStockAnalyticsRepository } from "./stock-analytics/repository";
import { SqliteDailySnapshotRepository } from "./stock-daily-snapshot/repository";
import { SqliteStockPositionRepository } from "./stock-positions/repository";
import { SqliteStockWatchListRepository } from "./stock-watchlist/repository";
import { RealSystemInfoRepository } from "./system-info/repository";
import { YahooTickerNewsClient } from "./ticker-news/yahoo-news-client";
import { FmpTickerLogoClient } from "./ticker-logos/fmp-logo-client";
import { SqliteTickerFavoriteRepository } from "./ticker-favorites/repository";
import { SqliteTickerLogoRepository } from "./ticker-logos/repository";
import { SqliteTickerRiskCacheRepository } from "./ticker-overview/repository";
import { SqliteTickerProfileRepository } from "./ticker-profiles/repository";
import { YahooTickerProfileClient } from "./ticker-profiles/yahoo-profile-client";
import { SqliteUserPreferencesRepository } from "./user-preferences/repository";
import { SqliteUserRepository } from "./user/repository";

const dbPath = process.env.MYHOMEBASE_DB ?? path.join(process.cwd(), "data", "myhomebase.db");

// Cache the connection on globalThis so Next.js dev-mode hot reloads reuse it
// instead of opening a new file handle on every module reload.
const globalForDb = globalThis as unknown as { __myhomebaseDb?: Database.Database };

const db =
  globalForDb.__myhomebaseDb ??
  (() => {
    const connection = new Database(dbPath);
    connection.pragma("journal_mode = WAL");
    return connection;
  })();

globalForDb.__myhomebaseDb = db;

// The music folder. Read here rather than in src/lib/music so the library code never
// touches process.env: `//NAS_DS223/MEDIA/AUDIO` over SMB from Windows in dev,
// `/volume1/MEDIA/AUDIO` locally on the NAS in production. Unset means the Music
// Library module reports "not configured" rather than crashing.
const musicRoot = process.env.MYHOMEBASE_MUSIC_ROOT ?? "";

// The photo archive's root is NOT read from the environment, unlike the music folder.
//
// It lives in the Journal module's settings (`photo_root`), editable on the module's
// Configuration screen. The music root predates that decision and stays as it is; this
// one is a setting because the two environments need different values (a UNC path from
// Windows in dev, `/volume1/...` on the NAS) and an env var can only be corrected by
// editing a file on the box and restarting -- which is how a wrong value went unnoticed
// on the NAS. A setting can be fixed, and verified with "Check Access", in the browser.
//
// `photoFileStoreFor(root)` therefore builds a store per request from the stored path,
// rather than `deps` holding one built at boot. The env var is still honoured as a
// fallback so an install that set it keeps working.
const photoRootFromEnv = process.env.MYHOMEBASE_PHOTO_ROOT ?? "";

// Google sign-in is only enabled when all three env vars are set — every
// adapter treats `deps.googleOAuthClient === undefined` as "feature off"
// rather than reading env vars itself.
const googleOAuthClient: GoogleOAuthClient | undefined =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI
    ? new GoogleAuthClient({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI,
      })
    : undefined;

// Self-signup can mint an admin account only when the visitor supplies the
// secret configured here. Unset (or empty) means "no admin signups possible" —
// `registerUser` rejects any admin-secret attempt when this is undefined.
const adminSignupSecret: string | undefined = process.env.ADMIN_SIGNUP_SECRET || undefined;

// Hoisted out of `deps` because two entries share it: the Yahoo client is both
// the market-data source and the quoteSummary source the sector lookup reads.
// One instance means one crumb handshake rather than two.
const marketDataClient = new YahooFinanceClient();

export const deps = {
  moduleRepo: new SqliteModuleRepository(db),
  settingsRepo: new SqliteSettingsRepository(db),
  moduleSettingsRepo: new SqliteModuleSettingsRepository(db),
  userRepo: new SqliteUserRepository(db),
  userPreferencesRepo: new SqliteUserPreferencesRepository(db),
  sessionRepo: new SqliteSessionRepository(db),
  authEventRepo: new SqliteAuthEventRepository(db),
  investmentAccountRepo: new SqliteInvestmentAccountRepository(db),
  journalRepo: new SqliteJournalRepository(db),
  /**
   * A read-only view of the photo archive at `root`.
   *
   * A factory rather than a ready-made instance because the path is a per-install
   * SETTING, so it is only known once the request has read it. Read-only by
   * construction, like the music store — PhotoFileStore has no write method, so nothing
   * here can modify the archive.
   */
  photoFileStoreFor: (root: string) => new NodePhotoFileStore(root),
  /** Fallback for an install still configured through the environment. */
  photoRootFromEnv,
  expenseRepo: new SqliteExpenseRepository(db),
  attendanceRepo: new SqliteAttendanceRepository(db),
  musicRepo: new SqliteMusicRepository(db),
  // Read-only by construction — MusicFileStore has no write method, so nothing here
  // can modify the music collection.
  musicFileStore: new NodeMusicFileStore(musicRoot),
  musicRoot,
  musicMetadataReader: new MusicMetadataReader(musicRoot),
  lyricsClient: new LrclibLyricsClient(),
  // Magic Playlists. Two ports rather than one: the candidate source only reads the
  // catalog, so a test can fake the eligible tracks without faking saved-list storage.
  magicListRepo: new SqliteMagicListRepository(db),
  magicCandidateSource: new SqliteMagicCandidateSource(db),
  csvFolder: new NodeCsvFolder(),
  csvImportMappingRepo: new SqliteCsvImportMappingRepository(db),
  csvAnalyticsRepo: new SqliteCsvAnalyticsRepository(db),
  dailyQuoteRepo: new SqliteDailyQuoteRepository(db),
  // The home dashboard's background picture (migrations/0063). The BLOB is read
  // only by src/app/api/dashboard/texture/route.ts; every other caller reads
  // `hasImage` off the settings row.
  dashboardTextureRepo: new SqliteDashboardTextureRepository(db),
  // A module's own background picture, keyed by slug (migrations/0064). Same
  // split as above: the BLOB is read only by
  // src/app/api/modules/[slug]/texture/route.ts.
  moduleTextureRepo: new SqliteModuleTextureRepository(db),
  stockPositionRepo: new SqliteStockPositionRepository(db),
  stockDailySnapshotRepo: new SqliteDailySnapshotRepository(db),
  // Last-run bookkeeping for background jobs, keyed by job name (migrations/0061).
  scheduledRunRepo: new SqliteScheduledRunRepository(db),
  stockWatchListRepo: new SqliteStockWatchListRepository(db),
  stockAnalyticsRepo: new SqliteStockAnalyticsRepository(db),
  sqlExplorerRepo: new SqliteSqlExplorerRepository(db),
  systemInfoRepo: new RealSystemInfoRepository(),
  changeHistoryRepo: new FileChangeHistoryRepository(),
  marketDataClient,
  tickerNewsClient: new YahooTickerNewsClient(),
  tickerLogoRepo: new SqliteTickerLogoRepository(db),
  tickerLogoClient: new FmpTickerLogoClient(),
  tickerFavoriteRepo: new SqliteTickerFavoriteRepository(db),
  tickerRiskCacheRepo: new SqliteTickerRiskCacheRepository(db),
  tickerProfileRepo: new SqliteTickerProfileRepository(db),
  // Sector data rides on the quoteSummary client the detail tab already uses —
  // same provider, same crumb handling, no second HTTP client.
  tickerProfileClient: new YahooTickerProfileClient(marketDataClient),
  geocodingClient: new NominatimGeocodingClient(),
  weatherClient: new OpenMeteoWeatherClient(),
  googleOAuthClient,
  adminSignupSecret,
};
