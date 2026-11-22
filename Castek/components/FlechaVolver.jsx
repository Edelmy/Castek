import { Link } from "react-router-dom";

// Flecha flotante para volver sin cerrar sesión (queda fija en una esquina de la pantalla)
export default function FlechaVolver({ to = "/menu", texto = "Volver al menú" }) {
  return (
    <Link className="flecha-volver" to={to} aria-label={texto} title={texto}>
      <span>←</span>
      <small>{texto}</small>
    </Link>
  );
}
