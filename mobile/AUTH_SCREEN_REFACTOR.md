# AuthScreen Refactorización - Pantalla de Bienvenida

## ✅ Cambios Implementados

### 1. Carousel de Películas Populares
- **Componente**: `MovieCarousel` creado en `/mobile/src/components/MovieCarousel.tsx`
- **Funcionalidad**: 
  - Auto-scroll cada 3 segundos
  - Muestra carátulas de películas populares de fondo
  - Opacidad reducida (0.3) para no interferir con el contenido
  - Overlay oscuro (rgba(0, 0, 0, 0.7)) para mejorar legibilidad

### 2. Películas Mockeadas
```typescript
const POPULAR_MOVIES = [
  { id: 1, title: 'Avatar', poster: 'https://image.tmdb.org/t/p/w500/...' },
  { id: 2, title: 'Joker', poster: 'https://image.tmdb.org/t/p/w500/...' },
  { id: 3, title: 'Dune', poster: 'https://image.tmdb.org/t/p/w500/...' },
  { id: 4, title: 'Oppenheimer', poster: 'https://image.tmdb.org/t/p/w500/...' },
  { id: 5, title: 'Barbie', poster: 'https://image.tmdb.org/t/p/w500/...' },
  { id: 6, title: 'Spider-Man', poster: 'https://image.tmdb.org/t/p/w500/...' },
];
```

### 3. Logo Trinity
- **Ubicación**: `elements/visuals/logoTrinity.png`
- **Tamaño**: 180x180px
- **Sombra**: 
  - shadowColor: '#000'
  - shadowOffset: { width: 0, height: 6 }
  - shadowOpacity: 0.9
  - shadowRadius: 12
  - elevation: 15 (Android)

### 4. Textos en Español
- ✅ "Welcome to Trinity" (mantiene inglés como en la imagen)
- ✅ "Collaborative Movie & Series Discovery" (mantiene inglés como en la imagen)
- ✅ "Iniciar Sesión" (español)
- ✅ "Crear Cuenta" (español)
- ✅ "Google" (nombre propio)
- ✅ "Apple" (nombre propio)

### 5. Layout de Botones
```
┌─────────────────────────────┐
│    Iniciar Sesión           │  ← Botón principal (primary)
└─────────────────────────────┘

┌─────────────────────────────┐
│    Crear Cuenta             │  ← Botón outline
└─────────────────────────────┘

┌──────────────┬──────────────┐
│   Google     │    Apple     │  ← Botones secundarios (mismo ancho)
└──────────────┴──────────────┘
```

### 6. Estructura Visual

```
┌─────────────────────────────────┐
│                                 │
│   [Carousel de Películas]       │  ← Fondo animado
│                                 │
│         [Logo Trinity]          │  ← Con sombra negra
│                                 │
│     Welcome to Trinity          │  ← Texto con sombra
│  Collaborative Movie & Series   │
│         Discovery               │
│                                 │
│                                 │
│   [Iniciar Sesión]              │
│   [Crear Cuenta]                │
│   [Google] [Apple]              │
│                                 │
└─────────────────────────────────┘
```

## 🎨 Estilos Aplicados

### Logo
- Tamaño: 180x180px
- Sombra negra pronunciada para destacar del fondo
- Centrado horizontalmente
- Margin top: 80px

### Textos
- Título: H1 (32px, bold, letter-spacing: 2)
- Subtítulo: Body (16px, regular)
- Ambos con text-shadow para legibilidad sobre el carousel

### Botones
- **Principales**: 
  - Ancho completo
  - Gap de 16px entre ellos
  - Primary: fondo #7c3aed
  - Outline: borde #7c3aed, fondo transparente

- **Secundarios (Google/Apple)**:
  - Flex: 1 (mismo ancho)
  - Gap de 12px entre ellos
  - Variant: secondary (fondo #2a2a2a)

## 📱 Componentes Creados

### MovieCarousel.tsx
```typescript
interface MovieCarouselProps {
  movies: Movie[];
  autoScroll?: boolean;
  scrollInterval?: number;
}
```

**Features**:
- Auto-scroll configurable
- Animación suave entre slides
- Overlay oscuro integrado
- Responsive (usa Dimensions)

## 🔄 Funcionalidad

### Auto-scroll
- Intervalo: 3000ms (3 segundos)
- Loop infinito
- Solo activo en modo 'welcome'
- Se detiene al cambiar a login/register

### Navegación
- "Iniciar Sesión" → setAuthMode('login')
- "Crear Cuenta" → setAuthMode('register')
- "Google" → Alert (próximamente)
- "Apple" → Alert (próximamente)

## 🚀 Próximos Pasos

1. **Integrar películas reales**: Reemplazar mock con llamada a TMDB API
2. **Implementar OAuth**: Google y Apple Sign-In
3. **Animaciones**: Transiciones suaves entre pantallas
4. **Testing**: Verificar en dispositivos físicos
5. **Optimización**: Lazy loading de imágenes del carousel

## 📝 Notas Técnicas

- El carousel usa `Animated.Value` para tracking del scroll
- Las imágenes se cargan desde TMDB CDN (w500)
- El logo se importa localmente desde `elements/visuals/`
- La ruta del logo es relativa: `../../../../elements/visuals/logoTrinity.png`
- El componente es reutilizable para otras pantallas si es necesario

## ⚠️ Consideraciones

- **Performance**: El carousel puede consumir memoria con muchas imágenes
- **Red**: Las imágenes requieren conexión a internet
- **Fallback**: Considerar placeholder si las imágenes no cargan
- **Accesibilidad**: Agregar labels para screen readers
