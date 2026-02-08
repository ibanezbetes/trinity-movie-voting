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
        new cdk.CfnOutput(this, 'Region', {
            value: this.region,
            description: 'AWS Region',
        });
    }
}
exports.TrinityStack = TrinityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJpbml0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3RyaW5pdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLCtEQUFpRDtBQUNqRCxtRUFBcUQ7QUFDckQsaUVBQW1EO0FBQ25ELGlFQUFtRDtBQUNuRCx5REFBMkM7QUFFM0MsMkNBQTZCO0FBRzdCLE1BQWEsWUFBYSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3pDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsa0JBQWtCO1FBQ2xCLE1BQU0sVUFBVSxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ3hELFNBQVMsRUFBRSxlQUFlO1lBQzFCLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQ2pFLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsbUJBQW1CLEVBQUUsS0FBSztZQUMxQixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQ3pDLENBQUMsQ0FBQztRQUVILGtEQUFrRDtRQUNsRCxVQUFVLENBQUMsdUJBQXVCLENBQUM7WUFDakMsU0FBUyxFQUFFLFlBQVk7WUFDdkIsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7U0FDcEUsQ0FBQyxDQUFDO1FBRUgsTUFBTSxVQUFVLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDeEQsU0FBUyxF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U0FDSCxDQUFDLENBQUM7UUFFSCxVQUFVO1FBQ1YsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN6QyxLQUFLLEVBQUUsR0FBRyxDQUFDLFVBQVU7WUFDckIsV0FBVyxFQUFFLHNCQUFzQjtTQUNwQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUN2QyxLQUFLLEVBQUUsR0FBRyxDQUFDLE1BQU0sSUFBSSxLQUFLO1lBQzFCLFdBQVcsRUFBRSxpQkFBaUI7U0FDL0IsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDcEMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxVQUFVO1lBQzFCLFdBQVcsRUFBRSxzQkFBc0I7U0FDcEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsY0FBYyxDQUFDLGdCQUFnQjtZQUN0QyxXQUFXLEVBQUUsNkJBQTZCO1NBQzNDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFO1lBQ2hDLEtBQUssRUFBRSxJQUFJLENBQUMsTUFBTTtZQUNsQixXQUFXLEVBQUUsWUFBWTtTQUMxQixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUExWkQsb0NBMFpDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xyXG5pbXBvcnQgKiBhcyBhcHBzeW5jIGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcHBzeW5jJztcclxuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcclxuXHJcbmV4cG9ydCBjbGFzcyBUcmluaXR5U3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xyXG5cclxuICAgIC8vIER5bmFtb0RCIFRhYmxlc1xyXG4gICAgY29uc3Qgcm9vbXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnUm9vbXNUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAndHJpbml0eS1yb29tcycsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnaWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBHU0kgZm9yIHJvb20gY29kZSBsb29rdXAgKGZpcnN0IGRlcGxveW1lbnQpXHJcbiAgICByb29tc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnY29kZS1pbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnY29kZScsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB2b3Rlc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdWb3Rlc1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICd0cmluaXR5LXZvdGVzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdyb29tSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICd1c2VyTW92aWVJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBtYXRjaGVzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ01hdGNoZXNUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAndHJpbml0eS1tYXRjaGVzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdyb29tSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdtb3ZpZUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5OVU1CRVIgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFVzZXJuYW1lIG1hcHBpbmcgdGFibGUgLSBtYXBzIHVzZXJuYW1lIHRvIGVtYWlsIGZvciBsb2dpblxyXG4gICAgY29uc3QgdXNlcm5hbWVzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1VzZXJuYW1lc1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICd0cmluaXR5LXVzZXJuYW1lcycsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAndXNlcm5hbWUnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUmVjb21tZW5kYXRpb25zIHRhYmxlIC0gc3RvcmVzIHNvY2lhbC9zdXN0YWluYWJsZSBtb3ZpZSByZWNvbW1lbmRhdGlvbnNcclxuICAgIGNvbnN0IHJlY29tbWVuZGF0aW9uc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdSZWNvbW1lbmRhdGlvbnNUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAndHJpbml0eS1yZWNvbW1lbmRhdGlvbnMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2NhdGVnb3J5SWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdtb3ZpZUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5OVU1CRVIgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLCAvLyBLZWVwIGRhdGEgb24gc3RhY2sgZGVsZXRpb25cclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBUcmlnZ2VyIGZvciBDb2duaXRvIC0gQXV0by1jb25maXJtIHVzZXJzIGFuZCBzdG9yZSB1c2VybmFtZSBtYXBwaW5nXHJcbiAgICBjb25zdCBwcmVTaWduVXBUcmlnZ2VyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnUHJlU2lnblVwVHJpZ2dlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdwcmUtc2lnbnVwLmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9jb2duaXRvLXRyaWdnZXJzJykpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygxMCksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXV0by1jb25maXJtcyB1c2VycyBvbiBzaWduLXVwIGFuZCBzdG9yZXMgdXNlcm5hbWUgbWFwcGluZycsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgVVNFUk5BTUVTX1RBQkxFOiB1c2VybmFtZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byB3cml0ZSB0byB1c2VybmFtZXMgdGFibGVcclxuICAgIHVzZXJuYW1lc1RhYmxlLmdyYW50UmVhZERhdGEocHJlU2lnblVwVHJpZ2dlcik7XHJcblxyXG4gICAgLy8gTGFtYmRhIFRyaWdnZXIgZm9yIENvZ25pdG8gLSBQb3N0IENvbmZpcm1hdGlvbiAoc3RvcmVzIHVzZXJuYW1lIG1hcHBpbmcpXHJcbiAgICBjb25zdCBwb3N0Q29uZmlybWF0aW9uVHJpZ2dlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1Bvc3RDb25maXJtYXRpb25UcmlnZ2VyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ3Bvc3QtY29uZmlybWF0aW9uLmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9jb2duaXRvLXRyaWdnZXJzJykpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygxMCksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3RvcmVzIHVzZXJuYW1lIG1hcHBpbmcgYWZ0ZXIgc3VjY2Vzc2Z1bCB1c2VyIGNyZWF0aW9uJyxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBVU0VSTkFNRVNfVEFCTEU6IHVzZXJuYW1lc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIHdyaXRlIHRvIHVzZXJuYW1lcyB0YWJsZVxyXG4gICAgdXNlcm5hbWVzVGFibGUuZ3JhbnRXcml0ZURhdGEocG9zdENvbmZpcm1hdGlvblRyaWdnZXIpO1xyXG5cclxuICAgIC8vIENvZ25pdG8gVXNlciBQb29sXHJcbiAgICBjb25zdCB1c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsICdUcmluaXR5VXNlclBvb2wnLCB7XHJcbiAgICAgIHVzZXJQb29sTmFtZTogJ3RyaW5pdHktdXNlcnMnLFxyXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgc2lnbkluQWxpYXNlczoge1xyXG4gICAgICAgIGVtYWlsOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgICBhdXRvVmVyaWZ5OiB7XHJcbiAgICAgICAgZW1haWw6IGZhbHNlLCAvLyBEaXNhYmxlZCAtIHVzaW5nIExhbWJkYSB0cmlnZ2VyIGZvciBhdXRvLWNvbmZpcm1hdGlvblxyXG4gICAgICB9LFxyXG4gICAgICBwYXNzd29yZFBvbGljeToge1xyXG4gICAgICAgIG1pbkxlbmd0aDogOCxcclxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxyXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXHJcbiAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZSxcclxuICAgICAgICByZXF1aXJlU3ltYm9sczogZmFsc2UsXHJcbiAgICAgIH0sXHJcbiAgICAgIGxhbWJkYVRyaWdnZXJzOiB7XHJcbiAgICAgICAgcHJlU2lnblVwOiBwcmVTaWduVXBUcmlnZ2VyLFxyXG4gICAgICAgIHBvc3RDb25maXJtYXRpb246IHBvc3RDb25maXJtYXRpb25UcmlnZ2VyLFxyXG4gICAgICB9LFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnVHJpbml0eVVzZXJQb29sQ2xpZW50Jywge1xyXG4gICAgICB1c2VyUG9vbCxcclxuICAgICAgdXNlclBvb2xDbGllbnROYW1lOiAndHJpbml0eS1jbGllbnQnLFxyXG4gICAgICBnZW5lcmF0ZVNlY3JldDogZmFsc2UsXHJcbiAgICAgIGF1dGhGbG93czoge1xyXG4gICAgICAgIHVzZXJQYXNzd29yZDogdHJ1ZSxcclxuICAgICAgICB1c2VyU3JwOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhcGhRTCBBUElcclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcHBzeW5jLkdyYXBocWxBcGkodGhpcywgJ1RyaW5pdHlBcGknLCB7XHJcbiAgICAgIG5hbWU6ICd0cmluaXR5LWFwaScsXHJcbiAgICAgIGRlZmluaXRpb246IGFwcHN5bmMuRGVmaW5pdGlvbi5mcm9tRmlsZShwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc2NoZW1hLmdyYXBocWwnKSksXHJcbiAgICAgIGF1dGhvcml6YXRpb25Db25maWc6IHtcclxuICAgICAgICBkZWZhdWx0QXV0aG9yaXphdGlvbjoge1xyXG4gICAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwcHN5bmMuQXV0aG9yaXphdGlvblR5cGUuVVNFUl9QT09MLFxyXG4gICAgICAgICAgdXNlclBvb2xDb25maWc6IHtcclxuICAgICAgICAgICAgdXNlclBvb2wsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYWRkaXRpb25hbEF1dGhvcml6YXRpb25Nb2RlczogW1xyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5JQU0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5BUElfS0VZLFxyXG4gICAgICAgICAgICBhcGlLZXlDb25maWc6IHtcclxuICAgICAgICAgICAgICBleHBpcmVzOiBjZGsuRXhwaXJhdGlvbi5hZnRlcihjZGsuRHVyYXRpb24uZGF5cygzNjUpKSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgICAgbG9nQ29uZmlnOiB7XHJcbiAgICAgICAgZmllbGRMb2dMZXZlbDogYXBwc3luYy5GaWVsZExvZ0xldmVsLkFMTCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBGdW5jdGlvbnNcclxuICAgIGNvbnN0IHRtZGJIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVG1kYkhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3RtZGInKSksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgVE1EQl9BUElfS0VZOiBwcm9jZXNzLmVudi5UTURCX0FQSV9LRVkgfHwgJ2RjNGRiY2QyNDA0YzFjYTg1MmY4ZWI5NjRhZGQyNjdkJywgLy8gRmFsbGJhY2sgaGFyZGNvZGVkXHJcbiAgICAgICAgVE1EQl9SRUFEX1RPS0VOOiBwcm9jZXNzLmVudi5UTURCX1JFQURfVE9LRU4gfHwgJ2V5SmhiR2NpT2lKSVV6STFOaUo5LmV5SmhkV1FpT2lKa1l6UmtZbU5rTWpRd05HTXhZMkU0TlRKbU9HVmlPVFkwWVdSa01qWTNaQ0lzSW01aVppSTZNVGMyTmpBd01UQXdNaTQwTURrNU9UazRMQ0p6ZFdJaU9pSTJPVFF6TURrMllUUmpNR014Wm1VelpEWTNPV0ZqWW1VaUxDSnpZMjl3WlhNaU9sc2lZWEJwWDNKbFlXUWlYU3dpZG1WeWMybHZiaUk2TVgwLnFLMTU1YzhvWEItX09VZlljTmVkd2M3RnNiZzh3N1k0ZDk5b2lrYjNTUDgnLFxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCByb29tSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1Jvb21IYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9yb29tJykpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFJPT01TX1RBQkxFOiByb29tc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBWT1RFU19UQUJMRTogdm90ZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgTUFUQ0hFU19UQUJMRTogbWF0Y2hlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBUTURCX0xBTUJEQV9BUk46IHRtZGJIYW5kbGVyLmZ1bmN0aW9uQXJuLFxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB2b3RlSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1ZvdGVIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy92b3RlJykpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFZPVEVTX1RBQkxFOiB2b3Rlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBNQVRDSEVTX1RBQkxFOiBtYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFJPT01TX1RBQkxFOiByb29tc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBHUkFQSFFMX0VORFBPSU5UOiBhcGkuZ3JhcGhxbFVybCxcclxuICAgICAgfSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgbWF0Y2hIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWF0Y2hIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9tYXRjaCcpKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBNQVRDSEVTX1RBQkxFOiBtYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEdSQVBIUUxfRU5EUE9JTlQ6IGFwaS5ncmFwaHFsVXJsLFxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB1c2VybmFtZUhhbmRsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdVc2VybmFtZUhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3VzZXJuYW1lJykpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFVTRVJOQU1FU19UQUJMRTogdXNlcm5hbWVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFJPT01TX1RBQkxFOiByb29tc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBWT1RFU19UQUJMRTogdm90ZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgTUFUQ0hFU19UQUJMRTogbWF0Y2hlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBVU0VSX1BPT0xfSUQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXHJcbiAgICAgIH0sXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHJlY29tbWVuZGF0aW9uc0hhbmRsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdSZWNvbW1lbmRhdGlvbnNIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9yZWNvbW1lbmRhdGlvbnMnKSksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgUkVDT01NRU5EQVRJT05TX1RBQkxFOiByZWNvbW1lbmRhdGlvbnNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIH0sXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDEwKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zXHJcbiAgICByb29tc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShyb29tSGFuZGxlcik7XHJcbiAgICB2b3Rlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShyb29tSGFuZGxlcik7XHJcbiAgICBtYXRjaGVzVGFibGUuZ3JhbnRSZWFkRGF0YShyb29tSGFuZGxlcik7XHJcbiAgICB2b3Rlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh2b3RlSGFuZGxlcik7XHJcbiAgICBtYXRjaGVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHZvdGVIYW5kbGVyKTtcclxuICAgIG1hdGNoZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEobWF0Y2hIYW5kbGVyKTtcclxuICAgIHJvb21zVGFibGUuZ3JhbnRSZWFkRGF0YSh2b3RlSGFuZGxlcik7XHJcbiAgICB1c2VybmFtZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodXNlcm5hbWVIYW5kbGVyKTtcclxuICAgIHJvb21zVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHVzZXJuYW1lSGFuZGxlcik7XHJcbiAgICB2b3Rlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh1c2VybmFtZUhhbmRsZXIpO1xyXG4gICAgbWF0Y2hlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh1c2VybmFtZUhhbmRsZXIpO1xyXG4gICAgcmVjb21tZW5kYXRpb25zVGFibGUuZ3JhbnRSZWFkRGF0YShyZWNvbW1lbmRhdGlvbnNIYW5kbGVyKTtcclxuXHJcbiAgICAvLyBHcmFudCBDb2duaXRvIHBlcm1pc3Npb25zIHRvIHVzZXJuYW1lIGhhbmRsZXJcclxuICAgIHVzZXJuYW1lSGFuZGxlci5hZGRUb1JvbGVQb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgICAnY29nbml0by1pZHA6QWRtaW5EZWxldGVVc2VyJyxcclxuICAgICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkdldFVzZXInLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbdXNlclBvb2wudXNlclBvb2xBcm5dLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuXHJcbiAgICB0bWRiSGFuZGxlci5ncmFudEludm9rZShyb29tSGFuZGxlcik7XHJcblxyXG4gICAgLy8gR3JhbnQgQXBwU3luYyBwZXJtaXNzaW9ucyB0byBMYW1iZGEgZnVuY3Rpb25zXHJcbiAgICBhcGkuZ3JhbnRNdXRhdGlvbih2b3RlSGFuZGxlciwgJ3B1Ymxpc2hSb29tTWF0Y2gnKTtcclxuICAgIGFwaS5ncmFudE11dGF0aW9uKHZvdGVIYW5kbGVyLCAncHVibGlzaFVzZXJNYXRjaCcpO1xyXG4gICAgYXBpLmdyYW50TXV0YXRpb24obWF0Y2hIYW5kbGVyLCAncHVibGlzaFJvb21NYXRjaCcpO1xyXG4gICAgYXBpLmdyYW50TXV0YXRpb24obWF0Y2hIYW5kbGVyLCAncHVibGlzaFVzZXJNYXRjaCcpO1xyXG5cclxuICAgIC8vIERhdGEgU291cmNlc1xyXG4gICAgY29uc3QgdG1kYkRhdGFTb3VyY2UgPSBhcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnVG1kYkRhdGFTb3VyY2UnLCB0bWRiSGFuZGxlcik7XHJcbiAgICBjb25zdCByb29tRGF0YVNvdXJjZSA9IGFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdSb29tRGF0YVNvdXJjZScsIHJvb21IYW5kbGVyKTtcclxuICAgIGNvbnN0IHZvdGVEYXRhU291cmNlID0gYXBpLmFkZExhbWJkYURhdGFTb3VyY2UoJ1ZvdGVEYXRhU291cmNlJywgdm90ZUhhbmRsZXIpO1xyXG4gICAgY29uc3QgbWF0Y2hEYXRhU291cmNlID0gYXBpLmFkZExhbWJkYURhdGFTb3VyY2UoJ01hdGNoRGF0YVNvdXJjZScsIG1hdGNoSGFuZGxlcik7XHJcbiAgICBjb25zdCB1c2VybmFtZURhdGFTb3VyY2UgPSBhcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnVXNlcm5hbWVEYXRhU291cmNlJywgdXNlcm5hbWVIYW5kbGVyKTtcclxuICAgIGNvbnN0IHJlY29tbWVuZGF0aW9uc0RhdGFTb3VyY2UgPSBhcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnUmVjb21tZW5kYXRpb25zRGF0YVNvdXJjZScsIHJlY29tbWVuZGF0aW9uc0hhbmRsZXIpO1xyXG5cclxuICAgIC8vIFJlc29sdmVyc1xyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0NyZWF0ZVJvb21SZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2NyZWF0ZVJvb20nLFxyXG4gICAgfSk7XHJcblxyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0pvaW5Sb29tUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdqb2luUm9vbScsXHJcbiAgICB9KTtcclxuXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0Um9vbVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0Um9vbScsXHJcbiAgICB9KTtcclxuXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0TXlSb29tc1Jlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0TXlSb29tcycsXHJcbiAgICB9KTtcclxuXHJcbiAgICB2b3RlRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignVm90ZVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAndm90ZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBtYXRjaERhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldE15TWF0Y2hlc1Jlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0TXlNYXRjaGVzJyxcclxuICAgIH0pO1xyXG5cclxuICAgIHVzZXJuYW1lRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0VXNlcm5hbWVFbWFpbFJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0VXNlcm5hbWVFbWFpbCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICB1c2VybmFtZURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0RlbGV0ZVVzZXJBY2NvdW50UmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdkZWxldGVVc2VyQWNjb3VudCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICByZWNvbW1lbmRhdGlvbnNEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdHZXRSZWNvbW1lbmRhdGlvbnNSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldFJlY29tbWVuZGF0aW9ucycsXHJcbiAgICB9KTtcclxuXHJcbiAgICByZWNvbW1lbmRhdGlvbnNEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdHZXRSZWNvbW1lbmRhdGlvbnNCeUNhdGVnb3J5UmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdnZXRSZWNvbW1lbmRhdGlvbnNCeUNhdGVnb3J5JyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFN1YnNjcmlwdGlvbiByZXNvbHZlcnMgKG5vLW9wIHJlc29sdmVycyBmb3IgdHJpZ2dlcmluZyBzdWJzY3JpcHRpb25zKVxyXG4gICAgLy8gQ1JJVElDQUwgRklYOiBSZXR1cm4gY29tcGxldGUgb2JqZWN0IGZyb20gYXJndW1lbnRzLCBub3QgZnJvbSByZXN1bHRcclxuICAgIC8vIEFwcFN5bmMgc3Vic2NyaXB0aW9ucyBuZWVkIHRoZSBmdWxsIG9iamVjdCB0byB0cmlnZ2VyIHByb3Blcmx5XHJcbiAgICBhcGkuY3JlYXRlUmVzb2x2ZXIoJ1B1Ymxpc2hSb29tTWF0Y2hSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ3B1Ymxpc2hSb29tTWF0Y2gnLFxyXG4gICAgICBkYXRhU291cmNlOiBhcGkuYWRkTm9uZURhdGFTb3VyY2UoJ05vbmVEYXRhU291cmNlJyksXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnJvb21JZFwiLFxyXG4gICAgICAgICAgICBcIm1hdGNoSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoSWRcIixcclxuICAgICAgICAgICAgXCJtb3ZpZUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tb3ZpZUlkXCIsXHJcbiAgICAgICAgICAgIFwibW92aWVUaXRsZVwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubW92aWVUaXRsZVwiLFxyXG4gICAgICAgICAgICBcInBvc3RlclBhdGhcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLnBvc3RlclBhdGhcIixcclxuICAgICAgICAgICAgXCJtYXRjaGVkVXNlcnNcIjogJHV0aWwudG9Kc29uKCRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hlZFVzZXJzKSxcclxuICAgICAgICAgICAgXCJ0aW1lc3RhbXBcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLnRpbWVzdGFtcFwiLFxyXG4gICAgICAgICAgICBcIm1hdGNoRGV0YWlsc1wiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaERldGFpbHMpXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICMjIENSSVRJQ0FMOiBSZXR1cm4gdGhlIGNvbXBsZXRlIG9iamVjdCBmcm9tIHRoZSByZXF1ZXN0IGFyZ3VtZW50c1xyXG4gICAgICAgICMjIFRoaXMgaXMgd2hhdCB0cmlnZ2VycyB0aGUgc3Vic2NyaXB0aW9uIHdpdGggdGhlIGZ1bGwgZGF0YVxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnJvb21JZFwiLFxyXG4gICAgICAgICAgXCJtYXRjaElkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaElkXCIsXHJcbiAgICAgICAgICBcIm1vdmllSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1vdmllSWRcIixcclxuICAgICAgICAgIFwibW92aWVUaXRsZVwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubW92aWVUaXRsZVwiLFxyXG4gICAgICAgICAgXCJwb3N0ZXJQYXRoXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5wb3N0ZXJQYXRoXCIsXHJcbiAgICAgICAgICBcIm1hdGNoZWRVc2Vyc1wiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaGVkVXNlcnMpLFxyXG4gICAgICAgICAgXCJ0aW1lc3RhbXBcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLnRpbWVzdGFtcFwiLFxyXG4gICAgICAgICAgXCJtYXRjaERldGFpbHNcIjogJHV0aWwudG9Kc29uKCRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hEZXRhaWxzKVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBhcGkuY3JlYXRlUmVzb2x2ZXIoJ1B1Ymxpc2hVc2VyTWF0Y2hSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ3B1Ymxpc2hVc2VyTWF0Y2gnLFxyXG4gICAgICBkYXRhU291cmNlOiBhcGkuYWRkTm9uZURhdGFTb3VyY2UoJ05vbmVEYXRhU291cmNlMicpLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy51c2VySWRcIixcclxuICAgICAgICAgICAgXCJyb29tSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLnJvb21JZFwiLFxyXG4gICAgICAgICAgICBcIm1hdGNoSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoSWRcIixcclxuICAgICAgICAgICAgXCJtb3ZpZUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tb3ZpZUlkXCIsXHJcbiAgICAgICAgICAgIFwibW92aWVUaXRsZVwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubW92aWVUaXRsZVwiLFxyXG4gICAgICAgICAgICBcInBvc3RlclBhdGhcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLnBvc3RlclBhdGhcIixcclxuICAgICAgICAgICAgXCJtYXRjaGVkVXNlcnNcIjogJHV0aWwudG9Kc29uKCRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hlZFVzZXJzKSxcclxuICAgICAgICAgICAgXCJ0aW1lc3RhbXBcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLnRpbWVzdGFtcFwiLFxyXG4gICAgICAgICAgICBcIm1hdGNoRGV0YWlsc1wiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaERldGFpbHMpXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICMjIENSSVRJQ0FMOiBSZXR1cm4gdGhlIGNvbXBsZXRlIG9iamVjdCBmcm9tIHRoZSByZXF1ZXN0IGFyZ3VtZW50c1xyXG4gICAgICAgICMjIFRoaXMgaXMgd2hhdCB0cmlnZ2VycyB0aGUgc3Vic2NyaXB0aW9uIHdpdGggdGhlIGZ1bGwgZGF0YVxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnVzZXJJZFwiLFxyXG4gICAgICAgICAgXCJyb29tSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLnJvb21JZFwiLFxyXG4gICAgICAgICAgXCJtYXRjaElkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaElkXCIsXHJcbiAgICAgICAgICBcIm1vdmllSWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1vdmllSWRcIixcclxuICAgICAgICAgIFwibW92aWVUaXRsZVwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubW92aWVUaXRsZVwiLFxyXG4gICAgICAgICAgXCJwb3N0ZXJQYXRoXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5wb3N0ZXJQYXRoXCIsXHJcbiAgICAgICAgICBcIm1hdGNoZWRVc2Vyc1wiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaGVkVXNlcnMpLFxyXG4gICAgICAgICAgXCJ0aW1lc3RhbXBcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLnRpbWVzdGFtcFwiLFxyXG4gICAgICAgICAgXCJtYXRjaERldGFpbHNcIjogJHV0aWwudG9Kc29uKCRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hEZXRhaWxzKVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBPdXRwdXRzXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR3JhcGhRTEVuZHBvaW50Jywge1xyXG4gICAgICB2YWx1ZTogYXBpLmdyYXBocWxVcmwsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnR3JhcGhRTCBBUEkgRW5kcG9pbnQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dyYXBoUUxBcGlLZXknLCB7XHJcbiAgICAgIHZhbHVlOiBhcGkuYXBpS2V5IHx8ICdOL0EnLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0dyYXBoUUwgQVBJIEtleScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xJZCcsIHtcclxuICAgICAgdmFsdWU6IHVzZXJQb29sLnVzZXJQb29sSWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgSUQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQ2xpZW50SWQnLCB7XHJcbiAgICAgIHZhbHVlOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIENsaWVudCBJRCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVnaW9uJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5yZWdpb24sXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVdTIFJlZ2lvbicsXHJcbiAgICB9KTtcclxuICB9XHJcbn0iXX0=