// The real dependency probes behind Admin -> Code Tester -> "Dependency test".
//
// Each one exercises the path the app itself takes: the same lazy `await import()`,
// a small real workload, and the facts that explain a break when there is one --
// which platform build is installed, which ABI the server runs, where a model file
// is read from. None of them touches the app's database or any user file: SQLite
// works on an in-memory database and a throwaway file in the OS temp folder.
//
// ## Every library import is lazy, for the reason text-engines.ts gives
//
// `wiring.ts` builds these and every page imports `wiring.ts`, so a top-level import
// would load four native/WASM libraries on every render -- and a broken one would
// take the whole app down instead of failing its own check.
//
// (better-sqlite3 is the exception in practice: `wiring.ts` itself opens the app
// database with it at the top level, so if its binding is broken the server never
// boots and this page is never reached. Its check is still useful for the facts --
// engine version, compile options, WAL on a real file -- and for the CLI.)

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
  OCR_LANGUAGE,
  OCR_WORKER_START_TIMEOUT_MS,
  checkOcrWorkerFiles,
  ocrModelFolder,
  ocrWorkerOptions,
  startOcrWorker,
} from "@/lib/documents";
import {
  describeErrorFully,
  type DependencyProbe,
  type DependencyRecorder,
  type RuntimeInfo,
} from "./dependency-checks";
import { OCR_SAMPLE_PNG_BASE64, OCR_SAMPLE_WORDS } from "./ocr-sample";

/** Below this mean confidence a clean printed sample is suspicious, though readable. */
const OCR_MIN_CONFIDENCE = 70;

function nodeModulesDir(): string {
  return path.join(process.cwd(), "node_modules");
}

/**
 * The version in `node_modules/<name>/package.json`, or `unknown`.
 *
 * Read from disk rather than `require`d: several of these packages' `exports` maps
 * don't expose `package.json`, and in the standalone NAS build `node_modules` sits
 * beside `server.js`, which is the process's cwd there too.
 */
