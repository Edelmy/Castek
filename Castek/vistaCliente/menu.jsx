import Navbar from "../components/Navbar";
import "../styles/menu.css";

// La base de datos no guarda imágenes: aquí se asocia cada foto con el nombre del producto.
const imagenes = {
  "Pastel de mil hojas (EN)": "/imagenes/milhojas.png",
  "Pastel Tiramisú (EN)": "/imagenes/tiramisu.png",
  "New York Cheesecake (RB)": "/imagenes/cheesecake.png",
  "Cruffin Toffee": "/imagenes/cruffin.png",
};
export const imagenDe = (nombre) => imagenes[nombre] ?? "/imagenes/cupcake.png";

// Datos de ejemplo que sigue usando la vista del Vendedor (aún sin conectar a la base)
export const productosEjemplo = [
  { id: 1, nombre: "Pastel de mil hojas (EN)", precio: 699, imagen: "/imagenes/milhojas.png" },
  { id: 2, nombre: "Pastel Tiramisú (EN)", precio: 699, imagen: "/imagenes/tiramisu.png" },
  { id: 3, nombre: "New York Cheesecake (RB)", precio: 79, imagen: "/imagenes/cheesecake.png" },
  { id: 4, nombre: "Cruffin Toffee", precio: 79, imagen: "/imagenes/cruffin.png" },
];

export function Tarjeta({ id, nombre, precio, imagen, favoritos, carrito, toggleFavorito, poner }) {
  const cantidad = carrito[id];

  return (
    <article className="tarjeta">
      <button
        aria-label="Favorito"
        aria-pressed={favoritos.includes(id)}
        onClick={() => toggleFavorito(id)}
      >
        <svg viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      </button>

      <img src={imagen} alt={nombre} />
      <h3>{nombre}</h3>
      <p>$ {precio.toFixed(2)}</p>

      <footer>
        {cantidad ? (
          <>
            <span className="boton">Seleccionado</span>
            <b>{cantidad}</b>
            <div>
              <button onClick={() => poner(id, cantidad + 1)} aria-label="Más">▲</button>
              <button onClick={() => poner(id, cantidad - 1)} aria-label="Menos">▼</button>
            </div>
          </>
        ) : (
          <button className="boton" onClick={() => poner(id, 1)}>
            Agregar <img src="/imagenes/carrito.png" alt="" />
          </button>
        )}
      </footer>
    </article>
  );
}

export default function Menu(props) {
  const { productos } = props; // vienen de PostgreSQL (los pide App.jsx)
  return (
    <>
      <Navbar />
      <main className="lista">
        {productos.length === 0 && <p>No hay productos disponibles por ahora.</p>}
        {productos.map((p) => <Tarjeta key={p.id} {...p} {...props} />)}
      </main>
    </>
  );
}