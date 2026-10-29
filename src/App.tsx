import './App.css';

function QrPlaceholder() {
  return (
    <div className="qr-placeholder" aria-label="Espacio reservado para tu código QR">
      <div className="qr-grid" aria-hidden="true">
        <span className="qr-corner qr-corner-top-left" />
        <span className="qr-corner qr-corner-top-right" />
        <span className="qr-corner qr-corner-bottom-left" />
        <span className="qr-dots" />
      </div>
    </div>
  );
}

export function App() {
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
            <QrPlaceholder />
          </div>
          <p className="card-description">Escanea este código desde el otro dispositivo</p>
          <button className="secondary-button" type="button">Copiar enlace de conexión</button>
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
          <div className="camera-placeholder" aria-label="Vista de cámara pendiente de activar">
            <div className="camera-frame">
              <span className="camera-corner top-left" />
              <span className="camera-corner top-right" />
              <span className="camera-corner bottom-left" />
              <span className="camera-corner bottom-right" />
              <span className="camera-center">⌁</span>
            </div>
          </div>
          <p className="card-description">Escanea el QR del otro dispositivo</p>
          <button className="primary-button" type="button">Activar cámara <span>→</span></button>
          <button className="text-button" type="button">Pegar enlace</button>
        </article>
      </section>

      <footer className="privacy-note">
        <span aria-hidden="true">◈</span>
        <p>Los archivos viajan directamente entre tus dispositivos.<br />No se almacenan en ningún servidor.</p>
      </footer>
    </main>
  );
}
