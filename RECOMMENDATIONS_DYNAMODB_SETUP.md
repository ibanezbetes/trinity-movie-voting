# Recomendaciones con DynamoDB - Guía Completa

## 📋 Resumen

Hemos migrado las recomendaciones de datos estáticos a DynamoDB para:
1. **Mantener los títulos originales** que te gustaban (Wonder, Karate Kid, Cyberbully, etc.)
2. **Usar URLs alternativas** para las carátulas (OMDb/IMDb) cuando TMDB falle
3. **Facilitar la actualización** de películas sin redeployar la app

## 🏗️ Cambios Realizados

### 1. Infraestructura (AWS CDK)

#### Nueva Tabla DynamoDB
```typescript
Table: trinity-recommendations
- Partition Key: categoryId (String)
- Sort Key: movieId (Number)
- Billing: PAY_PER_REQUEST
- Removal Policy: RETAIN (mantiene datos al eliminar stack)
```

#### Nuevo Lambda Handler
```
infrastructure/src/handlers/recommendations/
├── index.ts          # Handler principal
└── package.json      # Dependencias
```

#### GraphQL Schema Actualizado
```graphql
type RecommendationCategory {
  categoryId: String!
  title: String!
  description: String!
  movies: [RecommendationMovie!]!
}

type RecommendationMovie {
  movieId: Int!
  title: String!
  posterPath: String!
  alternativePosterUrl: String  # ← URL alternativa para carátulas
  year: String!
  description: String!
  trailerKey: String
}

# Nuevas Queries
getRecommendations: [RecommendationCategory!]!
getRecommendationsByCategory(categoryId: String!): RecommendationCategory
```

### 2. Datos de Recomendaciones

#### 7 Categorías con 4 Películas Cada Una (28 Total)

1. **Contra el Acoso Escolar** (anti-bullying)
   - Wonder (2017)
   - Karate Kid (1984)
   - Cyberbully (2011)
   - Chicas Pesadas (2004)

2. **Conciencia Medioambiental** (environmental-awareness)
   - WALL-E (2008)
   - Una Verdad Incómoda (2006)
   - El Lórax (2012)
   - FernGully (1992)

3. **Salud Mental** (mental-health)
   - Intensamente (2015)
   - Una Mente Brillante (2001)
   - El Indomable Will Hunting (1997)
   - Las Ventajas de Ser Invisible (2012)

4. **Diversidad e Inclusión** (diversity-inclusion)
   - Coco (2017)
   - Pantera Negra (2018)
   - Moana (2016)
   - Historias Cruzadas (2011)

5. **Justicia Social** (social-justice)
   - Selma (2014)
   - Figuras Ocultas (2016)
   - Matar a un Ruiseñor (1962)
   - El Odio que Das (2018)

6. **Educación y Empoderamiento** (education-empowerment)
   - La Sociedad de los Poetas Muertos (1989)
   - Escritores de la Libertad (2007)
   - En Busca de la Felicidad (2006)
   - Matilda (1996)

7. **Apoyo Comunitario** (community-support)
   - Qué Bello es Vivir (1946)
   - Cadena de Favores (2000)
   - Un Sueño Posible (2009)
   - Duelo de Titanes (2000)

### 3. URLs Alternativas para Carátulas

Cada película tiene dos URLs:
- **posterPath**: URL de TMDB (primaria)
- **alternativePosterUrl**: URL de OMDb/IMDb (fallback)

Ejemplo:
```json
{
  "title": "Wonder",
  "posterPath": "/ouYgAatYH7ynpAZER7A7PoKBCiw.jpg",
  "alternativePosterUrl": "https://m.media-amazon.com/images/M/MV5BYmRmOTZjNzMtMjc0Yi00NTg2LWI5ZTctMjk0ZjI5YWQwYzY5XkEyXkFqcGc@._V1_SX300.jpg"
}
```

## 🚀 Pasos de Deployment

### Paso 1: Compilar TypeScript

```bash
cd infrastructure
npm run build
```

### Paso 2: Deploy del Stack

```bash
cdk deploy
```

Esto creará:
- ✅ Tabla `trinity-recommendations`
- ✅ Lambda `RecommendationsHandler`
- ✅ Resolvers GraphQL

### Paso 3: Poblar la Tabla

```bash
node infrastructure/scripts/populate-recommendations.js
```

Esto insertará las 28 películas en DynamoDB.

**Output esperado**:
```
🚀 Starting to populate recommendations table...

📁 Processing category: Contra el Acoso Escolar
  ✅ Inserted: Wonder (2017)
  ✅ Inserted: Karate Kid (1984)
  ...

📊 Summary:
  Total inserted: 28
  Total errors: 0
  Categories: 7

✅ Done!
```

### Paso 4: Verificar en AWS Console

1. Ir a DynamoDB → Tables → `trinity-recommendations`
2. Ver items (deberías ver 28 items)
3. Verificar que cada item tiene:
   - categoryId
   - movieId
   - title
   - posterPath
   - alternativePosterUrl (opcional)

## 📱 Actualizar la App Móvil

