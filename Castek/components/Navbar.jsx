import { NavLink, Link } from "react-router-dom";
import BotonSalir from "./BotonSalir";
import "../styles/Navbar.css";

const enlaces = [
  ["Nosotros", "/nosotros"],
  ["Menú", "/menu"],
  ["Pedidos", "/pedidos", "carrito"],
  ["Favoritos", "/favoritos", "corazon"],
  ["Historial", "/historial"],
];

export default function Navbar() {
  return (
    <>
      <header className="barra-cafe">
        <button aria-label="Buscar">
          
        </button>
      </header>

      <nav className="barra-menu">
        <span className="logo">Castek<i>Sweet♡</i></span>

        <div>
          {enlaces.map(([texto, ruta, icono]) => (
            <NavLink key={ruta} to={ruta}>
              {texto}
              {icono && <img src={`/imagenes/${icono}.png`} alt="" />}
            </NavLink>
          ))}
        </div>

        <Link to="/registro" aria-label="Usuario">
          <img src="/imagenes/usuario.png" alt="" />
        </Link>

        <BotonSalir />
      </nav>
    </>
  );
}