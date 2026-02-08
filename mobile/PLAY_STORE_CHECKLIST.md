# ✅ Google Play Store - Checklist de Publicación

**App**: Trinity  
**Versión**: 1.0.0  
**Fecha**: 2026-02-08

---

## 🔐 Paso 1: Keystore de Producción

- [ ] Ejecutar `./create-keystore.ps1`
- [ ] Guardar `trinity-keystore-credentials.txt` en:
  - [ ] Google Drive / Dropbox / OneDrive
  - [ ] USB externo
  - [ ] Email a ti mismo
  - [ ] Gestor de contraseñas
- [ ] Verificar que `android/keystore.properties` existe
- [ ] Verificar que `android/app/trinity-release.keystore` existe

**⚠️ CRÍTICO**: Si pierdes el keystore, nunca podrás actualizar tu app.

---

## 📦 Paso 2: Generar AAB

- [ ] Ejecutar `./generate-aab.ps1`
- [ ] Verificar que se generó: `android/app/build/outputs/bundle/release/app-release.aab`
- [ ] Verificar tamaño del archivo (~30-50 MB)

---

## 💳 Paso 3: Cuenta de Desarrollador

- [ ] Crear cuenta en [Google Play Console](https://play.google.com/console)
- [ ] Pagar 25 USD (pago único)
- [ ] Completar verificación de identidad
- [ ] Esperar aprobación (1-3 días)

---

## 🎨 Paso 4: Assets de la Tienda

### Icono (512x512)
- [ ] Preparar icono PNG 512x512
- [ ] Sin transparencia
- [ ] Sin bordes redondeados

### Gráfico de Funciones (1024x500)
- [ ] Crear banner 1024x500
- [ ] Incluir logo y slogan
- [ ] Colores de marca

### Capturas de Pantalla (mínimo 2)
- [ ] Pantalla de login
- [ ] Dashboard
- [ ] Crear sala
- [ ] Votación
- [ ] Match celebration
- [ ] Mis matches
- [ ] Perfil
- [ ] Mis salas

**Formato**: PNG o JPEG, 1080x1920 o similar

---

## 📝 Paso 5: Textos de la Tienda

### Nombre de la App
- [ ] Trinity

### Descripción Corta (80 caracteres)
- [ ] "Encuentra películas con amigos. Vota, haz match y disfruta juntos."

### Descripción Completa
- [ ] Copiar de `docs/GOOGLE_PLAY_STORE_GUIDE.md`
- [ ] Revisar y personalizar si es necesario

### Categoría
- [ ] Entretenimiento

### Etiquetas
- [ ] películas, series, amigos, votación, match

---

## 🔒 Paso 6: Política de Privacidad

- [ ] Crear página web con política de privacidad
- [ ] Publicar en: `https://trinity-app.es/privacy-policy`
- [ ] O usar generador: [Privacy Policy Generator](https://www.privacypolicygenerator.info/)

**Contenido mínimo**:
- Qué datos recopilas
- Cómo usas los datos
- Con quién compartes datos
- Cómo proteges los datos
- Derechos del usuario
- Contacto

---

## 📋 Paso 7: Formularios de Play Console

### Clasificación de Contenido
- [ ] Completar cuestionario
- [ ] Confirmar: No violencia, no contenido sexual, no lenguaje ofensivo
- [ ] Marcar: Interacción entre usuarios (salas privadas)
- [ ] Resultado esperado: PEGI 3 / Everyone

### Público Objetivo
- [ ] Edad objetivo: 13+
- [ ] No dirigida a niños

### Seguridad de Datos
- [ ] Marcar: Recopilas datos (email, nombre, votos)
- [ ] Marcar: No compartes datos
- [ ] Marcar: Datos encriptados en tránsito (HTTPS)
- [ ] Marcar: Datos encriptados en reposo (AWS)
- [ ] Marcar: Usuarios pueden solicitar eliminación

---

## 🧪 Paso 8: Pruebas Internas (Recomendado)

- [ ] Ir a: Pruebas > Pruebas internas
- [ ] Crear nueva versión
- [ ] Subir AAB
- [ ] Añadir notas de la versión
- [ ] Crear lista de testers
- [ ] Añadir emails de testers
- [ ] Compartir link de prueba
- [ ] Probar durante 1-2 semanas
- [ ] Corregir bugs encontrados

---

## 🚀 Paso 9: Publicación en Producción

### Subir AAB
- [ ] Ir a: Producción > Crear nueva versión
- [ ] Subir `app-release.aab`
- [ ] Añadir notas de la versión:

```
Versión 1.0.0 - Lanzamiento Inicial

✨ Funcionalidades:
- Crear salas de votación
- Unirse con código de 6 caracteres
- Votar películas y series
- Detección automática de matches
- Notificaciones en tiempo real
- Autenticación con Google
- Historial de matches
- Perfil de usuario

🎬 Stop Scroll Infinity - Ponte de acuerdo en un chin
```

### Revisar Todo
- [ ] Ficha de la tienda completa
- [ ] Clasificación de contenido completa
- [ ] Público objetivo definido
- [ ] Política de privacidad añadida
- [ ] Seguridad de datos completa
- [ ] AAB subido

### Enviar a Revisión
- [ ] Clic en "Revisar versión"
- [ ] Verificar que todo esté verde
- [ ] Clic en "Iniciar implementación en producción"

---

## ⏳ Paso 10: Esperar Revisión

- [ ] Tiempo estimado: 1-7 días (usualmente 1-2 días)
- [ ] Revisar email para notificaciones
- [ ] Revisar Play Console regularmente

**Estados posibles**:
- 🟡 En revisión
- 🟢 Aprobada → ¡App publicada!
- 🔴 Rechazada → Revisar motivos y corregir

---

## 🎉 Paso 11: Post-Publicación

### Verificar Publicación
- [ ] Buscar "Trinity" en Google Play Store
- [ ] Verificar que aparece correctamente
- [ ] Probar instalación desde la tienda
- [ ] Verificar URL: `https://play.google.com/store/apps/details?id=com.trinityapp.mobile`

### Compartir
- [ ] Compartir en Instagram: [@trinity.app](https://www.instagram.com/trinity.app/)
- [ ] Compartir en redes sociales
- [ ] Enviar a amigos y familia
- [ ] Pedir reseñas

### Monitoreo
- [ ] Configurar alertas de crashes
- [ ] Revisar reseñas diariamente
- [ ] Responder a comentarios
- [ ] Monitorear métricas:
  - Instalaciones
  - Usuarios activos
  - Calificación
  - Crashes

---

## 🔄 Actualizaciones Futuras

### Antes de Cada Actualización

1. **Incrementar versión**:
   - [ ] `mobile/app.json`: `"version": "1.0.1"`
   - [ ] `mobile/android/app/build.gradle`: `versionCode 2`, `versionName "1.0.1"`

2. **Generar nuevo AAB**:
   ```bash
   cd mobile
   ./generate-aab.ps1
   ```

3. **Subir a Play Console**:
   - [ ] Producción > Crear nueva versión
   - [ ] Subir nuevo AAB
   - [ ] Añadir notas de la versión
   - [ ] Implementar

---

## 📞 Soporte

### Recursos
- 📖 [Guía Completa](../docs/GOOGLE_PLAY_STORE_GUIDE.md)
- 🌐 [Google Play Console Help](https://support.google.com/googleplay/android-developer)
- 📱 [Android Developer Docs](https://developer.android.com/studio/publish)

### Contacto Trinity
- **Email**: trinity.app.spain@gmail.com
- **Instagram**: [@trinity.app](https://www.instagram.com/trinity.app/)
- **Website**: [trinity-app.es](https://trinity-app.es)

---

## ✅ Estado Actual

**Fecha**: ___________

- [ ] Keystore creado y guardado
- [ ] AAB generado
- [ ] Cuenta de desarrollador creada
- [ ] Assets preparados
- [ ] Textos escritos
- [ ] Política de privacidad publicada
- [ ] Formularios completados
- [ ] Pruebas internas realizadas
- [ ] AAB subido a producción
- [ ] Enviado a revisión
- [ ] Aprobado por Google
- [ ] ¡App publicada! 🎉

---

**¡Buena suerte con tu publicación!** 🚀

*Stop Scroll Infinity - Ponte de acuerdo en un chin* 🎬✨
