import type { PropertyRepository } from "./ports";
import { createPropertySchema, updatePropertySchema } from "./schema";
import type { CreatePropertyInput, UpdatePropertyInput } from "./schema";
import type { PortfolioSummary, Property } from "./types";

export function listProperties(repo: PropertyRepository): Property[] {
  return repo.listProperties();
}

export function getPropertyById(repo: PropertyRepository, id: number): Property | undefined {
  return repo.getPropertyById(id);
}

export function createProperty(repo: PropertyRepository, input: CreatePropertyInput): Property {
  const validated = createPropertySchema.parse(input);
  return repo.createProperty(validated);
}

export function updateProperty(
  repo: PropertyRepository,
  id: number,
  input: UpdatePropertyInput,
): Property {
  const validated = updatePropertySchema.parse(input);
  return repo.updateProperty(id, validated);
}

export function deleteProperty(repo: PropertyRepository, id: number): void {
  repo.deleteProperty(id);
}

/** Totals purchase price, current value, mortgage balance, and equity across a set of properties. */
export function summarizePortfolio(properties: Property[]): PortfolioSummary {
  return properties.reduce<PortfolioSummary>(
    (summary, property) => ({
      propertyCount: summary.propertyCount + 1,
      totalPurchasePriceCents: summary.totalPurchasePriceCents + property.purchasePriceCents,
      totalCurrentValueCents: summary.totalCurrentValueCents + property.currentValueCents,
      totalMortgageBalanceCents: summary.totalMortgageBalanceCents + property.mortgageBalanceCents,
      totalEquityCents:
        summary.totalEquityCents + (property.currentValueCents - property.mortgageBalanceCents),
    }),
    {
      propertyCount: 0,
      totalPurchasePriceCents: 0,
      totalCurrentValueCents: 0,
      totalMortgageBalanceCents: 0,
      totalEquityCents: 0,
    },
  );
}
