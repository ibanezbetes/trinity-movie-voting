# Test Plan: Room-Based Match Notifications

## ✅ Cambios Completados

### 1. Cliente Móvil (VotingRoomScreen.tsx)
- ✅ **Timing Fix**: Suscripciones se configuran ANTES de cargar datos de la sala
- ✅ **Simplificación**: Removida suscripción dual conflictiva, solo usa room-based
- ✅ **Logging mejorado**: Más logs para debugging

### 2. Servicio de Suscripciones (subscriptions.ts)
- ✅ **Filtrado Fix**: Removido filtro `matchedUsers.includes(userId)` que bloqueaba notificaciones
- ✅ **Procesamiento**: Ahora procesa TODAS las notificaciones de sala para todos los usuarios

### 3. Backend Infrastructure
- ✅ **CDK Stack**: Creado y desplegado correctamente
- ✅ **Lambda Functions**: Vote, Room, Match, TMDB handlers desplegados
- ✅ **DynamoDB Tables**: Rooms, Votes, Matches con GSI para user matches
- ✅ **AppSync API**: GraphQL API con suscripciones configuradas
- ✅ **Cognito**: User Pool y Client configurados

### 4. Configuración
- ✅ **AWS Config**: Generada automáticamente desde stack outputs
- ✅ **GraphQL Endpoint**: https://ctpyevpldfe53jtmmabeld4hhm.appsync-api.eu-west-1.amazonaws.com/graphql
- ✅ **User Pool**: eu-west-1_RPkdnO7Ju
- ✅ **Client ID**: 61nf41i2bff1c4oc4qo9g36m1k

## 🧪 Escenario de Prueba

### Setup:
1. **Usuario A** crea una sala con código `ABC123`
2. **Usuario B** se une a la sala `ABC123`
3. Ambos usuarios ven las mismas películas candidatas

### Flujo de Votación:
1. **Usuario A** vota "👍" en "Movie X"
2. **Usuario B** vota "👍" en "Movie X"
3. **RESULTADO ESPERADO**: Ambos usuarios reciben notificación inmediata

### Verificación:
- [ ] Usuario A recibe notificación de match
- [ ] Usuario B recibe notificación de match
- [ ] Ambos pueden navegar a "My Matches"
- [ ] El match aparece en la lista de matches de ambos usuarios

## 🔍 Debugging

### Logs a Revisar:
```
🔔 Setting up CRITICAL room subscription system
📡 Room match notification received from AppSync
✅ Room match notification received - processing for all users in room
🎉 ROOM MATCH NOTIFICATION RECEIVED in VotingRoom
```

### Backend Logs:
```bash
# Vote Handler
aws logs tail /aws/lambda/TrinityStack-VoteHandler897F0396-* --follow

# Match Handler  
aws logs tail /aws/lambda/TrinityStack-MatchHandler04464E10-* --follow

# Room Handler
aws logs tail /aws/lambda/TrinityStack-RoomHandlerCF7B6EB0-* --follow
```

### Posibles Problemas:
1. **WebSocket Connection**: Verificar que `realtimeClient` se conecte correctamente
2. **Auth Tokens**: Verificar que los tokens de Cognito sean válidos
3. **AppSync Endpoint**: Verificar que el endpoint GraphQL sea correcto
4. **Schema Sync**: Verificar que el schema esté desplegado correctamente

## 🚀 Estado Actual

### ✅ Completado:
- [x] Backend desplegado correctamente
- [x] Configuración móvil actualizada
- [x] Suscripciones arregladas en el cliente
- [x] Vote handler con notificaciones duales
- [x] Schema GraphQL con suscripciones

### 🔄 Próximos Pasos:
1. **Test con 2 usuarios**: Probar el flujo completo
2. **Verificar logs**: Revisar CloudWatch logs durante las pruebas
3. **Debug WebSocket**: Si las suscripciones fallan, verificar conexión
4. **Fallback**: Implementar polling como backup si es necesario

## 📱 Comandos de Test

```bash
# Rebuild mobile app (si es necesario)
cd mobile && npm run android

# Check backend logs
aws logs tail /aws/lambda/TrinityStack-VoteHandler897F0396-* --follow

# Test GraphQL mutations manually
# (Use AWS AppSync console)
```

## ✅ Criterios de Éxito

- [x] Código compila sin errores
- [x] Backend desplegado correctamente
- [x] Configuración móvil actualizada
- [ ] Usuario A recibe notificación cuando Usuario B vota
- [ ] Usuario B recibe notificación cuando Usuario A vota
- [ ] Ambos usuarios pueden ver el match en "My Matches"
- [ ] No hay errores "Room not found"
- [ ] Las suscripciones se mantienen activas durante toda la sesión de votación

---

**Status**: ✅ Backend desplegado, configuración actualizada, listo para testing
**Next**: Probar con 2 usuarios reales en dispositivos/emuladores separados

## 🎯 Cambios Clave Implementados

1. **Suscripciones Simplificadas**: Solo room-based, sin filtrado por usuario
2. **Notificaciones Duales**: Backend envía tanto `publishUserMatch` como `publishRoomMatch`
3. **Timing Correcto**: Suscripciones se establecen antes de cargar datos
4. **Room Persistence**: Las salas no se eliminan después del match
5. **Logging Mejorado**: Más información para debugging