function packageVersion(name: string): string {
  try {
    const json = JSON.parse(readFileSync(path.join(nodeModulesDir(), name, "package.json"), "utf8")) as {
      version?: string;
    };
    return json.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** `@img/sharp-*` or `@napi-rs/canvas-*`: the platform builds actually installed. */
function installedPlatformBuilds(scope: string, prefix: string): string[] {
  try {
    return readdirSync(path.join(nodeModulesDir(), scope)).filter((entry) => entry.startsWith(prefix));
  } catch {
    return [];
  }
}

function describeFile(file: string): string {
  const stat = statSync(file);
  return `${(stat.size / 1024).toFixed(0)} KB, modified ${stat.mtime.toISOString().slice(0, 16).replace("T", " ")}`;
}

/** The platform-build check sharp and canvas share. A mismatch is a FAIL, not a warning. */
function checkPlatformBuild(record: DependencyRecorder, builds: string[], expectedPrefix: string): void {
  record.fact("Platform builds installed", builds.length > 0 ? builds.join(", ") : "none found");
  const matching = builds.filter((build) => build.startsWith(expectedPrefix));
  record.check(
    "Build for this platform",
    matching.length > 0,
    matching.length > 0
      ? `${matching.join(", ")} matches ${process.platform}/${process.arch}`
      : `no ${expectedPrefix}* package -- only ${builds.join(", ") || "none"}; a build for another platform was shipped`,
  );
}

// ---------------------------------------------------------------- SQLite

const sqliteProbe: DependencyProbe = {
  id: "sqlite",
  label: "SQLite (better-sqlite3)",
  purpose: "Every page: the app database and every module's tables.",
  async run(record) {
    record.version(packageVersion("better-sqlite3"));
    record.fact("Node ABI (process.versions.modules)", process.versions.modules);

    const binding = path.join(nodeModulesDir(), "better-sqlite3", "build", "Release", "better_sqlite3.node");
    record.fact("Native binding", binding);
    record.check(
      "Native binding on disk",
      existsSync(binding),
      existsSync(binding) ? describeFile(binding) : "not at the expected path; the load below says whether it is found elsewhere",
      "warn",
    );

    const Database = await record.step(
      "Load module",
      async () => (await import("better-sqlite3")).default,
      () => "binding loaded into this process",
    );

    const memory = await record.step("Open in-memory database", () => new Database(":memory:"), () => ":memory:");
    try {
      const engine = await record.step(
        "Engine version",
        () => (memory.prepare("select sqlite_version() as v").get() as { v: string }).v,
        (version) => `SQLite ${version}`,
      );
      record.fact("SQLite engine", engine);

      await record.step(
        "Write, then read back",
        () => {
          memory.exec("create table probe (id integer primary key, label text not null, amount real not null)");
          const insert = memory.prepare("insert into probe (label, amount) values (?, ?)");
          memory.transaction(() => {
            insert.run("alpha", 1.5);
            insert.run("beta", 2.25);
            insert.run("gamma", 3);
          })();
          const row = memory.prepare("select count(*) as n, sum(amount) as total from probe").get() as {
            n: number;
            total: number;
          };
          if (row.n !== 3 || row.total !== 6.75) {
            throw new Error(`read back ${row.n} rows totalling ${row.total}, expected 3 totalling 6.75`);
          }
          return row;
        },
        (row) => `3 rows in a transaction, read back ${row.n} totalling ${row.total}`,
      );

      await record.step(
        "JSON functions",
        () => {
          const value = (memory.prepare(`select json_extract('{"a":[1,2,3]}', '$.a[1]') as v`).get() as { v: number }).v;
          if (value !== 2) throw new Error(`json_extract returned ${value}, expected 2`);
          return value;
        },
        () => "json_extract works",
      );

      const options = (memory.pragma("compile_options") as { compile_options: string }[]).map(
        (row) => row.compile_options,
      );
      record.fact("Compile options", `${options.length} (${options.filter((o) => o.startsWith("ENABLE_")).join(", ")})`);
      let hasFts5 = true;
      try {
        memory.exec("create virtual table probe_fts using fts5(body)");
      } catch {
        hasFts5 = false;
      }
      record.check("FTS5 full-text search", hasFts5, hasFts5 ? "available" : "not compiled in", "warn");
    } finally {
      memory.close();
    }

    // The app runs the real database in WAL mode, which an in-memory database can't
    // use, so WAL gets its own throwaway file in the OS temp folder.
    const folder = mkdtempSync(path.join(os.tmpdir(), "myhomebase-deptest-"));
    try {
      await record.step(
        "WAL mode on a temp file",
        () => {
          const file = new Database(path.join(folder, "probe.db"));
          try {
            const mode = file.pragma("journal_mode = WAL", { simple: true });
            if (mode !== "wal") throw new Error(`journal_mode came back "${String(mode)}", expected "wal"`);
            file.exec("create table t (x); insert into t values (1);");
            return mode;
          } finally {
            file.close();
          }
        },
        () => `journal_mode=wal under ${os.tmpdir()}, then deleted`,
      );
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  },
};

// ---------------------------------------------------------------- Tesseract

/**
 * `requireLocalModel`: whether a missing local `eng.traineddata` is a FAIL (the NAS,
 * where a CDN fallback is a hidden network dependency) or only a WARN (dev).
 */
function createTesseractProbe(requireLocalModel: boolean): DependencyProbe {
  return {
    id: "tesseract",
    label: "Tesseract OCR (tesseract.js)",
    purpose: "Documents: reading text out of scanned PDFs and photos.",
    async run(record) {
      record.version(packageVersion("tesseract.js"));
      record.fact("tesseract.js-core (WASM)", packageVersion("tesseract.js-core"));
      record.fact("Language", OCR_LANGUAGE);

      const folder = ocrModelFolder();
      record.fact("MYHOMEBASE_TESSDATA", folder ?? "(unset)");
      const modelFile = `${OCR_LANGUAGE}.traineddata`;
      if (folder) {
        const file = path.join(folder, modelFile);
        const found = existsSync(file);
        record.fact("Model file", file);
        record.check(
          "Local language model",
          found,
          found ? describeFile(file) : `${file} does not exist -- OCR will fail to start`,
        );
      } else {
        const cached = path.join(process.cwd(), modelFile);
        record.fact("CDN cache in cwd", existsSync(cached) ? `${cached} (${describeFile(cached)})` : "none yet");
        record.check(
          "Local language model",
          false,
          "MYHOMEBASE_TESSDATA is unset, so tesseract.js downloads the model from a CDN on first use",
          requireLocalModel ? "fail" : "warn",
        );
      }

      // What the worker THREAD will require. Missing files there don't fail the start --
      // they kill the server -- so they are named here, before anything is spawned.
      const files = await record.step(
        "Worker files present",
        () => {
          const check = checkOcrWorkerFiles();
          if (check.missing.length > 0) {
            throw new Error(`missing from this install: ${check.missing.join("; ")}`);
          }
          return check;
        },
        (check) => `${check.filesChecked} worker source files, every require resolves`,
      );
      record.fact("Worker script", files.workerScript);
      // The copy of tesseract.js the SERVER loads: Turbopack requires a hashed alias under
      // `.next/node_modules`, which on the NAS is a materialised copy, not a symlink. An
      // incomplete one is what hung the worker start before `workerPath` was passed.
      const aliasRoot = path.join(process.cwd(), ".next", "node_modules");
      let aliases: string[] = [];
      try {
        aliases = readdirSync(aliasRoot).filter(
          (entry) => entry.startsWith("tesseract.js-") && !entry.startsWith("tesseract.js-core"),
        );
      } catch {
        // No .next/node_modules (dev server, CLI): nothing aliased.
      }
      record.fact(
        "Server's tesseract.js copies",
        aliases.length === 0
          ? "none under .next/node_modules (dev, or loaded from node_modules)"
          : aliases
              .map((alias) => {
                const complete = existsSync(path.join(aliasRoot, alias, "src", "worker-script", "index.js"));
                return `${alias} (${complete ? "complete" : "INCOMPLETE: no worker-script/index.js"})`;
              })
              .join(", "),
      );

      // The two WebAssembly probes the worker awaits before it sends ANY message. Run
      // here, on the main thread, with a timeout -- a hang in one of them is otherwise
      // indistinguishable from a worker that never started.
      await record.step(
        "WebAssembly SIMD probes",
        () => probeWasmFeatures(files.workerScript),
        (features) => `simd ${features.simd}, relaxed simd ${features.relaxedSimd} (picks ${features.coreVariant})`,
      );

      // tesseract.js hides its Worker and listens for nothing but messages, so a thread
      // that dies or stalls is silent. This starts the same script with every listener
      // attached and sends it the same first message.
      await record.step(
        "Worker thread smoke test",
        () => smokeTestWorkerThread(files.workerScript, record),
        (outcome) => outcome,
      );

      // Timed separately from the worker start: a broken install fails HERE, a missing
      // or unreachable model fails at "Start worker".
      await record.step(
        "Load module",
        async () => import("tesseract.js"),
        () => "tesseract.js loaded",
      );

      // The worker reports its stages ("loading tesseract core", "loading language
      // traineddata", ...). Kept with their first-seen time, so a slow or stuck
      // stage is visible in the report rather than only a total.
      const stageStart = performance.now();
      const stages = new Map<string, number>();
      const logger = (message: { status: string; progress: number }) => {
        if (!stages.has(message.status)) {
          const ms = performance.now() - stageStart;
          stages.set(message.status, ms);
          // One line per stage, not per progress tick: recognition alone sends dozens.
          record.debug(`worker stage "${message.status}" at ${Math.round(ms)} ms`);
        }
      };
      // Raw worker-side failures. tesseract.js rejects the pending promise as well, so
      // the step records the failure; this keeps the payload, which is often a bare
      // string (e.g. an ENOENT on the model file) with no stack of its own.
      const workerErrors: string[] = [];
      let workerErrorsReported = 0;
      const onWorkerError = (error: unknown) => {
        const text = describeErrorFully(error);
        workerErrors.push(text);
        record.debug("worker reported an error", text);
      };
      /** Records any worker errors not yet in the facts. */
      const flushWorkerErrors = () => {
        const fresh = workerErrors.slice(workerErrorsReported);
        workerErrorsReported = workerErrors.length;
        if (fresh.length > 0) record.fact("Worker errors", fresh.join(" | "));
      };

      const options = ocrWorkerOptions();
      record.debug(
        "creating worker",
        `language ${OCR_LANGUAGE}, langPath ${options.langPath ?? "(CDN)"}, gzip ${String(options.gzip ?? true)}, ` +
          `start timeout ${OCR_WORKER_START_TIMEOUT_MS / 1000}s, cwd ${process.cwd()}, ` +
          `workerPath ${files.workerScript} (passed explicitly)`,
      );
      let worker: Awaited<ReturnType<typeof startOcrWorker>>;
      try {
        // Documents' own start-up path, so a failure here is the one OCR would hit.
        worker = await record.step(
          "Start worker",
          () => startOcrWorker({ onWorkerError, logger }),
          () => (folder ? `model read from ${folder}` : "model from the CDN or its cwd cache"),
        );
      } catch (error) {
        // The probe stops here, so record how far the worker got before it did.
        flushWorkerErrors();
        record.fact(
          "Worker stages",
          [...stages].map(([status, ms]) => `${status} @${Math.round(ms)}ms`).join(" > ") || "none reported",
        );
        throw error;
      }
      try {
        const sample = Buffer.from(OCR_SAMPLE_PNG_BASE64, "base64");
        const { data } = await record.step(
          "Recognise the sample",
          () => worker.recognize(sample),
          (result) => `${sample.length}-byte PNG, ${Math.round(result.data.confidence)}% confidence`,
        );

        const text = data.text.replace(/\s+/g, " ").trim();
        record.fact("Text read", `"${text}"`);
        const lower = text.toLowerCase();
        const found = OCR_SAMPLE_WORDS.filter((word) => lower.includes(word.toLowerCase()));
        const missing = OCR_SAMPLE_WORDS.filter((word) => !found.includes(word));
        record.check(
          "Expected words found",
          missing.length === 0,
          `${found.length}/${OCR_SAMPLE_WORDS.length}${missing.length > 0 ? `, missing ${missing.join(", ")}` : ""}`,
          found.length >= OCR_SAMPLE_WORDS.length / 2 ? "warn" : "fail",
        );
        record.check(
          "Confidence",
          data.confidence >= OCR_MIN_CONFIDENCE,
          `${data.confidence.toFixed(0)}% (expected at least ${OCR_MIN_CONFIDENCE}%)`,
          "warn",
        );
      } finally {
        try {
          await record.step("Terminate worker", () => worker.terminate(), () => "worker stopped");
        } finally {
          flushWorkerErrors();
          record.fact(
            "Worker stages",
            [...stages].map(([status, ms]) => `${status} @${Math.round(ms)}ms`).join(" > ") || "none reported",
          );
        }
      }
    },
  };
}

/** How long the main-thread WebAssembly probes may take; they are microseconds normally. */
const WASM_PROBE_TIMEOUT_MS = 10_000;

/** How long the worker smoke test waits for the thread to answer `load`. */
const WORKER_SMOKE_TIMEOUT_MS = 45_000;

/** Rejects with `label` after `ms`, clearing its timer whichever way the race goes. */
async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms / 1000}s`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `wasm-feature-detect`'s `simd()` and `relaxedSimd()`, resolved from the worker
 * script's own location so it is the copy the worker would load.
 */
async function probeWasmFeatures(
  workerScript: string,
): Promise<{ simd: boolean; relaxedSimd: boolean; coreVariant: string }> {
  const detect = createRequire(workerScript)("wasm-feature-detect") as {
    simd: () => Promise<boolean>;
    relaxedSimd: () => Promise<boolean>;
  };
  const simd = await withTimeout(detect.simd(), WASM_PROBE_TIMEOUT_MS, "simd()");
  const relaxedSimd = await withTimeout(detect.relaxedSimd(), WASM_PROBE_TIMEOUT_MS, "relaxedSimd()");
  const coreVariant = relaxedSimd ? "relaxedsimd-lstm" : simd ? "simd-lstm" : "lstm";
  return { simd, relaxedSimd, coreVariant };
}

/**
 * Starts tesseract.js's worker script directly and sends it the `load` message the
 * library sends first, with logging on. Every event goes to the System Log AS IT
 * HAPPENS -- if the thread takes the process down, the lines before it survive.
 *
 * Resolves with a one-line outcome when `load` succeeds; throws, with the timeline of
 * events in the message, when the thread errors, exits, rejects or stays silent.
 */
async function smokeTestWorkerThread(workerScript: string, record: DependencyRecorder): Promise<string> {
  const { Worker } = await import("node:worker_threads");
  const startedAt = performance.now();
  const timeline: string[] = [];
  const note = (event: string, detail?: string) => {
    const line = `@${Math.round(performance.now() - startedAt)}ms ${event}`;
    timeline.push(detail ? `${line}: ${detail.split("\n")[0]}` : line);
    record.debug(`worker smoke test ${line}`, detail);
  };

  // stdout/stderr: true keeps the thread's console output for us rather than letting it
  // go to the server's own output, which on the NAS nobody is watching.
  const worker = new Worker(workerScript, { stdout: true, stderr: true });
  const capture = (stream: NodeJS.ReadableStream, name: string) => {
    let buffered = "";
    stream.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      let newline: number;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line !== "") note(name, line.slice(0, 500));
      }
    });
  };
  capture(worker.stdout, "stdout");
  capture(worker.stderr, "stderr");

  try {
    return await new Promise<string>((resolve, reject) => {
      const fail = (reason: string) =>
        reject(new Error(`${reason}. Timeline: ${timeline.join(" | ") || "no events at all"}`));
      const timer = setTimeout(
        () => fail(`the worker thread did not answer "load" within ${WORKER_SMOKE_TIMEOUT_MS / 1000}s`),
        WORKER_SMOKE_TIMEOUT_MS,
      );
      const finish = (callback: () => void) => {
        clearTimeout(timer);
        callback();
      };

      worker.on("online", () => {
        note("online (script started)");
        worker.postMessage({
          workerId: "dependency-test",
          jobId: "dependency-test-load",
          action: "load",
          payload: { options: { lstmOnly: true, corePath: undefined, logging: true } },
        });
        note("sent load");
      });
      worker.on("message", (packet: { status?: string; action?: string; data?: unknown }) => {
        const data = packet.data as { status?: string; progress?: number } | string | undefined;
        if (packet.status === "progress" && typeof data === "object") {
          note("progress", `${data?.status} ${data?.progress}`);
        } else if (packet.status === "resolve") {
          note(`resolve ${packet.action}`);
          finish(() =>
            resolve(`thread online and "load" answered in ${Math.round(performance.now() - startedAt)} ms`),
          );
        } else if (packet.status === "reject") {
          const text = describeErrorFully(packet.data);
          note(`reject ${packet.action}`, text);
          finish(() => fail(`the worker rejected "${packet.action}": ${text.split("\n")[0]}`));
        } else {
          note("message", JSON.stringify(packet).slice(0, 300));
        }
      });
      worker.on("messageerror", (error) => note("messageerror", describeErrorFully(error)));
      worker.on("error", (error) => {
        const text = describeErrorFully(error);
        note("error", text);
        finish(() => fail(`the worker thread threw: ${text.split("\n")[0]}`));
      });
      worker.on("exit", (code) => {
        note("exit", `code ${code}`);
        finish(() => fail(`the worker thread exited with code ${code} before answering "load"`));
      });
    });
  } finally {
    // Terminated whatever happened: a stalled thread must not outlive the check.
    await worker.terminate().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- sharp

const sharpProbe: DependencyProbe = {
  id: "sharp",
  label: "Image processing (sharp)",
  purpose: "Photo thumbnails, icon and carousel uploads, Clips images, exam sheets.",
  async run(record) {
    record.version(packageVersion("sharp"));
    // Linux builds are named sharp-linux-arm64 / sharp-linuxmusl-arm64; both count.
    checkPlatformBuild(record, installedPlatformBuilds("@img", "sharp-"), `sharp-${process.platform}`);

    const sharp = await record.step(
      "Load module",
      async () => (await import("sharp")).default,
      () => "native binding loaded",
    );

    const versions = sharp.versions as Record<string, string | undefined>;
    record.fact("libvips", versions.vips);
    record.fact(
      "Bundled libraries",
      Object.entries(versions)
        .filter(([name]) => name !== "sharp" && name !== "vips")
        .map(([name, version]) => `${name} ${version}`)
        .join(", "),
    );
    record.fact("Threads (sharp.concurrency)", sharp.concurrency());
    record.fact("SIMD", sharp.simd());
    const formats = sharp.format as unknown as Record<string, { input?: { buffer?: boolean }; output?: { buffer?: boolean } }>;
    record.fact(
      "Formats (read/write)",
      // No "avif": sharp reports it under heif, and its own key reads as unsupported.
      ["jpeg", "png", "webp", "gif", "tiff", "heif", "svg"]
        .map((name) => {
          const format = formats[name];
          const read = format?.input?.buffer ? "r" : "-";
          const write = format?.output?.buffer ? "w" : "-";
          return `${name} ${read}${write}`;
        })
        .join(", "),
    );

    const source = await record.step(
      "Create a 640x480 image",
      () =>
        sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 120, b: 40 } } })
          .png()
          .toBuffer(),
      (bytes) => `${bytes.length}-byte PNG`,
    );

    await record.step(
      "Resize to a 160px JPEG",
      async () => {
        const jpeg = await sharp(source).resize(160).jpeg({ quality: 80 }).toBuffer();
        const meta = await sharp(jpeg).metadata();
        if (meta.width !== 160 || meta.height !== 120 || meta.format !== "jpeg") {
          throw new Error(`got ${meta.format} ${meta.width}x${meta.height}, expected jpeg 160x120`);
        }
        return jpeg;
      },
      (jpeg) => `jpeg 160x120, ${jpeg.length} bytes, read back by metadata()`,
    );

    await record.step(
      "Encode WebP",
      async () => sharp(source).resize(320).webp({ quality: 80 }).toBuffer(),
      (webp) => `${webp.length} bytes (the carousel upload format)`,
    );
  },
};

// ---------------------------------------------------------------- @napi-rs/canvas

const canvasProbe: DependencyProbe = {
  id: "canvas",
  label: "Canvas (@napi-rs/canvas)",
  purpose: "Documents: rendering PDF pages to images so OCR can read scanned PDFs.",
  async run(record) {
    record.version(packageVersion("@napi-rs/canvas"));
    checkPlatformBuild(record, installedPlatformBuilds("@napi-rs", "canvas-"), `canvas-${process.platform}-${process.arch}`);

    const canvasModule = await record.step(
      "Load module",
      async () => import("@napi-rs/canvas"),
      () => "native binding loaded",
    );

    record.fact("Font families available", canvasModule.GlobalFonts.families.length);

    const canvas = await record.step(
      "Draw on a 200x100 canvas",
      () => {
        const surface = canvasModule.createCanvas(200, 100);
        const context = surface.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, 200, 100);
        context.fillStyle = "#ff0000";
        context.fillRect(40, 20, 120, 60);
        return { surface, context };
      },
      () => "white background, red rectangle",
    );

    await record.step(
      "Read a pixel back",
      () => {
        const [r, g, b] = canvas.context.getImageData(100, 50, 1, 1).data;
        if (r !== 255 || g !== 0 || b !== 0) throw new Error(`pixel is rgb(${r},${g},${b}), expected rgb(255,0,0)`);
        return [r, g, b];
      },
      () => "rgb(255,0,0) at the centre",
    );

    await record.step(
      "Encode PNG",
      async () => canvas.surface.encode("png"),
      (png) => `${png.length} bytes`,
    );
  },
};

// ---------------------------------------------------------------- wiring

/** The probes, in `DEPENDENCY_IDS` order. Building them loads nothing. */
export function createDependencyProbes(options: { requireLocalOcrModel: boolean }): DependencyProbe[] {
  return [sqliteProbe, createTesseractProbe(options.requireLocalOcrModel), sharpProbe, canvasProbe];
}

/** Facts about this server process, for the report header. */
export function describeRuntime(): RuntimeInfo {
  return {
    node: process.version,
    abi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    cwd: process.cwd(),
    rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    uptimeSeconds: process.uptime(),
  };
}
