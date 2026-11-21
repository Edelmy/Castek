import BotonSalir from "../components/BotonSalir";
import "../styles/login.css";

// Panel provisional. Aquí irán los módulos del administrador (productos, usuarios, gastos, corte...).
export default function Administrador({ sesion }) {
  return (
    <main className="panel">
      <h2>Panel del Administrador</h2>
      <p>Hola, {sesion.usuario}</p>
      <BotonSalir className="boton" />
    </main>
  );
}
