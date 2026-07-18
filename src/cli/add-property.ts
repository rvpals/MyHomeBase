import { createProperty } from "@/lib/real-estate";
import { dollarsToCents } from "@/lib/shared/money";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

export async function addPropertyCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  try {
    const property = createProperty(deps.propertyRepo, {
      address: flags.address ?? "",
      purchasePriceCents: dollarsToCents(flags["purchase-price"] ?? "0"),
      purchaseDate: flags["purchase-date"] ?? "",
      currentValueCents: dollarsToCents(flags["current-value"] ?? "0"),
      mortgageBalanceCents: dollarsToCents(flags["mortgage-balance"] ?? "0"),
      notes: flags.notes,
    });
    console.log(`Added property "${property.address}" (id ${property.id}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to add property.");
    process.exitCode = 1;
  }
}