### Paso 1: Crear GraphQL Queries

Crear `mobile/src/services/recommendations.ts`:

```typescript
import { generateClient } from 'aws-amplify/api';

const client = generateClient();

const GET_RECOMMENDATIONS = `
  query GetRecommendations {
    getRecommendations {
      categoryId
      title
      description
      movies {
        movieId
        title
        posterPath
        alternativePosterUrl
        year
        description
        trailerKey
      }
    }
  }
`;

export async function getRecommendations() {
  try {
    const result = await client.graphql({
      query: GET_RECOMMENDATIONS,
    });
    return result.data.getRecommendations;
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    return [];
  }
}
```

### Paso 2: Actualizar RecommendationsScreen

```typescript
// En RecommendationsScreen.tsx
import { getRecommendations } from '../services/recommendations';

export default function RecommendationsScreen() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecommendations();
  }, []);

  const loadRecommendations = async () => {
    setLoading(true);
    const data = await getRecommendations();
    setCategories(data);
    setLoading(false);
  };

  // Usar alternativePosterUrl como fallback
  const getPosterUrl = (movie) => {
    const tmdbUrl = `https://image.tmdb.org/t/p/w500${movie.posterPath}`;
    return {
      uri: tmdbUrl,
      fallback: movie.alternativePosterUrl,
    };
  };

  // En el Image component:
  <Image 
    source={{ uri: getPosterUrl(item).uri }}
    onError={() => {
      // Intentar con URL alternativa
      if (item.alternativePosterUrl) {
        setImageSource(item.alternativePosterUrl);
      }
    }}
  />
}
```

## 🔧 Mantenimiento

### Agregar Nueva Película

```javascript
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'eu-west-1' });
const docClient = DynamoDBDocumentClient.from(client);

await docClient.send(
  new PutCommand({
    TableName: 'trinity-recommendations',
    Item: {
      categoryId: 'anti-bullying',
      movieId: 1005,
      categoryTitle: 'Contra el Acoso Escolar',
      categoryDescription: 'Películas que abordan el bullying...',
      title: 'Nueva Película',
      posterPath: '/path.jpg',
      alternativePosterUrl: 'https://...',
      year: '2024',
      description: 'Descripción...',
      trailerKey: 'youtube_key',
    },
  })
);
```

### Actualizar Película Existente

```javascript
await docClient.send(
  new PutCommand({
    TableName: 'trinity-recommendations',
    Item: {
      // Mismo categoryId y movieId para actualizar
      categoryId: 'anti-bullying',
      movieId: 1001,
      // Nuevos datos
      alternativePosterUrl: 'https://nueva-url.com/poster.jpg',
      // ... resto de campos
    },
  })
);
```

### Eliminar Película

```javascript
const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');

await docClient.send(
  new DeleteCommand({
    TableName: 'trinity-recommendations',
    Key: {
      categoryId: 'anti-bullying',
      movieId: 1001,
    },
  })
);
```

## 🎯 Ventajas de Esta Solución

1. ✅ **Títulos Originales**: Mantenemos Wonder, Karate Kid, etc.
2. ✅ **URLs Alternativas**: Fallback automático si TMDB falla
3. ✅ **Fácil Actualización**: Cambiar películas sin redeployar app
4. ✅ **Escalable**: Agregar más categorías/películas fácilmente
5. ✅ **Sin Costo**: DynamoDB PAY_PER_REQUEST es gratis para bajo volumen
6. ✅ **Persistente**: Datos se mantienen al eliminar el stack

## 🐛 Troubleshooting

### Problema: Tabla no se crea
```bash
# Verificar que el stack se deployó correctamente
aws dynamodb describe-table --table-name trinity-recommendations --region eu-west-1
```

### Problema: Script de población falla
```bash
# Verificar credenciales AWS
aws sts get-caller-identity

# Verificar región
echo $AWS_REGION
```

### Problema: GraphQL no retorna datos
```bash
# Verificar que hay datos en la tabla
aws dynamodb scan --table-name trinity-recommendations --region eu-west-1 --max-items 5
```

### Problema: Carátulas no cargan
- Verificar que `alternativePosterUrl` está en los datos
- Implementar lógica de fallback en la app
- Usar `onError` handler en Image component

## 📊 Costos Estimados

- **DynamoDB**: ~$0.00 (28 items, pocas lecturas)
- **Lambda**: ~$0.00 (pocas invocaciones)
- **Total**: Prácticamente gratis 💰

## ✅ Checklist de Implementación

- [ ] Compilar TypeScript (`npm run build`)
- [ ] Deploy CDK (`cdk deploy`)
- [ ] Poblar tabla (`node populate-recommendations.js`)
- [ ] Verificar datos en AWS Console
- [ ] Crear servicio de recommendations en mobile
- [ ] Actualizar RecommendationsScreen
- [ ] Implementar fallback de imágenes
- [ ] Probar en la app
- [ ] Verificar scroll horizontal funciona
- [ ] Verificar todas las carátulas cargan

---

**Estado**: Listo para implementar ✅
**Próximo Paso**: Deploy del stack CDK
