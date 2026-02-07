# Cognito Auto-Confirm Setup

## 🎯 Descripción

Los usuarios se autoconfirman automáticamente al registrarse en la app, sin necesidad de verificar el email.

## 🔧 Configuración

### Lambda Trigger (Pre Sign-up)

**Ubicación**: `infrastructure/src/handlers/cognito-triggers/pre-signup.ts`

**Función**:
```typescript
export const handler: PreSignUpTriggerHandler = async (event) => {
  // Auto-confirm the user
  event.response.autoConfirmUser = true;

  // Auto-verify the email
  if (event.request.userAttributes.email) {
    event.response.autoVerifyEmail = true;
  }

  return event;
};
```

**Qué hace**:
- `autoConfirmUser = true`: Confirma automáticamente la cuenta del usuario
- `autoVerifyEmail = true`: Marca el email como verificado
- El usuario puede iniciar sesión inmediatamente después del registro

### Cognito User Pool Configuration

**Ubicación**: `infrastructure/lib/trinity-stack.ts`

```typescript
const userPool = new cognito.UserPool(this, 'TrinityUserPool', {
  userPoolName: 'trinity-users',
  selfSignUpEnabled: true,
  signInAliases: {
    email: true,
  },
  autoVerify: {
    email: false, // Disabled - using Lambda trigger
  },
  lambdaTriggers: {
    preSignUp: preSignUpTrigger, // Lambda trigger
  },
});
```

**Configuración clave**:
- `autoVerify.email = false`: Deshabilitado porque usamos Lambda trigger
- `lambdaTriggers.preSignUp`: Lambda que se ejecuta antes del registro

## 🚀 Deployment

### 1. Compilar TypeScript
```bash
cd infrastructure
npm run build
```

### 2. Desplegar Stack
```bash
cdk deploy
```

### 3. Verificar Deployment
```bash
# Ver outputs del stack
aws cloudformation describe-stacks --stack-name TrinityStack --query "Stacks[0].Outputs"
```

## ✅ Verificación

### Probar Auto-confirmación

1. **Registrar nuevo usuario en la app**:
   - Email: test@example.com
   - Password: Test1234

2. **Verificar en Cognito Console**:
   - Usuario debe aparecer con estado "CONFIRMED"
   - Email debe estar verificado

3. **Iniciar sesión inmediatamente**:
   - No se requiere código de verificación
   - Login debe funcionar de inmediato

### Logs de CloudWatch

Ver logs del trigger:
```bash
aws logs tail /aws/lambda/TrinityStack-PreSignUpTrigger --follow
```

Output esperado:
```json
{
  "message": "Pre Sign-up Trigger invoked",
  "userPoolId": "eu-west-1_xxxxx",
  "userName": "user-uuid",
  "email": "test@example.com"
}
{
  "message": "User auto-confirmed",
  "userName": "user-uuid",
  "autoConfirmUser": true,
  "autoVerifyEmail": true
}
```

## 🔐 Seguridad

### Consideraciones

✅ **Ventajas**:
- Mejor UX - sin fricción en el registro
- No se requiere servicio de email
- Usuarios pueden usar la app inmediatamente

⚠️ **Desventajas**:
- No se verifica que el email sea real
- Posible registro con emails falsos

### Recomendaciones

Si necesitas verificar emails en el futuro:

1. **Cambiar configuración**:
```typescript
autoVerify: {
  email: true, // Enable email verification
},
```

2. **Modificar Lambda trigger**:
```typescript
// Remove auto-confirmation
event.response.autoConfirmUser = false;
event.response.autoVerifyEmail = false;
```

3. **Configurar SES** (Simple Email Service):
```typescript
const userPool = new cognito.UserPool(this, 'TrinityUserPool', {
  // ... other config
  emailSettings: {
    from: 'noreply@yourdomain.com',
    replyTo: 'support@yourdomain.com',
  },
});
```

## 🧪 Testing

### Test Manual

```bash
# Registrar usuario
aws cognito-idp sign-up \
  --client-id YOUR_CLIENT_ID \
  --username test@example.com \
  --password Test1234

# Verificar estado (debe ser CONFIRMED)
aws cognito-idp admin-get-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username test@example.com
```

### Test en la App

```typescript
// mobile/src/services/auth.ts
export const signUp = async (email: string, password: string) => {
  try {
    const { isSignUpComplete, userId } = await Auth.signUp({
      username: email,
      password,
      attributes: { email },
    });

    // Con auto-confirm, isSignUpComplete debe ser true
    console.log('Sign up complete:', isSignUpComplete); // true
    console.log('User ID:', userId);

    // Usuario puede hacer login inmediatamente
    return { success: true, userId };
  } catch (error) {
    console.error('Sign up error:', error);
    return { success: false, error };
  }
};
```

## 📊 Monitoreo

### Métricas de CloudWatch

- **Invocations**: Número de registros
- **Errors**: Errores en el trigger
- **Duration**: Tiempo de ejecución

### Alarmas Recomendadas

```typescript
// Opcional: Agregar alarma para errores
const triggerErrorAlarm = new cloudwatch.Alarm(this, 'TriggerErrorAlarm', {
  metric: preSignUpTrigger.metricErrors(),
  threshold: 5,
  evaluationPeriods: 1,
  alarmDescription: 'Pre Sign-up Trigger errors',
});
```

## 🔄 Rollback

Si necesitas revertir a verificación manual:

1. **Actualizar stack**:
```typescript
autoVerify: { email: true },
```

2. **Modificar trigger**:
```typescript
event.response.autoConfirmUser = false;
```

3. **Desplegar**:
```bash
cdk deploy
```

## 📚 Referencias

- [Cognito Lambda Triggers](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools-working-with-aws-lambda-triggers.html)
- [Pre Sign-up Lambda Trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-sign-up.html)
- [AWS Amplify Auth](https://docs.amplify.aws/lib/auth/getting-started/q/platform/js/)

---

**Última actualización**: 2026-02-07  
**Estado**: ✅ Configurado y listo para deployment
