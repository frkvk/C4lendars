# C4lendar 📅

Aplicación web de gestión de calendarios de guardias con autenticación JWT, panel de administración y API REST documentada.

---

## 🧱 Stack

- **Frontend:** HTML + CSS + JS puro servido por Nginx
- **Backend:** Node.js + Express
- **Base de datos:** MariaDB 11
- **Contenedores:** Docker + Docker Compose

---

## 🚀 Despliegue rápido

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/c4lendar.git
cd c4lendar
```

### 2. Configurar variables

Edita el `docker-compose.yml` y cambia los valores marcados:

#### Contraseñas de base de datos
```yaml
C4lendar-DB:
  environment:
    MARIADB_ROOT_PASSWORD: "CAMBIA_ESTO"   # Contraseña root de MariaDB
    MARIADB_PASSWORD: "CAMBIA_ESTO"        # Contraseña del usuario de app
```

#### Clave secreta JWT
Genera una clave segura con:
```bash
openssl rand -base64 48
```
Y ponla en:
```yaml
C4lendar-BE:
  environment:
    DB_PASS: "CAMBIA_ESTO"              # Debe coincidir con MARIADB_PASSWORD
    JWT_SECRET: "PON_AQUI_TU_CLAVE"    # Clave de firma de tokens JWT
```

#### IP para el certificado HTTPS
El certificado autofirmado se genera automáticamente al arrancar. Cambia la IP en `docker-compose.yml`:
```yaml
C4lendar-Certs:
  entrypoint: sh -c "... -addext 'subjectAltName=IP:TU_IP,DNS:localhost' ..."
```

### 3. Configurar Nginx

El archivo `nginx.conf` apunta al backend por nombre de contenedor. Si cambias el nombre del contenedor del backend en el `docker-compose.yml`, actualiza también esta línea en `nginx.conf`:

```nginx
proxy_pass http://C4lendar-BE:4000;
```

### 4. Arrancar el proyecto

**Primera vez** (MariaDB tarda ~5 minutos en inicializarse):
```bash
docker compose up -d
docker compose logs -f C4lendar-DB   # Esperar a que termine la inicialización
```

**Arranques posteriores:**
```bash
docker compose up -d
```

> El certificado HTTPS se genera automáticamente en el primer arranque y se reutiliza en los siguientes.

---

## 🔐 Credenciales por defecto

Al arrancar por primera vez se crea automáticamente un usuario administrador:

| Campo      | Valor   |
|------------|---------|
| Usuario    | `admin` |
| Contraseña | `admin` |

> ⚠️ **Cambia la contraseña del admin desde el panel tras el primer acceso.**

---

## 🌐 URLs y puertos

| Recurso                    | URL                                         |
|----------------------------|---------------------------------------------|
| Panel principal (HTTPS)    | `https://TU_IP:8443`                        |
| Panel principal (HTTP)     | `http://TU_IP:8083` → redirige a HTTPS      |
| Documentación API (Swagger)| `https://TU_IP:8443/api-docs`               |

| Servicio  | Puerto host | Puerto contenedor | Notas                                      |
|-----------|-------------|-------------------|--------------------------------------------|
| Frontend  | `8083`      | `80`              | Redirige automáticamente a HTTPS           |
| Frontend  | `8443`      | `443`             | HTTPS principal                            |
| Backend   | No expuesto | `4000`            | Opcional, solo si necesitas acceso directo |
| MariaDB   | `3308`      | `3306`            | Opcional, solo para gestión externa        |

Por defecto el backend **no expone puerto externo** — el frontend accede a él internamente a través de Nginx. Solo expón el puerto del backend si necesitas usar la API directamente desde fuera del servidor:

```yaml
C4lendar-BE:
  ports:
    - "4000:4000"
```

---

## 📁 Estructura del proyecto
```
c4lendar/
├── backend/
│ ├── server.js # API REST (Express)
│ └── package.json # Dependencias Node.js
├── frontend/
│ ├── index.html # Panel de administración
│ ├── viewer.html # Visor de calendario (lun-dom)
│ └── 404.html # Página de error
├── nginx.conf # Configuración del servidor web
└── docker-compose.yml # Orquestación de contenedores
```

---

## 🔄 Actualizar el proyecto

```bash
git pull
docker compose down
docker compose up -d
```

> Los datos de la base de datos persisten en el volumen `c4lendar_db_data` gestionado por Docker y no se pierden al actualizar.

---

## 🧹 Resetear la base de datos

```bash
docker compose down
docker volume rm c4lendar_c4lendar_db_data
docker compose up -d
```

> ⚠️ Esto elimina **todos los datos**. Úsalo solo si quieres empezar desde cero.

---

## 🔒 Regenerar el certificado HTTPS

```bash
docker compose down
docker volume rm c4lendar_c4lendar_certs
docker compose up -d
```

> Útil si cambias la IP del servidor o el certificado ha caducado (caduca en 10 años).

---

## 🛠️ Comandos útiles

```bash
# Ver logs en tiempo real
docker compose logs -f

# Ver logs solo del backend
docker compose logs -f C4lendar-BE

# Reiniciar solo el backend
docker compose restart C4lendar-BE

# Entrar al contenedor del backend
docker exec -it C4lendar-BE sh

# Conectarse a MariaDB
docker exec -it C4lendar-DB mariadb -u DB_User -p DB_Pass

# Ver dónde están los datos de la BBDD
docker volume inspect c4lendar_c4lendar_db_data

# Forzar reinstalación de node_modules
docker volume rm c4lendar_excem_node_modules
docker compose up -d
```

---

## 📦 Dependencias del backend

| Paquete               | Uso                         |
|-----------------------|-----------------------------|
| `express`             | Servidor HTTP               |
| `mysql2`              | Conexión a MariaDB          |
| `bcrypt`              | Hash de contraseñas         |
| `jsonwebtoken`        | Autenticación JWT           |
| `node-fetch`          | Peticiones HTTP (festivos)  |
| `swagger-ui-express`  | Interfaz Swagger UI         |
| `swagger-jsdoc`       | Generación de spec OpenAPI  |

---

## 📌 Notas

- Los festivos nacionales se obtienen automáticamente de [Nager.Date](https://date.nager.at) y se combinan con festivos regionales configurados por comunidad autónoma.
- Si el servidor no tiene acceso a internet, los festivos nacionales no se cargarán pero los regionales sí.
- El token JWT tiene una validez de **7 días**. Tras ese periodo el usuario deberá volver a iniciar sesión.
- El certificado HTTPS es autofirmado — el navegador mostrará un aviso de seguridad la primera vez. Acepta la excepción para continuar.
