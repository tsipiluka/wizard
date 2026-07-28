import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOTES, type ClientState, type EmoteId, type Suit, type TrickPlay } from '@wizard/shared';
import { cardLabel, PlayingCard, SUIT_ICONS, sortHand } from '../cards';
import { EMOTE_BUTTON_ICON, EMOTE_ICONS } from '../emoteIcons';
import type { LiveEmote } from '../App';
import { MoveDeviceSheet } from './MoveDevice';

const SUIT_NAMES: Record<Suit, string> = {
  red: 'Embers',
  yellow: 'Suns',
  green: 'Leaves',
  blue: 'Moons',
};

export function Game({
  state,
  emotes,
  muted,
  onToggleMute,
  onEmote,
  onBid,
  onPlay,
  onChooseTrump,
  onAgain,
  onExit,
  onNotice,
}: {
  state: ClientState;
  emotes: LiveEmote[];
  muted: number[];
  onToggleMute: (seat: number) => void;
  onEmote: (id: EmoteId) => void;
  onBid: (bid: number) => void;
  onPlay: (cardId: string) => void;
  onChooseTrump: (suit: Suit) => void;
  onAgain: () => void;
  onExit: () => void;
  onNotice: (message: string) => void;
}) {
  const { seat, players } = state;
  const n = players.length;
  const me = players[seat]!;
  const myTurn = state.turnIndex === seat;
  const [showScores, setShowScores] = useState(false);
  const [showEmotes, setShowEmotes] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [queuedCardId, setQueuedCardId] = useState<string | null>(null);
  const emoteFor = (s: number) => emotes.find((e) => e.seat === s);

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
  const legal = useMemo(() => new Set(state.legalIds), [state.legalIds]);
  const canPlay = state.phase === 'playing' && myTurn && !heldTrick;
  const queuedCard = queuedCardId ? hand.find((c) => c.id === queuedCardId) : undefined;

  /**
   * Plays immediately if it's legally your turn; otherwise toggles the card
   * as queued so the resolving effect below can play it once your turn comes.
   */
  const handleCardClick = (cardId: string) => {
    if (canPlay && legal.has(cardId)) {
      onPlay(cardId);
      return;
    }
    if (state.phase === 'playing') {
      setQueuedCardId((prev) => (prev === cardId ? null : cardId));
    }
  };

  // Resolve a queued card once it's actually playable, or drop it if it
  // turned out illegal (led suit was established after it was queued).
  useEffect(() => {
    if (!queuedCardId) return;
    if (state.phase !== 'playing' || !hand.some((c) => c.id === queuedCardId)) {
      setQueuedCardId(null);
      return;
    }
    if (!canPlay) return;
    if (legal.has(queuedCardId)) {
      onPlay(queuedCardId);
    } else {
      onNotice("That card wasn't playable — pick another.");
    }
    setQueuedCardId(null);
  }, [queuedCardId, state.phase, canPlay, legal, hand, onPlay, onNotice]);

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
        <div className="game__topbtns">
          <button className="btn btn--ghost btn--small" onClick={() => setShowScores(true)}>
            Scores
          </button>
          <button
            className="btn btn--ghost btn--small game__menubtn"
            onClick={() => setShowMenu(true)}
            aria-label="Table menu"
          >
            ⋯
          </button>
        </div>
      </header>

      <section className="game__opponents">
        {opponents.map((i) => {
          const p = players[i]!;
          const bubble = emoteFor(i);
          return (
            <div
              key={i}
              className={[
                'seatchip',
                state.turnIndex === i && state.phase !== 'roundEnd' ? 'seatchip--turn' : '',
                p.connected ? '' : 'seatchip--away',
              ].join(' ')}
            >
              {bubble && <EmoteBubble key={bubble.key} id={bubble.id} />}
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
          (() => {
            const claimed = state.players.reduce((sum, p) => sum + (p.bid ?? 0), 0);
            // last bidder may not make the total land exactly on the round number
            const amLast = state.players.filter((p) => p.bid === null).length === 1;
            const forbidden = amLast ? state.round - claimed : null;
            return (
              <div className="tableprompt">
                <p className="veil-note">
                  {claimed} of {state.round} tricks claimed so far
                  {forbidden !== null && forbidden >= 0 && forbidden <= state.round && (
                    <>
                      <br />
                      you may not bid {forbidden} — someone has to miss
                    </>
                  )}
                </p>
                <div className="bidgrid">
                  {Array.from({ length: state.round + 1 }, (_, b) => (
                    <button
                      key={b}
                      className="bidgrid__btn"
                      disabled={b === forbidden}
                      onClick={() => onBid(b)}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()
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
        <button
          className="emotebtn"
          onClick={() => setShowEmotes(true)}
          aria-label="Send an emote"
        >
          {EMOTE_BUTTON_ICON}
        </button>
        <div className={`game__mebar ${myTurn && !heldTrick ? 'game__mebar--turn' : ''}`}>
          {(() => {
            const mine = emoteFor(seat);
            return mine ? <EmoteBubble key={mine.key} id={mine.id} own /> : null;
          })()}
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
              raised={canPlay && legal.has(card.id) && queuedCardId !== card.id}
              dimmed={canPlay && !legal.has(card.id) && queuedCardId !== card.id}
              queued={queuedCardId === card.id}
              onClick={state.phase === 'playing' ? () => handleCardClick(card.id) : undefined}
              style={{ ['--i' as string]: i, ['--n' as string]: hand.length }}
            />
          ))}
        </div>
        {queuedCard && (
          <p className="hand__note">
            {cardLabel(queuedCard)} queued — plays on your turn
          </p>
        )}
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

      {showEmotes && (
        <Sheet title="Say something" onClose={() => setShowEmotes(false)}>
          <div className="emotegrid">
            {EMOTES.map((e) => (
              <button
                key={e.id}
                className="emotegrid__btn"
                onClick={() => {
                  onEmote(e.id);
                  setShowEmotes(false);
                }}
              >
                <span className="emotegrid__icon">{EMOTE_ICONS[e.id]}</span>
                {e.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {showMenu && (
        <Sheet title="This table" onClose={() => setShowMenu(false)}>
          <button
            className="btn btn--gold"
            onClick={() => {
              setShowMenu(false);
              setShowMove(true);
            }}
          >
            Move to another device
          </button>

          <h3 className="panel__title menu__sub">Mute emotes from</h3>
          <ul className="mutelist">
            {players.map((p, i) =>
              i === seat ? null : (
                <li key={i} className="mutelist__row">
                  <span className="mutelist__name">{p.name}</span>
                  <button
                    className={`mutetoggle ${muted.includes(i) ? 'mutetoggle--on' : ''}`}
                    onClick={() => onToggleMute(i)}
                  >
                    {muted.includes(i) ? 'muted' : 'audible'}
                  </button>
                </li>
              ),
            )}
          </ul>

          <button className="btn btn--ghost" onClick={onExit}>
            Leave this device
          </button>
        </Sheet>
      )}

      {showMove && <MoveDeviceSheet code={state.code} onClose={() => setShowMove(false)} />}
    </main>
  );
}

function EmoteBubble({ id, own = false }: { id: EmoteId; own?: boolean }) {
  const label = EMOTES.find((e) => e.id === id)?.label ?? '';
  return (
    <span className={`bubble ${own ? 'bubble--own' : ''}`} role="status">
      <span className="bubble__icon">{EMOTE_ICONS[id]}</span>
      <span className="bubble__label">{label}</span>
    </span>
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
