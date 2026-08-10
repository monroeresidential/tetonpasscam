import type { AlertType } from '../shared/types';

/**
 * Canonical per-type icon/label metadata for community alerts, shared by
 * AlertsStrip ("From the road" cards) and ReportModal (the report sheet's
 * type grid) so the emoji/label pairing can't drift between the two --
 * hoisted here (Task 8) rather than exported from AlertsStrip, since neither
 * component is "the" owner of alert-type metadata.
 */
export const TYPE_ICON: Record<AlertType, string> = {
  crash: '💥',
  slideoff: '🛞',
  slick: '❄',
  wildlife: '🦌',
  stopped: '🚗',
  closure: '🚧',
  other: '⚠',
};

export const TYPE_LABEL: Record<AlertType, string> = {
  crash: 'Crash',
  slideoff: 'Slide-off',
  slick: 'Slick/Ice',
  wildlife: 'Wildlife',
  stopped: 'Stopped traffic',
  closure: 'Closure',
  other: 'Other',
};

// Canonical display order for the type grid (ReportModal) -- matches the
// design handoff's card 2d tile order, "Other" last/full-width.
export const TYPE_ORDER: AlertType[] = [
  'crash',
  'slideoff',
  'slick',
  'wildlife',
  'stopped',
  'closure',
  'other',
];

// Item-title direction phrasing: "toward" the side of the pass a driver
// coming from that direction is headed, not a bare compass word.
export const DIRECTION_SUFFIX: Record<'eb' | 'wb', string> = {
  wb: 'westbound to Victor',
  eb: 'eastbound to Jackson',
};
