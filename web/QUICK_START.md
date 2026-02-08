# 🚀 Trinity Web - Quick Start

Guía rápida para deployar el sitio web de Trinity.

## ⚡ Deployment Rápido

### Opción 1: Netlify (Más Fácil)

1. Ve a [Netlify](https://app.netlify.com/)
2. Arrastra la carpeta `web/` al dashboard
3. ¡Listo! 🎉

### Opción 2: Script Automático

**Windows**:
```powershell
cd web
.\deploy.ps1
```

**Linux/Mac**:
```bash
cd web
chmod +x deploy.sh
./deploy.sh
```

## 📋 Checklist Pre-Deployment

- [ ] Verificar que las URLs estén correctas en los archivos HTML
- [ ] Actualizar versión en footer si es necesario
- [ ] Verificar que el enlace de Google Play Store funcione
- [ ] **Agregar iconos de ODS en `web/images/`** (ods-3.png, ods-9.png, ods-12.png, ods-13.png)
- [ ] Probar todas las páginas localmente
- [ ] Verificar que los enlaces de navegación funcionen
- [ ] Revisar que los colores sean consistentes con la app
- [ ] Verificar que las imágenes de ODS se vean correctamente

## 🧪 Probar Localmente

### Con Python:
```bash
cd web
python -m http.server 8000
# Abre http://localhost:8000
```

### Con Node.js:
```bash
npm install -g http-server
cd web
http-server
# Abre http://localhost:8080
```

### Con PHP:
```bash
cd web
php -S localhost:8000
# Abre http://localhost:8000
```

## 🔧 Configuración de Dominio

### Netlify
1. Ve a Site settings → Domain management
2. Agrega tu dominio personalizado: `trinity-app.es`
3. Configura DNS según las instrucciones

### Vercel
1. Ve a Settings → Domains
2. Agrega `trinity-app.es`
3. Configura DNS records

### Cloudflare (Recomendado para DNS)
1. Agrega tu dominio a Cloudflare
2. Configura los nameservers
3. Agrega CNAME record apuntando a tu hosting

## 📱 URLs Importantes

Una vez deployado, verifica estas URLs:

- ✅ `https://trinity-app.es/` - Landing page
- ✅ `https://trinity-app.es/privacy` - Política de privacidad
- ✅ `https://trinity-app.es/terms` - Términos de uso
- ✅ `https://trinity-app.es/faqs` - FAQs
- ✅ `https://trinity-app.es/404` - Página de error

## 🔍 SEO Post-Deployment

1. **Google Search Console**:
   - Agrega tu sitio
   - Envía el sitemap: `https://trinity-app.es/sitemap.xml`
   - Verifica la propiedad del dominio

2. **Google Analytics** (Opcional):
   - Crea una propiedad
   - Agrega el código de tracking a los HTML

3. **Open Graph** (Opcional):
   - Agrega meta tags para redes sociales
   - Prueba con [Facebook Debugger](https://developers.facebook.com/tools/debug/)

## 🐛 Troubleshooting

### Las imágenes no cargan
- Verifica las rutas en los HTML
- Si deployaste solo `web/`, ejecuta `copy-assets.ps1`

### URLs sin .html no funcionan
- Verifica que `.htaccess` esté presente (Apache)
- Verifica `netlify.toml` o `vercel.json` según tu hosting

### Estilos no se aplican
- Verifica que `styles.css` esté en la misma carpeta
- Limpia caché del navegador (Ctrl+Shift+R)

### 404 personalizado no funciona
- Verifica configuración del hosting
- En Netlify/Vercel se configura automáticamente

## 📞 Soporte

¿Problemas? Contacta:
- **Email**: trinity.app.spain@gmail.com
- **Instagram**: [@trinity.app](https://www.instagram.com/trinity.app/)

---

**¡Listo para deployar!** 🚀
