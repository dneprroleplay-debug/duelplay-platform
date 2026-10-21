/**
 * Single source of truth for the site hero background assets.
 *
 * Some hero files are shipped as WebP while the others are JPEG, so the
 * public URL cannot be built from the hero id alone. Every place that renders
 * a hero background (home page, create-match backdrop, site atmosphere,
 * admin panel) must resolve the file name through this helper so a renamed
 * asset can never break a dynamic URL again.
 */
export const HERO_BACKGROUND_IDS = [
  "hero-01",
  "hero-02",
  "hero-03",
  "hero-04",
  "hero-05",
  "hero-06",
  "hero-07",
  "hero-08",
  "hero-09",
  "hero-10",
] as const;

export type HeroBackgroundId = (typeof HERO_BACKGROUND_IDS)[number];

const HERO_BACKGROUND_FILES: Record<HeroBackgroundId, string> = {
  "hero-01": "/hero-backgrounds/hero-01.jpg",
  "hero-02": "/hero-backgrounds/hero-02.png",
  "hero-03": "/hero-backgrounds/hero-03.png",
  "hero-04": "/hero-backgrounds/hero-04.png",
  "hero-05": "/hero-backgrounds/hero-05.png",
  "hero-06": "/hero-backgrounds/hero-06.png",
  "hero-07": "/hero-backgrounds/hero-07.png",
  "hero-08": "/hero-backgrounds/hero-08.png",
  "hero-09": "/hero-backgrounds/hero-09.png",
  "hero-10": "/hero-backgrounds/hero-10.png",
};

export const DEFAULT_HERO_BACKGROUND_ID: HeroBackgroundId = "hero-01";

export function isHeroBackgroundId(value: unknown): value is HeroBackgroundId {
  return typeof value === "string" && (HERO_BACKGROUND_IDS as readonly string[]).includes(value);
}

/** Public path of a hero background; unknown ids fall back to the default hero. */
export function heroBackgroundImage(id: string | null | undefined): string {
  return isHeroBackgroundId(id) ? HERO_BACKGROUND_FILES[id] : HERO_BACKGROUND_FILES[DEFAULT_HERO_BACKGROUND_ID];
}

/** Every hero background with its public path, used by the admin panel picker. */
export function heroBackgroundOptions(): Array<{ id: HeroBackgroundId; image: string }> {
  return HERO_BACKGROUND_IDS.map(id => ({ id, image: HERO_BACKGROUND_FILES[id] }));
}
