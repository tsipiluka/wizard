import { useEffect, useState } from 'react';
import type { ClientState } from '@wizard/shared';

export function Lobby({
  state,
  onStart,
  onLeave,
}: {
  state: ClientState;
  onStart: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isHost = state.players[state.seat]?.isHost ?? false;
  const canStart = state.players.length >= 3;
  const shareUrl = `${window.location.origin}/#/join/${state.code}`;

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (state.autoStartAt === null) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((state.autoStartAt! - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [state.autoStartAt]);

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Tsipizard', text: 'Join my Tsipizard table', url: shareUrl });
        return;
      }
    } catch {
      /* fall through to clipboard */
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; code is visible anyway */
    }
  }

  return (
    <main className="lobby">
      <header className="lobby__head">
        <p className="lobby__label">Table code</p>
        <button className="lobby__code" onClick={share} title="Share invite link">
          {state.code.split('').map((ch, i) => (
            <span key={i} className="lobby__glyph">
              {ch}
            </span>
          ))}
        </button>
        <button className="btn btn--ghost btn--small" onClick={share}>
          {copied ? 'Link copied ✓' : 'Share invite'}
        </button>
      </header>

      {state.isPublic && (
        <p className="veil-note">
          {secondsLeft !== null
            ? `Public table — starting in ${secondsLeft}s`
            : 'Public table — starts once 3 players are seated'}
        </p>
      )}

      <section className="panel lobby__seats">
        <h2 className="panel__title">Seated ({state.players.length}/6)</h2>
        <ul className="lobby__list">
          {state.players.map((p, i) => (
            <li key={i} className={`lobby__player ${p.connected ? '' : 'lobby__player--away'}`}>
              <span className="lobby__dot" aria-hidden />
              <span className="lobby__name">
                {p.name}
                {i === state.seat ? ' (you)' : ''}
              </span>
              {p.isHost && <span className="tag">host</span>}
            </li>
          ))}
          {Array.from({ length: Math.max(0, 3 - state.players.length) }).map((_, i) => (
            <li key={`empty-${i}`} className="lobby__player lobby__player--empty">
              <span className="lobby__dot" aria-hidden />
              <span className="lobby__name">waiting…</span>
            </li>
          ))}
        </ul>
      </section>

      {isHost ? (
        <button className="btn btn--gold" onClick={onStart} disabled={!canStart}>
          {canStart ? 'Begin the game' : 'Need at least 3 players'}
        </button>
      ) : (
        <p className="veil-note">The host will begin when all are seated.</p>
      )}

      <button className="btn btn--ghost" onClick={onLeave}>
        Leave table
      </button>
    </main>
  );
}
