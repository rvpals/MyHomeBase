import { describe, expect, it } from "vitest";
import type { CreatePropertyInput, UpdatePropertyInput } from "./schema";
import {
  createProperty,
  deleteProperty,
  getPropertyById,
  listProperties,
  summarizePortfolio,
  updateProperty,
} from "./real-estate";
import type { PropertyRepository } from "./ports";
import type { Property } from "./types";

// Hand-written fake — no mocking framework, reusable across tests.
function fakeRepo(seed: Property[]): PropertyRepository {
  let state = [...seed];
  let nextId = state.reduce((max, property) => Math.max(max, property.id), 0) + 1;
  return {
    listProperties() {
      return [...state];
    },
    getPropertyById(id) {
      return state.find((property) => property.id === id);
    },
    createProperty(input) {
      const created: Property = {
        id: nextId++,
        ...input,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      state.push(created);
      return created;
    },
    updateProperty(id, input) {
      state = state.map((property) =>
        property.id === id ? { ...property, ...input, updatedAt: "2026-01-02T00:00:00.000Z" } : property,
      );
      const updated = state.find((property) => property.id === id);
      if (!updated) throw new Error(`Property ${id} not found.`);
      return updated;
    },
    deleteProperty(id) {
      state = state.filter((property) => property.id !== id);
    },
  };
}

const sample: Property[] = [
  {
    id: 1,
    address: "123 Main St",
    purchasePriceCents: 30000000,
    purchaseDate: "2020-05-01",
    currentValueCents: 35000000,
    mortgageBalanceCents: 20000000,
    createdAt: "2020-05-01T00:00:00.000Z",
    updatedAt: "2020-05-01T00:00:00.000Z",
  },
  {
    id: 2,
    address: "456 Oak Ave",
    purchasePriceCents: 15000000,
    purchaseDate: "2022-08-15",
    currentValueCents: 16000000,
    mortgageBalanceCents: 10000000,
    createdAt: "2022-08-15T00:00:00.000Z",
    updatedAt: "2022-08-15T00:00:00.000Z",
  },
];

describe("listProperties", () => {
  it("returns every property", () => {
    expect(listProperties(fakeRepo(sample))).toHaveLength(2);
  });
});

describe("getPropertyById", () => {
  it("returns the matching property", () => {
    expect(getPropertyById(fakeRepo(sample), 2)?.address).toBe("456 Oak Ave");
  });

  it("returns undefined when no property matches", () => {
    expect(getPropertyById(fakeRepo(sample), 999)).toBeUndefined();
  });
});

describe("createProperty", () => {
  const validInput: CreatePropertyInput = {
    address: "789 Pine Rd",
    purchasePriceCents: 20000000,
    purchaseDate: "2026-01-01",
    currentValueCents: 20000000,
    mortgageBalanceCents: 0,
  };

  it("creates a property and returns it with an id", () => {
    const repo = fakeRepo(sample);
    const created = createProperty(repo, validInput);
    expect(created.id).toBe(3);
    expect(listProperties(repo)).toHaveLength(3);
  });

  it("rejects an empty address", () => {
    const repo = fakeRepo(sample);
    expect(() => createProperty(repo, { ...validInput, address: "" })).toThrow();
  });

  it("rejects a negative purchase price", () => {
    const repo = fakeRepo(sample);
    expect(() => createProperty(repo, { ...validInput, purchasePriceCents: -100 })).toThrow();
  });
});

describe("updateProperty", () => {
  const validInput: UpdatePropertyInput = {
    address: "123 Main St, Unit B",
    purchasePriceCents: 30000000,
    purchaseDate: "2020-05-01",
    currentValueCents: 36000000,
    mortgageBalanceCents: 19000000,
  };

  it("updates an existing property", () => {
    const repo = fakeRepo(sample);
    const updated = updateProperty(repo, 1, validInput);
    expect(updated.address).toBe("123 Main St, Unit B");
    expect(updated.currentValueCents).toBe(36000000);
  });

  it("rejects an invalid update", () => {
    const repo = fakeRepo(sample);
    expect(() => updateProperty(repo, 1, { ...validInput, address: "" })).toThrow();
  });
});

describe("deleteProperty", () => {
  it("removes the property", () => {
    const repo = fakeRepo(sample);
    deleteProperty(repo, 1);
    expect(listProperties(repo)).toHaveLength(1);
  });
});

describe("summarizePortfolio", () => {
  it("totals purchase price, current value, mortgage balance, and equity", () => {
    const summary = summarizePortfolio(sample);
    expect(summary).toEqual({
      propertyCount: 2,
      totalPurchasePriceCents: 45000000,
      totalCurrentValueCents: 51000000,
      totalMortgageBalanceCents: 30000000,
      totalEquityCents: 21000000,
    });
  });

  it("returns all zeros for an empty portfolio", () => {
    expect(summarizePortfolio([])).toEqual({
      propertyCount: 0,
      totalPurchasePriceCents: 0,
      totalCurrentValueCents: 0,
      totalMortgageBalanceCents: 0,
      totalEquityCents: 0,
    });
  });
});
