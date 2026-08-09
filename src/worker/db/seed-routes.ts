export interface SeedRoute {
  slug: string;
  name: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  direction: 'eb' | 'wb';
}

const VICTOR = { lat: 43.6026, lng: -111.1113, name: 'Victor' };
const DRIGGS = { lat: 43.7231, lng: -111.111, name: 'Driggs' };
const JACKSON = { lat: 43.4799, lng: -110.7624, name: 'Jackson' };
const TETON_VILLAGE = { lat: 43.5873, lng: -110.8276, name: 'Teton Village' };
const AIRPORT = { lat: 43.6034, lng: -110.7363, name: 'Airport' };

// Idaho-side towns (Victor, Driggs) paired with Jackson-side destinations
// (Jackson, Teton Village, Airport). `eb` runs Idaho -> Jackson side (toward
// Jackson); `wb` is the reverse (toward Idaho).
const PAIRS: Array<{
  slugPrefix: string;
  idahoSlug: string;
  idahoSide: typeof VICTOR;
  jacksonSide: typeof JACKSON;
}> = [
  { slugPrefix: 'victor-jackson', idahoSlug: 'victor', idahoSide: VICTOR, jacksonSide: JACKSON },
  { slugPrefix: 'driggs-jackson', idahoSlug: 'driggs', idahoSide: DRIGGS, jacksonSide: JACKSON },
  {
    slugPrefix: 'victor-tetonvillage',
    idahoSlug: 'victor',
    idahoSide: VICTOR,
    jacksonSide: TETON_VILLAGE,
  },
  {
    slugPrefix: 'driggs-tetonvillage',
    idahoSlug: 'driggs',
    idahoSide: DRIGGS,
    jacksonSide: TETON_VILLAGE,
  },
  { slugPrefix: 'victor-airport', idahoSlug: 'victor', idahoSide: VICTOR, jacksonSide: AIRPORT },
  { slugPrefix: 'driggs-airport', idahoSlug: 'driggs', idahoSide: DRIGGS, jacksonSide: AIRPORT },
];

export const ROUTES: SeedRoute[] = PAIRS.flatMap(({ slugPrefix, idahoSide, jacksonSide }) => [
  {
    slug: `${slugPrefix}-eb`,
    name: `${idahoSide.name} → ${jacksonSide.name}`,
    originLat: idahoSide.lat,
    originLng: idahoSide.lng,
    destLat: jacksonSide.lat,
    destLng: jacksonSide.lng,
    direction: 'eb',
  },
  {
    slug: `${slugPrefix}-wb`,
    name: `${jacksonSide.name} → ${idahoSide.name}`,
    originLat: jacksonSide.lat,
    originLng: jacksonSide.lng,
    destLat: idahoSide.lat,
    destLng: idahoSide.lng,
    direction: 'wb',
  },
]);

export async function seedRoutes(d1: D1Database): Promise<void> {
  const insert = d1.prepare(
    `INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  await d1.batch(
    ROUTES.map((route) =>
      insert.bind(
        route.slug,
        route.name,
        route.originLat,
        route.originLng,
        route.destLat,
        route.destLng,
        route.direction,
      ),
    ),
  );
}
