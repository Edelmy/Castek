import Navbar from "../components/Navbar";
import FlechaVolver from "../components/FlechaVolver";
import { Tarjeta } from "./menu";
import "../styles/menu.css";
import "../styles/favoritos.css";

export default function Favoritos(props) {
  const lista = props.productos.filter((p) => props.favoritos.includes(p.id_prod));

  return (
    <>
      <Navbar />
      <FlechaVolver to="/menu" texto="Volver al menú" />
      <main className="lista">
        {lista.length
          ? lista.map((p) => <Tarjeta key={p.id} {...p} {...props} />)
          : <p>Aún no tienes favoritos. Marca un ♡ en el menú y aparecerá aquí.</p>}
      </main>
    </>
  );
}