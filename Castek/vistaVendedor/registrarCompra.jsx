import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import BotonSalir from "../components/BotonSalir";
import FlechaVolver from "../components/FlechaVolver";
import { pedir } from "../api";
import { imagenDe } from "../vistaCliente/menu";
import "../styles/menu.css";
import "../styles/vendedor.css";
import CampoNumero from "../components/CampoNumero";

const menus = {
  vendedor: [
    ["Registrar Compra", "/vendedor/registrar", "/imagenes/caja.png"],
    ["Ventas", "/vendedor/ventas", "/imagenes/ventas.png"],
    ["Pedidos", "/vendedor/pedidos", "/imagenes/bolsa.png"],
  ],
  admin: [
    ["Productos", "/admin/productos", "/imagenes/productos.png"],
    ["Pedidos", "/admin/pedidos", "/imagenes/bolsa.png"],
    ["Ventas", "/admin/ventas", "/imagenes/ventas.png"],
    ["Clientes", "/admin/clientes", "/imagenes/usuario.png"],
    ["Usuarios", "/admin/usuarios", "/imagenes/usuarios.png"],
    ["Gastos", "/admin/gastos", "/imagenes/gastos.png"],
    ["Caja", "/admin/caja", "/imagenes/caja.png"],
    ["Reportes", "/admin/reportes", "/imagenes/reportes.png"],
  ],
};

export function Layout({ titulo, rol = "vendedor", volver, children }) {
  return (
    <div className="vendedor">
      {volver && <FlechaVolver to={volver} texto="Volver" />}
      <header><h1>{titulo}</h1></header>

      <nav className="barra-menu">
        <span className="logo">Castek<i>Sweet♡</i></span>
        <button aria-label="Buscar"><img src="/imagenes/buscar.png" alt="" /></button>
      </nav>

      <div className="cuerpo">
        <aside>
          {menus[rol].map(([texto, ruta, icono]) => (
            <NavLink key={ruta} to={ruta}>
              <img src={icono} alt="" />
              {texto}
            </NavLink>
          ))}
          <BotonSalir className="boton">Cerrar Sesión</BotonSalir>
        </aside>

        <main>{children}</main>
      </div>
    </div>
  );
}

const hoy = new Date().toLocaleDateString("sv-SE");

export default function RegistrarCompra({ rol = "vendedor" }) {
  const navigate = useNavigate();
  const [productos, setProductos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [venta, setVenta] = useState({});          // { id de presentación: cantidad }
  const [cliente, setCliente] = useState("");      // texto escrito (se busca en la lista de clientes)
  const [pago, setPago] = useState("efectivo");
  const [recibio, setRecibio] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Productos y clientes vienen de PostgreSQL
  useEffect(() => {
    pedir("/productos").then(({ ok, datos }) => ok && setProductos(datos));
    pedir("/clientes").then(({ ok, datos }) => ok && setClientes(datos));
  }, []);

  const agregar = (p) => setVenta((v) => ({ ...v, [p.id]: Math.min((v[p.id] || 0) + 1, p.stock) }));
  const quitar = (id) => setVenta(({ [id]: _, ...resto }) => resto);

  const items = productos.filter((p) => venta[p.id]);
  const total = items.reduce((s, p) => s + p.precio * venta[p.id], 0);
  const recibido = Number(recibio) || 0;
  const cambio = Math.max(0, recibido - total);
  const faltante = pago === "efectivo" && total > 0 && recibido < total;

  // Si lo escrito coincide con un cliente registrado, la venta queda a su nombre; si no, es de mostrador
  const clienteElegido = clientes.find((c) => c.nombre.toLowerCase() === cliente.trim().toLowerCase());

  async function realizarVenta(e) {
    e.preventDefault();
    setError("");
    setEnviando(true);
    // Solo se manda qué se vendió y cuánto. El precio, el total y el stock los calcula la base de datos.
    const { ok, datos } = await pedir("/ventas", "POST", {
      metodo_pago: pago,
      id_client: clienteElegido?.id ?? null,
      items: items.map((p) => ({ id: p.id, cantidad: venta[p.id] })),
    });
    setEnviando(false);
    if (!ok) return setError(datos.error);
    navigate(`/${rol}/recibo/${datos.id_venta}`, { state: { recibido, cambio } });
  }

  return (
    <Layout titulo="Registrar Compra" rol={rol}>
      <section className="venta">

        <div className="productos">
          {productos.length === 0 && <p>No hay productos disponibles.</p>}
          {productos.map((p) => (
            <article className="tarjeta" key={p.id}>
              <img src={imagenDe(p.nombre)} alt={p.nombre} />
              <h3>{p.nombre}</h3>
              <p>$ {p.precio.toFixed(2)}</p>
              <footer>
                {p.stock <= 0 ? (
                  <b>AGOTADO</b>
                ) : (
                  <button className="boton" onClick={() => agregar(p)}>
                    Agregar <img src="/imagenes/carrito.png" alt="" />
                  </button>
                )}
              </footer>
            </article>
          ))}
        </div>

        <form className="resumen" onSubmit={realizarVenta}>
          <label>
            Nombre del cliente:
            <input list="lista-clientes" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Vacío = venta de mostrador" />
            <datalist id="lista-clientes">
              {clientes.map((c) => <option key={c.id} value={c.nombre} />)}
            </datalist>
          </label>

          <p>Artículos agregados:</p>
          <ul>
            {items.map((p) => (
              <li key={p.id}>
                {venta[p.id]} × {p.nombre}
                <button type="button" onClick={() => quitar(p.id)} aria-label="Quitar">✕</button>
              </li>
            ))}
          </ul>

          <p>Total: <b>${total.toFixed(2)}</b></p>

          <label>
            Método de pago:
            <select value={pago} onChange={(e) => setPago(e.target.value)}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
            </select>
          </label>

          {pago === "efectivo" && (
            <>
              <label>
                Recibió:
                <CampoNumero tipo="decimal" value={recibio} onChange={(e) => setRecibio(e.target.value)} />
              </label>
              <p>Cambio: <b>${cambio.toFixed(2)}</b></p>
              {faltante && <small>Faltan ${(total - recibido).toFixed(2)}</small>}
            </>
          )}

          {error && <p className="msj">{error}</p>}
          <button className="boton" disabled={enviando || items.length === 0 || faltante}>
            Realizar venta
          </button>
        </form>

      </section>
    </Layout>
  );
}
