import { lookupProperty } from "@/lib/property-watch";
import { formatCents } from "@/lib/shared/money";
import { deps } from "@/lib/wiring";

export async function lookupPropertyCommand(args: string[]): Promise<void> {
  const address = args.join(" ");

  if (!deps.propertyLookupClient) {
    console.error("Property lookup isn't configured (set RENTCAST_API_KEY).");
    process.exitCode = 1;
    return;
  }

  try {
    const details = await lookupProperty(deps.propertyLookupClient, address);
    console.log(`${details.address}`);
    console.log(
      `${details.propertyType ?? "Unknown type"} — ${details.bedrooms ?? "?"} bed / ${
        details.bathrooms ?? "?"
      } bath, ${details.squareFootage ?? "?"} sqft, built ${details.yearBuilt ?? "?"}`,
    );
    if (details.latestTaxAssessment) {
      console.log(
        `Tax assessment (${details.latestTaxAssessment.year}): ${formatCents(
          details.latestTaxAssessment.valueCents,
        )}`,
      );
    }
    if (details.latestAnnualTax) {
      console.log(`Annual tax (${details.latestAnnualTax.year}): ${formatCents(details.latestAnnualTax.amountCents)}`);
    }
    if (details.lastSaleDate) {
      console.log(
        `Last sale: ${details.lastSaleDate}${
          details.lastSalePriceCents !== undefined ? ` for ${formatCents(details.lastSalePriceCents)}` : ""
        }`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to look up property.");
    process.exitCode = 1;
  }
}
