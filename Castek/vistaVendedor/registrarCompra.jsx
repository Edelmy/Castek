import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import BotonSalir from "../components/BotonSalir";
import { productosEjemplo as productos } from "../vistaCliente/menu";
import "../styles/menu.css";
import "../styles/vendedor.css";

const agotados = [3];

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

export function Layout({ titulo, rol = "vendedor", children }) {
  return (
    <div className="vendedor">
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
  const [venta, setVenta] = useState({});
  const [recibio, setRecibio] = useState("");

  const agregar = (id) => setVenta((v) => ({ ...v, [id]: (v[id] || 0) + 1 }));
  const quitar = (id) => setVenta(({ [id]: _, ...resto }) => resto);

  const items = productos.filter((p) => venta[p.id]);
  const total = items.reduce((s, p) => s + p.precio * venta[p.id], 0);
  const recibido = Number(recibio) || 0;
  const cambio = Math.max(0, recibido - total);
  const faltante = total > 0 && recibido < total;

  return (
    <Layout titulo="Registrar Compra" rol={rol}>
      <section className="venta">

        <div className="productos">
          {productos.map((p) => (
            <article className="tarjeta" key={p.id}>
              <img src={p.imagen} alt={p.nombre} />
              <h3>{p.nombre}</h3>
              <p>$ {p.precio.toFixed(2)}</p>
              <footer>
                {agotados.includes(p.id) ? (
                  <b>AGOTADO</b>
                ) : (
                  <button className="boton" onClick={() => agregar(p.id)}>
                    Agregar <img src="/imagenes/carrito.png" alt="" />
                  </button>
                )}
              </footer>
            </article>
          ))}
        </div>

        <form className="resumen" onSubmit={(e) => e.preventDefault()}>
          <label>Nombre del cliente: <input /></label>
          <label>Fecha de venta: <input type="date" defaultValue={hoy} min={hoy} /></label>

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
            Recibió:
            <input type="number" min="0" value={recibio} onChange={(e) => setRecibio(e.target.value)} />
          </label>

          <p>Cambio: <b>${cambio.toFixed(2)}</b></p>
          {faltante && <small>Faltan ${(total - recibido).toFixed(2)}</small>}

          <label>
            Comentarios (opcional):
            <textarea rows="3" placeholder="Detalles especiales del pedido" />
          </label>

          <Link className="boton" to={`/${rol}/recibo`}>Realizar venta</Link>
        </form>

      </section>
    </Layout>
  );
}