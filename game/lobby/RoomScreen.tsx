'use client';

import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../convex/_generated/api';
import { errorMessage, useGuestToken } from '../../lib/guest';
import { strings } from '../../lib/strings';
import { NetworkGame } from '../NetworkGameLoader';
import { NameForm } from './NameForm';
import { TeamFace } from './TeamFace';
import { Button, ErrorText, Screen } from './ui';
import { useRoomPresence } from './useRoomPresence';

type RoomView = NonNullable<FunctionReturnType<typeof api.rooms.view>>;
type Member = RoomView['members'][number];
type Team = Member['team'];

const TEAM_STYLES: Record<Team, { panel: string; banner: string; title: string }> = {
  dog: { panel: 'border-amber-800 bg-amber-100', banner: 'bg-amber-300', title: 'text-amber-950' },
  cat: { panel: 'border-slate-700 bg-slate-200', banner: 'bg-slate-400', title: 'text-slate-900' },
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Screen>
      <div className="mt-[15vh] flex w-full max-w-md flex-col gap-4 border-4 border-stone-800 bg-amber-50 p-5">
        {children}
      </div>
    </Screen>
  );
}

function BackHome() {
  return (
    <Link href="/" className="text-center underline">
      {strings.backHome}
    </Link>
  );
}

export function RoomScreen({ code }: { code: string }) {
  const { token, clear } = useGuestToken();
  const me = useQuery(api.guests.me, token ? { token } : 'skip');
  const room = useQuery(api.rooms.view, token && me ? { token, code } : 'skip');
  const join = useMutation(api.rooms.join);
  const [joinError, setJoinError] = useState('');
  const attemptedJoin = useRef(false);
  const leaving = useRef(false);

  useRoomPresence(token && room?.isMember ? token : null, code);

  useEffect(() => {
    if (me === null) clear();
  }, [me, clear]);

  // Arriving by link is enough to join, once. A failure stays on screen rather than retrying forever.
  useEffect(() => {
    if (!token || !room || leaving.current) return;
    if (room.isMember) {
      attemptedJoin.current = false; // If removed later, trying again shows the reason.
      return;
    }
    if (attemptedJoin.current) return;
    attemptedJoin.current = true;
    join({ token, code }).catch((failure) => setJoinError(errorMessage(failure)));
  }, [token, room, join, code]);

  if (token === null) {
    return (
      <Centered>
        <p className="text-lg font-bold">
          {strings.roomLabel} <span className="font-mono">{code}</span>
        </p>
        <NameForm />
      </Centered>
    );
  }
  if (room === null) {
    return (
      <Centered>
        <ErrorText>{strings.errors.ROOM_NOT_FOUND}</ErrorText>
        <BackHome />
      </Centered>
    );
  }
  if (joinError) {
    return (
      <Centered>
        <ErrorText>{joinError}</ErrorText>
        <BackHome />
      </Centered>
    );
  }
  if (!token || !room || !room.isMember) {
    return (
      <Centered>
        <p>{strings.loading}</p>
      </Centered>
    );
  }
  if (room.status === 'playing') return <NetworkGame token={token} code={code} />;
  return <Lobby token={token} room={room} onLeaving={() => (leaving.current = true)} />;
}

