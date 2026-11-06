'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { strings } from '../../lib/strings';
import { RETREAT_MS, TURN_MS, WIND_MAX } from '../../shared/game/constants';
import { TouchControls } from '../input/TouchControls';
import type { TouchInput } from '../input/touchInput';
import type { MatchView } from '../match/matchView';
import type { FrameStats } from '../scene/GameScene';
import { useMatchSounds } from '../sound';
import { SoundButton } from '../SoundButton';
import { Minimap } from './Minimap';

const REFRESH_MS = 100; // Text and lists. Anything that moves smoothly paints itself every frame instead.
const LOW_TIME_RATIO = 0.2;
const SHOW_FPS = process.env.NODE_ENV !== 'production';

const TEAM_TEXT = { dog: 'text-amber-300', cat: 'text-slate-200' };
const TEAM_BAR = { dog: 'bg-amber-400', cat: 'bg-slate-300' };

function readHud(match: MatchView, fps: number) {
  const active = match.active;
  const queue = match.turnQueue.map((id) => match.players.find((p) => p.id === id)!);
  return {
    phase: match.phase,
    turnNumber: match.turnNumber,
    activeName: active.name,
    isMyTurn: match.myPlayerId === match.activeId,
    usesMouse: match.controllable,
    showAim: match.showAimUi,
    activeTeam: active.team,
    secondsLeft: Math.max(0, Math.ceil(match.phaseMsLeft / 1000)),
    windStrength: Math.hypot(match.wind.x, match.wind.z),
    winner: match.winner,
    myTeam: match.players.find((p) => p.id === match.myPlayerId)?.team ?? null,
    fps,
    players: queue.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      hp: p.hp,
      alive: p.alive,
      isMe: p.id === match.myPlayerId,
      isActive: p.id === match.activeId,
    })),
  };
}

type Hud = ReturnType<typeof readHud>;

