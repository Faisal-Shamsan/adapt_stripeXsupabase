import { gym } from "./gym";
import { salon } from "./salon";
import { spa } from "./spa";
import { padel } from "./padel";

export const presets = { gym, salon, spa, padel } as const;
export type PresetKey = keyof typeof presets;
