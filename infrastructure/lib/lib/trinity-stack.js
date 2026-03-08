"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrinityStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const appsync = __importStar(require("aws-cdk-lib/aws-appsync"));
const cognito = __importStar(require("aws-cdk-lib/aws-cognito"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const path = __importStar(require("path"));
class TrinityStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // DynamoDB Tables
        const roomsTable = new dynamodb.Table(this, 'RoomsTable', {
            tableName: 'trinity-rooms',
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: 'ttl',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Add GSI for room code lookup (first deployment)
        roomsTable.addGlobalSecondaryIndex({
            indexName: 'code-index',
            partitionKey: { name: 'code', type: dynamodb.AttributeType.STRING },
        });
        const votesTable = new dynamodb.Table(this, 'VotesTable', {
            tableName: 'trinity-votes',
            partitionKey: { name: 'roomId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'userMovieId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const matchesTable = new dynamodb.Table(this, 'MatchesTable', {
            tableName: 'trinity-matches',
            partitionKey: { name: 'roomId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'movieId', type: dynamodb.AttributeType.NUMBER },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Username mapping table - maps username to email for login
        const usernamesTable = new dynamodb.Table(this, 'UsernamesTable', {
            tableName: 'trinity-usernames',
            partitionKey: { name: 'username', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Recommendations table - stores social/sustainable movie recommendations
        const recommendationsTable = new dynamodb.Table(this, 'RecommendationsTable', {
            tableName: 'trinity-recommendations',
            partitionKey: { name: 'categoryId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'movieId', type: dynamodb.AttributeType.NUMBER },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep data on stack deletion
        });
        // Lambda Trigger for Cognito - Auto-confirm users and store username mapping
        const preSignUpTrigger = new lambda.Function(this, 'PreSignUpTrigger', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'pre-signup.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/cognito-triggers')),
            timeout: cdk.Duration.seconds(10),
            description: 'Auto-confirms users on sign-up and stores username mapping',
            environment: {
                USERNAMES_TABLE: usernamesTable.tableName,
            },
        });
        // Grant permissions to write to usernames table
        usernamesTable.grantReadData(preSignUpTrigger);
        // Lambda Trigger for Cognito - Post Confirmation (stores username mapping)
        const postConfirmationTrigger = new lambda.Function(this, 'PostConfirmationTrigger', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'post-confirmation.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/cognito-triggers')),
            timeout: cdk.Duration.seconds(10),
            description: 'Stores username mapping after successful user creation',
            environment: {
                USERNAMES_TABLE: usernamesTable.tableName,
            },
        });
        // Grant permissions to write to usernames table
        usernamesTable.grantWriteData(postConfirmationTrigger);
        // Cognito User Pool
        const userPool = new cognito.UserPool(this, 'TrinityUserPool', {
            userPoolName: 'trinity-users',
            selfSignUpEnabled: true,
            signInAliases: {
                email: true,
            },
            autoVerify: {
                email: false, // Disabled - using Lambda trigger for auto-confirmation
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: false,
            },
            lambdaTriggers: {
                preSignUp: preSignUpTrigger,
                postConfirmation: postConfirmationTrigger,
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        const userPoolClient = new cognito.UserPoolClient(this, 'TrinityUserPoolClient', {
            userPool,
            userPoolClientName: 'trinity-client',
            generateSecret: false,
            authFlows: {
                userPassword: true,
                userSrp: true,
            },
            // CRITICAL: Configure token expiration times to MAXIMUM allowed by Cognito
            // Users will stay logged in indefinitely as long as they use the app
            accessTokenValidity: cdk.Duration.days(1), // Access token: 1 day (Cognito maximum)
            idTokenValidity: cdk.Duration.days(1), // ID token: 1 day (Cognito maximum)
            refreshTokenValidity: cdk.Duration.days(3650), // Refresh token: 10 YEARS (Cognito maximum)
            // Enable token refresh
            enableTokenRevocation: true,
            // Prevent token refresh errors
            preventUserExistenceErrors: true,
        });
        // Cognito Identity Pool for Federated Sign-In (Google, Apple)
        // CRITICAL: For native Google Sign-In to work, we need to configure the Identity Pool
        // to accept tokens from Google OAuth. The token will have the Web Client ID as audience
        // but will be generated through native sign-in flow.
        const identityPool = new cognito.CfnIdentityPool(this, 'TrinityIdentityPool', {
            identityPoolName: 'trinity-identity-pool',
            allowUnauthenticatedIdentities: false,
            cognitoIdentityProviders: [
                {
                    clientId: userPoolClient.userPoolClientId,
                    providerName: userPool.userPoolProviderName,
                },
            ],
            supportedLoginProviders: {
                // Use Web Client ID - this is what the token's 'aud' field will contain
                // even when using native sign-in with @react-native-google-signin/google-signin
                'accounts.google.com': '1022509849017-1bcq0tpo9babgeoh80get5akv84bgdq0.apps.googleusercontent.com',
            },
            // Allow classic flow for Google federation
            allowClassicFlow: true,
        });
        // IAM roles for authenticated users
        const authenticatedRole = new iam.Role(this, 'CognitoAuthenticatedRole', {
            assumedBy: new iam.CompositePrincipal(
            // Allow Cognito Identity Pool to assume this role
            new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
                StringEquals: {
                    'cognito-identity.amazonaws.com:aud': identityPool.ref,
                },
                'ForAnyValue:StringLike': {
                    'cognito-identity.amazonaws.com:amr': 'authenticated',
                },
            }, 'sts:AssumeRoleWithWebIdentity'), 
            // CRITICAL: Allow Google to assume this role directly
            // This is required for native Google Sign-In to work with Cognito Identity Pool
            new iam.FederatedPrincipal('accounts.google.com', {
                StringEquals: {
                    'accounts.google.com:aud': '1022509849017-1bcq0tpo9babgeoh80get5akv84bgdq0.apps.googleusercontent.com',
                },
            }, 'sts:AssumeRoleWithWebIdentity')),
        });
        // Attach role to identity pool
        new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
            identityPoolId: identityPool.ref,
            roles: {
                authenticated: authenticatedRole.roleArn,
            },
        });
        // GraphQL API
        const api = new appsync.GraphqlApi(this, 'TrinityApi', {
            name: 'trinity-api',
            definition: appsync.Definition.fromFile(path.join(__dirname, '../schema.graphql')),
            authorizationConfig: {
                defaultAuthorization: {
                    authorizationType: appsync.AuthorizationType.USER_POOL,
                    userPoolConfig: {
                        userPool,
                    },
                },
                additionalAuthorizationModes: [
                    {
                        authorizationType: appsync.AuthorizationType.IAM,
                    },
                    {
                        authorizationType: appsync.AuthorizationType.API_KEY,
                        apiKeyConfig: {
                            expires: cdk.Expiration.after(cdk.Duration.days(365)),
                        },
                    },
                ],
            },
            logConfig: {
                fieldLogLevel: appsync.FieldLogLevel.ALL,
            },
        });
        // Grant authenticated users from Identity Pool access to AppSync
        authenticatedRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['appsync:GraphQL'],
            resources: [`${api.arn}/*`],
        }));
        // Lambda Functions
        const tmdbHandler = new lambda.Function(this, 'TmdbHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/tmdb')),
            environment: {
                TMDB_API_KEY: process.env.TMDB_API_KEY || 'dc4dbcd2404c1ca852f8eb964add267d', // Fallback hardcoded
                TMDB_READ_TOKEN: process.env.TMDB_READ_TOKEN || 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJkYzRkYmNkMjQwNGMxY2E4NTJmOGViOTY0YWRkMjY3ZCIsIm5iZiI6MTc2NjAwMTAwMi40MDk5OTk4LCJzdWIiOiI2OTQzMDk2YTRjMGMxZmUzZDY3OWFjYmUiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.qK155c8oXB-_OUfYcNedwc7Fsbg8w7Y4d99oikb3SP8',
            },
            timeout: cdk.Duration.seconds(30),
        });
        const roomHandler = new lambda.Function(this, 'RoomHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/room')),
            environment: {
                ROOMS_TABLE: roomsTable.tableName,
                VOTES_TABLE: votesTable.tableName,
                MATCHES_TABLE: matchesTable.tableName,
                TMDB_LAMBDA_ARN: tmdbHandler.functionArn,
            },
            timeout: cdk.Duration.seconds(30),
        });
        const voteHandler = new lambda.Function(this, 'VoteHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/vote')),
            environment: {
                VOTES_TABLE: votesTable.tableName,
                MATCHES_TABLE: matchesTable.tableName,
                ROOMS_TABLE: roomsTable.tableName,
                GRAPHQL_ENDPOINT: api.graphqlUrl,
            },
            timeout: cdk.Duration.seconds(30),
        });
        const matchHandler = new lambda.Function(this, 'MatchHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/match')),
            environment: {
                MATCHES_TABLE: matchesTable.tableName,
                GRAPHQL_ENDPOINT: api.graphqlUrl,
            },
            timeout: cdk.Duration.seconds(30),
        });
        const usernameHandler = new lambda.Function(this, 'UsernameHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/username')),
            environment: {
                USERNAMES_TABLE: usernamesTable.tableName,
                ROOMS_TABLE: roomsTable.tableName,
                VOTES_TABLE: votesTable.tableName,
                MATCHES_TABLE: matchesTable.tableName,
                USER_POOL_ID: userPool.userPoolId,
            },
            timeout: cdk.Duration.seconds(30),
        });
        const recommendationsHandler = new lambda.Function(this, 'RecommendationsHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/recommendations')),
            environment: {
                RECOMMENDATIONS_TABLE: recommendationsTable.tableName,
            },
            timeout: cdk.Duration.seconds(10),
        });
        // Grant permissions
        roomsTable.grantReadWriteData(roomHandler);
        votesTable.grantReadWriteData(roomHandler);
        matchesTable.grantReadData(roomHandler);
        votesTable.grantReadWriteData(voteHandler);
        matchesTable.grantReadWriteData(voteHandler);
        matchesTable.grantReadWriteData(matchHandler);
        roomsTable.grantReadData(voteHandler);
        usernamesTable.grantReadWriteData(usernameHandler);
        roomsTable.grantReadWriteData(usernameHandler);
        votesTable.grantReadWriteData(usernameHandler);
        matchesTable.grantReadWriteData(usernameHandler);
        recommendationsTable.grantReadData(recommendationsHandler);
        // Grant Cognito permissions to username handler
        usernameHandler.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'cognito-idp:AdminDeleteUser',
                'cognito-idp:AdminGetUser',
            ],
            resources: [userPool.userPoolArn],
        }));
        tmdbHandler.grantInvoke(roomHandler);
        // Grant AppSync permissions to Lambda functions
        api.grantMutation(voteHandler, 'publishRoomMatch');
        api.grantMutation(voteHandler, 'publishUserMatch');
        api.grantMutation(matchHandler, 'publishRoomMatch');
        api.grantMutation(matchHandler, 'publishUserMatch');
        // Data Sources
        const tmdbDataSource = api.addLambdaDataSource('TmdbDataSource', tmdbHandler);
        const roomDataSource = api.addLambdaDataSource('RoomDataSource', roomHandler);
        const voteDataSource = api.addLambdaDataSource('VoteDataSource', voteHandler);
        const matchDataSource = api.addLambdaDataSource('MatchDataSource', matchHandler);
        const usernameDataSource = api.addLambdaDataSource('UsernameDataSource', usernameHandler);
        const recommendationsDataSource = api.addLambdaDataSource('RecommendationsDataSource', recommendationsHandler);
        // Resolvers
        roomDataSource.createResolver('CreateRoomResolver', {
            typeName: 'Mutation',
            fieldName: 'createRoom',
        });
        roomDataSource.createResolver('JoinRoomResolver', {
            typeName: 'Mutation',
            fieldName: 'joinRoom',
        });
        roomDataSource.createResolver('GetRoomResolver', {
            typeName: 'Query',
            fieldName: 'getRoom',
        });
        roomDataSource.createResolver('GetMyRoomsResolver', {
            typeName: 'Query',
            fieldName: 'getMyRooms',
        });
        voteDataSource.createResolver('VoteResolver', {
            typeName: 'Mutation',
            fieldName: 'vote',
        });
        matchDataSource.createResolver('GetMyMatchesResolver', {
            typeName: 'Query',
            fieldName: 'getMyMatches',
        });
        usernameDataSource.createResolver('GetUsernameEmailResolver', {
            typeName: 'Query',
            fieldName: 'getUsernameEmail',
        });
        usernameDataSource.createResolver('DeleteUserAccountResolver', {
            typeName: 'Mutation',
            fieldName: 'deleteUserAccount',
        });
        recommendationsDataSource.createResolver('GetRecommendationsResolver', {
            typeName: 'Query',
            fieldName: 'getRecommendations',
        });
        recommendationsDataSource.createResolver('GetRecommendationsByCategoryResolver', {
            typeName: 'Query',
            fieldName: 'getRecommendationsByCategory',
        });
        // Subscription resolvers (no-op resolvers for triggering subscriptions)
        // CRITICAL FIX: Return complete object from arguments, not from result
        // AppSync subscriptions need the full object to trigger properly
        api.createResolver('PublishRoomMatchResolver', {
            typeName: 'Mutation',
            fieldName: 'publishRoomMatch',
            dataSource: api.addNoneDataSource('NoneDataSource'),
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "payload": {
            "roomId": "$context.arguments.roomId",
            "matchId": "$context.arguments.matchData.matchId",
            "movieId": "$context.arguments.matchData.movieId",
            "movieTitle": "$context.arguments.matchData.movieTitle",
            "posterPath": "$context.arguments.matchData.posterPath",
            "matchedUsers": $util.toJson($context.arguments.matchData.matchedUsers),
            "timestamp": "$context.arguments.matchData.timestamp",
            "matchDetails": $util.toJson($context.arguments.matchData.matchDetails)
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        ## CRITICAL: Return the complete object from the request arguments
        ## This is what triggers the subscription with the full data
        {
          "roomId": "$context.arguments.roomId",
          "matchId": "$context.arguments.matchData.matchId",
          "movieId": "$context.arguments.matchData.movieId",
          "movieTitle": "$context.arguments.matchData.movieTitle",
          "posterPath": "$context.arguments.matchData.posterPath",
          "matchedUsers": $util.toJson($context.arguments.matchData.matchedUsers),
          "timestamp": "$context.arguments.matchData.timestamp",
          "matchDetails": $util.toJson($context.arguments.matchData.matchDetails)
        }
      `),
        });
        api.createResolver('PublishUserMatchResolver', {
            typeName: 'Mutation',
            fieldName: 'publishUserMatch',
            dataSource: api.addNoneDataSource('NoneDataSource2'),
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "payload": {
            "userId": "$context.arguments.userId",
            "roomId": "$context.arguments.matchData.roomId",
            "matchId": "$context.arguments.matchData.matchId",
            "movieId": "$context.arguments.matchData.movieId",
            "movieTitle": "$context.arguments.matchData.movieTitle",
            "posterPath": "$context.arguments.matchData.posterPath",
            "matchedUsers": $util.toJson($context.arguments.matchData.matchedUsers),
            "timestamp": "$context.arguments.matchData.timestamp",
            "matchDetails": $util.toJson($context.arguments.matchData.matchDetails)
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        ## CRITICAL: Return the complete object from the request arguments
        ## This is what triggers the subscription with the full data
        {
          "userId": "$context.arguments.userId",
          "roomId": "$context.arguments.matchData.roomId",
          "matchId": "$context.arguments.matchData.matchId",
          "movieId": "$context.arguments.matchData.movieId",
          "movieTitle": "$context.arguments.matchData.movieTitle",
          "posterPath": "$context.arguments.matchData.posterPath",
          "matchedUsers": $util.toJson($context.arguments.matchData.matchedUsers),
          "timestamp": "$context.arguments.matchData.timestamp",
          "matchDetails": $util.toJson($context.arguments.matchData.matchDetails)
        }
      `),
        });
        // Outputs
        new cdk.CfnOutput(this, 'GraphQLEndpoint', {
            value: api.graphqlUrl,
            description: 'GraphQL API Endpoint',
        });
        new cdk.CfnOutput(this, 'GraphQLApiKey', {
            value: api.apiKey || 'N/A',
            description: 'GraphQL API Key',
        });
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: userPool.userPoolId,
            description: 'Cognito User Pool ID',
        });
        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: userPoolClient.userPoolClientId,
            description: 'Cognito User Pool Client ID',
        });
        new cdk.CfnOutput(this, 'IdentityPoolId', {
            value: identityPool.ref,
            description: 'Cognito Identity Pool ID',
        });
        new cdk.CfnOutput(this, 'Region', {
            value: this.region,
            description: 'AWS Region',
        });
    }
}
exports.TrinityStack = TrinityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJpbml0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3RyaW5pdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLCtEQUFpRDtBQUNqRCxtRUFBcUQ7QUFDckQsaUVBQW1EO0FBQ25ELGlFQUFtRDtBQUNuRCx5REFBMkM7QUFFM0MsMkNBQTZCO0FBRzdCLE1BQWEsWUFBYSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3pDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsa0JBQWtCO1FBQ2xCLE1BQU0sVUFBVSxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ3hELFNBQVMsRUFBRSxlQUFlO1lBQzFCLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQ2pFLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsbUJBQW1CLEVBQUUsS0FBSztZQUMxQixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQ3pDLENBQUMsQ0FBQztRQUVILGtEQUFrRDtRQUNsRCxVQUFVLENBQUMsdUJBQXVCLENBQUM7WUFDakMsU0FBUyxFQUFFLFlBQVk7WUFDdkIsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7U0FDcEUsQ0FBQyxDQUFDO1FBRUgsTUFBTSxVQUFVLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDeEQsU0FBUyxF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V0FBVyxFQUFFLGlCQUFpQjtTQUMvQixDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUNwQyxLQUFLLEVBQUUsUUFBUSxDQUFDLFVBQVU7WUFDMUIsV0FBVyxFQUFFLHNCQUFzQjtTQUNwQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFDLEtBQUssRUFBRSxjQUFjLENBQUMsZ0JBQWdCO1lBQ3RDLFdBQVcsRUFBRSw2QkFBNkI7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4QyxLQUFLLEVBQUUsWUFBWSxDQUFDLEdBQUc7WUFDdkIsV0FBVyxFQUFFLDBCQUEwQjtTQUN4QyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRTtZQUNoQyxLQUFLLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDbEIsV0FBVyxFQUFFLFlBQVk7U0FDMUIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBN2VELG9DQTZlQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcclxuaW1wb3J0ICogYXMgYXBwc3luYyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBwc3luYyc7XHJcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcblxyXG5leHBvcnQgY2xhc3MgVHJpbml0eVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcclxuXHJcbiAgICAvLyBEeW5hbW9EQiBUYWJsZXNcclxuICAgIGNvbnN0IHJvb21zVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1Jvb21zVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ3RyaW5pdHktcm9vbXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgR1NJIGZvciByb29tIGNvZGUgbG9va3VwIChmaXJzdCBkZXBsb3ltZW50KVxyXG4gICAgcm9vbXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ2NvZGUtaW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2NvZGUnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgdm90ZXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVm90ZXNUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAndHJpbml0eS12b3RlcycsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAncm9vbUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAndXNlck1vdmllSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgbWF0Y2hlc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdNYXRjaGVzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ3RyaW5pdHktbWF0Y2hlcycsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAncm9vbUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnbW92aWVJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBVc2VybmFtZSBtYXBwaW5nIHRhYmxlIC0gbWFwcyB1c2VybmFtZSB0byBlbWFpbCBmb3IgbG9naW5cclxuICAgIGNvbnN0IHVzZXJuYW1lc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdVc2VybmFtZXNUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAndHJpbml0eS11c2VybmFtZXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VzZXJuYW1lJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFJlY29tbWVuZGF0aW9ucyB0YWJsZSAtIHN0b3JlcyBzb2NpYWwvc3VzdGFpbmFibGUgbW92aWUgcmVjb21tZW5kYXRpb25zXHJcbiAgICBjb25zdCByZWNvbW1lbmRhdGlvbnNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnUmVjb21tZW5kYXRpb25zVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ3RyaW5pdHktcmVjb21tZW5kYXRpb25zJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdjYXRlZ29yeUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnbW92aWVJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTiwgLy8gS2VlcCBkYXRhIG9uIHN0YWNrIGRlbGV0aW9uXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMYW1iZGEgVHJpZ2dlciBmb3IgQ29nbml0byAtIEF1dG8tY29uZmlybSB1c2VycyBhbmQgc3RvcmUgdXNlcm5hbWUgbWFwcGluZ1xyXG4gICAgY29uc3QgcHJlU2lnblVwVHJpZ2dlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1ByZVNpZ25VcFRyaWdnZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAncHJlLXNpZ251cC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zcmMvaGFuZGxlcnMvY29nbml0by10cmlnZ2VycycpKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0F1dG8tY29uZmlybXMgdXNlcnMgb24gc2lnbi11cCBhbmQgc3RvcmVzIHVzZXJuYW1lIG1hcHBpbmcnLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFVTRVJOQU1FU19UQUJMRTogdXNlcm5hbWVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgdG8gd3JpdGUgdG8gdXNlcm5hbWVzIHRhYmxlXHJcbiAgICB1c2VybmFtZXNUYWJsZS5ncmFudFJlYWREYXRhKHByZVNpZ25VcFRyaWdnZXIpO1xyXG5cclxuICAgIC8vIExhbWJkYSBUcmlnZ2VyIGZvciBDb2duaXRvIC0gUG9zdCBDb25maXJtYXRpb24gKHN0b3JlcyB1c2VybmFtZSBtYXBwaW5nKVxyXG4gICAgY29uc3QgcG9zdENvbmZpcm1hdGlvblRyaWdnZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdQb3N0Q29uZmlybWF0aW9uVHJpZ2dlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdwb3N0LWNvbmZpcm1hdGlvbi5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zcmMvaGFuZGxlcnMvY29nbml0by10cmlnZ2VycycpKSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1N0b3JlcyB1c2VybmFtZSBtYXBwaW5nIGFmdGVyIHN1Y2Nlc3NmdWwgdXNlciBjcmVhdGlvbicsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgVVNFUk5BTUVTX1RBQkxFOiB1c2VybmFtZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byB3cml0ZSB0byB1c2VybmFtZXMgdGFibGVcclxuICAgIHVzZXJuYW1lc1RhYmxlLmdyYW50V3JpdGVEYXRhKHBvc3RDb25maXJtYXRpb25UcmlnZ2VyKTtcclxuXHJcbiAgICAvLyBDb2duaXRvIFVzZXIgUG9vbFxyXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnVHJpbml0eVVzZXJQb29sJywge1xyXG4gICAgICB1c2VyUG9vbE5hbWU6ICd0cmluaXR5LXVzZXJzJyxcclxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXHJcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHtcclxuICAgICAgICBlbWFpbDogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgICAgYXV0b1ZlcmlmeToge1xyXG4gICAgICAgIGVtYWlsOiBmYWxzZSwgLy8gRGlzYWJsZWQgLSB1c2luZyBMYW1iZGEgdHJpZ2dlciBmb3IgYXV0by1jb25maXJtYXRpb25cclxuICAgICAgfSxcclxuICAgICAgcGFzc3dvcmRQb2xpY3k6IHtcclxuICAgICAgICBtaW5MZW5ndGg6IDgsXHJcbiAgICAgICAgcmVxdWlyZUxvd2VyY2FzZTogdHJ1ZSxcclxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxyXG4gICAgICAgIHJlcXVpcmVEaWdpdHM6IHRydWUsXHJcbiAgICAgICAgcmVxdWlyZVN5bWJvbHM6IGZhbHNlLFxyXG4gICAgICB9LFxyXG4gICAgICBsYW1iZGFUcmlnZ2Vyczoge1xyXG4gICAgICAgIHByZVNpZ25VcDogcHJlU2lnblVwVHJpZ2dlcixcclxuICAgICAgICBwb3N0Q29uZmlybWF0aW9uOiBwb3N0Q29uZmlybWF0aW9uVHJpZ2dlcixcclxuICAgICAgfSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50ID0gbmV3IGNvZ25pdG8uVXNlclBvb2xDbGllbnQodGhpcywgJ1RyaW5pdHlVc2VyUG9vbENsaWVudCcsIHtcclxuICAgICAgdXNlclBvb2wsXHJcbiAgICAgIHVzZXJQb29sQ2xpZW50TmFtZTogJ3RyaW5pdHktY2xpZW50JyxcclxuICAgICAgZ2VuZXJhdGVTZWNyZXQ6IGZhbHNlLFxyXG4gICAgICBhdXRoRmxvd3M6IHtcclxuICAgICAgICB1c2VyUGFzc3dvcmQ6IHRydWUsXHJcbiAgICAgICAgdXNlclNycDogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgICAgLy8gQ1JJVElDQUw6IENvbmZpZ3VyZSB0b2tlbiBleHBpcmF0aW9uIHRpbWVzIHRvIE1BWElNVU0gYWxsb3dlZCBieSBDb2duaXRvXHJcbiAgICAgIC8vIFVzZXJzIHdpbGwgc3RheSBsb2dnZWQgaW4gaW5kZWZpbml0ZWx5IGFzIGxvbmcgYXMgdGhleSB1c2UgdGhlIGFwcFxyXG4gICAgICBhY2Nlc3NUb2tlblZhbGlkaXR5OiBjZGsuRHVyYXRpb24uZGF5cygxKSwgICAgICAvLyBBY2Nlc3MgdG9rZW46IDEgZGF5IChDb2duaXRvIG1heGltdW0pXHJcbiAgICAgIGlkVG9rZW5WYWxpZGl0eTogY2RrLkR1cmF0aW9uLmRheXMoMSksICAgICAgICAgIC8vIElEIHRva2VuOiAxIGRheSAoQ29nbml0byBtYXhpbXVtKVxyXG4gICAgICByZWZyZXNoVG9rZW5WYWxpZGl0eTogY2RrLkR1cmF0aW9uLmRheXMoMzY1MCksICAvLyBSZWZyZXNoIHRva2VuOiAxMCBZRUFSUyAoQ29nbml0byBtYXhpbXVtKVxyXG4gICAgICAvLyBFbmFibGUgdG9rZW4gcmVmcmVzaFxyXG4gICAgICBlbmFibGVUb2tlblJldm9jYXRpb246IHRydWUsXHJcbiAgICAgIC8vIFByZXZlbnQgdG9rZW4gcmVmcmVzaCBlcnJvcnNcclxuICAgICAgcHJldmVudFVzZXJFeGlzdGVuY2VFcnJvcnM6IHRydWUsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDb2duaXRvIElkZW50aXR5IFBvb2wgZm9yIEZlZGVyYXRlZCBTaWduLUluIChHb29nbGUsIEFwcGxlKVxyXG4gICAgLy8gQ1JJVElDQUw6IEZvciBuYXRpdmUgR29vZ2xlIFNpZ24tSW4gdG8gd29yaywgd2UgbmVlZCB0byBjb25maWd1cmUgdGhlIElkZW50aXR5IFBvb2xcclxuICAgIC8vIHRvIGFjY2VwdCB0b2tlbnMgZnJvbSBHb29nbGUgT0F1dGguIFRoZSB0b2tlbiB3aWxsIGhhdmUgdGhlIFdlYiBDbGllbnQgSUQgYXMgYXVkaWVuY2VcclxuICAgIC8vIGJ1dCB3aWxsIGJlIGdlbmVyYXRlZCB0aHJvdWdoIG5hdGl2ZSBzaWduLWluIGZsb3cuXHJcbiAgICBjb25zdCBpZGVudGl0eVBvb2wgPSBuZXcgY29nbml0by5DZm5JZGVudGl0eVBvb2wodGhpcywgJ1RyaW5pdHlJZGVudGl0eVBvb2wnLCB7XHJcbiAgICAgIGlkZW50aXR5UG9vbE5hbWU6ICd0cmluaXR5LWlkZW50aXR5LXBvb2wnLFxyXG4gICAgICBhbGxvd1VuYXV0aGVudGljYXRlZElkZW50aXRpZXM6IGZhbHNlLFxyXG4gICAgICBjb2duaXRvSWRlbnRpdHlQcm92aWRlcnM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBjbGllbnRJZDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcclxuICAgICAgICAgIHByb3ZpZGVyTmFtZTogdXNlclBvb2wudXNlclBvb2xQcm92aWRlck5hbWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgXSxcclxuICAgICAgc3VwcG9ydGVkTG9naW5Qcm92aWRlcnM6IHtcclxuICAgICAgICAvLyBVc2UgV2ViIENsaWVudCBJRCAtIHRoaXMgaXMgd2hhdCB0aGUgdG9rZW4ncyAnYXVkJyBmaWVsZCB3aWxsIGNvbnRhaW5cclxuICAgICAgICAvLyBldmVuIHdoZW4gdXNpbmcgbmF0aXZlIHNpZ24taW4gd2l0aCBAcmVhY3QtbmF0aXZlLWdvb2dsZS1zaWduaW4vZ29vZ2xlLXNpZ25pblxyXG4gICAgICAgICdhY2NvdW50cy5nb29nbGUuY29tJzogJzEwMjI1MDk4NDkwMTctMWJjcTB0cG85YmFiZ2VvaDgwZ2V0NWFrdjg0YmdkcTAuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20nLFxyXG4gICAgICB9LFxyXG4gICAgICAvLyBBbGxvdyBjbGFzc2ljIGZsb3cgZm9yIEdvb2dsZSBmZWRlcmF0aW9uXHJcbiAgICAgIGFsbG93Q2xhc3NpY0Zsb3c6IHRydWUsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBJQU0gcm9sZXMgZm9yIGF1dGhlbnRpY2F0ZWQgdXNlcnNcclxuICAgIGNvbnN0IGF1dGhlbnRpY2F0ZWRSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdDb2duaXRvQXV0aGVudGljYXRlZFJvbGUnLCB7XHJcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5Db21wb3NpdGVQcmluY2lwYWwoXHJcbiAgICAgICAgLy8gQWxsb3cgQ29nbml0byBJZGVudGl0eSBQb29sIHRvIGFzc3VtZSB0aGlzIHJvbGVcclxuICAgICAgICBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbChcclxuICAgICAgICAgICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb20nLFxyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcclxuICAgICAgICAgICAgICAnY29nbml0by1pZGVudGl0eS5hbWF6b25hd3MuY29tOmF1ZCc6IGlkZW50aXR5UG9vbC5yZWYsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICdGb3JBbnlWYWx1ZTpTdHJpbmdMaWtlJzoge1xyXG4gICAgICAgICAgICAgICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YW1yJzogJ2F1dGhlbnRpY2F0ZWQnLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgICdzdHM6QXNzdW1lUm9sZVdpdGhXZWJJZGVudGl0eSdcclxuICAgICAgICApLFxyXG4gICAgICAgIC8vIENSSVRJQ0FMOiBBbGxvdyBHb29nbGUgdG8gYXNzdW1lIHRoaXMgcm9sZSBkaXJlY3RseVxyXG4gICAgICAgIC8vIFRoaXMgaXMgcmVxdWlyZWQgZm9yIG5hdGl2ZSBHb29nbGUgU2lnbi1JbiB0byB3b3JrIHdpdGggQ29nbml0byBJZGVudGl0eSBQb29sXHJcbiAgICAgICAgbmV3IGlhbS5GZWRlcmF0ZWRQcmluY2lwYWwoXHJcbiAgICAgICAgICAnYWNjb3VudHMuZ29vZ2xlLmNvbScsXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgIFN0cmluZ0VxdWFsczoge1xyXG4gICAgICAgICAgICAgICdhY2NvdW50cy5nb29nbGUuY29tOmF1ZCc6ICcxMDIyNTA5ODQ5MDE3LTFiY3EwdHBvOWJhYmdlb2g4MGdldDVha3Y4NGJnZHEwLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29tJyxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICAnc3RzOkFzc3VtZVJvbGVXaXRoV2ViSWRlbnRpdHknXHJcbiAgICAgICAgKVxyXG4gICAgICApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQXR0YWNoIHJvbGUgdG8gaWRlbnRpdHkgcG9vbFxyXG4gICAgbmV3IGNvZ25pdG8uQ2ZuSWRlbnRpdHlQb29sUm9sZUF0dGFjaG1lbnQodGhpcywgJ0lkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50Jywge1xyXG4gICAgICBpZGVudGl0eVBvb2xJZDogaWRlbnRpdHlQb29sLnJlZixcclxuICAgICAgcm9sZXM6IHtcclxuICAgICAgICBhdXRoZW50aWNhdGVkOiBhdXRoZW50aWNhdGVkUm9sZS5yb2xlQXJuLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhcGhRTCBBUElcclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcHBzeW5jLkdyYXBocWxBcGkodGhpcywgJ1RyaW5pdHlBcGknLCB7XHJcbiAgICAgIG5hbWU6ICd0cmluaXR5LWFwaScsXHJcbiAgICAgIGRlZmluaXRpb246IGFwcHN5bmMuRGVmaW5pdGlvbi5mcm9tRmlsZShwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc2NoZW1hLmdyYXBocWwnKSksXHJcbiAgICAgIGF1dGhvcml6YXRpb25Db25maWc6IHtcclxuICAgICAgICBkZWZhdWx0QXV0aG9yaXphdGlvbjoge1xyXG4gICAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwcHN5bmMuQXV0aG9yaXphdGlvblR5cGUuVVNFUl9QT09MLFxyXG4gICAgICAgICAgdXNlclBvb2xDb25maWc6IHtcclxuICAgICAgICAgICAgdXNlclBvb2wsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYWRkaXRpb25hbEF1dGhvcml6YXRpb25Nb2RlczogW1xyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5JQU0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5BUElfS0VZLFxyXG4gICAgICAgICAgICBhcGlLZXlDb25maWc6IHtcclxuICAgICAgICAgICAgICBleHBpcmVzOiBjZGsuRXhwaXJhdGlvbi5hZnRlcihjZGsuRHVyYXRpb24uZGF5cygzNjUpKSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgICAgbG9nQ29uZmlnOiB7XHJcbiAgICAgICAgZmllbGRMb2dMZXZlbDogYXBwc3luYy5GaWVsZExvZ0xldmVsLkFMTCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IGF1dGhlbnRpY2F0ZWQgdXNlcnMgZnJvbSBJZGVudGl0eSBQb29sIGFjY2VzcyB0byBBcHBTeW5jXHJcbiAgICBhdXRoZW50aWNhdGVkUm9sZS5hZGRUb1BvbGljeShcclxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICBhY3Rpb25zOiBbJ2FwcHN5bmM6R3JhcGhRTCddLFxyXG4gICAgICAgIHJlc291cmNlczogW2Ake2FwaS5hcm59LypgXSxcclxuICAgICAgfSlcclxuICAgICk7XHJcblxyXG4gICAgLy8gTGFtYmRhIEZ1bmN0aW9uc1xyXG4gICAgY29uc3QgdG1kYkhhbmRsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdUbWRiSGFuZGxlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zcmMvaGFuZGxlcnMvdG1kYicpKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBUTURCX0FQSV9LRVk6IHByb2Nlc3MuZW52LlRNREJfQVBJX0tFWSB8fCAnZGM0ZGJjZDI0MDRjMWNhODUyZjhlYjk2NGFkZDI2N2QnLCAvLyBGYWxsYmFjayBoYXJkY29kZWRcclxuICAgICAgICBUTURCX1JFQURfVE9LRU46IHByb2Nlc3MuZW52LlRNREJfUkVBRF9UT0tFTiB8fCAnZXlKaGJHY2lPaUpJVXpJMU5pSjkuZXlKaGRXUWlPaUprWXpSa1ltTmtNalF3TkdNeFkyRTROVEptT0dWaU9UWTBZV1JrTWpZM1pDSXNJbTVpWmlJNk1UYzJOakF3TVRBd01pNDBNRGs1T1RrNExDSnpkV0lpT2lJMk9UUXpNRGsyWVRSak1HTXhabVV6WkRZM09XRmpZbVVpTENKelkyOXdaWE1pT2xzaVlYQnBYM0psWVdRaVhTd2lkbVZ5YzJsdmJpSTZNWDAucUsxNTVjOG9YQi1fT1VmWWNOZWR3YzdGc2JnOHc3WTRkOTlvaWtiM1NQOCcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHJvb21IYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnUm9vbUhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3Jvb20nKSksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgUk9PTVNfVEFCTEU6IHJvb21zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFZPVEVTX1RBQkxFOiB2b3Rlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBNQVRDSEVTX1RBQkxFOiBtYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFRNREJfTEFNQkRBX0FSTjogdG1kYkhhbmRsZXIuZnVuY3Rpb25Bcm4sXHJcbiAgICAgIH0sXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHZvdGVIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVm90ZUhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3ZvdGUnKSksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgVk9URVNfVEFCTEU6IHZvdGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIE1BVENIRVNfVEFCTEU6IG1hdGNoZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgUk9PTVNfVEFCTEU6IHJvb21zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEdSQVBIUUxfRU5EUE9JTlQ6IGFwaS5ncmFwaHFsVXJsLFxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBtYXRjaEhhbmRsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdNYXRjaEhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL21hdGNoJykpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIE1BVENIRVNfVEFCTEU6IG1hdGNoZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgR1JBUEhRTF9FTkRQT0lOVDogYXBpLmdyYXBocWxVcmwsXHJcbiAgICAgIH0sXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHVzZXJuYW1lSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1VzZXJuYW1lSGFuZGxlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zcmMvaGFuZGxlcnMvdXNlcm5hbWUnKSksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgVVNFUk5BTUVTX1RBQkxFOiB1c2VybmFtZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgUk9PTVNfVEFCTEU6IHJvb21zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFZPVEVTX1RBQkxFOiB2b3Rlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBNQVRDSEVTX1RBQkxFOiBtYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFVTRVJfUE9PTF9JRDogdXNlclBvb2wudXNlclBvb2xJZCxcclxuICAgICAgfSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgcmVjb21tZW5kYXRpb25zSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1JlY29tbWVuZGF0aW9uc0hhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3JlY29tbWVuZGF0aW9ucycpKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBSRUNPTU1FTkRBVElPTlNfVEFCTEU6IHJlY29tbWVuZGF0aW9uc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgfSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnNcclxuICAgIHJvb21zVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHJvb21IYW5kbGVyKTtcclxuICAgIHZvdGVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHJvb21IYW5kbGVyKTtcclxuICAgIG1hdGNoZXNUYWJsZS5ncmFudFJlYWREYXRhKHJvb21IYW5kbGVyKTtcclxuICAgIHZvdGVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHZvdGVIYW5kbGVyKTtcclxuICAgIG1hdGNoZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodm90ZUhhbmRsZXIpO1xyXG4gICAgbWF0Y2hlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShtYXRjaEhhbmRsZXIpO1xyXG4gICAgcm9vbXNUYWJsZS5ncmFudFJlYWREYXRhKHZvdGVIYW5kbGVyKTtcclxuICAgIHVzZXJuYW1lc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh1c2VybmFtZUhhbmRsZXIpO1xyXG4gICAgcm9vbXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodXNlcm5hbWVIYW5kbGVyKTtcclxuICAgIHZvdGVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHVzZXJuYW1lSGFuZGxlcik7XHJcbiAgICBtYXRjaGVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHVzZXJuYW1lSGFuZGxlcik7XHJcbiAgICByZWNvbW1lbmRhdGlvbnNUYWJsZS5ncmFudFJlYWREYXRhKHJlY29tbWVuZGF0aW9uc0hhbmRsZXIpO1xyXG5cclxuICAgIC8vIEdyYW50IENvZ25pdG8gcGVybWlzc2lvbnMgdG8gdXNlcm5hbWUgaGFuZGxlclxyXG4gICAgdXNlcm5hbWVIYW5kbGVyLmFkZFRvUm9sZVBvbGljeShcclxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkRlbGV0ZVVzZXInLFxyXG4gICAgICAgICAgJ2NvZ25pdG8taWRwOkFkbWluR2V0VXNlcicsXHJcbiAgICAgICAgXSxcclxuICAgICAgICByZXNvdXJjZXM6IFt1c2VyUG9vbC51c2VyUG9vbEFybl0sXHJcbiAgICAgIH0pXHJcbiAgICApO1xyXG5cclxuICAgIHRtZGJIYW5kbGVyLmdyYW50SW52b2tlKHJvb21IYW5kbGVyKTtcclxuXHJcbiAgICAvLyBHcmFudCBBcHBTeW5jIHBlcm1pc3Npb25zIHRvIExhbWJkYSBmdW5jdGlvbnNcclxuICAgIGFwaS5ncmFudE11dGF0aW9uKHZvdGVIYW5kbGVyLCAncHVibGlzaFJvb21NYXRjaCcpO1xyXG4gICAgYXBpLmdyYW50TXV0YXRpb24odm90ZUhhbmRsZXIsICdwdWJsaXNoVXNlck1hdGNoJyk7XHJcbiAgICBhcGkuZ3JhbnRNdXRhdGlvbihtYXRjaEhhbmRsZXIsICdwdWJsaXNoUm9vbU1hdGNoJyk7XHJcbiAgICBhcGkuZ3JhbnRNdXRhdGlvbihtYXRjaEhhbmRsZXIsICdwdWJsaXNoVXNlck1hdGNoJyk7XHJcblxyXG4gICAgLy8gRGF0YSBTb3VyY2VzXHJcbiAgICBjb25zdCB0bWRiRGF0YVNvdXJjZSA9IGFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdUbWRiRGF0YVNvdXJjZScsIHRtZGJIYW5kbGVyKTtcclxuICAgIGNvbnN0IHJvb21EYXRhU291cmNlID0gYXBpLmFkZExhbWJkYURhdGFTb3VyY2UoJ1Jvb21EYXRhU291cmNlJywgcm9vbUhhbmRsZXIpO1xyXG4gICAgY29uc3Qgdm90ZURhdGFTb3VyY2UgPSBhcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnVm90ZURhdGFTb3VyY2UnLCB2b3RlSGFuZGxlcik7XHJcbiAgICBjb25zdCBtYXRjaERhdGFTb3VyY2UgPSBhcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnTWF0Y2hEYXRhU291cmNlJywgbWF0Y2hIYW5kbGVyKTtcclxuICAgIGNvbnN0IHVzZXJuYW1lRGF0YVNvdXJjZSA9IGFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdVc2VybmFtZURhdGFTb3VyY2UnLCB1c2VybmFtZUhhbmRsZXIpO1xyXG4gICAgY29uc3QgcmVjb21tZW5kYXRpb25zRGF0YVNvdXJjZSA9IGFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdSZWNvbW1lbmRhdGlvbnNEYXRhU291cmNlJywgcmVjb21tZW5kYXRpb25zSGFuZGxlcik7XHJcblxyXG4gICAgLy8gUmVzb2x2ZXJzXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignQ3JlYXRlUm9vbVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAnY3JlYXRlUm9vbScsXHJcbiAgICB9KTtcclxuXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignSm9pblJvb21SZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2pvaW5Sb29tJyxcclxuICAgIH0pO1xyXG5cclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdHZXRSb29tUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdnZXRSb29tJyxcclxuICAgIH0pO1xyXG5cclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdHZXRNeVJvb21zUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdnZXRNeVJvb21zJyxcclxuICAgIH0pO1xyXG5cclxuICAgIHZvdGVEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdWb3RlUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICd2b3RlJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG1hdGNoRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0TXlNYXRjaGVzUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdnZXRNeU1hdGNoZXMnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdXNlcm5hbWVEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdHZXRVc2VybmFtZUVtYWlsUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdnZXRVc2VybmFtZUVtYWlsJyxcclxuICAgIH0pO1xyXG5cclxuICAgIHVzZXJuYW1lRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignRGVsZXRlVXNlckFjY291bnRSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2RlbGV0ZVVzZXJBY2NvdW50JyxcclxuICAgIH0pO1xyXG5cclxuICAgIHJlY29tbWVuZGF0aW9uc0RhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldFJlY29tbWVuZGF0aW9uc1Jlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0UmVjb21tZW5kYXRpb25zJyxcclxuICAgIH0pO1xyXG5cclxuICAgIHJlY29tbWVuZGF0aW9uc0RhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldFJlY29tbWVuZGF0aW9uc0J5Q2F0ZWdvcnlSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldFJlY29tbWVuZGF0aW9uc0J5Q2F0ZWdvcnknLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gU3Vic2NyaXB0aW9uIHJlc29sdmVycyAobm8tb3AgcmVzb2x2ZXJzIGZvciB0cmlnZ2VyaW5nIHN1YnNjcmlwdGlvbnMpXHJcbiAgICAvLyBDUklUSUNBTCBGSVg6IFJldHVybiBjb21wbGV0ZSBvYmplY3QgZnJvbSBhcmd1bWVudHMsIG5vdCBmcm9tIHJlc3VsdFxyXG4gICAgLy8gQXBwU3luYyBzdWJzY3JpcHRpb25zIG5lZWQgdGhlIGZ1bGwgb2JqZWN0IHRvIHRyaWdnZXIgcHJvcGVybHlcclxuICAgIGFwaS5jcmVhdGVSZXNvbHZlcignUHVibGlzaFJvb21NYXRjaFJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAncHVibGlzaFJvb21NYXRjaCcsXHJcbiAgICAgIGRhdGFTb3VyY2U6IGFwaS5hZGROb25lRGF0YVNvdXJjZSgnTm9uZURhdGFTb3VyY2UnKSxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJyb29tSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMucm9vbUlkXCIsXHJcbiAgICAgICAgICAgIFwibWF0Y2hJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hJZFwiLFxyXG4gICAgICAgICAgICBcIm1vdmllSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1vdmllSWRcIixcclxuICAgICAgICAgICAgXCJtb3ZpZVRpdGxlXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tb3ZpZVRpdGxlXCIsXHJcbiAgICAgICAgICAgIFwicG9zdGVyUGF0aFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEucG9zdGVyUGF0aFwiLFxyXG4gICAgICAgICAgICBcIm1hdGNoZWRVc2Vyc1wiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaGVkVXNlcnMpLFxyXG4gICAgICAgICAgICBcInRpbWVzdGFtcFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEudGltZXN0YW1wXCIsXHJcbiAgICAgICAgICAgIFwibWF0Y2hEZXRhaWxzXCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoRGV0YWlscylcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgIyMgQ1JJVElDQUw6IFJldHVybiB0aGUgY29tcGxldGUgb2JqZWN0IGZyb20gdGhlIHJlcXVlc3QgYXJndW1lbnRzXHJcbiAgICAgICAgIyMgVGhpcyBpcyB3aGF0IHRyaWdnZXJzIHRoZSBzdWJzY3JpcHRpb24gd2l0aCB0aGUgZnVsbCBkYXRhXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJyb29tSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMucm9vbUlkXCIsXHJcbiAgICAgICAgICBcIm1hdGNoSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoSWRcIixcclxuICAgICAgICAgIFwibW92aWVJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubW92aWVJZFwiLFxyXG4gICAgICAgICAgXCJtb3ZpZVRpdGxlXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tb3ZpZVRpdGxlXCIsXHJcbiAgICAgICAgICBcInBvc3RlclBhdGhcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLnBvc3RlclBhdGhcIixcclxuICAgICAgICAgIFwibWF0Y2hlZFVzZXJzXCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoZWRVc2VycyksXHJcbiAgICAgICAgICBcInRpbWVzdGFtcFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEudGltZXN0YW1wXCIsXHJcbiAgICAgICAgICBcIm1hdGNoRGV0YWlsc1wiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaERldGFpbHMpXHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGFwaS5jcmVhdGVSZXNvbHZlcignUHVibGlzaFVzZXJNYXRjaFJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAncHVibGlzaFVzZXJNYXRjaCcsXHJcbiAgICAgIGRhdGFTb3VyY2U6IGFwaS5hZGROb25lRGF0YVNvdXJjZSgnTm9uZURhdGFTb3VyY2UyJyksXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnVzZXJJZFwiLFxyXG4gICAgICAgICAgICBcInJvb21JZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEucm9vbUlkXCIsXHJcbiAgICAgICAgICAgIFwibWF0Y2hJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hJZFwiLFxyXG4gICAgICAgICAgICBcIm1vdmllSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1vdmllSWRcIixcclxuICAgICAgICAgICAgXCJtb3ZpZVRpdGxlXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tb3ZpZVRpdGxlXCIsXHJcbiAgICAgICAgICAgIFwicG9zdGVyUGF0aFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEucG9zdGVyUGF0aFwiLFxyXG4gICAgICAgICAgICBcIm1hdGNoZWRVc2Vyc1wiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaGVkVXNlcnMpLFxyXG4gICAgICAgICAgICBcInRpbWVzdGFtcFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEudGltZXN0YW1wXCIsXHJcbiAgICAgICAgICAgIFwibWF0Y2hEZXRhaWxzXCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoRGV0YWlscylcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgIyMgQ1JJVElDQUw6IFJldHVybiB0aGUgY29tcGxldGUgb2JqZWN0IGZyb20gdGhlIHJlcXVlc3QgYXJndW1lbnRzXHJcbiAgICAgICAgIyMgVGhpcyBpcyB3aGF0IHRyaWdnZXJzIHRoZSBzdWJzY3JpcHRpb24gd2l0aCB0aGUgZnVsbCBkYXRhXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMudXNlcklkXCIsXHJcbiAgICAgICAgICBcInJvb21JZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEucm9vbUlkXCIsXHJcbiAgICAgICAgICBcIm1hdGNoSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoSWRcIixcclxuICAgICAgICAgIFwibW92aWVJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubW92aWVJZFwiLFxyXG4gICAgICAgICAgXCJtb3ZpZVRpdGxlXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tb3ZpZVRpdGxlXCIsXHJcbiAgICAgICAgICBcInBvc3RlclBhdGhcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLnBvc3RlclBhdGhcIixcclxuICAgICAgICAgIFwibWF0Y2hlZFVzZXJzXCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoZWRVc2VycyksXHJcbiAgICAgICAgICBcInRpbWVzdGFtcFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEudGltZXN0YW1wXCIsXHJcbiAgICAgICAgICBcIm1hdGNoRGV0YWlsc1wiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaERldGFpbHMpXHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE91dHB1dHNcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHcmFwaFFMRW5kcG9pbnQnLCB7XHJcbiAgICAgIHZhbHVlOiBhcGkuZ3JhcGhxbFVybCxcclxuICAgICAgZGVzY3JpcHRpb246ICdHcmFwaFFMIEFQSSBFbmRwb2ludCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR3JhcGhRTEFwaUtleScsIHtcclxuICAgICAgdmFsdWU6IGFwaS5hcGlLZXkgfHwgJ04vQScsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnR3JhcGhRTCBBUEkgS2V5JyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbElkJywge1xyXG4gICAgICB2YWx1ZTogdXNlclBvb2wudXNlclBvb2xJZCxcclxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBJRCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xDbGllbnRJZCcsIHtcclxuICAgICAgdmFsdWU6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQ2xpZW50IElEJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdJZGVudGl0eVBvb2xJZCcsIHtcclxuICAgICAgdmFsdWU6IGlkZW50aXR5UG9vbC5yZWYsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBJZGVudGl0eSBQb29sIElEJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZWdpb24nLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnJlZ2lvbixcclxuICAgICAgZGVzY3JpcHRpb246ICdBV1MgUmVnaW9uJyxcclxuICAgIH0pO1xyXG4gIH1cclxufSJdfQ==