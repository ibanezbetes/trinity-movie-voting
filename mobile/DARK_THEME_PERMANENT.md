# Tema Oscuro Permanente - Cambios Aplicados

## ✅ Cambios Realizados

### 1. ThemeContext - Siempre Oscuro
**Archivo**: `mobile/src/context/ThemeContext.tsx`

**Antes**:
- Usuario podía cambiar entre tema claro y oscuro
- Se guardaba preferencia en AsyncStorage
- `isDarkMode` era un estado mutable

**Después**:
```typescript
const [isDarkMode] = useState(true); // Siempre true

const toggleTheme = () => {
  // Función deshabilitada - siempre tema oscuro
  logger.info('THEME', 'Theme toggle disabled - always dark mode');
};

const colors = darkTheme; // Siempre darkTheme
```

### 2. ProfileScreen - Opción Eliminada
**Archivo**: `mobile/src/screens/ProfileScreen.tsx`

**Eliminado**:
- Switch de "Tema Oscuro" en sección de Preferencias
- Importación de `isDarkMode` y `toggleTheme`
- Solo mantiene `colors` del ThemeContext

**Antes**:
```typescript
const { isDarkMode, toggleTheme, colors } = useTheme();

// Switch de Tema Oscuro
<Switch
  value={isDarkMode}
  onValueChange={toggleTheme}
  ...
/>
```

**Después**:
```typescript
const { colors } = useTheme();

// Switch eliminado - solo queda "Silenciar Sonidos"
```

### 3. Botones Sociales - Tema Oscuro
**Archivo**: `mobile/src/screens/AuthScreen.tsx`

**Antes**:
```typescript
socialButton: {
  backgroundColor: '#ffffff',  // Fondo blanco
  borderColor: '#e0e0e0',
}
appleIcon: {
  color: '#000000',  // Negro
}
```

**Después**:
```typescript
socialButton: {
  backgroundColor: '#1a1a1a',  // Fondo oscuro
  borderColor: '#2a2a2a',      // Borde oscuro
}
appleIcon: {
  color: '#ffffff',  // Blanco
}
```

## 🎨 Colores del Tema Oscuro (Permanente)

```typescript
const darkTheme = {
  background: '#0a0a0a',      // Negro profundo
  surface: '#1a1a1a',         // Gris muy oscuro
  text: '#ffffff',            // Blanco
  textSecondary: '#cccccc',   // Gris claro
  primary: '#7c3aed',         // Púrpura
  border: '#2a2a2a',          // Gris oscuro
  card: '#1a1a1a',            // Gris muy oscuro
  error: '#ef4444',           // Rojo
};
```

## 📱 Pantallas Afectadas

### AuthScreen
- ✅ Botones sociales con fondo oscuro
- ✅ Logo de Apple en blanco
- ✅ Logo de Google (multicolor) visible sobre fondo oscuro

### ProfileScreen
- ✅ Opción de "Tema Oscuro" eliminada
- ✅ Solo queda "Silenciar Sonidos" en Preferencias
- ✅ Siempre usa colores del tema oscuro

### Todas las demás pantallas
- ✅ Automáticamente usan tema oscuro
- ✅ No hay forma de cambiar a tema claro

## 🚀 Beneficios

1. **Consistencia**: Todos los usuarios ven la misma interfaz
2. **Simplicidad**: No hay que mantener dos temas
3. **Mejor UX**: Tema oscuro es mejor para apps de entretenimiento
4. **Menos código**: Eliminado código de toggle y persistencia

## 📝 Notas

- El `lightTheme` sigue definido en ThemeContext pero nunca se usa
- Se puede eliminar completamente si se desea limpiar más código
- La función `toggleTheme` existe pero no hace nada (para mantener compatibilidad)
- AsyncStorage ya no se usa para guardar preferencia de tema

## 🧪 Testing

Para verificar los cambios:
```bash
cd mobile
npx expo start
# Presiona R, R para reload
```

Verificar:
- [ ] Botones de Google y Apple se ven bien en tema oscuro
- [ ] No hay opción de "Tema Oscuro" en ProfileScreen
- [ ] Todas las pantallas usan tema oscuro
- [ ] Logo de Apple es blanco (visible)
- [ ] Logo de Google es multicolor (visible)
