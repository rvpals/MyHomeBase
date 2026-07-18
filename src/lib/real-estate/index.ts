export type { Property, PortfolioSummary } from "./types";
export {
  propertySchema,
  createPropertySchema,
  updatePropertySchema,
  type CreatePropertyInput,
  type UpdatePropertyInput,
} from "./schema";
export type { PropertyRepository } from "./ports";
export {
  listProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
  summarizePortfolio,
} from "./real-estate";
