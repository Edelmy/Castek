import Navbar from "../components/Navbar";
import { Tarjeta } from "./menu";
import "../styles/menu.css";
import "../styles/favoritos.css";

export default function Favoritos(props) {
  const lista = props.productos.filter((p) => props.favoritos.includes(p.id));

  return (
    <>
      <Navbar />
      <main className="lista">
        {lista.length
          ? lista.map((p) => <Tarjeta key={p.id} {...p} {...props} />)
          : <p>Aún no tienes favoritos. Marca un ♡ en el menú y aparecerá aquí.</p>}
      </main>
    </>
  );
}