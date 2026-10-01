"use client";

import { createContext, useContext } from "react";
import type { RoleCategory } from "@/lib/types/models";

/**
 * The role categories (migration 0043) for every page, loaded once by the app layout,
 * so pickers, badges and suggestions don't each fetch them.
 */
const Ctx = createContext<RoleCategory[]>([]);

export function RoleCategoriesProvider({ value, children }: { value: RoleCategory[]; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRoleCategories(): RoleCategory[] {
  return useContext(Ctx);
}
