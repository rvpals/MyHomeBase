import { describe, expect, it } from "vitest";

import {
  DEFAULT_SYSTEM_LOG_MAX_ROWS,
  SYSTEM_LOG_MAX_MAX_ROWS,
  SYSTEM_LOG_MIN_MAX_ROWS,
  SYSTEM_LOG_SETTING_KEYS,
} from "./schema";
import {
  describeSystemLogState,
  isKindEnabled,
  isSystemLogEnabled,
  resolveSystemLogSettings,
  systemLogBooleanValue,
} from "./settings";

const rows = (overrides: Record<string, string>) =>
  Object.entries(overrides).map(([key, value]) => ({ key, value }));

describe("resolveSystemLogSettings", () => {
  it("defaults both switches to off when nothing is stored", () => {
    const settings = resolveSystemLogSettings([]);

    expect(settings.debugEnabled).toBe(false);
    expect(settings.operationalEnabled).toBe(false);
    expect(settings.maxRows).toBe(DEFAULT_SYSTEM_LOG_MAX_ROWS);
  });

  it("reads each switch independently", () => {
    const settings = resolveSystemLogSettings(
      rows({
        [SYSTEM_LOG_SETTING_KEYS.operationalEnabled]: "true",
        [SYSTEM_LOG_SETTING_KEYS.debugEnabled]: "false",
      }),
    );

    expect(settings.operationalEnabled).toBe(true);
    expect(settings.debugEnabled).toBe(false);
  });

  it("accepts both the 'true'/'false' and '1'/'0' spellings this database contains", () => {
    const written = resolveSystemLogSettings(
      rows({ [SYSTEM_LOG_SETTING_KEYS.debugEnabled]: "true" }),
    );
    const handEdited = resolveSystemLogSettings(
      rows({ [SYSTEM_LOG_SETTING_KEYS.debugEnabled]: "1" }),
    );

    expect(written.debugEnabled).toBe(true);
    expect(handEdited.debugEnabled).toBe(true);
  });

  it("is case- and whitespace-insensitive, so a hand-edited row still behaves", () => {
    const settings = resolveSystemLogSettings(
      rows({ [SYSTEM_LOG_SETTING_KEYS.debugEnabled]: "  TRUE  " }),
    );

    expect(settings.debugEnabled).toBe(true);
  });

  it("falls back to off for a value it cannot read, rather than throwing", () => {
    const settings = resolveSystemLogSettings(
      rows({ [SYSTEM_LOG_SETTING_KEYS.debugEnabled]: "perhaps" }),
    );

    expect(settings.debugEnabled).toBe(false);
  });

  it("clamps a row cap below the floor", () => {
    const settings = resolveSystemLogSettings(
      rows({ [SYSTEM_LOG_SETTING_KEYS.maxRows]: "5" }),
    );

    expect(settings.maxRows).toBe(SYSTEM_LOG_MIN_MAX_ROWS);
  });

  it("clamps a row cap above the ceiling", () => {
    const settings = resolveSystemLogSettings(
      rows({ [SYSTEM_LOG_SETTING_KEYS.maxRows]: "99999999" }),
    );

    expect(settings.maxRows).toBe(SYSTEM_LOG_MAX_MAX_ROWS);
  });

  it("falls back to the default cap for a non-numeric or zero value", () => {
    expect(
      resolveSystemLogSettings(rows({ [SYSTEM_LOG_SETTING_KEYS.maxRows]: "lots" })).maxRows,
    ).toBe(DEFAULT_SYSTEM_LOG_MAX_ROWS);
    expect(resolveSystemLogSettings(rows({ [SYSTEM_LOG_SETTING_KEYS.maxRows]: "0" })).maxRows).toBe(
      DEFAULT_SYSTEM_LOG_MAX_ROWS,
    );
  });
});

describe("isKindEnabled", () => {
  it("treats the two kinds as independent, not as a severity ladder", () => {
    const debugOnly = resolveSystemLogSettings(
      rows({ [SYSTEM_LOG_SETTING_KEYS.debugEnabled]: "true" }),
    );

    expect(isKindEnabled(debugOnly, "debug")).toBe(true);
    // The point of the test: debug being on does NOT imply operational.
    expect(isKindEnabled(debugOnly, "operational")).toBe(false);
  });

  it("allows operational alone, which is the NAS-watching case", () => {
    const operationalOnly = resolveSystemLogSettings(
      rows({ [SYSTEM_LOG_SETTING_KEYS.operationalEnabled]: "true" }),
    );

    expect(isKindEnabled(operationalOnly, "operational")).toBe(true);
    expect(isKindEnabled(operationalOnly, "debug")).toBe(false);
  });
});

describe("isSystemLogEnabled", () => {
  it("is false only when both switches are off", () => {
    expect(isSystemLogEnabled(resolveSystemLogSettings([]))).toBe(false);
    expect(
      isSystemLogEnabled(
        resolveSystemLogSettings(rows({ [SYSTEM_LOG_SETTING_KEYS.debugEnabled]: "true" })),
      ),
    ).toBe(true);
  });
});

describe("describeSystemLogState", () => {
  it("says so plainly when nothing is being written", () => {
    expect(describeSystemLogState(resolveSystemLogSettings([]))).toBe(
      "The system log is off — nothing is being written.",
    );
  });

  it("names the one switch that is on", () => {
    const settings = resolveSystemLogSettings(
      rows({ [SYSTEM_LOG_SETTING_KEYS.operationalEnabled]: "true" }),
    );

    expect(describeSystemLogState(settings)).toContain("OPERATIONAL is on");
  });

  it("names both when both are on", () => {
    const settings = resolveSystemLogSettings(
      rows({
        [SYSTEM_LOG_SETTING_KEYS.debugEnabled]: "true",
        [SYSTEM_LOG_SETTING_KEYS.operationalEnabled]: "true",
      }),
    );

    expect(describeSystemLogState(settings)).toContain("DEBUG and OPERATIONAL are on");
  });
});

describe("systemLogBooleanValue", () => {
  it("writes the spelling sys_app_settings already carries", () => {
    expect(systemLogBooleanValue(true)).toBe("true");
    expect(systemLogBooleanValue(false)).toBe("false");
  });

  it("round-trips through the resolver", () => {
    const settings = resolveSystemLogSettings(
      rows({ [SYSTEM_LOG_SETTING_KEYS.debugEnabled]: systemLogBooleanValue(true) }),
    );

    expect(settings.debugEnabled).toBe(true);
  });
});
