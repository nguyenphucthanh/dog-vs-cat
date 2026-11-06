import type { Team } from '../../shared/game/turns';
import { TEAM_LOOKS } from '../teamLooks';

const EYE = '#141414';
const CAT_NOSE = '#d9708a';

function DogFace() {
  const { fur, dark, light } = TEAM_LOOKS.dog;
  return (
    <>
      <rect x="3" y="3" width="10" height="11" fill={fur} />
      <rect x="1" y="3" width="3" height="7" fill={dark} />
      <rect x="12" y="3" width="3" height="7" fill={dark} />
      <rect x="5" y="6" width="2" height="2" fill={EYE} />
      <rect x="9" y="6" width="2" height="2" fill={EYE} />
      <rect x="5" y="9" width="6" height="5" fill={light} />
      <rect x="7" y="9" width="2" height="2" fill={EYE} />
      <rect x="7" y="12" width="2" height="2" fill={CAT_NOSE} />
    </>
  );
}

function CatFace() {
  const { fur, dark, light } = TEAM_LOOKS.cat;
  return (
    <>
      <rect x="3" y="1" width="2" height="4" fill={dark} />
      <rect x="5" y="2" width="1" height="3" fill={dark} />
      <rect x="11" y="1" width="2" height="4" fill={dark} />
      <rect x="10" y="2" width="1" height="3" fill={dark} />
      <rect x="3" y="4" width="10" height="10" fill={fur} />
      <rect x="5" y="7" width="2" height="2" fill={EYE} />
      <rect x="9" y="7" width="2" height="2" fill={EYE} />
      <rect x="6" y="10" width="4" height="3" fill={light} />
      <rect x="7" y="10" width="2" height="1" fill={CAT_NOSE} />
      <rect x="1" y="10" width="3" height="1" fill={dark} />
      <rect x="12" y="10" width="3" height="1" fill={dark} />
      <rect x="1" y="12" width="3" height="1" fill={dark} />
      <rect x="12" y="12" width="3" height="1" fill={dark} />
    </>
  );
}

/** Decoration only: the team's name is always written next to it. */
export function TeamFace({ team, className }: { team: Team; className: string }) {
  return (
    <svg viewBox="0 0 16 15" shapeRendering="crispEdges" aria-hidden="true" className={`shrink-0 ${className}`}>
      {team === 'dog' ? <DogFace /> : <CatFace />}
    </svg>
  );
}
