import { useState } from "react";
import { Link } from "react-router-dom";
import { API } from "../api";
import "../styles/registro.css"; // el diseño de la tarjeta (el mismo que usa Registro)
import "../styles/login.css";

// Pantalla de inicio de sesión, para los tres roles.
// "alEntrar" es una función que App.jsx le pasa; se llama cuando Flask dice que el login es correcto.
export default function Login({ alEntrar }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function entrar(e) {
    e.preventDefault(); // evita que la página se recargue al enviar el formulario
    setError("");

    try {
      // POST: le manda a Flask el usuario y la contraseña
      const respuesta = await fetch(`${API}/login`, {
        method: "POST",
        credentials: "include", // permite que viaje la cookie de sesión
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, password }),
      });
      const datos = await respuesta.json(); // { usuario, rol }  o  { error }

      if (respuesta.ok) alEntrar(datos);
      else setError(datos.error);
    } catch {
      setError("No se pudo conectar con el servidor. ¿Está encendido Flask?");
    }
  }

  return (
    <>
      <header className="barra-cafe" />
      <nav className="barra-menu">
        <span className="logo">Castek<i>Sweet♡</i></span>
      </nav>

      <main className="registro login">
        <form className="perfil" onSubmit={entrar}>
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="12" fill="#A65E43" />
            <circle cx="12" cy="9" r="3.5" fill="white" />
            <path d="M6 19c0-3.5 2.7-5.5 6-5.5s6 2 6 5.5z" fill="white" />
          </svg>

          <label>
            🤎Usuario:
            <input name="usuario" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
          </label>

          <label>
            🤎Contraseña:
            <input
              name="contrasena"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <button className="boton" type="submit">Ingresar</button>
          {error && <p className="error">{error}</p>}
          <Link to="/crear-cuenta">¿Eres cliente nuevo? Crea tu cuenta</Link>
        </form>

        <img src="/imagenes/texto.png" alt="" />
      </main>
    </>
  );
}
