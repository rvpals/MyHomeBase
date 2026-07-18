import { deleteProperty, getPropertyById } from "@/lib/real-estate";
import { deps } from "@/lib/wiring";

export async function deletePropertyCommand(args: string[]): Promise<void> {
  const id = Number(args[0]);

  if (!Number.isInteger(id) || id <= 0) {
    console.error("Usage: delete-property <id>");
    process.exitCode = 1;
    return;
  }

  const property = getPropertyById(deps.propertyRepo, id);
  if (!property) {
    console.error(`No property with id ${id}.`);
    process.exitCode = 1;
    return;
  }

  deleteProperty(deps.propertyRepo, id);
  console.log(`Deleted property "${property.address}" (id ${id}).`);
}
