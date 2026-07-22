export interface Property {
  id: number;
  address: string;
  purchasePriceCents: number;
  purchaseDate: string;
  currentValueCents: number;
  mortgageBalanceCents: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioSummary {
  propertyCount: number;
  totalPurchasePriceCents: number;
  totalCurrentValueCents: number;
  totalMortgageBalanceCents: number;
  totalEquityCents: number;
}

export interface RealEstateDisplaySettings {
  defaultAddress?: string;
  defaultZipCode?: string;
}
