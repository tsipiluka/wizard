import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientState } from '@wizard/shared';
import { api, clearSession, loadSession, saveSession, socket } from './socket';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Game } from './screens/Game';

/** Read a room code from a share link like /#/join/ABCD */
function codeFromHash(): string {
  const match = /#\/join\/([A-Za-z]{4})/.exec(window.location.hash);
  return match ? match[1]!.toUpperCase() : '';
}

export default function App() {
  const [state, setState] = useState<ClientState | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [toast, setToast] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(() => loadSession() !== null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    socket.on('state', setState);
    const onConnect = () => {
      setConnected(true);
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
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

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
    screen = <Home prefillCode={codeFromHash()} onEnter={enterRoom} />;
  } else if (state.phase === 'lobby') {
    screen = <Lobby state={state} onStart={() => act(api.start)} onLeave={leaveRoom} />;
  } else {
    screen = (
      <Game
        state={state}
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