function Lobby({ token, room, onLeaving }: { token: string; room: RoomView; onLeaving: () => void }) {
  const router = useRouter();
  const { code } = room;
  const setTeam = useMutation(api.rooms.setTeam);
  const setReady = useMutation(api.rooms.setReady);
  const start = useMutation(api.rooms.start);
  const leave = useMutation(api.rooms.leave);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const me = room.members.find((member) => member.isMe)!;
  const otherTeam: Team = me.team === 'dog' ? 'cat' : 'dog';

  const act = (action: Promise<unknown>) => {
    setError('');
    action.catch((failure) => setError(errorMessage(failure)));
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/r/${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const leaveRoom = async () => {
    onLeaving(); // Otherwise arriving-by-link logic would rejoin before the page changes.
    try {
      await leave({ token, code });
      router.push('/');
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Screen>
      <div className="flex w-full max-w-3xl flex-col gap-4 pb-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-4 border-stone-800 bg-amber-50 p-4">
          <div>
            <div className="text-sm text-stone-600">{strings.roomLabel}</div>
            <div className="font-mono text-3xl font-black tracking-widest">{code}</div>
          </div>
          <Button onClick={() => void copyLink()}>{copied ? strings.copied : strings.copyLink}</Button>
        </header>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <TeamPanel team="dog" members={room.members} isMine={me.team === 'dog'} />
          <div className="self-center justify-self-center border-4 border-stone-800 bg-stone-800 px-2 py-1 font-mono text-lg font-black text-amber-50">
            {strings.versus}
          </div>
          <TeamPanel team="cat" members={room.members} isMine={me.team === 'cat'} />
        </div>

        <div className="flex flex-col gap-3 border-4 border-stone-800 bg-amber-50 p-4">
          {/* Leaving sits apart on the left, and the way forward is always furthest right. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button onClick={() => void leaveRoom()}>{strings.leaveRoom}</Button>
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <Button
                className="flex items-center gap-2"
                onClick={() => act(setTeam({ token, code, team: otherTeam }))}
              >
                <TeamFace team={otherTeam} className="h-5 w-5" />
                {strings.switchTo(strings.teams[otherTeam])}
              </Button>
              {me.isHost ? (
                <Button
                  variant="primary"
                  disabled={room.startProblem !== null}
                  onClick={() => act(start({ token, code }))}
                >
                  {strings.startGame}
                </Button>
              ) : (
                <Button
                  variant={me.ready ? 'secondary' : 'primary'}
                  onClick={() => act(setReady({ token, code, ready: !me.ready }))}
                >
                  {me.ready ? strings.unready : strings.ready}
                </Button>
              )}
            </div>
          </div>
          <div className="text-right empty:hidden">
            {me.isHost && room.startProblem && <p className="text-stone-700">{strings.errors[room.startProblem]}</p>}
            <ErrorText>{error}</ErrorText>
          </div>
        </div>
      </div>
    </Screen>
  );
}

function TeamPanel({ team, members, isMine }: { team: Team; members: Member[]; isMine: boolean }) {
  const onTeam = members.filter((member) => member.team === team);
  const styles = TEAM_STYLES[team];
  return (
    <section className={`border-4 ${styles.panel}`}>
      <header className={`flex items-center gap-3 p-3 ${styles.banner}`}>
        <TeamFace team={team} className="h-14 w-14" />
        <div className="min-w-0">
          <h2 className={`text-2xl font-black ${styles.title}`}>
            {strings.teams[team]} <span className="text-base font-bold opacity-70">({onTeam.length})</span>
          </h2>
          {isMine && <p className={`text-xs font-bold ${styles.title}`}>{strings.yourTeam}</p>}
        </div>
      </header>
      <div className="min-h-24 p-3">
        {onTeam.length === 0 ? (
          <p className="text-stone-600">{strings.emptyTeam}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {onTeam.map((member) => (
              <MemberRow key={member.id} member={member} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function MemberRow({ member }: { member: Member }) {
  return (
    <li className={`flex flex-wrap items-center gap-2 bg-white/70 px-2 py-2 ${member.online ? '' : 'opacity-50'}`}>
      <TeamFace team={member.team} className="h-6 w-6" />
      <span className="min-w-0 truncate font-bold">{member.name}</span>
      {member.isMe && <span className="text-xs text-stone-600">({strings.you})</span>}
      <span className="ml-auto flex items-center gap-1 text-xs font-bold">
        {member.isHost && <span className="bg-amber-400 px-1.5 py-0.5 text-stone-900">{strings.host}</span>}
        {!member.online && <span className="bg-stone-500 px-1.5 py-0.5 text-white">{strings.offline}</span>}
        {member.online && !member.isHost && (
          <span
            className={
              member.ready ? 'bg-green-600 px-1.5 py-0.5 text-white' : 'bg-stone-200 px-1.5 py-0.5 text-stone-700'
            }
          >
            {member.ready ? strings.isReady : strings.notReady}
          </span>
        )}
      </span>
    </li>
  );
}
