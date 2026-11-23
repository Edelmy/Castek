import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { API, pedir } from "./api";
import Login from "./vistaLogin/login";
import CrearCuenta from "./vistaLogin/crearCuenta";
import RegistrarCompra from "./vistaVendedor/registrarCompra";
import PedidosVendedor from "./vistaVendedor/pedidos";
import Ventas from "./vistaVendedor/ventas";

import AdminProductos from "./vistaAdmin/productos";
import Clientes from "./vistaAdmin/clientes";
import Usuarios from "./vistaAdmin/usuarios";
import Gastos from "./vistaAdmin/gastos";
import Caja from "./vistaAdmin/caja";
import Reportes from "./vistaAdmin/reportes";
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
  Administrador: "/admin/productos",
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
  const [favoritos, setFavoritos] = useState([]); // [id de producto]
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

  // Mientras haya sesión, se le avisa a Flask cada 45 s que la pantalla sigue abierta
  // (así la cuenta se libera sola si cierran la pestaña sin salir). Si Flask ya no la reconoce, vuelve al login.
  useEffect(() => {
    if (!sesion) return;
    const latido = setInterval(() => {
      fetch(`${API}/me`, { credentials: "include" })
        .then((r) => { if (r.status === 401) setSesion(null); })
        .catch(() => {});
    }, 45000);
    return () => clearInterval(latido);
  }, [sesion]);

  // Productos que vienen de PostgreSQL (se piden cuando alguien entra como Cliente)
  const [productos, setProductos] = useState([]);
  const recargar = () =>
    pedir("/productos").then(({ ok, datos }) =>
      setProductos(ok ? datos.map((p) => ({ ...p, imagen: imagenDe(p.nombre) })) : [])
    );

  // Al entrar un Cliente se cargan sus productos y sus favoritos guardados
  useEffect(() => {
    if (sesion?.rol !== "Cliente") return;
    recargar();
    pedir("/favoritos").then(({ ok, datos }) => ok && setFavoritos(datos));
  }, [sesion]);

  // Corazón del menú: se cambia en pantalla y se guarda en la base (id = id del producto)
  const toggleFavorito = (id_prod) => {
    const activo = !favoritos.includes(id_prod);
    setFavoritos((f) => (activo ? [...f, id_prod] : f.filter((x) => x !== id_prod)));
    pedir(`/favoritos/${id_prod}`, "PUT", { activo }).then(({ ok }) => {
      if (!ok) setFavoritos((f) => (activo ? f.filter((x) => x !== id_prod) : [...f, id_prod])); // si falló, se deshace
    });
  };

  // Fija la cantidad; con 0 o menos quita el producto
  const poner = (id, cantidad) =>
    setCarrito((c) => {
      const nuevo = { ...c, [id]: cantidad };
      if (cantidad <= 0) delete nuevo[id];
      return nuevo;
    });
  const vaciar = () => setCarrito({});

  const tienda = { productos, favoritos, carrito, toggleFavorito, poner, vaciar, recargar };

  // Atajo: envuelve una pantalla para que solo la vea un Cliente
  const cliente = (pantalla) => (
    <Protegida sesion={sesion} rol="Cliente">{pantalla}</Protegida>
  );

  // Igual, para las pantallas del Vendedor
  const vendedor = (pantalla) => (
    <Protegida sesion={sesion} rol="Vendedor">{pantalla}</Protegida>
  );

  // Igual, para las pantallas del Administrador
  const admin = (pantalla) => (
    <Protegida sesion={sesion} rol="Administrador">{pantalla}</Protegida>
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

        <Route path="/crear-cuenta" element={destino ? <Navigate to={destino} replace /> : <CrearCuenta />} />

        {/* Vista del Vendedor (pantallas con datos de ejemplo por ahora) */}
        <Route path="/vendedor" element={<Navigate to="/vendedor/registrar" replace />} />
        <Route path="/vendedor/registrar" element={vendedor(<RegistrarCompra />)} />
        <Route path="/vendedor/pedidos" element={vendedor(<PedidosVendedor />)} />
        <Route path="/vendedor/recibo/:id" element={vendedor(<ReciboVendedor />)} />
        <Route path="/vendedor/ventas" element={vendedor(<Ventas />)} />

        {/* Vista del Administrador */}
        <Route path="/administrador" element={<Navigate to="/admin/productos" replace />} />
        <Route path="/admin/productos" element={admin(<AdminProductos />)} />
        <Route path="/admin/pedidos" element={admin(<PedidosVendedor rol="admin" />)} />
        <Route path="/admin/ventas" element={admin(<Ventas rol="admin" />)} />
        <Route path="/admin/registrar" element={admin(<RegistrarCompra rol="admin" />)} />
        <Route path="/admin/recibo/:id" element={admin(<ReciboVendedor rol="admin" />)} />
        <Route path="/admin/clientes" element={admin(<Clientes />)} />
        <Route path="/admin/usuarios" element={admin(<Usuarios />)} />
        <Route path="/admin/gastos" element={admin(<Gastos />)} />
        <Route path="/admin/caja" element={admin(<Caja />)} />
        <Route path="/admin/reportes" element={admin(<Reportes />)} />

        {/* Vista del Cliente: las mismas pantallas de antes, ahora protegidas */}
        <Route path="/nosotros" element={cliente(<Nosotros />)} />
        <Route path="/menu" element={cliente(<Menu {...tienda} />)} />
        <Route path="/pedidos" element={cliente(<Carrito {...tienda} />)} />
        <Route path="/favoritos" element={cliente(<Favoritos {...tienda} />)} />
        <Route path="/registro" element={cliente(<Registro />)} />
        <Route path="/historial" element={cliente(<Historial />)} />
        <Route path="/recibo/:id" element={cliente(<Recibo />)} />
        <Route path="/recibo" element={<Navigate to="/historial" replace />} />

        {/* Cualquier otra dirección */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
