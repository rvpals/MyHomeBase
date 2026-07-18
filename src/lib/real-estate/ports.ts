import type { CreatePropertyInput, UpdatePropertyInput } from "./schema";
import type { Property } from "./types";

export interface PropertyRepository {
  listProperties(): Property[];
  getPropertyById(id: number): Property | undefined;
  createProperty(input: CreatePropertyInput): Property;
  updateProperty(id: number, input: UpdatePropertyInput): Property;
  deleteProperty(id: number): void;
}
