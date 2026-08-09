import type { CameraId } from '../shared/types';

export interface CameraDef {
  id: CameraId;
  url: string;
  caption: string;
}

/**
 * The three WY-22 cam image URLs, Drew's own DigitalOcean Spaces mirror of
 * WYDOT's camera imagery -- the same source tetonflats.com's webcam pages
 * embed. Per the camera caveat (spec): this scrape-adjacent URL scheme can
 * change without notice, so `Cameras.tsx`'s `onerror` fallback (link card +
 * one `/api/camera-error` beacon per session per camera) is load-bearing,
 * not optional polish.
 */
export const CAMERAS: CameraDef[] = [
  {
    id: 'valley',
    url: 'https://teton-flats-webcam.nyc3.cdn.digitaloceanspaces.com/Teton_Pass/latest/WYO_22_Teton_Pass_-_Jackson_Hole_Valley.jpg',
    caption: 'Jackson Hole Valley',
  },
  {
    id: 'east',
    url: 'https://teton-flats-webcam.nyc3.cdn.digitaloceanspaces.com/Teton_Pass/latest/WYO_22_Teton_Pass_-_East.jpg',
    caption: 'Teton Pass — East',
  },
  {
    id: 'west',
    url: 'https://teton-flats-webcam.nyc3.cdn.digitaloceanspaces.com/Teton_Pass/latest/WYO_22_Teton_Pass_-_West.jpg',
    caption: 'Teton Pass — West',
  },
];
