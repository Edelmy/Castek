import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { API } from "./api";
import Login from "./vistaLogin/login";
import Administrador from "./vistaAdministrador/administrador";
import RegistrarCompra from "./vistaVendedor/registrarCompra";
import PedidosVendedor from "./vistaVendedor/pedidos";
import ReciboVendedor from "./vistaVendedor/reciboVendedor";

import Nosotros from "./vistaCliente/nosotros";
import Menu, { imagenDe } from "./vistaCliente/menu";
import Carrito from "./vistaCliente/carrito";
import Favoritos from "./vistaCliente/favoritos";
import Registro from "./vistaCliente/registro";
import Historial from "./vistaCliente/historial";
import Recibo from "./vistaCliente/recibo";

// A qué pantalla va cada rol después de iniciar sesión.
// Los nombres deben ser iguales a los de la tabla "rol" en PostgreSQL.
const inicioDe = {
  Cliente: "/nosotros",
  Administrador: "/administrador",
  Vendedor: "/vendedor/registrar",
};

// Guardia de rutas: deja pasar solo a quien tenga el rol indicado.
//   - Sin sesión          -> lo manda al login
//   - Con otro rol        -> lo manda a su propia pantalla
function Protegida({ sesion, rol, children }) {
  if (!sesion) return <Navigate to="/login" replace />;
  if (sesion.rol !== rol) return <Navigate to={inicioDe[sesion.rol] ?? "/login"} replace />;
  return children;
}

export default function App() {
  const [favoritos, setFavoritos] = useState([]); // [ids]
  const [carrito, setCarrito] = useState({});     // { id: cantidad }

  // Quién tiene la sesión abierta: null (nadie) o { usuario, rol }
  const [sesion, setSesion] = useState(null);
  const [cargando, setCargando] = useState(true); // true mientras se le pregunta a Flask

  // Al abrir o recargar la página, se le pregunta a Flask si ya hay una sesión abierta
  useEffect(() => {
    fetch(`${API}/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setSesion)
      .catch(() => setSesion(null))
      .finally(() => setCargando(false));
  }, []);

  // Productos que vienen de PostgreSQL (se piden cuando alguien entra como Cliente)
  const [productos, setProductos] = useState([]);
  useEffect(() => {
    if (sesion?.rol !== "Cliente") return;
    fetch(`${API}/productos`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((lista) => setProductos(lista.map((p) => ({ ...p, imagen: imagenDe(p.nombre) }))))
      .catch(() => setProductos([]));
  }, [sesion]);

  const toggleFavorito = (id) =>
    setFavoritos((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  // Fija la cantidad; con 0 o menos quita el producto
  const poner = (id, cantidad) =>
    setCarrito((c) => {
      const nuevo = { ...c, [id]: cantidad };
      if (cantidad <= 0) delete nuevo[id];
      return nuevo;
    });

  const tienda = { productos, favoritos, carrito, toggleFavorito, poner };

  // Atajo: envuelve una pantalla para que solo la vea un Cliente
  const cliente = (pantalla) => (
    <Protegida sesion={sesion} rol="Cliente">{pantalla}</Protegida>
  );

  // Igual, para las pantallas del Vendedor
  const vendedor = (pantalla) => (
    <Protegida sesion={sesion} rol="Vendedor">{pantalla}</Protegida>
  );

  // Hasta saber si hay sesión, no se muestra nada (evita un parpadeo del login)
  if (cargando) return null;

  // Si ya hay sesión y el rol existe, /login lo manda a su pantalla
  const destino = sesion && inicioDe[sesion.rol];

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route
          path="/login"
          element={destino ? <Navigate to={destino} replace /> : <Login alEntrar={setSesion} />}
        />

        {/* Administrador (por ahora panel vacío) */}
        <Route
          path="/administrador"
          element={
            <Protegida sesion={sesion} rol="Administrador">
              <Administrador sesion={sesion} />
            </Protegida>
          }
        />

        {/* Vista del Vendedor (pantallas con datos de ejemplo por ahora) */}
        <Route path="/vendedor" element={<Navigate to="/vendedor/registrar" replace />} />
        <Route path="/vendedor/registrar" element={vendedor(<RegistrarCompra />)} />
        <Route path="/vendedor/pedidos" element={vendedor(<PedidosVendedor />)} />
        <Route path="/vendedor/recibo" element={vendedor(<ReciboVendedor />)} />

        {/* Vista del Cliente: las mismas pantallas de antes, ahora protegidas */}
        <Route path="/nosotros" element={cliente(<Nosotros />)} />
        <Route path="/menu" element={cliente(<Menu {...tienda} />)} />
        <Route path="/pedidos" element={cliente(<Carrito {...tienda} />)} />
        <Route path="/favoritos" element={cliente(<Favoritos {...tienda} />)} />
        <Route path="/registro" element={cliente(<Registro />)} />
        <Route path="/historial" element={cliente(<Historial />)} />
        <Route path="/recibo" element={cliente(<Recibo />)} />

        {/* Cualquier otra dirección */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
