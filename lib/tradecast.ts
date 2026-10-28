/**
 * Tradecast is its own area (migration 0064, decided with the user 2026-10-28): its projects
 * (/tradecast) and Bug Library (/tradecast/library) are kept apart from the Android/iOS ones.
 * Underneath it is a third value of projects / base_page / roles .platform, so the platform
 * visibility rules (0034) decide who sees it: a Tradecast role sees only Tradecast, Android
 * and iOS developers never see it, admins and QA see everything.
 */
export const TRADECAST = "tradecast";

export const isTradecast = (p: { platform: string | null }) => p.platform === TRADECAST;

/** Can this person open the Tradecast area? (userPlatform: user_platform(), null = every platform) */
export const seesTradecast = (userPlatform: string | null) => userPlatform === null || userPlatform === TRADECAST;

/** Can this person open the main (Android/iOS) projects and Bug Library? */
export const seesMain = (userPlatform: string | null) => userPlatform !== TRADECAST;
