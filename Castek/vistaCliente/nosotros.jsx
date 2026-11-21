import React from "react";
import Navbar from "../components/Navbar";
import "../styles/nosotros.css";

function Nosotros() {
  return (
    <div className="contenedor">
      <Navbar />

      {/* Imagen con la palabra NOSOTROS */}
      <div className="imagen-nosotros">
      </div>

      {/* Historia */}
      <section className="seccion-historia">
        <h2>Historia que da Dulzura</h2>

        <div className="historia-local"></div>
      </section>
    </div>
  );
}

export default Nosotros;