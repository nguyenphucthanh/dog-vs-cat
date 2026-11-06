'use client';

import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { strings } from '../../lib/strings';
import { WIND_MAX } from '../../shared/game/constants';
import type { MatchView } from '../match/matchView';
import type { FrameStats } from '../scene/GameScene';

function readHud(match: MatchView, fps: number) {
  const active = match.active;
  // Wind direction relative to where the camera faces, so the arrow reads "blowing that way".
  const forward = { x: -Math.sin(active.yaw), z: -Math.cos(active.yaw) };
  const right = { x: Math.cos(active.yaw), z: -Math.sin(active.yaw) };
  const windAhead = match.wind.x * forward.x + match.wind.z * forward.z;
  const windRight = match.wind.x * right.x + match.wind.z * right.z;
  return {
    phase: match.phase,
    turnNumber: match.turnNumber,
    activeName: active.name,
    isMyTurn: match.myPlayerId === match.activeId,
    usesMouse: match.controllable,
    showAim: match.showAimUi,
    activeTeam: active.team,
    secondsLeft: Math.max(0, Math.ceil(match.phaseMsLeft / 1000)),
    power: match.power,
    windAngle: (Math.atan2(windRight, windAhead) * 180) / Math.PI,
    windStrength: Math.hypot(match.wind.x, match.wind.z) / WIND_MAX,
    winner: match.winner,
    fps,
    players: match.players.map((p) => ({ id: p.id, name: p.name, team: p.team, hp: p.hp, alive: p.alive })),
  };
}

const TEAM_TEXT = { dog: 'text-amber-300', cat: 'text-slate-200' };
const TEAM_BAR = { dog: 'bg-amber-400', cat: 'bg-slate-300' };

/** The essential readouts. The minimap and turn list arrive in a later milestone. */
export function GameHud({
  match,
  statsRef,
  locked,
  finishedAction,
}: {
  match: MatchView;
  statsRef: RefObject<FrameStats>;
  locked: boolean;
  finishedAction: ReactNode;
}) {
  const [hud, setHud] = useState(() => readHud(match, 0));

  useEffect(() => {
    const timer = setInterval(() => setHud(readHud(match, statsRef.current.fps)), 50);
    return () => clearInterval(timer);
  }, [match, statsRef]);

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-mono text-white [text-shadow:0_1px_2px_#000]">
      <div className="absolute left-3 top-3 border-2 border-black/40 bg-black/50 px-3 py-2">
        <div className="text-xs opacity-80">{strings.turnNumber(hud.turnNumber)}</div>
        <div className={`text-lg font-bold ${TEAM_TEXT[hud.activeTeam]}`}>
          {hud.isMyTurn ? strings.yourTurn : strings.turnOf(hud.activeName)}
        </div>
        <div className="text-sm">
          {strings.phases[hud.phase]}
          {(hud.phase === 'aiming' || hud.phase === 'retreat') && (
            <span className="ml-2 text-xl font-bold tabular-nums">{hud.secondsLeft}s</span>
          )}
        </div>
      </div>

      <div className="absolute left-3 top-32 flex w-44 flex-col gap-1 border-2 border-black/40 bg-black/50 p-2 text-xs">
        {hud.players.map((p) => (
          <div key={p.id} className={p.alive ? '' : 'line-through opacity-40'}>
            <div className="flex justify-between">
              <span className={TEAM_TEXT[p.team]}>{p.name}</span>
              <span className="tabular-nums">{p.hp}</span>
            </div>
            <div className="h-1.5 bg-black/60">
              <div className={`h-full ${TEAM_BAR[p.team]}`} style={{ width: `${p.hp}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="absolute right-3 top-3 flex flex-col items-center gap-1 border-2 border-black/40 bg-black/50 px-4 py-2">
        <div className="text-xs opacity-80">{strings.wind}</div>
        <div className="text-3xl leading-none" style={{ transform: `rotate(${hud.windAngle}deg)` }}>
          ↑
        </div>
        <div className="h-2 w-20 bg-black/60">
          <div className="h-full bg-sky-300" style={{ width: `${hud.windStrength * 100}%` }} />
        </div>
        <div className="text-[10px] opacity-60">{hud.fps} FPS</div>
      </div>

      {hud.showAim && (
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2">
          <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-white/90" />
          <div className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-white/90" />
        </div>
      )}

      <div className="absolute bottom-10 left-1/2 w-80 -translate-x-1/2">
        <div className="mb-1 text-center text-xs opacity-80">{strings.power}</div>
        <div className="h-5 border-2 border-black/60 bg-black/50">
          <div
            className="h-full bg-gradient-to-r from-yellow-300 to-red-500"
            style={{ width: `${hud.power * 100}%` }}
          />
        </div>
      </div>
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs opacity-80">
        {strings.controls}
      </div>

      {!locked && hud.usesMouse && hud.phase !== 'finished' && (
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 border-2 border-black/40 bg-black/70 px-4 py-2 text-lg">
          {strings.clickToPlay}
        </div>
      )}

      {hud.phase === 'finished' && hud.winner && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40">
          <div className="text-5xl font-bold">{strings.winner[hud.winner]}</div>
          <div className="pointer-events-auto text-lg">{finishedAction}</div>
        </div>
      )}
    </div>
  );
}
