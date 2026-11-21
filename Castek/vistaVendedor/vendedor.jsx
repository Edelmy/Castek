import BotonSalir from "../components/BotonSalir";
import "../styles/login.css";

// Panel provisional. Aquí irán los módulos del vendedor (ventas, pedidos...).
export default function Vendedor({ sesion }) {
  return (
    <main className="panel">
      <h2>Panel del Vendedor</h2>
      <p>Hola, {sesion.usuario}</p>
      <BotonSalir className="boton" />
    </main>
  );
}
