# Rediseño de Botones Sociales - AuthScreen

## ✅ Cambios Aplicados

### Diseño Anterior
```
┌─────────────────────────────┐
│    Iniciar Sesión           │
└─────────────────────────────┘

┌─────────────────────────────┐
│    Crear Cuenta             │
└─────────────────────────────┘

┌──────────────┬──────────────┐
│   [G logo]   │   [ logo]   │  ← Botones rectangulares
└──────────────┴──────────────┘
```

### Diseño Nuevo
```
┌─────────────────────────────┐
│    Iniciar Sesión           │
└─────────────────────────────┘

┌─────────────────────────────┐
│    Crear Cuenta             │
└─────────────────────────────┘

      Continúa con:             ← Texto (no botón)

    ⭕ Google    ⭕ Apple        ← Botones circulares
```

## 🎨 Especificaciones de Diseño

### Texto "Continúa con:"
```typescript
continueText: {
  marginTop: 8,
  marginBottom: 8,
  opacity: 0.7,
  // Typography variant: 'caption'
  // Alineación: center
}
```

### Botones Circulares
```typescript
socialButtonCircle: {
  width: 56,
  height: 56,
  borderRadius: 28,           // Perfectamente circular
  backgroundColor: '#ffffff',  // Fondo blanco
  borderWidth: 1,
  borderColor: '#e0e0e0',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.25,
  shadowRadius: 4,
  elevation: 5,               // Sombra en Android
}
```

### Logos
```typescript
socialIconLarge: {
  width: 32,
  height: 32,  // Más grandes que antes (24x24)
}
```

**Google Logo**:
- URL: `https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png`
- Colores: Multicolor oficial de Google
- Tamaño: 32x32px

**Apple Logo**:
- URL: `https://cdn-icons-png.flaticon.com/512/731/731985.png`
- Color: Negro (se ve bien sobre fondo blanco)
- Tamaño: 32x32px

### Layout
```typescript
socialButtonsRow: {
  flexDirection: 'row',
  justifyContent: 'center',  // Centrados
  gap: 20,                   // Espacio entre botones
  marginTop: 8,
}
```

## 📐 Medidas

- **Botones principales**: Ancho completo, altura estándar (large)
- **Gap entre botones principales**: 16px
- **Texto "Continúa con:"**: Centrado, margin top/bottom 8px
- **Botones circulares**: 56x56px (diámetro)
- **Gap entre botones circulares**: 20px
- **Logos**: 32x32px
- **Sombra**: Elevación 5 (Android), shadowRadius 4 (iOS)

## 🎯 Resultado Visual

```
┌─────────────────────────────────┐
│                                 │
│   [Carousel de Películas]       │
│                                 │
│         [Logo Trinity]          │
│                                 │
│           Trinity               │
│      Stop Scroll Infinity       │
│   Ponte de acuerdo en un chin   │
│                                 │
│   ┌───────────────────────┐     │
│   │   Iniciar Sesión      │     │
│   └───────────────────────┘     │
│                                 │
│   ┌───────────────────────┐     │
│   │   Crear Cuenta        │     │
│   └───────────────────────┘     │
│                                 │
│       Continúa con:             │
│                                 │
│      ⭕ Google  ⭕ Apple         │
│                                 │
└─────────────────────────────────┘
```

## 🔄 Interacción

### Botones Circulares
- **Hover/Press**: `activeOpacity={0.7}`
- **Acción Google**: `handleGoogleLogin()` → Alert "Próximamente"
- **Acción Apple**: `handleAppleLogin()` → Alert "Próximamente"

### Accesibilidad
- Botones tienen tamaño mínimo de 44x44 (cumple con WCAG)
- Contraste adecuado (logos sobre fondo blanco)
- Sombra ayuda a identificar que son botones

## 📝 Notas Técnicas

- Los botones circulares usan `TouchableOpacity` directamente (no el componente Button)
- El fondo blanco asegura que ambos logos se vean correctamente
- La sombra da profundidad y hace que los botones "floten"
- El gap de 20px entre botones da espacio suficiente para tocar sin errores
- Los logos se cargan desde CDN (requiere internet)

## 🚀 Testing

Para ver los cambios:
```bash
cd mobile
npx expo start
# Presiona R, R para reload
```

Verificar:
- [ ] Texto "Continúa con:" visible y centrado
- [ ] Dos botones circulares blancos con sombra
- [ ] Logo de Google (G multicolor) visible
- [ ] Logo de Apple (manzana negra) visible
- [ ] Botones responden al toque
- [ ] Espaciado correcto entre elementos
