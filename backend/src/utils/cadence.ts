import { z } from "zod";

export interface CadenceStep {
  body: string;
  waitDays: number;
}

export const cadenceItemSchema = z.object({
  body: z.string().min(1).max(300),
  waitDays: z.number().int().min(1).max(90),
});

export const cadenceSchema = z.array(cadenceItemSchema).min(1).max(5).optional();

export function parseCadence(raw: string | null | undefined): CadenceStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is CadenceStep =>
        Boolean(s) &&
        typeof (s as CadenceStep).body === "string" &&
        typeof (s as CadenceStep).waitDays === "number",
    );
  } catch {
    return [];
  }
}
