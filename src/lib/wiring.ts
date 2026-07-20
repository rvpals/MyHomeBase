// Composition root: builds real dependencies (repositories, clients) and hands them
// to use-cases. Both src/app and src/cli import `deps` from here — never construct a
// repository directly in a presentation file.
import path from "node:path";
import Database from "better-sqlite3";
import { SqliteSessionRepository } from "./auth/repository";
import { GoogleAuthClient } from "./auth/google-client";
import type { GoogleOAuthClient } from "./auth/ports";
import { SqliteCsvAnalyticsRepository } from "./csv-analytics/repository";
import { SqliteCsvImportMappingRepository } from "./csv-import/repository";
import { SqliteInvestmentAccountRepository } from "./investment-accounts/repository";
import { YahooFinanceClient } from "./market-data/yahoo-finance-client";
import { SqliteModuleSettingsRepository } from "./module-settings/repository";
import { SqliteModuleRepository } from "./modules/repository";
import { RentCastLookupClient } from "./property-watch/rentcast-client";
import type { PropertyLookupClient } from "./property-watch/ports";
import { SqliteWatchedPropertyRepository } from "./property-watch/repository";
import { SqlitePropertyRepository } from "./real-estate/repository";
import { SqliteSettingsRepository } from "./settings/repository";
import { SqliteSqlExplorerRepository } from "./sql-explorer/repository";
import { SqliteStockAnalyticsRepository } from "./stock-analytics/repository";
import { SqliteStockPositionRepository } from "./stock-positions/repository";
import { SqliteStockWatchListRepository } from "./stock-watchlist/repository";
import { RealSystemInfoRepository } from "./system-info/repository";
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

// Property lookup (RentCast) is only enabled when an API key is set — every
// adapter treats `deps.propertyLookupClient === undefined` as "feature off".
const propertyLookupClient: PropertyLookupClient | undefined = process.env.RENTCAST_API_KEY
  ? new RentCastLookupClient({ apiKey: process.env.RENTCAST_API_KEY })
  : undefined;

export const deps = {
  moduleRepo: new SqliteModuleRepository(db),
  settingsRepo: new SqliteSettingsRepository(db),
  moduleSettingsRepo: new SqliteModuleSettingsRepository(db),
  userRepo: new SqliteUserRepository(db),
  sessionRepo: new SqliteSessionRepository(db),
  propertyRepo: new SqlitePropertyRepository(db),
  watchedPropertyRepo: new SqliteWatchedPropertyRepository(db),
  investmentAccountRepo: new SqliteInvestmentAccountRepository(db),
  csvImportMappingRepo: new SqliteCsvImportMappingRepository(db),
  csvAnalyticsRepo: new SqliteCsvAnalyticsRepository(db),
  stockPositionRepo: new SqliteStockPositionRepository(db),
  stockWatchListRepo: new SqliteStockWatchListRepository(db),
  stockAnalyticsRepo: new SqliteStockAnalyticsRepository(db),
  sqlExplorerRepo: new SqliteSqlExplorerRepository(db),
  systemInfoRepo: new RealSystemInfoRepository(),
  marketDataClient: new YahooFinanceClient(),
  propertyLookupClient,
  googleOAuthClient,
};
