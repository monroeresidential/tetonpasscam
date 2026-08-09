-- Generated from src/worker/db/seed-routes.ts ROUTES (do not hand-edit --
-- regenerate if seed-routes.ts changes). One-off remote seed for the 12
-- route rows; safe to re-run (INSERT OR IGNORE, unique on slug).
INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction) VALUES ('victor-jackson-eb', 'Victor → Jackson', 43.6026, -111.1113, 43.4799, -110.7624, 'eb');
INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction) VALUES ('victor-jackson-wb', 'Jackson → Victor', 43.4799, -110.7624, 43.6026, -111.1113, 'wb');
INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction) VALUES ('driggs-jackson-eb', 'Driggs → Jackson', 43.7231, -111.111, 43.4799, -110.7624, 'eb');
INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction) VALUES ('driggs-jackson-wb', 'Jackson → Driggs', 43.4799, -110.7624, 43.7231, -111.111, 'wb');
INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction) VALUES ('victor-tetonvillage-eb', 'Victor → Teton Village', 43.6026, -111.1113, 43.5873, -110.8276, 'eb');
INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction) VALUES ('victor-tetonvillage-wb', 'Teton Village → Victor', 43.5873, -110.8276, 43.6026, -111.1113, 'wb');
INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction) VALUES ('driggs-tetonvillage-eb', 'Driggs → Teton Village', 43.7231, -111.111, 43.5873, -110.8276, 'eb');
INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction) VALUES ('driggs-tetonvillage-wb', 'Teton Village → Driggs', 43.5873, -110.8276, 43.7231, -111.111, 'wb');
INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction) VALUES ('victor-airport-eb', 'Victor → Airport', 43.6026, -111.1113, 43.6034, -110.7363, 'eb');
INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction) VALUES ('victor-airport-wb', 'Airport → Victor', 43.6034, -110.7363, 43.6026, -111.1113, 'wb');
INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction) VALUES ('driggs-airport-eb', 'Driggs → Airport', 43.7231, -111.111, 43.6034, -110.7363, 'eb');
INSERT OR IGNORE INTO routes (slug, name, origin_lat, origin_lng, dest_lat, dest_lng, direction) VALUES ('driggs-airport-wb', 'Airport → Driggs', 43.6034, -110.7363, 43.7231, -111.111, 'wb');