/** Runs `paint` once a frame for as long as the component is mounted. */
function usePaintLoop(paint: () => void) {
  const paintRef = useRef(paint);
  useEffect(() => {
    paintRef.current = paint;
  });
  useEffect(() => {
    let frame = requestAnimationFrame(function loop() {
      paintRef.current();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
}

/** A bar painted straight onto its element every frame: smooth motion can't wait for React state. */
function LiveBar({
  read,
  className,
  colorOf,
}: {
  read: () => number;
  className: string;
  colorOf?: (level: number) => string;
}) {
  const fillRef = useRef<HTMLDivElement>(null);
  usePaintLoop(() => {
    const fill = fillRef.current;
    if (!fill) return;
    const level = read();
    fill.style.transform = `scaleX(${level})`;
    if (colorOf) fill.style.backgroundColor = colorOf(level);
  });
  return <div ref={fillRef} className={`h-full origin-left ${className}`} style={{ transform: 'scaleX(0)' }} />;
}

/** Tilted back like a compass lying flat, and turned relative to the camera so it reads "blowing that way". */
function WindArrow({ match }: { match: MatchView }) {
  const arrowRef = useRef<SVGSVGElement>(null);
  usePaintLoop(() => {
    const arrow = arrowRef.current;
    if (!arrow) return;
    const { yaw } = match.active;
    const ahead = -match.wind.x * Math.sin(yaw) - match.wind.z * Math.cos(yaw);
    const right = match.wind.x * Math.cos(yaw) - match.wind.z * Math.sin(yaw);
    const angle = (Math.atan2(right, ahead) * 180) / Math.PI;
    arrow.style.transform = `perspective(90px) rotateX(50deg) rotateZ(${angle}deg)`;
  });
  return (
    <svg ref={arrowRef} viewBox="0 0 24 24" className="h-12 w-12 drop-shadow short:h-7 short:w-7" aria-hidden="true">
      <path d="M12 1 22 13h-6v10H8V13H2z" fill="#7dd3fc" stroke="#0c4a6e" strokeWidth="1.5" />
    </svg>
  );
}

function PlayerList({ players }: { players: Hud['players'] }) {
  const nextId = players.find((p) => !p.isActive && p.alive)?.id;
  return (
    <ol className="absolute left-3 top-3 flex w-52 flex-col gap-1.5 border-2 border-black/40 bg-black/50 p-2 text-xs short:left-1 short:top-1 short:w-36 short:gap-0 short:border short:p-1 short:text-[10px] short:leading-tight">
      {players.map((p) => (
        <li key={p.id} className={p.alive ? '' : 'opacity-40'}>
          <div className="flex items-center gap-1">
            <span className="w-3 shrink-0 text-yellow-300" aria-hidden="true">
              {p.isActive ? '▶' : ''}
            </span>
            <span className={`min-w-0 truncate font-bold ${TEAM_TEXT[p.team]} ${p.alive ? '' : 'line-through'}`}>
              {p.name}
            </span>
            {p.isMe && <span className="shrink-0 opacity-70">({strings.you})</span>}
            <span className="ml-auto shrink-0 tabular-nums">
              {p.id === nextId ? <span className="mr-1.5 text-sky-200 short:hidden">{strings.next}</span> : null}
              {p.hp}
            </span>
          </div>
          <div className="ml-4 h-1.5 bg-black/60 short:hidden">
            <div className={`h-full ${TEAM_BAR[p.team]}`} style={{ width: `${p.hp}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function TurnStatus({ match, hud }: { match: MatchView; hud: Hud }) {
  const timed = hud.phase === 'aiming' || hud.phase === 'retreat';
  const fullTime = hud.phase === 'retreat' ? RETREAT_MS : TURN_MS;
  return (
    <div className="absolute left-1/2 top-3 w-72 max-w-[40vw] -translate-x-1/2 border-2 border-black/40 bg-black/50 px-3 py-1.5 text-center short:top-1 short:px-2 short:py-0.5 short:text-xs">
      <div className={`truncate font-bold ${TEAM_TEXT[hud.activeTeam]}`}>
        {hud.isMyTurn ? strings.yourTurn : strings.turnOf(hud.activeName)}
      </div>
      <div className="flex items-center justify-center gap-2 text-sm short:text-[10px]">
        <span>{strings.phases[hud.phase]}</span>
        {timed && <span className="font-bold tabular-nums">{hud.secondsLeft}s</span>}
      </div>
      {timed && (
        <div className="mt-1 h-2 overflow-hidden bg-black/60">
          <LiveBar
            read={() => Math.min(1, match.phaseMsLeft / fullTime)}
            className=""
            colorOf={(level) => (level <= LOW_TIME_RATIO ? '#ef4444' : '#a3e635')}
          />
        </div>
      )}
    </div>
  );
}

function WindPanel({ match, hud, besideFireButton }: { match: MatchView; hud: Hud; besideFireButton: boolean }) {
  return (
    <div
      className={`absolute top-3 flex flex-col items-center border-2 border-black/40 bg-black/50 px-4 py-2 short:top-1 short:px-2 short:py-0.5 ${besideFireButton ? 'right-[6.5rem]' : 'right-3'}`}
    >
      <div className="text-xs opacity-80 short:text-[10px]">{strings.wind}</div>
      <WindArrow match={match} />
      <div className="mt-1 h-2 w-20 bg-black/60 short:mt-0 short:h-1 short:w-12">
        <div className="h-full bg-sky-300" style={{ width: `${(hud.windStrength / WIND_MAX) * 100}%` }} />
      </div>
      <div className="mt-0.5 text-xs tabular-nums short:mt-0 short:text-[10px]">{hud.windStrength.toFixed(1)}</div>
      {SHOW_FPS && <div className="text-[10px] opacity-60">{hud.fps} FPS</div>}
    </div>
  );
}

function Results({ hud, action }: { hud: Hud; action: ReactNode }) {
  const { winner, myTeam } = hud;
  if (!winner) return null;
  const headline =
    winner === 'draw' || !myTeam ? strings.winner[winner] : winner === myTeam ? strings.youWon : strings.youLost;
  const team = (id: 'dog' | 'cat') => (
    <div className="min-w-0 flex-1">
      <h3 className={`mb-1 font-bold ${TEAM_TEXT[id]}`}>
        {strings.teams[id]}
        {winner === id && ` · ${strings.winnerTag}`}
      </h3>
      <ul className="flex flex-col gap-1 text-sm short:gap-0 short:text-xs">
        {hud.players
          .filter((p) => p.team === id)
          .map((p) => (
            <li key={p.id} className="flex justify-between gap-2">
              <span className={`truncate ${p.alive ? '' : 'line-through opacity-60'}`}>{p.name}</span>
              <span className="tabular-nums">{p.hp}</span>
            </li>
          ))}
      </ul>
    </div>
  );
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
      <div className="flex w-[28rem] max-w-[92vw] flex-col gap-4 border-4 border-black/60 bg-stone-900/90 p-5 short:gap-1.5 short:p-2">
        <div className="text-center">
          <h2 className="text-4xl font-bold short:text-xl">{headline}</h2>
          <p className="mt-1 text-sm opacity-70 short:mt-0 short:text-xs">{strings.turnsPlayed(hud.turnNumber)}</p>
        </div>
        <div className="flex gap-6">
          {team('dog')}
          {team('cat')}
        </div>
        <div className="pointer-events-auto text-center">{action}</div>
      </div>
    </div>
  );
}

export function GameHud({
  match,
  statsRef,
  locked,
  touch,
  finishedAction,
}: {
  match: MatchView;
  statsRef: RefObject<FrameStats>;
  locked: boolean;
  touch: TouchInput | null;
  finishedAction: ReactNode;
}) {
  const [hud, setHud] = useState(() => readHud(match, 0));
  useMatchSounds(match);

  useEffect(() => {
    const timer = setInterval(() => setHud(readHud(match, statsRef.current.fps)), REFRESH_MS);
    return () => clearInterval(timer);
  }, [match, statsRef]);

  const finished = hud.phase === 'finished';
  return (
    <div className="pointer-events-none absolute inset-0 select-none font-mono text-white [text-shadow:0_1px_2px_#000]">
      {touch && <TouchControls input={touch} enabled={hud.usesMouse && !finished} canFire={hud.showAim} />}
      <PlayerList players={hud.players} />
      <TurnStatus match={match} hud={hud} />
      <WindPanel match={match} hud={hud} besideFireButton={touch !== null} />
      <SoundButton className="pointer-events-auto absolute bottom-3 left-3 border-2 border-black/40 bg-black/50 px-2 py-1 text-xs hover:bg-black/70 short:bottom-0.5 short:left-1 short:border short:px-1 short:py-0 short:text-[10px]" />
      <div className="absolute bottom-3 right-3 short:bottom-1 short:right-1">
        <Minimap match={match} />
      </div>

      {hud.showAim && (
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2">
          <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-white/90" />
          <div className="absolute left-0 top-1/2 h-0.5 w-full -translate-y-1/2 bg-white/90" />
        </div>
      )}

      {!finished && hud.phase === 'aiming' && (
        <div
          key={hud.turnNumber}
          role="status"
          className="turn-banner absolute left-1/2 top-1/4 -translate-x-1/2 whitespace-nowrap text-4xl font-bold short:text-2xl"
        >
          <span className={hud.isMyTurn ? 'text-yellow-300' : TEAM_TEXT[hud.activeTeam]}>
            {hud.isMyTurn ? strings.yourTurn : strings.turnOf(hud.activeName)}
          </span>
        </div>
      )}

      <div className="absolute bottom-10 left-1/2 w-80 max-w-[40vw] -translate-x-1/2 short:bottom-1">
        <div className="mb-1 text-center text-xs opacity-80 short:mb-0 short:text-[10px]">{strings.power}</div>
        <div className="h-5 overflow-hidden border-2 border-black/60 bg-black/50 short:h-3 short:border">
          <LiveBar read={() => match.chargeLevel} className="bg-gradient-to-r from-yellow-300 to-red-500" />
        </div>
      </div>
      {hud.usesMouse && !touch && (
        <div className="short:hidden absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs opacity-80">
          {strings.controls}
        </div>
      )}

      {!locked && hud.usesMouse && !touch && !finished && (
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 border-2 border-black/40 bg-black/70 px-4 py-2 text-lg">
          {strings.clickToPlay}
        </div>
      )}

      {finished && <Results hud={hud} action={finishedAction} />}
    </div>
  );
}
