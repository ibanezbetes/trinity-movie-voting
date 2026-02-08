# Trinity Web - Imágenes

Esta carpeta contiene las imágenes utilizadas en el sitio web de Trinity.

## 📋 Imágenes Requeridas

### Iconos de ODS (Objetivos de Desarrollo Sostenible)

Coloca aquí los iconos de los 4 ODS con los que Trinity está comprometida:

- **ods-3.png** - ODS 3: Salud y Bienestar
- **ods-9.png** - ODS 9: Industria, Innovación e Infraestructura
- **ods-12.png** - ODS 12: Producción y Consumo Responsables
- **ods-13.png** - ODS 13: Acción por el Clima

### Especificaciones de las Imágenes

- **Formato**: PNG con transparencia
- **Tamaño recomendado**: 200x200px o 300x300px
- **Peso**: < 50KB por imagen
- **Estilo**: Iconos oficiales de ODS de la ONU

### Dónde Obtener los Iconos

Los iconos oficiales de ODS se pueden descargar de:
- [ONU - Recursos de ODS](https://www.un.org/sustainabledevelopment/es/news/communications-material/)
- [SDG Resources](https://www.globalgoals.org/resources)

### Uso en el Sitio

Los iconos se utilizan en:
- **index.html**: Sección "Compromiso con los ODS"
- Tamaño de visualización: 60px x 60px (desktop), 80px x 80px (mobile)

## 🎨 Optimización

Para optimizar las imágenes antes de subirlas:

**Con TinyPNG** (Online):
```
https://tinypng.com/
```

**Con ImageMagick** (CLI):
```bash
convert ods-3.png -resize 300x300 -quality 85 ods-3-optimized.png
```

**Con Node.js** (sharp):
```bash
npm install -g sharp-cli
sharp -i ods-3.png -o ods-3-optimized.png resize 300 300
```

## 📝 Checklist

Antes de deployar, verifica que:
- [ ] Las 4 imágenes de ODS están presentes
- [ ] Los nombres de archivo son correctos (ods-3.png, ods-9.png, ods-12.png, ods-13.png)
- [ ] Las imágenes están optimizadas (< 50KB cada una)
- [ ] Las imágenes tienen transparencia
- [ ] Las imágenes se ven bien en el sitio (probar localmente)

## 🔗 Referencias

- [Objetivos de Desarrollo Sostenible - ONU](https://www.un.org/sustainabledevelopment/es/)
- [Global Goals](https://www.globalgoals.org/)
- [SDG Tracker](https://sdg-tracker.org/)
