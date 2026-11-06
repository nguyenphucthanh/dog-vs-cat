'use client';

import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../convex/_generated/api';
import { errorMessage, useGuestToken } from '../../lib/guest';
import { strings } from '../../lib/strings';
import { ROOM_CODE_LENGTH } from '../../shared/game/constants';
import { NameForm } from './NameForm';
import { Button, ErrorText, Screen } from './ui';

export function HomeScreen() {
  const { token, clear } = useGuestToken();
  const me = useQuery(api.guests.me, token ? { token } : 'skip');

  // The token no longer matches anyone, for example after the database was reset.
  useEffect(() => {
    if (me === null) clear();
  }, [me, clear]);

  return (
    <Screen>
      <div className="mt-[10vh] flex w-full max-w-md flex-col gap-6">
        <header className="text-center">
          <h1 className="text-5xl font-black">{strings.title}</h1>
          <p className="mt-2 text-stone-700">{strings.tagline}</p>
        </header>
        <div className="flex flex-col gap-4 border-4 border-stone-800 bg-amber-50 p-5">
          {token === undefined || (token && me === undefined) ? (
            <p>{strings.loading}</p>
          ) : token && me ? (
            <RoomChoices token={token} name={me.name} />
          ) : (
            <NameForm />
          )}
        </div>
      </div>
    </Screen>
  );
}

function RoomChoices({ token, name }: { token: string; name: string }) {
  const router = useRouter();
  const createRoom = useMutation(api.rooms.create);
  const joinRoom = useMutation(api.rooms.join);
  const [code, setCode] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const enter = async (getCode: () => Promise<string>) => {
    setBusy(true);
    setError('');
    try {
      router.push(`/r/${await getCode()}`);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    void enter(() => joinRoom({ token, code }));
  };

  return (
    <>
      {editingName ? (
        <NameForm currentName={name} onDone={() => setEditingName(false)} />
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-lg font-bold">{strings.hello(name)}</span>
          <button type="button" className="shrink-0 text-sm underline" onClick={() => setEditingName(true)}>
            {strings.changeName}
          </button>
        </div>
      )}
      <Button variant="primary" disabled={busy} onClick={() => void enter(() => createRoom({ token }))}>
        {strings.createRoom}
      </Button>
      <div className="text-center text-sm text-stone-600">{strings.or}</div>
      <form onSubmit={submitCode} className="flex gap-2">
        <input
          aria-label={strings.roomCode}
          required
          value={code}
          maxLength={ROOM_CODE_LENGTH}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder={strings.roomCode}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          className="min-w-0 flex-1 border-2 border-stone-400 bg-white px-3 py-2 font-mono uppercase tracking-widest"
        />
        <Button type="submit" disabled={busy || code.trim().length !== ROOM_CODE_LENGTH}>
          {strings.joinRoom}
        </Button>
      </form>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
