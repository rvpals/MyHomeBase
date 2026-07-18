import { z } from "zod";

export const sqlStatementSchema = z.string().min(1);
