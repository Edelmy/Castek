import os

import sys
from getpass import getpass#es para no mostrar la contraseña mientras la escribe

import psycopg2#permite la conexión con Postgre
from flask import Flask, jsonify, request, session #jsonify convierte datos en respuestas JSON para enviarlas a react
from flask_cors import CORS#hace que flask y react se comuniquen apesar de estar en puertos distintos
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
app.secret_key = 'secret_key' # Clave para proteger la sesión (la cookie del usuario)

# React corre en otro puerto (5173), así que hay que permitirle hablar con Flask
CORS(app, supports_credentials=True, origins=['http://localhost:5173'])

#--------------------------------------------
CUENTAS = {
    'postgres': ('postgres', os.environ.get('PG_CLAVE_POSTGRES', '131313')),   # solo para crear-usuario
    'auth':     ('castek_auth',     os.environ.get('PG_CLAVE_AUTH',     'CAMBIAR_castek_auth')),
    'Cliente':       ('castek_cliente',  os.environ.get('PG_CLAVE_CLIENTE',  'CAMBIAR_castek_cliente')),
    'Vendedor':      ('castek_vendedor', os.environ.get('PG_CLAVE_VENDEDOR', 'CAMBIAR_castek_vendedor')),
    'Administrador': ('castek_admin',    os.environ.get('PG_CLAVE_ADMIN',    'CAMBIAR_castek_admin')),
}#Cada rol de la aplicación usa SU cuenta de PostgreSQL. Así la base de datos puede controlar qué puede hacer cada rol, sin que la aplicación tenga que preocuparse de eso. 

def Conexion(cuenta='postgres'):
    # Abre la conexión a PostgreSQL con la cuenta indicada 
    usuario, clave = CUENTAS[cuenta]
    return psycopg2.connect(host='localhost', port=5432, dbname='castekDB', user=usuario, password=clave)

def conexion_de_sesion():
    # La conexión que corresponde al rol de quien tiene la sesión abierta
    return Conexion(session['rol'])

# LOGIN
@app.post('/api/login')
def login():
    datos = request.get_json() # lo que manda React: {"usuario": "...", "password": "..."}
    usuario = datos.get('usuario', '').strip()
    password = datos.get('password', '')

    conn = Conexion('auth')   # el "portero": solo puede consultar usuarios para el login
    cur = conn.cursor()
    cur.execute(
        """SELECT u.id_usuario, u.nom_usua, u.contrasena, r.nom_rol
           FROM usuario u
           JOIN rol r ON r.id_rol = u.id_rol
           WHERE u.nom_usua = %s AND u.estado = TRUE""",
        (usuario,),
    )
    fila = cur.fetchone()      # None si el usuario no existe
    conn.close()

    # Se compara la contraseña escrita contra el HASH guardado en la base.
    if fila is None or not check_password_hash(fila[2], password):
        return jsonify(error='Usuario o contraseña incorrectos'), 401

    # Se guarda en la sesión quién es y qué rol tiene.
    session['id'] = fila[0]
    session['usuario'] = fila[1]
    session['rol'] = fila[3]

    # React recibe el rol y con eso decide qué pantalla mostrar.
    return jsonify(usuario=fila[1], rol=fila[3])

    # Se compara la contraseña escrita contra el HASH guardado en la base.
    if fila is None or not check_password_hash(fila[2], password):
        return jsonify(error='Usuario o contraseña incorrectos'), 401

    # Se guarda en la sesión quién es y qué rol tiene.
    session['id'] = fila[0]
    session['usuario'] = fila[1]
    session['rol'] = fila[3]

    # React recibe el rol y con eso decide qué pantalla mostrar.
    return jsonify(usuario=fila[1], rol=fila[3])
#-------------------------------------------------------------------------------------
#React la llama al abrir o recargar la página
# para saber si ya hay una sesión abierta y con qué rol.
@app.get('/api/me')
def me():
    if 'id' not in session:
        return jsonify(error='Sin sesión'), 401
    return jsonify(usuario=session['usuario'], rol=session['rol'])


@app.post('/api/logout')
def logout():
    session.clear()
    return jsonify(mensaje='Sesión cerrada')
#------  menú
@app.get('/api/productos')
def productos():
    if 'id' not in session:
        return jsonify(error='Sin sesión'), 401

    conn = conexion_de_sesion()
    cur = conn.cursor()
    cur.execute(
        """SELECT pv.id_tipo_prod_vent, p.id_prod, p.nom_prod, pv.precio, t.nom_tipo_venta, p.stock
           FROM producto p
           JOIN presentprodvent pv ON pv.id_prod = p.id_prod
           JOIN tipoventa t        ON t.id_tipo_venta = pv.id_tipo_venta
           WHERE p.estado = TRUE
           ORDER BY p.id_prod"""
    )
    filas = cur.fetchall()
    conn.close()
 # id = la presentación (producto + cómo se vende). Es lo que usará el carrito.
    return jsonify([
        {'id': f[0], 'id_prod': f[1], 'nombre': f[2], 'precio': float(f[3]), 'tipo': f[4], 'stock': f[5]}
        for f in filas
    ])

# ---------------------------------------------------------------- CREAR USUARIOS (desde la terminal)
def crear_usuario():
    nombre = input('Nombre real (ej. Ana María): ').strip()
    nom_usua = input('Usuario para iniciar sesión (ej. ana): ').strip()
    ap = input('Apellido paterno: ').strip()
    rol = input('Rol (Administrador / Vendedor / Cliente): ').strip()
    password = getpass('Contraseña: ')

    conn = Conexion()
    cur = conn.cursor()
    cur.execute('SELECT id_rol FROM rol WHERE nom_rol = %s', (rol,))
    fila = cur.fetchone()
    if fila is None:
        print('Ese rol no existe. Revisa que esté escrito igual que en la tabla rol.')
        conn.close()
        return

    cur.execute(
        'INSERT INTO usuario (nombre, nom_usua, ap, contrasena, id_rol) VALUES (%s, %s, %s, %s, %s) RETURNING id_usuario',
        (nombre, nom_usua, ap, generate_password_hash(password), fila[0]),   # se guarda el hash, no la contraseña
    )
    id_usuario = cur.fetchone()[0]

    # Si es Cliente, también se crea su registro en la tabla cliente, unido a su cuenta.
    # Las dos inserciones se confirman juntas: o se crean las dos o no se crea ninguna.
    if rol == 'Cliente':
        cur.execute(
            'INSERT INTO cliente (nombre, ap, id_usuario) VALUES (%s, %s, %s)',
            (nombre, ap, id_usuario),
        )

    conn.commit()
    conn.close()
    print('Usuario creado' + (' (con su registro de cliente)' if rol == 'Cliente' else ''))
#--------------------------------------------

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'crear-usuario':
        crear_usuario()
    else:
        app.run(debug=True, port=5000)