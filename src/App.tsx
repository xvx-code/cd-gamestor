import AdminOrders from "./AdminOrders";
import { SupportPanel, AdminSupport } from "./Support";
import { FormEvent, useEffect, useRef, useState } from "react";

type Product = {
  amount: number;
  price: number;
  oldPrice: number | "";
  badge: "" | "hot" | "best";
};

type StoreData = {
  robux: Product[];
  diamond: Product[];
  payments: string[];
};

type ProductType = "robux" | "diamond";

import DEFAULT_DATA from "../default-data.js";
const cloneDefaults = () => structuredClone(DEFAULT_DATA) as StoreData;

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m13.2 2-8 11h6.2L10.8 22l8-12h-6.2z" fill="currentColor" />
    </svg>
  );
}

function DiamondIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4h10l4 5-9 11L3 9l4-5Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m3.7 9 16.6 0M8 4l4 16 4-16" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function RobuxIcon() {
  return (
    <span className="robux-mark" aria-hidden="true">
      <i />
    </span>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm8 3.7-2.1-1.2.1-2.5-2.2-1.3-2 1.3L11.7 7 9.6 8.3 7.5 7 5.3 8.3l.1 2.5L3.3 12l2.1 1.2-.1 2.5L7.5 17l2.1-1.3 2.1 1.3 2.1-1.3 2 1.3 2.2-1.3-.1-2.5L20 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function App() {
  const [data, setData] = useState<StoreData>(cloneDefaults);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loginOpen, setLoginOpen] = useState(window.location.pathname.replace(/\/$/, "") === "/admin");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const csrf = useRef("");
  const pending = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    fetch("/api/store").then(r => { if (!r.ok) throw Error(); return r.json(); })
      .then(value => { setData(value); setReady(true); })
      .catch(() => setMessage("No se pudo conectar con la tienda. Recarga la página."));
    fetch("/api/session").then(r => r.json()).then(value => {
      setIsAdmin(value.admin === true); csrf.current = value.csrf || "";
      if (value.admin && window.location.pathname.replace(/\/$/, "") === "/admin") setAdminOpen(true);
    }).catch(() => {});
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || "No se pudo iniciar sesión.");
      csrf.current = value.csrf; setIsAdmin(true); setAdminOpen(true); setLoginOpen(false); setPassword("");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    setBusy(true);
    await pending.current;
    try {
      const response = await fetch("/api/logout", { method: "POST", headers: { "X-CSRF-Token": csrf.current } });
      if (!response.ok) throw Error();
      setIsAdmin(false); setAdminOpen(false); csrf.current = "";
    } catch { setMessage("No se pudo cerrar sesión. Inténtalo de nuevo."); }
    finally { setBusy(false); }
  };
  const [orderTicket, setOrderTicket] = useState("");
  const [orderError, setOrderError] = useState("");
  const [copied, setCopied] = useState(false);
  const requestId = useRef("");
  const [activeTab, setActiveTab] = useState<ProductType>("robux");
  const [adminOpen, setAdminOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selected, setSelected] = useState<{ type: ProductType; product: Product } | null>(null);
  const [orderStatus, setOrderStatus] = useState<
    "shopping" | "checkout" | "processing" | "success"
  >("shopping");
  const [newPayment, setNewPayment] = useState("");
  const saveTimer = useRef<number | undefined>(undefined);
  const orderRef = useRef<HTMLDivElement>(null);

  const persist = (next: StoreData) => {
    if (!isAdmin || !ready) return;
    setData(next); setSaved(false); setMessage("Guardando cambios…");
    pending.current = pending.current.then(async () => {
      const response = await fetch("/api/store", {
        method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.current }, body: JSON.stringify(next),
      });
      if (response.status === 401) { setIsAdmin(false); setAdminOpen(false); setLoginOpen(true); }
      if (!response.ok) throw Error("No se guardaron los cambios. Revisa la conexión y tu sesión.");
      setMessage(""); setSaved(true);
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => setSaved(false), 1800);
    }).catch(error => setMessage(error.message));
  };

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const switchTab = (type: ProductType) => {
    setActiveTab(type);
    setSelected(null);
    setOrderStatus("shopping");
  };

  const chooseProduct = (type: ProductType, product: Product) => {
    requestId.current = crypto.randomUUID();
    setOrderError(""); setCopied(false);
    setSelected({ type, product });
    setOrderStatus("checkout");
    window.setTimeout(
      () => orderRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }),
      0,
    );
  };

  const updateProduct = (type: ProductType, index: number, field: keyof Product, value: string) => {
    const next = structuredClone(data);
    const product = next[type][index];
    if (field === "badge") product.badge = value as Product["badge"];
    else if (field === "oldPrice") product.oldPrice = value === "" ? "" : Number(value);
    else {
      const minimum = field === "amount" ? (type === "robux" ? 1000 : 1) : 0;
      product[field] = Math.max(minimum, Number(value));
    }
    persist(next);
  };

  const addProduct = (type: ProductType) => {
    const next = structuredClone(data);
    const robuxAmount =
      type === "robux" ? Math.max(...next.robux.map((product) => product.amount)) + 5000 : 0;
    next[type].push({
      amount: type === "robux" ? robuxAmount : 500,
      price: 9.99,
      oldPrice: "",
      badge: "",
    });
    persist(next);
  };

  const removeProduct = (type: ProductType, index: number) => {
    if (data[type].length <= 1) {
      window.alert("Debe quedar al menos un paquete.");
      return;
    }
    const next = structuredClone(data);
    next[type].splice(index, 1);
    persist(next);
  };

  const updatePayment = (index: number, value: string) => {
    if (!value.trim()) return;
    const next = structuredClone(data);
    next.payments[index] = value.trim();
    persist(next);
  };

  const removePayment = (index: number) => {
    if (data.payments.length <= 1) {
      window.alert("Debe quedar al menos un método de pago.");
      return;
    }
    const next = structuredClone(data);
    next.payments.splice(index, 1);
    persist(next);
  };

  const addPayment = () => {
    if (!newPayment.trim()) return;
    persist({ ...data, payments: [...data.payments, newPayment.trim()] });
    setNewPayment("");
  };

  const submitOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected || orderStatus === "processing") return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setOrderStatus("processing"); setOrderError("");
    try {
      if (!requestId.current) requestId.current = crypto.randomUUID();
      const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, type: selected.type, amount: selected.product.amount, expectedPrice: selected.product.price, requestId: requestId.current }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error || "No se pudo crear el pedido.");
      setOrderTicket(result.ticket); setOrderStatus("success");
      window.setTimeout(() => orderRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
    } catch(error) { setOrderError((error as Error).message); setOrderStatus("checkout"); }
  };

  const resetStore = () => {
    if (
      window.confirm("¿Restablecer todos los precios y métodos de pago a los valores originales?")
    ) {
      persist(cloneDefaults());
    }
  };

  const productLabel = selected?.type === "robux" ? "Robux" : "Diamantes";

  return (
    <main>
      <div className="bg-effects" />
      <div className="shell">
        <header className="site-header">
          <a className="logo" href="#" aria-label="GameStore inicio">
            <span className="logo-icon">
              <BoltIcon />
            </span>
            <span>
              <span className="logo-text">GAMESTORE</span>
              <span className="logo-sub">Robux & Diamonds</span>
            </span>
          </a>
          <div className="header-right">
            <div className="status-badge">
              <span className="status-dot" />
              ONLINE
            </div>
            {isAdmin && <button
              className={`admin-toggle ${adminOpen ? "active" : ""}`}
              onClick={() => setAdminOpen(!adminOpen)}
            >
              <SettingsIcon /> Admin
            </button>}
          </div>
        </header>

        {message && <p role="status" className="admin-desc">{message}</p>}
        {loginOpen && !isAdmin && <section className="order-card">
          <h2>ACCESO DE ADMINISTRADOR</h2>
          <form onSubmit={login}>
            <label>Contraseña de administrador
              <input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={e => setPassword(e.target.value)} />
            </label>
            <button className="submit-button" disabled={busy || !ready}>{busy ? "Entrando…" : "Iniciar sesión"}</button>
            <a className="back-button" href="/">Volver a la tienda</a>
          </form>
        </section>}
        {adminOpen && isAdmin && ready && (
          <section className="admin-panel" aria-label="Panel de administración">
            <div className={`save-indicator ${saved ? "show" : ""}`}>
              <span />
              Guardado automáticamente
            </div>
            <h2>PANEL DE ADMINISTRACIÓN</h2>
            <p className="admin-desc">
              Edita precios y métodos de pago. Todo se guarda solo al cambiar cualquier valor.
            </p>
            <AdminProducts
              title="Paquetes de Robux"
              type="robux"
              products={data.robux}
              update={updateProduct}
              add={addProduct}
              remove={removeProduct}
            />
            <AdminProducts
              title="Paquetes de Diamantes"
              type="diamond"
              products={data.diamond}
              update={updateProduct}
              add={addProduct}
              remove={removeProduct}
            />
            <div className="admin-section">
              <h3>
                <span className="section-icon card-symbol" /> Métodos de pago
              </h3>
              <div className="payment-admin-list">
                {data.payments.map((payment, index) => (
                  <div className="payment-chip" key={`${payment}-${index}`}>
                    <input
                      defaultValue={payment}
                      onBlur={(event) => updatePayment(index, event.target.value)}
                      aria-label={`Método de pago ${index + 1}`}
                    />
                    <button
                      className="remove"
                      onClick={() => removePayment(index)}
                      aria-label={`Eliminar ${payment}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="add-payment-row">
                <input
                  value={newPayment}
                  onChange={(event) => setNewPayment(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && addPayment()}
                  placeholder="Nuevo método (ej: Yape, Bizum...)"
                />
                <button className="btn-admin primary" onClick={addPayment}>
                  Añadir
                </button>
              </div>
            </div>
            <AdminOrders csrf={() => csrf.current} />
            <AdminSupport csrf={() => csrf.current} />
            <div className="admin-footer">
              <span>Los cambios se aplican al instante y se guardan solos.</span>
              <div>
                <button className="btn-admin danger" onClick={resetStore}>
                  Restablecer valores
                </button>
                <button className="btn-admin" disabled={busy} onClick={logout}>Cerrar sesión</button>
                <button className="btn-admin" onClick={() => setAdminOpen(false)}>
                  Cerrar panel
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="hero">
          <div className="hero-tag">// SECURE TRADE SYSTEM</div>
          <h1>
            Compra <span className="green">Robux</span> & <span className="purple">Diamantes</span>
          </h1>
          <p>Interfaz de trading gamer. Entrega en 7 a 20 minutos, precios bajos y soporte 24/7.</p>
          <div className="stats-row">
            <div>
              <strong>12K+</strong>
              <span>Pedidos</span>
            </div>
            <div>
              <strong>7–20 min</strong>
              <span>Entrega</span>
            </div>
            <div>
              <strong>4.9★</strong>
              <span>Rating</span>
            </div>
          </div>
        </section>

        <div className="tabs-wrapper">
          <div className="tabs">
            <button
              className={`tab robux ${activeTab === "robux" ? "active" : ""}`}
              onClick={() => switchTab("robux")}
            >
              <RobuxIcon /> ROBUX
            </button>
            <button
              className={`tab diamond ${activeTab === "diamond" ? "active" : ""}`}
              onClick={() => switchTab("diamond")}
            >
              <DiamondIcon /> DIAMANTES
            </button>
          </div>
        </div>

        <p className="pricing-note">
          Precios en USD. Oferta de GAMESTORE: 20 % menos que el precio de referencia, redondeado a centavos.
          Referencias del 17/11/2026: {activeTab === "robux" ?
            <a href="https://www.roblox.com/upgrades/robux?ctx=topbar" target="_blank" rel="noreferrer">Roblox web</a> :
            <a href="https://pagostore.garena.com/?app=100067&channel=250000" target="_blank" rel="noreferrer">PagoStore LATAM</a>}.
          {activeTab === "diamond" && " Cantidades base; no incluyen bonos promocionales. Los precios oficiales pueden variar por país y método de pago."}
          {" "}El descuento se muestra en cada paquete elegible. No es una promoción oficial de Roblox o Garena.
        </p>
        {orderStatus === "shopping" && (
          <section className="products">
            {data[activeTab].map((product, index) => (
              <article
                className={`product ${activeTab}`}
                key={`${product.amount}-${index}`}
                onClick={() => chooseProduct(activeTab, product)}
              >
                {product.badge && (
                  <span className={`product-badge ${product.badge}`}>
                    {product.badge === "hot" ? "HOT" : "BEST"}
                  </span>
                )}
                <div className="product-icon">
                  {activeTab === "robux" ? <RobuxIcon /> : <DiamondIcon />}
                </div>
                <div className="product-amount">{product.amount.toLocaleString()}</div>
                <div className="product-label">{activeTab === "robux" ? "Robux" : "Diamantes"}</div>
                {typeof product.oldPrice === "number" && product.oldPrice > 0 &&
                  Math.round(product.price * 100) === Math.round(Math.round(product.oldPrice * 100) * 0.8) &&
                  <span className="discount-label">−20 % GAMESTORE</span>}
                <div className="price-row">
                  <strong>${product.price.toFixed(2)}</strong>
                  {product.oldPrice !== "" && <del title="Precio de referencia">${Number(product.oldPrice).toFixed(2)}</del>}
                </div>
                <button className="buy-button">Comprar</button>
              </article>
            ))}
          </section>
        )}

        <div ref={orderRef}>
          {(orderStatus === "checkout" || orderStatus === "processing") && selected && (
            <section className="order-card">
              <h2>CONFIRMAR PEDIDO</h2>
              <p className="order-summary">
                Paquete seleccionado
                <strong>
                  {selected.product.amount.toLocaleString()} {productLabel} <span>•</span> $
                  {selected.product.price.toFixed(2)}
                </strong>
              </p>
              {selected.type === "robux" && (
                <aside className="robux-delivery-info" aria-labelledby="robux-delivery-title">
                  <h3 id="robux-delivery-title">🎮 Recibe tus Robux sin compartir tu contraseña</h3>
                  <p>Escribe tu nombre de usuario exacto de Roblox, no tu nombre para mostrar. Nunca te pediremos tu contraseña ni códigos de seguridad.</p>
                  <p><strong>Entrega estimada: 7–20 minutos</strong>, sujeta a disponibilidad, límites de transferencia y aprobaciones pendientes.</p>
                  <h4>📜 Requisitos para transferencias de Roblox</h4>
                  <ul>
                    <li><strong>Sin Plus para recibir:</strong> el destinatario no necesita suscripción; quien envía sí necesita Roblox Plus.</li>
                    <li><strong>16 años o más:</strong> debes completar la verificación de edad en Roblox.</li>
                    <li><strong>Menores de 16:</strong> necesitas una cuenta parental vinculada y que tu padre, madre o tutor apruebe cada transferencia.</li>
                  </ul>
                  <p className="delivery-detail">En algunas regiones se exige aprobación parental hasta los 18 años. Acepta la transferencia dentro de Roblox; el saldo se acredita al completarse las aprobaciones. Los límites de tu cuenta pueden impedir o retrasar paquetes grandes.</p>
                  <a href="https://en.help.roblox.com/hc/es/articles/48510707796756-Enviar-y-recibir-Robux" target="_blank" rel="noreferrer">Consultar requisitos y límites en Roblox ↗</a>
                </aside>
              )}
              {orderError && <p role="alert">{orderError}</p>}
              <form onSubmit={submitOrder}>
                <label>
                  {selected.type === "robux" ? "Nombre de usuario exacto de Roblox" : "ID de jugador de Free Fire"}
                  <input name="username" maxLength={80} required placeholder={selected.type === "robux" ? "Tu usuario, no tu nombre para mostrar" : "Tu ID de Free Fire"} autoCapitalize="none" spellCheck={false} />
                </label>
                <label>
                  Correo electrónico
                  <input name="email" maxLength={254} required type="email" placeholder="tu@email.com" />
                </label>
                <label>
                  Método de pago
                  <select name="payment" required defaultValue="">
                    <option value="" disabled>
                      Seleccionar método
                    </option>
                    {data.payments.map((payment) => (
                      <option key={payment}>{payment}</option>
                    ))}
                  </select>
                </label>
                <button className="submit-button" disabled={orderStatus === "processing"}>
                  {orderStatus === "processing" ? "CREANDO TICKET..." : "Crear ticket y continuar en Discord"}
                </button>
                <button
                  type="button"
                  className="back-button"
                  disabled={orderStatus === "processing"}
                  onClick={() => setOrderStatus("shopping")}
                >
                  ← Volver a los paquetes
                </button>
              </form>
            </section>
          )}

          {orderStatus === "success" && (
            <section className="success-card">
              <div className="success-icon">✓</div>
              <h2>CONFIRMA TU COMPRA EN DISCORD</h2>
              <p>Tu pedido está registrado y pendiente de verificación del pago.</p>
              <label className="discord-ticket">Tu número de ticket
                <input readOnly value={orderTicket} onFocus={e => e.target.select()} aria-label="Número de ticket" />
              </label>
              <button className="submit-button" onClick={async () => {
                try { await navigator.clipboard.writeText(orderTicket); setCopied(true); setOrderError(""); }
                catch { setOrderError("Selecciona el número de ticket y cópialo manualmente."); }
              }}>{copied ? "✓ Ticket copiado" : "Copiar ticket"}</button>
              {orderError && <p role="status">{orderError}</p>}
              <a className="submit-button discord-link" href="https://discord.gg/D6N6hNf4e5" target="_blank" rel="noopener noreferrer">Confirmar compra en Discord ↗</a>
              <p>Guarda este número, entra al servidor y envíalo al equipo para confirmar tu compra. Abrir Discord no confirma el pago; lo verificará un administrador.</p>
              <button
                className="submit-button"
                onClick={() => {
                  setSelected(null);
                  setOrderStatus("shopping");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                Nueva compra
              </button>
            </section>
          )}
        </div>

        <div className="payment-bar">
          {data.payments.map((payment) => (
            <span key={payment}>{payment.toUpperCase()}</span>
          ))}
        </div>
        <footer>
          <strong>GAMESTORE</strong>
          <p>Sistema de trading seguro • Entrega en 7–20 minutos • Soporte 24/7</p>
          <p className="legal-links">
            <a href="/privacidad">Privacidad</a>
            <span aria-hidden="true"> · </span>
            <a href="/seguridad">Seguridad y condiciones</a>
          </p>
        </footer>
      </div>
      <SupportPanel />
    </main>
  );
}

type AdminProductsProps = {
  title: string;
  type: ProductType;
  products: Product[];
  update: (type: ProductType, index: number, field: keyof Product, value: string) => void;
  add: (type: ProductType) => void;
  remove: (type: ProductType, index: number) => void;
};

function AdminProducts({ title, type, products, update, add, remove }: AdminProductsProps) {
  return (
    <div className="admin-section">
      <h3>
        {type === "robux" ? <RobuxIcon /> : <DiamondIcon />} {title}
      </h3>
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Cantidad</th>
              <th>Precio ($)</th>
              <th>Referencia (USD)</th>
              <th>Badge</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((product, index) => (
              <tr key={index}>
                <td>
                  <input
                    type="number"
                    min={type === "robux" ? 1000 : 1}
                    defaultValue={product.amount}
                    onBlur={(event) => update(type, index, "amount", event.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={product.price}
                    onChange={(event) => update(type, index, "price", event.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={product.oldPrice}
                    onChange={(event) => update(type, index, "oldPrice", event.target.value)}
                  />
                </td>
                <td>
                  <select
                    value={product.badge}
                    onChange={(event) => update(type, index, "badge", event.target.value)}
                  >
                    <option value="">Ninguno</option>
                    <option value="hot">HOT</option>
                    <option value="best">BEST</option>
                  </select>
                </td>
                <td>
                  <button
                    className="delete-button"
                    onClick={() => remove(type, index)}
                    aria-label="Eliminar paquete"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn-admin add-package" onClick={() => add(type)}>
        + Añadir paquete
      </button>
    </div>
  );
}
