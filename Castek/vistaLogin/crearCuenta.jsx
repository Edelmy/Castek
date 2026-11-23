import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { pedir } from "../api";
import FlechaVolver from "../components/FlechaVolver";
import "../styles/registro.css";
import "../styles/login.css";
import CampoNumero from "../components/CampoNumero";

// Los clientes nuevos crean su propia cuenta aquí. Siempre se crea con rol Cliente.
export default function CrearCuenta() {
  const navigate = useNavigate();
  const [error, setError] = useState("");

  async function enviar(e) {
    e.preventDefault();
    setError("");
    const datos = Object.fromEntries(new FormData(e.target)); // { nombre, ap, ..., usuario, password }
    if (datos.password !== datos.repetir) return setError("Las contraseñas no coinciden");

    const { ok, datos: r } = await pedir("/registro", "POST", datos);
    if (!ok) return setError(r.error);
    alert("¡Cuenta creada! Ahora inicia sesión."); // aviso sencillo
    navigate("/login");
  }

  return (
    <>
      <FlechaVolver to="/login" texto="Volver al inicio de sesión" />
      <header className="barra-cafe" />
      <nav className="barra-menu">
        <span className="logo">Castek<i>Sweet♡</i></span>
      </nav>

      <main className="registro">
        <form className="perfil largo" onSubmit={enviar}>
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="12" fill="#A65E43" />
            <circle cx="12" cy="9" r="3.5" fill="white" />
            <path d="M6 19c0-3.5 2.7-5.5 6-5.5s6 2 6 5.5z" fill="white" />
          </svg>

          <h3>Tu cuenta</h3>
          <div className="doble">
            <label>Usuario <input name="usuario" required /></label>
            <label>Contraseña (mín. 6) <input name="password" type="password" minLength="6" required /></label>
            <label>Repite la contraseña <input name="repetir" type="password" minLength="6" required /></label>
          </div>

          <h3>Datos personales</h3>
          <div className="doble">
            <label>Nombre <input name="nombre" required /></label>
            <label>Teléfono <CampoNumero tipo="telefono" name="telefono" pattern="[0-9]{10}" title="10 dígitos, solo números" /></label>
            <label>Apellido paterno <input name="ap" required /></label>
            <label>Apellido materno <input name="am" /></label>
          </div>

          <h3>Domicilio (opcional)</h3>
          <div className="doble">
            <label>Calle <input name="calle" /></label>
            <label>Núm. de casa <input name="numero" /></label>
          </div>
          <label>Cruzamientos <input name="cruzamientos" /></label>

          {error && <p className="error">{error}</p>}
          <button className="boton" type="submit">Crear cuenta</button>
          <Link to="/login">Ya tengo cuenta</Link>
        </form>
      </main>
    </>
  );
}
