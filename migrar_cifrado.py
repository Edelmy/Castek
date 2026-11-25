"""
Cifra los datos que YA estaban guardados en texto plano (se corre UNA sola vez).

Antes:  1) ejecuta 06_cifrado.sql en pgAdmin (agranda las columnas)
        2) haz un respaldo de la base
Después: python migrar_cifrado.py

Es seguro correrlo dos veces: lo que ya empieza con "enc:" no se vuelve a cifrar.
"""
from app import Conexion
from cifrado import cifrar

# tabla -> (columna llave, columnas a cifrar, filtro opcional)
TABLAS = {
    'cliente':   ('id_client',  ['nombre', 'ap', 'am', 'telefono'], ''),
    'direccion': ('id_direc',   ['calle', 'numero', 'cruzamientos', 'com_ref', 'link_ubi'], ''),
    # en usuario solo las cuentas de Clientes (admin y vendedores se quedan igual)
    'usuario':   ('id_usuario', ['nombre', 'ap', 'am', 'telefono'],
                  "WHERE id_rol = (SELECT id_rol FROM rol WHERE nom_rol = 'Cliente')"),
}

conn = Conexion('postgres')       # cuenta dueña de las tablas
cur = conn.cursor()
try:
    # La bitácora guarda copia de lo que cambia en usuario; se apaga un momento para que
    # no anote los datos viejos (en texto plano) al cifrarlos.
    cur.execute('ALTER TABLE usuario DISABLE TRIGGER t_usuario_bitacora')
    for tabla, (llave, columnas, filtro) in TABLAS.items():
        cur.execute(f'SELECT {llave}, {", ".join(columnas)} FROM {tabla} {filtro}')
        cambiadas = 0
        for fila in cur.fetchall():
            nuevos = [cifrar(v) for v in fila[1:]]
            if nuevos != list(fila[1:]):
                asignar = ', '.join(f'{c} = %s' for c in columnas)
                cur.execute(f'UPDATE {tabla} SET {asignar} WHERE {llave} = %s', nuevos + [fila[0]])
                cambiadas += 1
        print(f'{tabla}: {cambiadas} filas cifradas')
    cur.execute('ALTER TABLE usuario ENABLE TRIGGER t_usuario_bitacora')
    conn.commit()
    print('Listo.')
except Exception:
    conn.rollback()     # si algo falla no queda nada a medias
    raise
finally:
    conn.close()
