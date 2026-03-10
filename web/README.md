# Trinity Web

Sitio web informativo para Trinity App.

## 📁 Estructura

```
web/
├── index.html          # Página principal
├── privacy.html        # Política de privacidad
├── terms.html          # Términos de uso
├── faqs.html          # Preguntas frecuentes
├── delete-account.html # Eliminación de cuenta
├── room.html          # Deep linking - Unirse a sala
├── 404.html           # Página de error
├── styles.css         # Estilos globales
├── .htaccess          # Configuración Apache (URLs limpias + deep linking)
├── netlify.toml       # Configuración Netlify
├── vercel.json        # Configuración Vercel
├── robots.txt         # SEO robots
├── sitemap.xml        # SEO sitemap
├── .well-known/       # Android App Links
│   └── assetlinks.json
└── README.md          # Este archivo
```

## 🖼️ Assets

**Importante**: Los archivos HTML referencian imágenes desde `../mobile/assets/` y `images/`. 

### Imágenes de la App
**Opción 1 - Deployment desde raíz del proyecto** (Recomendado):
- Deployar todo el repositorio y configurar la carpeta `web/` como root
- Las rutas relativas funcionarán correctamente

**Opción 2 - Deployment independiente**:
Si quieres deployar solo la carpeta `web/`, copia las imágenes necesarias:
```bash
# Crear carpeta de assets
mkdir web/assets

# Copiar imágenes necesarias
cp mobile/assets/splash-icon.png web/assets/
cp mobile/assets/favicon.png web/assets/

# Actualizar rutas en HTML (cambiar ../mobile/assets/ por ./assets/)
```

### Iconos de ODS
Coloca los iconos de los Objetivos de Desarrollo Sostenible en `web/images/`:
- `ods-3.png` - Salud y Bienestar
- `ods-9.png` - Industria, Innovación e Infraestructura
- `ods-12.png` - Producción y Consumo Responsables
- `ods-13.png` - Acción por el Clima

Ver `web/images/README.md` para más detalles sobre dónde obtener estos iconos.

## 🎨 Diseño

- **Mobile First**: Diseño responsive optimizado para móviles
- **Colores**: Paleta consistente con la app móvil
  - Primary: `#7c3aed` (púrpura)
  - Background: `#0a0a0a` (negro)
  - Surface: `#1a1a1a` (gris oscuro)
  - Text: `#ffffff` (blanco)
- **Tipografía**: System fonts para mejor rendimiento
- **Iconos**: SVG inline para mejor rendimiento

## 🚀 Deployment

### Script Automático (Recomendado)

**Windows (PowerShell)**:
```powershell
cd web
.\deploy.ps1
```

**Linux/Mac (Bash)**:
```bash
cd web
chmod +x deploy.sh
./deploy.sh
```

El script te guiará a través del proceso de deployment para:
1. Netlify
2. Vercel
3. AWS S3
4. GitHub Pages

### Opción 1: Netlify (Recomendado - Más fácil)

