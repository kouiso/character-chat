import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

export const getAvatarFallback = (name: string): string => {
  const chars = Array.from(name);
  if (chars.length === 0) return "?";
  if (chars.length <= 2) return name;
  return chars[0];
};
