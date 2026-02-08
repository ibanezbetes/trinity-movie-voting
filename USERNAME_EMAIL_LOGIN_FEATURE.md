# Username & Email Login Feature - Final Implementation

**Date**: 2026-02-08  
**Version**: 2.2.5  
**Status**: ✅ Implemented - Email-Only Login with Username Display

## Overview

Trinity now supports custom usernames for display purposes while maintaining email-based authentication for simplicity and reliability.

## Implementation Details

### Authentication Flow

**Registration**:
1. User provides: username, email, password
2. Username is validated (min 3 chars, alphanumeric + underscore)
3. Username is stored in Cognito `preferred_username` attribute
4. Email is used as Cognito username (for login)
5. Username mapping is saved to `trinity-usernames` table (PostConfirmation trigger)

**Login**:
1. User provides: email, password
2. System authenticates using email as Cognito username
3. Username is retrieved from `preferred_username` attribute
4. Dashboard displays username (not email)

### Key Design Decisions

**Why Email-Only Login?**
- ✅ Simpler and more reliable
- ✅ No race conditions with username blocking
- ✅ Standard authentication pattern
- ✅ Avoids complex username lookup logic
- ✅ Less infrastructure to maintain

**Why Keep Username?**
- ✅ Better user experience (display name)
- ✅ Privacy (don't show email everywhere)
- ✅ Personalization

### Database Schema

#### trinity-usernames Table
```typescript
{
  username: string;      // PK - lowercase, unique
  email: string;         // User's email (Cognito username)
  createdAt: string;     // ISO timestamp
}
```

**Purpose**: 
- Username uniqueness validation
- Username-to-email mapping for future features
- User account deletion (GDPR compliance)

### Cognito Configuration

**User Attributes**:
- `email` (required) - Used as Cognito username
- `preferred_username` (custom) - Display name

**Triggers**:
- `PreSignUp`: Validates username availability, auto-confirms user
- `PostConfirmation`: Saves username mapping to DynamoDB

### Lambda Handlers

#### 1. PreSignUp Trigger
**File**: `infrastructure/src/handlers/cognito-triggers/pre-signup.ts`

**Responsibilities**:
- Auto-confirm user
- Auto-verify email
- Validate username availability (check DynamoDB)
- Throw error if username already exists

#### 2. PostConfirmation Trigger
**File**: `infrastructure/src/handlers/cognito-triggers/post-confirmation.ts`

**Responsibilities**:
- Save username → email mapping to DynamoDB
- Only runs after successful user creation

#### 3. Username Handler
**File**: `infrastructure/src/handlers/username/index.ts`

**Operations**:
- `getUsernameEmail`: Lookup email by username (API Key auth)
- `deleteUserAccount`: Delete all user data (GDPR compliance)

### GraphQL Schema

```graphql
type Query {
  getUsernameEmail(username: String!): UsernameMapping @aws_api_key
}

type Mutation {
  deleteUserAccount: DeleteUserResult!
}

type UsernameMapping @aws_api_key {
  username: String!
  email: String!
}
```

### Mobile App Implementation

#### AuthScreen
**File**: `mobile/src/screens/AuthScreen.tsx`

**Registration Form**:
- Username field (min 3 chars, alphanumeric + underscore)
- Email field (used for login)
- Password field (8+ chars, uppercase, lowercase, number)
- Confirm password field

**Login Form**:
- Email field (Cognito username)
- Password field

**Validation**:
- Username: min 3 chars, alphanumeric + underscore, lowercase
- Email: standard email format
- Password: 8+ chars, 1 uppercase, 1 lowercase, 1 number

#### DashboardScreen
**File**: `mobile/src/screens/DashboardScreen.tsx`

**Display**:
- Shows "¡Hola {username}!" using `preferred_username` attribute
- Falls back to email if username not available

### API Key Authentication

**Purpose**: Allow unauthenticated username lookup during login

**Configuration**:
- API Key: `da2-ztbvjtcm4bc5bblvsbnk4amc2a`
- Expires: 2027-02-08
- Used for: `getUsernameEmail` query only

**Security**: API Key is safe for client-side use as it only allows username lookup (public information).

### User Account Deletion (GDPR)

**Mutation**: `deleteUserAccount`

**Deletes**:
1. Username mapping from `trinity-usernames`
2. User's rooms from `trinity-rooms`
3. User's votes from `trinity-votes`
4. User from Cognito User Pool

**Returns**:
```typescript
{
  success: boolean;
  message: string;
  deletedItems: {
    username: boolean;
    rooms: number;
    votes: number;
    matches: number;
  }
}
```

## Testing

### Registration Flow
1. Open app → "Crear Cuenta"
2. Enter username (e.g., "testuser")
3. Enter email (e.g., "test@example.com")
4. Enter password (e.g., "Test1234")
5. Confirm password
6. Click "Crear Cuenta"
7. Should see success message
8. Redirected to login screen

### Login Flow
1. Open app → "Iniciar Sesión"
2. Enter email (e.g., "test@example.com")
3. Enter password (e.g., "Test1234")
4. Click "Iniciar Sesión"
5. Should see Dashboard with "¡Hola testuser!"

### Username Display
1. After login, Dashboard shows username
2. Profile screen shows username
3. Email is NOT displayed in main UI

## Troubleshooting

### "Username already in use" Error

**Cause**: Orphaned username in `trinity-usernames` table from failed registration

**Solution**:
```bash
# Delete orphaned username
aws dynamodb delete-item \
  --table-name trinity-usernames \
  --key '{"username": {"S": "testuser"}}' \
  --region eu-west-1
```

### "No credentials" Error

**Cause**: API Key not configured in mobile app

**Solution**: Verify `mobile/.env` has:
```bash
EXPO_PUBLIC_GRAPHQL_API_KEY=da2-ztbvjtcm4bc5bblvsbnk4amc2a
```

### Login Fails with Valid Credentials

**Cause**: User not confirmed in Cognito

**Solution**: PreSignUp trigger should auto-confirm. Check CloudWatch logs.

## Future Enhancements

### Potential Features (Not Implemented)
- [ ] Username login (requires atomic username reservation)
- [ ] Username change (requires uniqueness validation)
- [ ] Username search (find users by username)
- [ ] Username mentions (@username)

### If Username Login is Needed

**Recommended Approach**:
1. Use Cognito custom attributes with uniqueness constraint
2. OR implement atomic username reservation with rollback
3. OR use two-phase commit pattern with compensation

**Not Recommended**:
- ❌ Current PreSignUp + PostConfirmation approach (race conditions)
- ❌ Manual cleanup of orphaned usernames

## Deployment

### Infrastructure
```bash
cd infrastructure
npm run build
cdk deploy
```

### Mobile
```bash
cd mobile
npm install
npx expo start
```

### Environment Variables

**infrastructure/.env**:
```bash
TMDB_API_KEY=your_tmdb_api_key
AWS_REGION=eu-west-1
```

**mobile/.env**:
```bash
EXPO_PUBLIC_AWS_REGION=eu-west-1
EXPO_PUBLIC_USER_POOL_ID=your_user_pool_id
EXPO_PUBLIC_USER_POOL_CLIENT_ID=your_client_id
EXPO_PUBLIC_GRAPHQL_ENDPOINT=your_graphql_endpoint
EXPO_PUBLIC_GRAPHQL_API_KEY=da2-ztbvjtcm4bc5bblvsbnk4amc2a
```

## Summary

✅ **What Works**:
- Username display in app
- Email-based login
- Username uniqueness validation
- User account deletion (GDPR)

❌ **What Doesn't Work**:
- Username-based login (by design - too complex)

🎯 **Result**: Simple, reliable authentication with personalized username display.

---

**Last Updated**: 2026-02-08  
**Next Review**: When username login is absolutely required
