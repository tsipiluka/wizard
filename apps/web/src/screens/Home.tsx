import { useState } from 'react';

export function Home({
  prefillCode,
  onEnter,
  onClaim,
}: {
  prefillCode: string;
  onEnter: (kind: 'create' | 'join', name: string, code?: string) => void;
  onClaim: (claim: string) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState(prefillCode);
  const [mode, setMode] = useState<'create' | 'join'>(prefillCode ? 'join' : 'create');
  const [moving, setMoving] = useState(false);
  const [claim, setClaim] = useState('');
  const ready = name.trim().length > 0 && (mode === 'create' || code.trim().length === 4);

  return (
    <main className="home">
      <header className="home__head">
        <div className="home__sigil" aria-hidden>
          ✦
        </div>
        <h1 className="home__title">Tsipizard</h1>
        <p className="home__sub">trick-taking by candlelight</p>
      </header>

      <form
        className="home__form panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onEnter(mode, name.trim(), code);
        }}
      >
        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Merlin"
            maxLength={20}
            autoComplete="nickname"
            enterKeyHint="next"
          />
        </label>

        <div className="home__modes" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'create'}
            className={`mode ${mode === 'create' ? 'mode--on' : ''}`}
            onClick={() => setMode('create')}
          >
            New table
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'join'}
            className={`mode ${mode === 'join' ? 'mode--on' : ''}`}
            onClick={() => setMode('join')}
          >
            Join table
          </button>
        </div>

        {mode === 'join' && (
          <label className="field">
            <span className="field__label">Table code</span>
            <input
              className="field__input field__input--code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
              placeholder="ABCD"
              autoCapitalize="characters"
              autoCorrect="off"
              enterKeyHint="go"
            />
          </label>
        )}

        <button className="btn btn--gold" type="submit" disabled={!ready}>
          {mode === 'create' ? 'Light the candles' : 'Take a seat'}
        </button>
      </form>

      {moving ? (
        <form
          className="panel home__move"
          onSubmit={(e) => {
            e.preventDefault();
            if (claim.length === 6) onClaim(claim);
          }}
        >
          <label className="field">
            <span className="field__label">Transfer code from your other device</span>
            <input
              className="field__input field__input--code field__input--claim"
              value={claim}
              onChange={(e) =>
                setClaim(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
              }
              placeholder="AB3XKP"
              autoCapitalize="characters"
              autoCorrect="off"
              enterKeyHint="go"
            />
          </label>
          <button className="btn btn--gold" type="submit" disabled={claim.length !== 6}>
            Take over my seat
          </button>
          <button type="button" className="home__link" onClick={() => setMoving(false)}>
            never mind
          </button>
        </form>
      ) : (
        <button type="button" className="home__link" onClick={() => setMoving(true)}>
          moving from another device?
        </button>
      )}

      <p className="home__rules">
        3–6 players · bid your tricks · exact or pay the price
      </p>
    </main>
  );
}
