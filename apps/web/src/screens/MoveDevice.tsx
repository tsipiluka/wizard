import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../socket';

/**
 * Hands this seat to another device. The server issues a single-use code that
 * rotates the seat's token on redemption, so a stale screenshot is worthless
 * and only one device ever holds the hand.
 */
export function MoveDeviceSheet({ code, onClose }: { code: string; onClose: () => void }) {
  const [claim, setClaim] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .claimCode()
      .then(async (r) => {
        if (cancelled) return;
        setClaim(r.claim);
        setSecondsLeft(Math.max(0, Math.round((r.expiresAt - Date.now()) / 1000)));
        const url = `${window.location.origin}/#/move/${r.claim}`;
        try {
          setQr(
            await QRCode.toString(url, {
              type: 'svg',
              margin: 1,
              color: { dark: '#0c0a16', light: '#f3ead2' },
            }),
          );
        } catch {
          /* the typed code alone is enough */
        }
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const expired = secondsLeft !== null && secondsLeft <= 0;

  return (
    <div className="sheet__veil" onClick={onClose}>
      <div
        className="sheet panel"
        role="dialog"
        aria-label="Move to another device"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__head">
          <h2 className="sheet__title">Move to another device</h2>
          <button className="sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <p className="veil-note">{error}</p>}

        {!error && !claim && <p className="veil-note">Sealing a transfer rune…</p>}

        {claim && (
          <>
            <p className="veil-note">
              Scan this on your other device, or open the app there and enter the code.
            </p>
            {qr && (
              <div
                className={`moveqr ${expired ? 'moveqr--dead' : ''}`}
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            )}
            <div className={`moveclaim ${expired ? 'moveclaim--dead' : ''}`}>
              {claim.split('').map((ch, i) => (
                <span key={i} className="moveclaim__glyph">
                  {ch}
                </span>
              ))}
            </div>
            <p className="veil-note">
              {expired
                ? 'This code has expired — reopen to get a fresh one.'
                : `Valid for ${Math.floor((secondsLeft ?? 0) / 60)}:${String((secondsLeft ?? 0) % 60).padStart(2, '0')} · single use`}
            </p>
            <p className="veil-note movewarn">
              Whoever uses it takes over your seat at table {code} — this device will be signed out.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