**Método 1: Drag & Drop**
1. Ve a [Netlify](https://app.netlify.com/)
2. Arrastra la carpeta `web/` al dashboard
3. ¡Listo! Tu sitio está en línea

**Método 2: CLI**
```bash
npm install -g netlify-cli
cd web
netlify deploy --prod
```

**Método 3: Git**
1. Conecta tu repositorio en Netlify
2. Build settings:
   - Base directory: `web`
   - Build command: (dejar vacío)
   - Publish directory: `.`
3. Deploy

### Opción 2: Vercel

```bash
npm install -g vercel
cd web
vercel --prod
```

O conecta tu repositorio en [Vercel Dashboard](https://vercel.com/):
- Root Directory: `web`
- Framework Preset: Other
- Build Command: (dejar vacío)
- Output Directory: `.`

### Opción 3: GitHub Pages

```bash
# Crear rama gh-pages
git checkout -b gh-pages
git add web/*
git commit -m "Deploy website"
git push origin gh-pages
```

Luego en GitHub:
- Settings → Pages
- Source: gh-pages branch
- Folder: / (root)

### Opción 4: AWS S3 + CloudFront

```bash
# Crear bucket S3
aws s3 mb s3://trinity-app-web

# Subir archivos
aws s3 sync web/ s3://trinity-app-web --delete

# Configurar como sitio web
aws s3 website s3://trinity-app-web --index-document index.html --error-document 404.html

# Crear distribución CloudFront (opcional, para HTTPS y CDN)
```

### Opción 5: Servidor Apache

1. Sube todos los archivos al directorio raíz
2. Asegúrate de que `.htaccess` esté presente
3. Verifica que `mod_rewrite` esté habilitado

### Opción 6: Servidor Nginx

Configuración para URLs limpias:

```nginx
server {
    listen 80;
    server_name trinity-app.es;
    root /var/www/trinity;
    index index.html;

    # Clean URLs
    location / {
        try_files $uri $uri.html $uri/ =404;
    }

    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Cache static assets
    location ~* \.(css|js|png|jpg|jpeg|gif|svg|webp)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 404 page
    error_page 404 /404.html;
}
```

## 🔗 URLs

- **Inicio**: `https://trinity-app.es/`
- **Privacidad**: `https://trinity-app.es/privacy`
- **Términos**: `https://trinity-app.es/terms`
- **FAQs**: `https://trinity-app.es/faqs`
- **Eliminar cuenta**: `https://trinity-app.es/delete-account`
- **Unirse a sala**: `https://trinity-app.es/room/{CODE}` (deep linking)

## 📱 Responsive Breakpoints

- **Mobile**: < 480px
- **Tablet**: 481px - 768px
- **Desktop**: > 768px

## 🎯 SEO

Cada página incluye:
- Meta description
- Meta keywords
- Open Graph tags (opcional, agregar si es necesario)
- Favicon
- Títulos descriptivos

## 🔧 Mantenimiento

### Actualizar versión

Cuando actualices la app, actualiza también:
- Footer: `Versión X.X.X`
- Páginas de legal: Fecha de actualización

### Agregar nueva página

1. Crea `nueva-pagina.html`
2. Copia la estructura de navegación
3. Agrega el contenido
4. Actualiza enlaces en footer
5. Actualiza `.htaccess` si es necesario

## 📊 Analytics (Opcional)

Para agregar Google Analytics:

```html
<!-- Agregar antes de </head> -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

## 🔒 Seguridad

Headers recomendados (agregar en servidor):

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
```

## 📝 Licencia

© 2026 Trinity App. Todos los derechos reservados.

## 📧 Contacto

- **Email**: trinity.app.spain@gmail.com
- **Instagram**: [@trinity.app](https://www.instagram.com/trinity.app/)


## 🔗 Android App Links

### Archivo assetlinks.json

El archivo `.well-known/assetlinks.json` es necesario para que los deep links de Android funcionen sin mostrar el diálogo de selección de app.

**Ubicación**: `web/.well-known/assetlinks.json`

**Contenido actual**:
- Package: `com.trinityapp.mobile`
- Debug SHA-256: `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`
- Release SHA-256: `33:79:58:38:1D:54:97:04:6C:81:8A:5D:EB:46:42:99:76:57:45:DD:26:A4:44:DD:F7:4B:1A:96:8B:49:5C:12`

### Deployment del archivo assetlinks.json

**IMPORTANTE**: Este archivo DEBE ser accesible en:
```
https://trinity-app.es/.well-known/assetlinks.json
```

**Requisitos**:
- ✅ Accesible vía HTTPS
- ✅ Content-Type: `application/json`
- ✅ Sin autenticación
- ✅ Sin redirects
- ✅ Código 200 OK

### Verificar Deployment

1. **Verificar accesibilidad**:
```bash
curl https://trinity-app.es/.well-known/assetlinks.json
```

2. **Verificar con Google**:
- Ir a: https://developers.google.com/digital-asset-links/tools/generator
- Ingresar dominio: `trinity-app.es`
- Verificar que el archivo sea válido

3. **Probar deep link**:
```bash
adb shell am start -W -a android.intent.action.VIEW \
  -d "https://trinity-app.es/room/ABC123" \
  com.trinityapp.mobile
```

### Configuración del Servidor

**Apache (.htaccess)** - Ya incluido:
```apache
<Files "assetlinks.json">
  Header set Content-Type "application/json"
  Header set Access-Control-Allow-Origin "*"
</Files>
```

**Nginx**:
```nginx
location /.well-known/assetlinks.json {
    add_header Content-Type application/json;
    add_header Access-Control-Allow-Origin *;
}
```

**Netlify/Vercel**: Funciona automáticamente, solo asegúrate de subir la carpeta `.well-known/`

### Actualizar SHA-256 Fingerprints

Si cambias el certificado de firma de la app:

1. Obtener nuevo fingerprint:
```bash
cd mobile/android
./gradlew signingReport
```

2. Actualizar `web/.well-known/assetlinks.json` con el nuevo SHA-256

3. Re-deployar el sitio web

### Deep Links Soportados

- **Unirse a sala**: `https://trinity-app.es/room/{CODE}`
  - Ejemplo: `https://trinity-app.es/room/ABC123`
  - Abre la app y une automáticamente a la sala

Ver `docs/DEEP_LINKING_GUIDE.md` para más detalles sobre la implementación.
