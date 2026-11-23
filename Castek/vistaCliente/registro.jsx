import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import FlechaVolver from "../components/FlechaVolver";
import { SERVIDOR, pedir } from "../api";
import "../styles/registro.css";
import CampoNumero from "../components/CampoNumero";

// Pide los datos del cliente a Flask y sabe guardarlos. Lo usan Registro e Historial.
export function usePerfil() {
  const [datos, setDatos] = useState(null);   // null = todavía cargando
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    pedir("/perfil").then(({ ok, datos }) => (ok ? setDatos(datos) : setError(datos.error)));
  }, []);

  async function guardar(formData) {
    setAviso("");
    setError("");
    const { ok, datos: respuesta } = await pedir("/perfil", "PUT", formData);
    if (!ok) return setError(respuesta.error);
    setAviso("¡Tus datos se guardaron correctamente!");
    const nuevo = await pedir("/perfil"); // se vuelve a leer para ver la imagen guardada
    if (nuevo.ok) setDatos(nuevo.datos);
  }

  return { datos, aviso, error, guardar };
}

// El formulario se escribe aquí e historial.jsx lo reutiliza
export function Perfil({ boton, datos, onGuardar }) {
  const [vista, setVista] = useState("");

  const elegirImagen = (e) => {
    const archivo = e.target.files[0];
    setVista(archivo ? URL.createObjectURL(archivo) : "");
  };

  const enviar = (e) => {
    e.preventDefault();
    onGuardar?.(new FormData(e.target)); // incluye la imagen como archivo
  };

  const imagenActual = vista || (datos.imagen ? `${SERVIDOR}${datos.imagen}` : "");

  return (
    <form className="perfil largo" onSubmit={enviar}>
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="12" fill="#A65E43" />
        <circle cx="12" cy="9" r="3.5" fill="white" />
        <path d="M6 19c0-3.5 2.7-5.5 6-5.5s6 2 6 5.5z" fill="white" />
      </svg>

      <h3>Datos personales</h3>
      <div className="doble">
        <label>Nombre <input name="nombre" defaultValue={datos.nombre} required /></label>
        <label>Teléfono
          <CampoNumero tipo="telefono" name="telefono" defaultValue={datos.telefono} pattern="[0-9]{10}" title="10 dígitos, solo números" required />
        </label>
        <label>Apellido paterno <input name="ap" defaultValue={datos.ap} required /></label>
        <label>Apellido materno <input name="am" defaultValue={datos.am} /></label>
      </div>

      <h3>Domicilio</h3>
      <div className="doble">
        <label>Calle <input name="calle" defaultValue={datos.calle} required /></label>
        <label>Núm. de casa <input name="numero" defaultValue={datos.numero} required /></label>
      </div>
      <label>Cruzamientos <input name="cruzamientos" defaultValue={datos.cruzamientos} required /></label>

      <label>
        Imagen de referencia
        <input name="imagen" type="file" accept="image/*" onChange={elegirImagen} />
      </label>
      {imagenActual && <img className="vista-previa" src={imagenActual} alt="Vista previa" />}

      <label>
        Comentario de referencia
        <textarea name="comentario" rows="3" defaultValue={datos.comentario} placeholder="Ej. Casa blanca con portón negro" />
      </label>

      <label>
        Link de la ubicación
        <input name="ubicacion" type="url" defaultValue={datos.ubicacion} placeholder="https://maps.app.goo.gl/..." />
      </label>

      <button className="boton">{boton}</button>
    </form>
  );
}

export default function Registro() {
  const { datos, aviso, error, guardar } = usePerfil();

  return (
    <>
      <Navbar />
      <FlechaVolver to="/menu" texto="Volver al menú" />
      <main className="registro">
        {datos && <Perfil boton="Guardar" datos={datos} onGuardar={guardar} />}
        {aviso && <p className="aviso">{aviso}</p>}
        {error && <p className="aviso error-texto">{error}</p>}
        <img src="/imagenes/texto.png" alt="" />
      </main>
    </>
  );
}
