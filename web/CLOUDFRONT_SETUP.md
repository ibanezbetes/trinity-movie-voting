# CloudFront Setup para Deep Linking

Esta guía explica cómo configurar CloudFront para que las URLs `/room/*` funcionen correctamente.

## Opción 1: CloudFront Functions (Recomendado)

CloudFront Functions es la forma más eficiente y económica de manejar rewrites de URL.

### Paso 1: Crear la función

1. Ve a **CloudFront** en AWS Console
2. En el menú lateral, selecciona **Functions**
3. Haz clic en **Create function**
4. Configuración:
   - **Name**: `trinity-url-rewrite`
   - **Description**: `Rewrite /room/* to /room.html for deep linking`
   - **Runtime**: CloudFront Functions

### Paso 2: Agregar el código

Copia el contenido de `cloudfront-function.js` en el editor:

```javascript
function handler(event) {
    var request = event.request;
    var uri = request.uri;
    
    // Si la URI es /room/CODIGO, reescribir a /room.html
    if (uri.match(/^\/room\/[A-Z0-9]{6}$/i)) {
        request.uri = '/room.html';
    }
    // Si la URI no tiene extensión, agregar .html
    else if (!uri.includes('.') && uri !== '/') {
        request.uri = uri + '.html';
    }
    // Si la URI termina en /, agregar index.html
    else if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
    }
    
    return request;
}
```

### Paso 3: Publicar la función

1. Haz clic en **Save changes**
2. Haz clic en **Publish** (pestaña Publish)
3. Confirma la publicación

### Paso 4: Asociar con la distribución

1. Ve a tu distribución de CloudFront
2. Selecciona la pestaña **Behaviors**
3. Edita el behavior por defecto (Default (*))
4. En **Function associations**:
   - **Viewer request**: Selecciona `trinity-url-rewrite`
5. Guarda los cambios

### Paso 5: Esperar propagación

Los cambios tardan 5-10 minutos en propagarse. Puedes verificar el estado en la pestaña **General** de tu distribución.

## Opción 2: Lambda@Edge (Alternativa)

Si necesitas lógica más compleja, puedes usar Lambda@Edge, pero es más costoso.

### Crear función Lambda

```javascript
exports.handler = async (event) => {
    const request = event.Records[0].cf.request;
    const uri = request.uri;
    
    // Rewrite /room/* to /room.html
    if (uri.match(/^\/room\/[A-Z0-9]{6}$/i)) {
        request.uri = '/room.html';
    }
    // Add .html to URIs without extension
    else if (!uri.includes('.') && uri !== '/') {
        request.uri = uri + '.html';
    }
    // Add index.html to directory URIs
    else if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
    }
    
    return request;
};
```

**Nota**: Lambda@Edge debe crearse en **us-east-1** (N. Virginia).

## Opción 3: S3 Website Hosting + Routing Rules

Si usas S3 Website Hosting (no CloudFront), puedes usar routing rules:

```xml
<RoutingRules>
    <RoutingRule>
        <Condition>
            <KeyPrefixEquals>room/</KeyPrefixEquals>
        </Condition>
        <Redirect>
            <ReplaceKeyWith>room.html</ReplaceKeyWith>
        </Redirect>
    </RoutingRule>
</RoutingRules>
```

## Verificar Configuración

### 1. Probar en navegador

```
https://trinity-app.es/room/ABC123
```

Debería mostrar la página `room.html` con el código "ABC123".

### 2. Probar con curl

```bash
curl -I https://trinity-app.es/room/ABC123
```

Debería devolver `200 OK` y el contenido de `room.html`.

### 3. Probar deep link en Android

```bash
adb shell am start -W -a android.intent.action.VIEW \
  -d "https://trinity-app.es/room/ABC123" \
  com.trinityapp.mobile
```

## Troubleshooting

### Error 403 Forbidden

**Causa**: S3 no encuentra el archivo porque CloudFront no está reescribiendo la URL.

**Solución**: Verifica que la CloudFront Function esté asociada correctamente.

### Error 404 Not Found

**Causa**: El archivo `room.html` no existe en S3.

**Solución**: 
```bash
cd web
aws s3 cp room.html s3://trinity-app-web/room.html
```

### Los cambios no se reflejan

**Causa**: Cache de CloudFront.

**Solución**: Invalida el cache:
```bash
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/*"
```

### La función no se ejecuta

**Causa**: La función no está publicada o no está asociada.

**Solución**: 
1. Verifica que la función esté en estado **Published**
2. Verifica que esté asociada en **Behaviors** → **Function associations**
3. Espera 5-10 minutos para propagación

## Comandos Útiles

### Ver distribuciones de CloudFront

```bash
aws cloudfront list-distributions \
  --query 'DistributionList.Items[*].[Id,DomainName,Comment]' \
  --output table
```

### Ver funciones de CloudFront

```bash
aws cloudfront list-functions
```

### Invalidar cache

```bash
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

### Subir archivo específico a S3

```bash
aws s3 cp room.html s3://trinity-app-web/room.html \
  --cache-control "public, max-age=3600"
```

## Costos

- **CloudFront Functions**: $0.10 por millón de invocaciones (muy económico)
- **Lambda@Edge**: $0.60 por millón de invocaciones + $0.00005001 por GB-segundo
- **CloudFront Invalidations**: Primeras 1,000 gratis por mes, luego $0.005 por path

**Recomendación**: Usa CloudFront Functions para este caso de uso.

## Referencias

- [CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-functions.html)
- [Lambda@Edge](https://docs.aws.amazon.com/lambda/latest/dg/lambda-edge.html)
- [S3 Website Hosting](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteHosting.html)
