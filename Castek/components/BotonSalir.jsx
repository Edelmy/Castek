import { API } from "../api";

// Botón para cerrar sesión. Se usa en el Navbar del cliente, en el menú del vendedor
// y en el panel del administrador. Si no se le da texto, dice "Salir".
export default function BotonSalir({ className, children = "Salir" }) {
  async function salir() {
    // Le avisa a Flask que borre la sesión
    await fetch(`${API}/logout`, { method: "POST", credentials: "include" });
    // Recarga la página en /login para que React olvide quién estaba dentro
    window.location.href = "/login";
  }

  return (
    <button className={className} onClick={salir}>
      {children}
    </button>
  );
}
