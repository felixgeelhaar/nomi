import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { ApiError } from "@/lib/api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Narrow an unknown catch value to a human-readable message. Prefers
 * ApiError (our own), then standard Error.message, then String(err).
 * Used instead of `catch (e: any) { e.message }` so lint can stay strict
 * about `no-explicit-any`.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
