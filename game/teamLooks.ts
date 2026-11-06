import type { Team } from '../shared/game/turns';

/** Shared by the 3D characters and the lobby's faces, so a team looks the same everywhere. */
export const TEAM_LOOKS: Record<Team, { fur: string; dark: string; light: string }> = {
  dog: { fur: '#b5763a', dark: '#6e4420', light: '#efd9b4' },
  cat: { fur: '#8c8f99', dark: '#4d4f58', light: '#e6e6ea' },
};
