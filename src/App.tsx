import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';
import './App.css';

const INVITATION_KEY = 'transferencia-p2p-invitation';

function createInvitation() {
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${window.location.origin}/?invite=${encodeURIComponent(id)}`;
}

function QrCode({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: 190,
      margin: 1,
      color: { dark: '#17212b', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    }).catch(() => undefined);
  }, [value]);

  return (
    <canvas ref={canvasRef} className="qr-code" aria-label="Código QR de invitación" />
  );
}

export function App() {
  const [invitation, setInvitation] = useState(() => {
    const saved = window.sessionStorage.getItem(INVITATION_KEY);
    return saved ?? createInvitation();
  });
  const [notice, setNotice] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);

  useEffect(() => {
    window.sessionStorage.setItem(INVITATION_KEY, invitation);
  }, [invitation]);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current) return;
    let active = true;
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        if (active) window.location.href = result.data;
      },
      { returnDetailedScanResult: true },
    );
    scannerRef.current = scanner;
    scanner.start().catch(() => {
      if (active) setCameraError('No se pudo acceder a la cámara. Revisa los permisos del navegador.');
    });
    return () => {
      active = false;
      scanner.stop();
      scanner.destroy();
      if (scannerRef.current === scanner) scannerRef.current = null;
    };
  }, [cameraOpen]);

  const copyInvitation = async () => {
    try {
      await navigator.clipboard.writeText(invitation);
      setNotice('Enlace copiado');
    } catch {
      setNotice('No se pudo copiar el enlace');
    }
    window.setTimeout(() => setNotice(''), 2200);
  };

  const startCamera = async () => {
    setCameraError('');
    setCameraOpen(true);
  };

  const closeCamera = () => {
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
    setCameraOpen(false);
  };

  const pasteInvitation = async () => {
    const value = window.prompt('Pega aquí el enlace de conexión');
    if (!value) return;
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol');
      window.location.href = url.toString();
    } catch {
      setNotice('El enlace no es válido');
      window.setTimeout(() => setNotice(''), 2200);
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">↗</div>
        <div>
          <p className="eyebrow">Transferencia directa</p>
          <h1>Transferencia P2P</h1>
        </div>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Sin cuentas · Sin nube · Privado</p>
        <h2 id="page-title">Comparte archivos<br /><span>directamente.</span></h2>
        <p className="hero-copy">
          Conecta dos dispositivos con un código QR y transfiere tus archivos de forma
          directa y segura.
        </p>
      </section>

      <section className="pairing-grid" aria-label="Opciones de emparejamiento">
        <article className="pairing-card own-card">
          <div className="card-heading">
            <span className="step-badge">01</span>
            <div>
              <p className="card-kicker">Tu dispositivo</p>
              <h3>Mi QR</h3>
            </div>
          </div>
          <div className="qr-area">
            <QrCode value={invitation} />
          </div>
          <p className="card-description">Escanea este código desde el otro dispositivo</p>
          <button className="secondary-button" type="button" onClick={copyInvitation}>Copiar enlace de conexión</button>
        </article>

        <div className="connector" aria-hidden="true">
          <span />
          <strong>o</strong>
          <span />
        </div>

        <article className="pairing-card scan-card">
          <div className="card-heading">
            <span className="step-badge">02</span>
            <div>
              <p className="card-kicker">Otro dispositivo</p>
              <h3>Escanear</h3>
            </div>
          </div>
          <div className={`camera-placeholder${cameraOpen ? ' camera-active' : ''}`} aria-label="Vista de cámara">
            {cameraOpen ? (
              <>
                <video ref={videoRef} className="camera-video" muted playsInline />
                <div className="camera-frame">
                  <span className="camera-corner top-left" />
                  <span className="camera-corner top-right" />
                  <span className="camera-corner bottom-left" />
                  <span className="camera-corner bottom-right" />
                </div>
              </>
            ) : (
              <div className="camera-frame">
                <span className="camera-corner top-left" />
                <span className="camera-corner top-right" />
                <span className="camera-corner bottom-left" />
                <span className="camera-corner bottom-right" />
                <span className="camera-center">⌁</span>
              </div>
            )}
          </div>
          <p className="card-description">{cameraError || (cameraOpen ? 'Apunta al código QR del otro dispositivo' : 'Escanea el QR del otro dispositivo')}</p>
          {cameraOpen ? (
            <button className="secondary-button" type="button" onClick={closeCamera}>Cerrar cámara</button>
          ) : (
            <button className="primary-button" type="button" onClick={startCamera}>Activar cámara <span>→</span></button>
          )}
          <button className="text-button" type="button" onClick={pasteInvitation}>Pegar enlace</button>
        </article>
      </section>

      <p className={`notice${notice ? ' notice-visible' : ''}`} role="status">{notice}</p>
      <footer className="privacy-note">
        <span aria-hidden="true">◈</span>
        <p>Los archivos viajan directamente entre tus dispositivos.<br />No se almacenan en ningún servidor.</p>
      </footer>
    </main>
  );
}
