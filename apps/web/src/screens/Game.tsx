import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClientState, Suit, TrickPlay } from '@wizard/shared';
import { PlayingCard, SUIT_ICONS, sortHand } from '../cards';

const SUIT_NAMES: Record<Suit, string> = {
  red: 'Embers',
  yellow: 'Suns',
  green: 'Leaves',
  blue: 'Moons',
};

export function Game({
  state,
  onBid,
  onPlay,
  onChooseTrump,
  onAgain,
  onExit,
}: {
  state: ClientState;
  onBid: (bid: number) => void;
  onPlay: (cardId: string) => void;
  onChooseTrump: (suit: Suit) => void;
  onAgain: () => void;
  onExit: () => void;
}) {
  const { seat, players } = state;
  const n = players.length;
  const me = players[seat]!;
  const myTurn = state.turnIndex === seat;
  const [showScores, setShowScores] = useState(false);

  // When a trick completes the server clears currentTrick immediately;
  // keep showing the finished trick briefly so players see who took it.
  const [heldTrick, setHeldTrick] = useState<{ plays: TrickPlay[]; winnerIndex: number } | null>(null);
  const lastTrickKey = state.lastTrick ? state.lastTrick.plays.map((p) => p.card.id).join(',') : '';
  const lastTrickRef = useRef(state.lastTrick);
  lastTrickRef.current = state.lastTrick;
  useEffect(() => {
    // Depend only on the key: later broadcasts (same trick) must not cancel the un-hold timer.
    if (!lastTrickKey) return;
    setHeldTrick(lastTrickRef.current);
    const t = setTimeout(() => setHeldTrick(null), 2000);
    return () => clearTimeout(t);
  }, [lastTrickKey]);

  const trick = heldTrick ? heldTrick.plays : state.currentTrick;
  const winnerIndex = heldTrick?.winnerIndex ?? null;

  const hand = useMemo(() => sortHand(state.hand), [state.hand]);
  const legal = new Set(state.legalIds);
  const canPlay = state.phase === 'playing' && myTurn && !heldTrick;

  const opponents = Array.from({ length: n - 1 }, (_, i) => (seat + 1 + i) % n);

  const roundScores = state.history[state.history.length - 1];
  const showRoundEnd = state.phase === 'roundEnd' && !heldTrick;
  const showBid = state.phase === 'bidding' && myTurn && !heldTrick;
  const showTrump = state.phase === 'choosingTrump' && state.dealerIndex === seat;

  const statusLine = (() => {
    if (heldTrick) return `${players[heldTrick.winnerIndex]!.name} takes the trick`;
    switch (state.phase) {
      case 'choosingTrump':
        return state.dealerIndex === seat
          ? 'A Wizard was revealed — choose the trump'
          : `${players[state.dealerIndex]!.name} is choosing the trump…`;
      case 'bidding':
        return myTurn ? 'Your bid' : `${players[state.turnIndex]!.name} is bidding…`;
      case 'playing':
        return myTurn ? 'Your turn' : `${players[state.turnIndex]!.name} is thinking…`;
      case 'roundEnd':
        return 'Round complete';
      case 'gameOver':
        return 'The final candle burns out';
      default:
        return '';
    }
  })();

  return (
    <main className="game">
      <header className="game__top">
        <div className="game__round">
          <span className="game__round-label">Round</span>
          <span className="game__round-num">
            {state.round}<em>/{state.totalRounds}</em>
          </span>
        </div>
        <button className="btn btn--ghost btn--small" onClick={() => setShowScores(true)}>
          Scores
        </button>
      </header>

      <section className="game__opponents">
        {opponents.map((i) => {
          const p = players[i]!;
          return (
            <div
              key={i}
              className={[
                'seatchip',
                state.turnIndex === i && state.phase !== 'roundEnd' ? 'seatchip--turn' : '',
                p.connected ? '' : 'seatchip--away',
              ].join(' ')}
            >
              <span className="seatchip__name">
                {p.name}
                {state.dealerIndex === i && <span className="seatchip__dealer" title="Dealer">✦</span>}
              </span>
              <span className="seatchip__meta">
                {p.bid !== null ? `bid ${p.bid} · took ${p.tricksWon}` : '· · ·'}
              </span>
              <span className="seatchip__score">{p.score}</span>
            </div>
          );
        })}
      </section>

      <section className="game__table">
        <TableTrump state={state} />
        <p className="game__status" key={statusLine}>
          {statusLine}
        </p>
        {showTrump ? (
          <div className="tableprompt">
            <div className="trumppick">
              {(Object.keys(SUIT_NAMES) as Suit[]).map((s) => (
                <button
                  key={s}
                  className={`trumppick__suit trumppick__suit--${s}`}
                  onClick={() => onChooseTrump(s)}
                >
                  <span className="trumppick__icon">{SUIT_ICONS[s]}</span>
                  {SUIT_NAMES[s]}
                </button>
              ))}
            </div>
          </div>
        ) : showBid ? (
          <div className="tableprompt">
            <p className="veil-note">
              {state.players.reduce((sum, p) => sum + (p.bid ?? 0), 0)} of {state.round} tricks
              claimed so far
            </p>
            <div className="bidgrid">
              {Array.from({ length: state.round + 1 }, (_, b) => (
                <button key={b} className="bidgrid__btn" onClick={() => onBid(b)}>
                  {b}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="trick">
            {trick.length === 0 && !showRoundEnd && (
              <div className="trick__empty" aria-hidden>
                ✦
              </div>
            )}
            {trick.map((play, idx) => (
              <div
                className={`trick__play ${winnerIndex === play.playerIndex ? 'trick__play--winner' : ''}`}
                key={play.card.id}
                style={{ ['--i' as string]: idx }}
              >
                <PlayingCard card={play.card} size="md" />
                <span className="trick__who">
                  {play.playerIndex === seat ? 'you' : players[play.playerIndex]!.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="game__me">
        <div className={`game__mebar ${myTurn && !heldTrick ? 'game__mebar--turn' : ''}`}>
          <span className="game__mename">
            {me.name}
            {state.dealerIndex === seat && <span className="seatchip__dealer"> ✦</span>}
          </span>
          <span className="game__mebid">
            {me.bid !== null ? `bid ${me.bid} · took ${me.tricksWon}` : ''}
          </span>
          <span className="game__mescore">{me.score}</span>
        </div>
        <div className={`hand ${hand.length > 8 ? 'hand--crowded' : ''}`}>
          {hand.map((card, i) => (
            <PlayingCard
              key={card.id}
              card={card}
              size="lg"
              raised={canPlay && legal.has(card.id)}
              dimmed={canPlay && !legal.has(card.id)}
              onClick={canPlay && legal.has(card.id) ? () => onPlay(card.id) : undefined}
              style={{ ['--i' as string]: i, ['--n' as string]: hand.length }}
            />
          ))}
        </div>
      </footer>

      {showRoundEnd && roundScores && (
        <Sheet title={`Round ${state.round} — the reckoning`}>
          <ul className="reckoning">
            {roundScores.map((r, i) => (
              <li key={i} className="reckoning__row">
                <span className="reckoning__name">{players[i]!.name}</span>
                <span className="reckoning__detail">
                  bid {r.bid} · took {r.tricks}
                </span>
                <span className={`reckoning__delta ${r.delta >= 0 ? 'good' : 'bad'}`}>
                  {r.delta >= 0 ? `+${r.delta}` : r.delta}
                </span>
              </li>
            ))}
          </ul>
          <p className="veil-note">Next round is being dealt…</p>
        </Sheet>
      )}

      {state.phase === 'gameOver' && (
        <GameOverSheet state={state} onAgain={onAgain} onExit={onExit} />
      )}

      {showScores && <ScoreSheet state={state} onClose={() => setShowScores(false)} />}
    </main>
  );
}

/** The flipped trump card, sitting in the middle of the table like on a real one. */
function TableTrump({ state }: { state: ClientState }) {
  const card = state.trumpCard;
  return (
    <div className="tabletrump">
      {card && <PlayingCard card={card} size="sm" />}
      <span
        className={`tabletrump__chip ${state.trumpSuit ? `tabletrump__chip--${state.trumpSuit}` : ''}`}
      >
        {state.trumpSuit ? (
          <>
            <span className="tabletrump__icon">{SUIT_ICONS[state.trumpSuit]}</span> trump
          </>
        ) : card?.kind === 'wizard' ? (
          'trump being chosen…'
        ) : (
          'no trump'
        )}
      </span>
    </div>
  );
}

function GameOverSheet({
  state,
  onAgain,
  onExit,
}: {
  state: ClientState;
  onAgain: () => void;
  onExit: () => void;
}) {
  const standings = state.players
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => b.score - a.score);
  const isHost = state.players[state.seat]?.isHost ?? false;
  return (
    <Sheet title="The tale is told">
      <ol className="standings">
        {standings.map((p, rank) => (
          <li key={p.i} className={`standings__row ${rank === 0 ? 'standings__row--first' : ''}`}>
            <span className="standings__rank">{rank === 0 ? '👑' : rank + 1}</span>
            <span className="standings__name">
              {p.name}
              {p.i === state.seat ? ' (you)' : ''}
            </span>
            <span className="standings__score">{p.score}</span>
          </li>
        ))}
      </ol>
      {isHost ? (
        <button className="btn btn--gold" onClick={onAgain}>
          Back to the lobby
        </button>
      ) : (
        <p className="veil-note">Waiting for the host…</p>
      )}
      <button className="btn btn--ghost" onClick={onExit}>
        Leave
      </button>
    </Sheet>
  );
}

function ScoreSheet({ state, onClose }: { state: ClientState; onClose: () => void }) {
  return (
    <Sheet title="The ledger" onClose={onClose}>
      <div className="ledger__scroll">
        <table className="ledger">
          <thead>
            <tr>
              <th>R</th>
              {state.players.map((p, i) => (
                <th key={i}>{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.history.map((round, r) => (
              <tr key={r}>
                <td>{r + 1}</td>
                {round.map((s, i) => (
                  <td key={i}>
                    <span className={s.delta >= 0 ? 'good' : 'bad'}>
                      {s.delta >= 0 ? `+${s.delta}` : s.delta}
                    </span>
                    <small> ({s.tricks}/{s.bid})</small>
                  </td>
                ))}
              </tr>
            ))}
            <tr className="ledger__total">
              <td>Σ</td>
              {state.players.map((p, i) => (
                <td key={i}>{p.score}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Sheet>
  );
}

function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="sheet__veil" onClick={onClose}>
      <div className="sheet panel" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          {onClose && (
            <button className="sheet__close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
