"""
CIFRADO DE DATOS DEL CLIENTE (a nivel de aplicación, con Fernet)

Idea: Flask cifra el dato ANTES de mandarlo a PostgreSQL y lo descifra DESPUÉS de leerlo.
La base de datos solo ve texto ilegible; sin la clave, un respaldo o una copia robada de la base no sirve.

Técnica: Fernet (librería 'cryptography'). Por dentro usa
  - AES-128 en modo CBC  -> cifra el contenido (confidencialidad)
  - HMAC-SHA256          -> firma el resultado (si alguien lo altera, no se puede descifrar)
  - un valor aleatorio (IV) distinto en cada cifrado -> el mismo texto da resultados distintos.

LA CLAVE:
  1) Se toma de la variable de entorno CASTEK_CLAVE_CIFRADO, si existe.
  2) Si no, se usa (o se crea la primera vez) el archivo  clave_cifrado.key  junto a app.py.
  ¡Respáldala aparte de la base de datos! Si la pierdes, los datos cifrados NO se pueden recuperar.
"""
import os

from cryptography.fernet import Fernet, InvalidToken

PREFIJO = 'enc:'   # marca que distingue un dato cifrado de uno viejo en texto plano
ARCHIVO_CLAVE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'clave_cifrado.key')


def _cargar_clave():
    clave = os.environ.get('CASTEK_CLAVE_CIFRADO')
    if clave:
        return clave.encode()
    if not os.path.exists(ARCHIVO_CLAVE):
        with open(ARCHIVO_CLAVE, 'wb') as f:
            f.write(Fernet.generate_key())
        print(f'[cifrado] Se creó una clave nueva en {ARCHIVO_CLAVE}. RESPÁLDALA y no la subas a Git.')
    with open(ARCHIVO_CLAVE, 'rb') as f:
        return f.read().strip()


_fernet = Fernet(_cargar_clave())


def cifrar(valor):
    """Texto -> 'enc:gAAAA...'. None y '' se dejan igual (no hay nada que proteger)."""
    if valor is None or valor == '':
        return valor
    valor = str(valor)
    if valor.startswith(PREFIJO):          # ya estaba cifrado: no se cifra dos veces
        return valor
    return PREFIJO + _fernet.encrypt(valor.encode('utf-8')).decode('ascii')


def descifrar(valor):
    """'enc:gAAAA...' -> texto. Si el dato es viejo (sin prefijo) se devuelve tal cual,
    así los registros anteriores a este cambio siguen funcionando."""
    if valor is None or not isinstance(valor, str) or not valor.startswith(PREFIJO):
        return valor
    try:
        return _fernet.decrypt(valor[len(PREFIJO):].encode('ascii')).decode('utf-8')
    except InvalidToken:
        return '[no se pudo descifrar]'     # clave equivocada o dato alterado
