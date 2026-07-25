import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientState, EmoteId } from '@wizard/shared';
import { api, clearSession, loadSession, saveSession, socket } from './socket';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Game } from './screens/Game';

/** Read a room code from a share link like /#/join/ABCD */
function codeFromHash(): string {
  const match = /#\/join\/([A-Za-z]{4})/.exec(window.location.hash);
  return match ? match[1]!.toUpperCase() : '';
}

/** Read a seat-transfer code from a move link like /#/move/AB3XKP */
function claimFromHash(): string {
  const match = /#\/move\/([A-Za-z0-9]{6})/.exec(window.location.hash);
  return match ? match[1]!.toUpperCase() : '';
}

/** A live emote floating over someone's seat. */
export interface LiveEmote {
  key: number;
  seat: number;
  id: EmoteId;
}

export default function App() {
  const [state, setState] = useState<ClientState | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [toast, setToast] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(() => loadSession() !== null || claimFromHash() !== '');
  const [emotes, setEmotes] = useState<LiveEmote[]>([]);
  const [muted, setMuted] = useState<number[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const emoteKey = useRef(0);
  const mutedRef = useRef<number[]>([]);
  mutedRef.current = muted;

  const showToast = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    socket.on('state', setState);

    const onEmote = ({ seat, id }: { seat: number; id: EmoteId }) => {
      if (mutedRef.current.includes(seat)) return;
      const key = ++emoteKey.current;
      // one bubble per seat at a time, so a burst can't stack up the screen
      setEmotes((prev) => [...prev.filter((e) => e.seat !== seat), { key, seat, id }]);
      setTimeout(() => setEmotes((prev) => prev.filter((e) => e.key !== key)), 3000);
    };
    socket.on('emote', onEmote);

    const onKicked = () => {
      clearSession();
      setState(null);
      setEmotes([]);
      showToast('This table moved to another device');
    };
    socket.on('kicked', onKicked);

    const onConnect = () => {
      setConnected(true);
      // a /#/move/CODE link takes over the seat from the old device
      const claim = claimFromHash();
      if (claim) {
        window.location.hash = '';
        api
          .claimSeat(claim)
          .then((r) => saveSession({ code: r.code, token: r.token, name: '' }))
          .catch((err: Error) => showToast(err.message))
          .finally(() => setRestoring(false));
        return;
      }
      // resume a stored seat on every (re)connect, e.g. after the phone slept
      const session = loadSession();
      if (session) {
        api
          .rejoin(session.code, session.token)
          .catch(() => {
            clearSession();
            setState(null);
          })
          .finally(() => setRestoring(false));
      } else {
        setRestoring(false);
      }
    };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('state', setState);
      socket.off('emote', onEmote);
      socket.off('kicked', onKicked);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [showToast]);

  const enterRoom = useCallback(
    async (kind: 'create' | 'join', name: string, code?: string) => {
      try {
        if (kind === 'create') {
          const r = await api.create(name);
          saveSession({ code: r.code, token: r.token, name });
        } else {
          const clean = (code ?? '').trim().toUpperCase();
          const r = await api.join(clean, name);
          saveSession({ code: clean, token: r.token, name });
        }
        window.location.hash = '';
      } catch (err) {
        showToast((err as Error).message);
      }
    },
    [showToast],
  );

  const leaveRoom = useCallback(() => {
    api.leave().catch(() => undefined);
    clearSession();
    setState(null);
  }, []);

  const act = useCallback(
    (fn: () => Promise<unknown>) => {
      fn().catch((err: Error) => showToast(err.message));
    },
    [showToast],
  );

  let screen: JSX.Element;
  if (restoring) {
    screen = <div className="veil-note">Summoning your table…</div>;
  } else if (!state) {
    screen = (
      <Home
        prefillCode={codeFromHash()}
        onEnter={enterRoom}
        onClaim={(claim) =>
          act(async () => {
            const r = await api.claimSeat(claim);
            saveSession({ code: r.code, token: r.token, name: '' });
          })
        }
      />
    );
  } else if (state.phase === 'lobby') {
    screen = <Lobby state={state} onStart={() => act(api.start)} onLeave={leaveRoom} />;
  } else {
    screen = (
      <Game
        state={state}
        emotes={emotes}
        muted={muted}
        onToggleMute={(seat) =>
          setMuted((prev) => (prev.includes(seat) ? prev.filter((s) => s !== seat) : [...prev, seat]))
        }
        onEmote={(id) => act(() => api.emote(id))}
        onBid={(n) => act(() => api.bid(n))}
        onPlay={(id) => act(() => api.play(id))}
        onChooseTrump={(s) => act(() => api.chooseTrump(s))}
        onAgain={() => act(api.again)}
        onExit={() => {
          clearSession();
          setState(null);
        }}
      />
    );
  }

  return (
    <div className="app">
      <div className="app__stars" aria-hidden />
      {screen}
      {!connected && !restoring && <div className="conn-banner">Reaching for the aether…</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
