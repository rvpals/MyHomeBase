import { listProperties, summarizePortfolio } from "@/lib/real-estate";
import { formatCents } from "@/lib/shared/money";
import { deps } from "@/lib/wiring";

export async function listPropertiesCommand(): Promise<void> {
  const properties = listProperties(deps.propertyRepo);

  if (properties.length === 0) {
    console.log("No properties yet.");
    return;
  }

  for (const property of properties) {
    const equityCents = property.currentValueCents - property.mortgageBalanceCents;
    console.log(
      `#${property.id} ${property.address} — purchased ${property.purchaseDate} for ${formatCents(
        property.purchasePriceCents,
      )}, now worth ${formatCents(property.currentValueCents)}, mortgage ${formatCents(
        property.mortgageBalanceCents,
      )}, equity ${formatCents(equityCents)}${property.notes ? ` — ${property.notes}` : ""}`,
    );
  }

  const summary = summarizePortfolio(properties);
  console.log(
    `\n${summary.propertyCount} properties — total value ${formatCents(
      summary.totalCurrentValueCents,
    )}, total mortgage ${formatCents(summary.totalMortgageBalanceCents)}, total equity ${formatCents(
      summary.totalEquityCents,
    )}`,
  );
}
