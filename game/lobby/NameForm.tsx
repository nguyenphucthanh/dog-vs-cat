'use client';

import { useMutation } from 'convex/react';
import { useState, type FormEvent } from 'react';
import { api } from '../../convex/_generated/api';
import { errorMessage, newToken, useGuestToken } from '../../lib/guest';
import { strings } from '../../lib/strings';
import { MAX_NAME_LENGTH } from '../../shared/game/constants';
import { Button, ErrorText } from './ui';

/** Creates the guest, or renames them when `currentName` is given. */
export function NameForm({ currentName, onDone }: { currentName?: string; onDone?: () => void }) {
  const { token, setToken } = useGuestToken();
  const create = useMutation(api.guests.create);
  const rename = useMutation(api.guests.rename);
  const [name, setName] = useState(currentName ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (token) {
        await rename({ token, name });
      } else {
        const fresh = newToken();
        await create({ token: fresh, name });
        setToken(fresh);
      }
      onDone?.();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-2">
      <label htmlFor="guest-name" className="font-bold">
        {strings.yourName}
      </label>
      <div className="flex gap-2">
        <input
          id="guest-name"
          autoFocus
          required
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="nickname"
          placeholder={strings.namePlaceholder}
          onChange={(event) => setName(event.target.value)}
          className="min-w-0 flex-1 border-2 border-stone-400 bg-white px-3 py-2"
        />
        <Button type="submit" variant="primary" disabled={busy || name.trim() === ''}>
          {currentName ? strings.saveName : strings.continue}
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}
