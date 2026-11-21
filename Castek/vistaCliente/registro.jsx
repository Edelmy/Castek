import Navbar from "../components/Navbar";
import "../styles/registro.css";

// El formulario se escribe aquí e historial.jsx lo reutiliza
export function Perfil({ boton }) {
  return (
    <form className="perfil">
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="12" fill="#A65E43" />
        <circle cx="12" cy="9" r="3.5" fill="white" />
        <path d="M6 19c0-3.5 2.7-5.5 6-5.5s6 2 6 5.5z" fill="white" />
      </svg>

      {["Nombre", "Apellido", "Teléfono", "Dirección"].map((c) => (
        <label key={c}>
          🤎{c}: <input name={c.toLowerCase()} />
        </label>
      ))}

      <button className="boton">{boton}</button>
    </form>
  );
}

export default function Registro() {
  return (
    <>
      <Navbar />
      <main className="registro">
        <Perfil boton="Guardar" />
        <img src="/imagenes/texto.png" alt="Los mejores momentos siempre son dulces" />
      </main>
    </>
  );
}