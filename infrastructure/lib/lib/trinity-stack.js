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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJpbml0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3RyaW5pdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLCtEQUFpRDtBQUNqRCxtRUFBcUQ7QUFDckQsaUVBQW1EO0FBQ25ELGlFQUFtRDtBQUNuRCx5REFBMkM7QUFFM0MsMkNBQTZCO0FBRzdCLE1BQWEsWUFBYSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3pDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsa0JBQWtCO1FBQ2xCLE1BQU0sVUFBVSxHQUFHLElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ3hELFNBQVMsRUFBRSxlQUFlO1lBQzFCLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFO1lBQ2pFLFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsbUJBQW1CLEVBQUUsS0FBSztZQUMxQixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQ3pDLENBQUMsQ0FBQztRQUVILGtEQUFrRDtRQUNsRCxVQUFVLENBQUMsdUJBQXVCLENBQUM7WUFDakMsU0FBUyxFQUFFLFlBQVk7WUFDdkIsWUFBWSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUU7U0FDcEUsQ0FBQyxDQUFDO1FBRUgsTUFBTSxVQUFVLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDeEQsU0FBUyxF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O1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxNQUFNLElBQUksS0FBSztZQUMxQixXQUFXLEVBQUUsaUJBQWlCO1NBQy9CLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ3BDLEtBQUssRUFBRSxRQUFRLENBQUMsVUFBVTtZQUMxQixXQUFXLEVBQUUsc0JBQXNCO1NBQ3BDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDMUMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxnQkFBZ0I7WUFDdEMsV0FBVyxFQUFFLDZCQUE2QjtTQUMzQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRTtZQUNoQyxLQUFLLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDbEIsV0FBVyxFQUFFLFlBQVk7U0FDMUIsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBM1hELG9DQTJYQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcclxuaW1wb3J0ICogYXMgYXBwc3luYyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBwc3luYyc7XHJcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XHJcblxyXG5leHBvcnQgY2xhc3MgVHJpbml0eVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcclxuXHJcbiAgICAvLyBEeW5hbW9EQiBUYWJsZXNcclxuICAgIGNvbnN0IHJvb21zVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1Jvb21zVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ3RyaW5pdHktcm9vbXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgR1NJIGZvciByb29tIGNvZGUgbG9va3VwIChmaXJzdCBkZXBsb3ltZW50KVxyXG4gICAgcm9vbXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ2NvZGUtaW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2NvZGUnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgdm90ZXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVm90ZXNUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAndHJpbml0eS12b3RlcycsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAncm9vbUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAndXNlck1vdmllSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgbWF0Y2hlc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdNYXRjaGVzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ3RyaW5pdHktbWF0Y2hlcycsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAncm9vbUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgc29ydEtleTogeyBuYW1lOiAnbW92aWVJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBVc2VybmFtZSBtYXBwaW5nIHRhYmxlIC0gbWFwcyB1c2VybmFtZSB0byBlbWFpbCBmb3IgbG9naW5cclxuICAgIGNvbnN0IHVzZXJuYW1lc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdVc2VybmFtZXNUYWJsZScsIHtcclxuICAgICAgdGFibGVOYW1lOiAndHJpbml0eS11c2VybmFtZXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VzZXJuYW1lJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBUcmlnZ2VyIGZvciBDb2duaXRvIC0gQXV0by1jb25maXJtIHVzZXJzIGFuZCBzdG9yZSB1c2VybmFtZSBtYXBwaW5nXHJcbiAgICBjb25zdCBwcmVTaWduVXBUcmlnZ2VyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnUHJlU2lnblVwVHJpZ2dlcicsIHtcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXHJcbiAgICAgIGhhbmRsZXI6ICdwcmUtc2lnbnVwLmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9jb2duaXRvLXRyaWdnZXJzJykpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygxMCksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXV0by1jb25maXJtcyB1c2VycyBvbiBzaWduLXVwIGFuZCBzdG9yZXMgdXNlcm5hbWUgbWFwcGluZycsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgVVNFUk5BTUVTX1RBQkxFOiB1c2VybmFtZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byB3cml0ZSB0byB1c2VybmFtZXMgdGFibGVcclxuICAgIHVzZXJuYW1lc1RhYmxlLmdyYW50UmVhZERhdGEocHJlU2lnblVwVHJpZ2dlcik7XHJcblxyXG4gICAgLy8gTGFtYmRhIFRyaWdnZXIgZm9yIENvZ25pdG8gLSBQb3N0IENvbmZpcm1hdGlvbiAoc3RvcmVzIHVzZXJuYW1lIG1hcHBpbmcpXHJcbiAgICBjb25zdCBwb3N0Q29uZmlybWF0aW9uVHJpZ2dlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1Bvc3RDb25maXJtYXRpb25UcmlnZ2VyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ3Bvc3QtY29uZmlybWF0aW9uLmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9jb2duaXRvLXRyaWdnZXJzJykpLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygxMCksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnU3RvcmVzIHVzZXJuYW1lIG1hcHBpbmcgYWZ0ZXIgc3VjY2Vzc2Z1bCB1c2VyIGNyZWF0aW9uJyxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBVU0VSTkFNRVNfVEFCTEU6IHVzZXJuYW1lc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIHdyaXRlIHRvIHVzZXJuYW1lcyB0YWJsZVxyXG4gICAgdXNlcm5hbWVzVGFibGUuZ3JhbnRXcml0ZURhdGEocG9zdENvbmZpcm1hdGlvblRyaWdnZXIpO1xyXG5cclxuICAgIC8vIENvZ25pdG8gVXNlciBQb29sXHJcbiAgICBjb25zdCB1c2VyUG9vbCA9IG5ldyBjb2duaXRvLlVzZXJQb29sKHRoaXMsICdUcmluaXR5VXNlclBvb2wnLCB7XHJcbiAgICAgIHVzZXJQb29sTmFtZTogJ3RyaW5pdHktdXNlcnMnLFxyXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgc2lnbkluQWxpYXNlczoge1xyXG4gICAgICAgIGVtYWlsOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgICBhdXRvVmVyaWZ5OiB7XHJcbiAgICAgICAgZW1haWw6IGZhbHNlLCAvLyBEaXNhYmxlZCAtIHVzaW5nIExhbWJkYSB0cmlnZ2VyIGZvciBhdXRvLWNvbmZpcm1hdGlvblxyXG4gICAgICB9LFxyXG4gICAgICBwYXNzd29yZFBvbGljeToge1xyXG4gICAgICAgIG1pbkxlbmd0aDogOCxcclxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxyXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXHJcbiAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZSxcclxuICAgICAgICByZXF1aXJlU3ltYm9sczogZmFsc2UsXHJcbiAgICAgIH0sXHJcbiAgICAgIGxhbWJkYVRyaWdnZXJzOiB7XHJcbiAgICAgICAgcHJlU2lnblVwOiBwcmVTaWduVXBUcmlnZ2VyLFxyXG4gICAgICAgIHBvc3RDb25maXJtYXRpb246IHBvc3RDb25maXJtYXRpb25UcmlnZ2VyLFxyXG4gICAgICB9LFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnVHJpbml0eVVzZXJQb29sQ2xpZW50Jywge1xyXG4gICAgICB1c2VyUG9vbCxcclxuICAgICAgdXNlclBvb2xDbGllbnROYW1lOiAndHJpbml0eS1jbGllbnQnLFxyXG4gICAgICBnZW5lcmF0ZVNlY3JldDogZmFsc2UsXHJcbiAgICAgIGF1dGhGbG93czoge1xyXG4gICAgICAgIHVzZXJQYXNzd29yZDogdHJ1ZSxcclxuICAgICAgICB1c2VyU3JwOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhcGhRTCBBUElcclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcHBzeW5jLkdyYXBocWxBcGkodGhpcywgJ1RyaW5pdHlBcGknLCB7XHJcbiAgICAgIG5hbWU6ICd0cmluaXR5LWFwaScsXHJcbiAgICAgIGRlZmluaXRpb246IGFwcHN5bmMuRGVmaW5pdGlvbi5mcm9tRmlsZShwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc2NoZW1hLmdyYXBocWwnKSksXHJcbiAgICAgIGF1dGhvcml6YXRpb25Db25maWc6IHtcclxuICAgICAgICBkZWZhdWx0QXV0aG9yaXphdGlvbjoge1xyXG4gICAgICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwcHN5bmMuQXV0aG9yaXphdGlvblR5cGUuVVNFUl9QT09MLFxyXG4gICAgICAgICAgdXNlclBvb2xDb25maWc6IHtcclxuICAgICAgICAgICAgdXNlclBvb2wsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYWRkaXRpb25hbEF1dGhvcml6YXRpb25Nb2RlczogW1xyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5JQU0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBwc3luYy5BdXRob3JpemF0aW9uVHlwZS5BUElfS0VZLFxyXG4gICAgICAgICAgICBhcGlLZXlDb25maWc6IHtcclxuICAgICAgICAgICAgICBleHBpcmVzOiBjZGsuRXhwaXJhdGlvbi5hZnRlcihjZGsuRHVyYXRpb24uZGF5cygzNjUpKSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgICAgbG9nQ29uZmlnOiB7XHJcbiAgICAgICAgZmllbGRMb2dMZXZlbDogYXBwc3luYy5GaWVsZExvZ0xldmVsLkFMTCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIExhbWJkYSBGdW5jdGlvbnNcclxuICAgIGNvbnN0IHRtZGJIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVG1kYkhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3RtZGInKSksXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgVE1EQl9BUElfS0VZOiBwcm9jZXNzLmVudi5UTURCX0FQSV9LRVkgfHwgJ2RjNGRiY2QyNDA0YzFjYTg1MmY4ZWI5NjRhZGQyNjdkJywgLy8gRmFsbGJhY2sgaGFyZGNvZGVkXHJcbiAgICAgICAgVE1EQl9SRUFEX1RPS0VOOiBwcm9jZXNzLmVudi5UTURCX1JFQURfVE9LRU4gfHwgJ2V5SmhiR2NpT2lKSVV6STFOaUo5LmV5SmhkV1FpT2lKa1l6UmtZbU5rTWpRd05HTXhZMkU0TlRKbU9HVmlPVFkwWVdSa01qWTNaQ0lzSW01aVppSTZNVGMyTmpBd01UQXdNaTQwTURrNU9UazRMQ0p6ZFdJaU9pSTJPVFF6TURrMllUUmpNR014Wm1VelpEWTNPV0ZqWW1VaUxDSnpZMjl3WlhNaU9sc2lZWEJwWDNKbFlXUWlYU3dpZG1WeWMybHZiaUk2TVgwLnFLMTU1YzhvWEItX09VZlljTmVkd2M3RnNiZzh3N1k0ZDk5b2lrYjNTUDgnLFxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCByb29tSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1Jvb21IYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9yb29tJykpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFJPT01TX1RBQkxFOiByb29tc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBWT1RFU19UQUJMRTogdm90ZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgTUFUQ0hFU19UQUJMRTogbWF0Y2hlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBUTURCX0xBTUJEQV9BUk46IHRtZGJIYW5kbGVyLmZ1bmN0aW9uQXJuLFxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB2b3RlSGFuZGxlciA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1ZvdGVIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy92b3RlJykpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFZPVEVTX1RBQkxFOiB2b3Rlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBNQVRDSEVTX1RBQkxFOiBtYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFJPT01TX1RBQkxFOiByb29tc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBHUkFQSFFMX0VORFBPSU5UOiBhcGkuZ3JhcGhxbFVybCxcclxuICAgICAgfSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgbWF0Y2hIYW5kbGVyID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWF0Y2hIYW5kbGVyJywge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9tYXRjaCcpKSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBNQVRDSEVTX1RBQkxFOiBtYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEdSQVBIUUxfRU5EUE9JTlQ6IGFwaS5ncmFwaHFsVXJsLFxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB1c2VybmFtZUhhbmRsZXIgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdVc2VybmFtZUhhbmRsZXInLCB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3VzZXJuYW1lJykpLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIFVTRVJOQU1FU19UQUJMRTogdXNlcm5hbWVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFJPT01TX1RBQkxFOiByb29tc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBWT1RFU19UQUJMRTogdm90ZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgTUFUQ0hFU19UQUJMRTogbWF0Y2hlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBVU0VSX1BPT0xfSUQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXHJcbiAgICAgIH0sXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zXHJcbiAgICByb29tc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShyb29tSGFuZGxlcik7XHJcbiAgICB2b3Rlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShyb29tSGFuZGxlcik7XHJcbiAgICBtYXRjaGVzVGFibGUuZ3JhbnRSZWFkRGF0YShyb29tSGFuZGxlcik7XHJcbiAgICB2b3Rlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh2b3RlSGFuZGxlcik7XHJcbiAgICBtYXRjaGVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHZvdGVIYW5kbGVyKTtcclxuICAgIG1hdGNoZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEobWF0Y2hIYW5kbGVyKTtcclxuICAgIHJvb21zVGFibGUuZ3JhbnRSZWFkRGF0YSh2b3RlSGFuZGxlcik7XHJcbiAgICB1c2VybmFtZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodXNlcm5hbWVIYW5kbGVyKTtcclxuICAgIHJvb21zVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHVzZXJuYW1lSGFuZGxlcik7XHJcbiAgICB2b3Rlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh1c2VybmFtZUhhbmRsZXIpO1xyXG4gICAgbWF0Y2hlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh1c2VybmFtZUhhbmRsZXIpO1xyXG5cclxuICAgIC8vIEdyYW50IENvZ25pdG8gcGVybWlzc2lvbnMgdG8gdXNlcm5hbWUgaGFuZGxlclxyXG4gICAgdXNlcm5hbWVIYW5kbGVyLmFkZFRvUm9sZVBvbGljeShcclxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgIGFjdGlvbnM6IFtcclxuICAgICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkRlbGV0ZVVzZXInLFxyXG4gICAgICAgICAgJ2NvZ25pdG8taWRwOkFkbWluR2V0VXNlcicsXHJcbiAgICAgICAgXSxcclxuICAgICAgICByZXNvdXJjZXM6IFt1c2VyUG9vbC51c2VyUG9vbEFybl0sXHJcbiAgICAgIH0pXHJcbiAgICApO1xyXG5cclxuICAgIHRtZGJIYW5kbGVyLmdyYW50SW52b2tlKHJvb21IYW5kbGVyKTtcclxuXHJcbiAgICAvLyBHcmFudCBBcHBTeW5jIHBlcm1pc3Npb25zIHRvIExhbWJkYSBmdW5jdGlvbnNcclxuICAgIGFwaS5ncmFudE11dGF0aW9uKHZvdGVIYW5kbGVyLCAncHVibGlzaFJvb21NYXRjaCcpO1xyXG4gICAgYXBpLmdyYW50TXV0YXRpb24odm90ZUhhbmRsZXIsICdwdWJsaXNoVXNlck1hdGNoJyk7XHJcbiAgICBhcGkuZ3JhbnRNdXRhdGlvbihtYXRjaEhhbmRsZXIsICdwdWJsaXNoUm9vbU1hdGNoJyk7XHJcbiAgICBhcGkuZ3JhbnRNdXRhdGlvbihtYXRjaEhhbmRsZXIsICdwdWJsaXNoVXNlck1hdGNoJyk7XHJcblxyXG4gICAgLy8gRGF0YSBTb3VyY2VzXHJcbiAgICBjb25zdCB0bWRiRGF0YVNvdXJjZSA9IGFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdUbWRiRGF0YVNvdXJjZScsIHRtZGJIYW5kbGVyKTtcclxuICAgIGNvbnN0IHJvb21EYXRhU291cmNlID0gYXBpLmFkZExhbWJkYURhdGFTb3VyY2UoJ1Jvb21EYXRhU291cmNlJywgcm9vbUhhbmRsZXIpO1xyXG4gICAgY29uc3Qgdm90ZURhdGFTb3VyY2UgPSBhcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnVm90ZURhdGFTb3VyY2UnLCB2b3RlSGFuZGxlcik7XHJcbiAgICBjb25zdCBtYXRjaERhdGFTb3VyY2UgPSBhcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnTWF0Y2hEYXRhU291cmNlJywgbWF0Y2hIYW5kbGVyKTtcclxuICAgIGNvbnN0IHVzZXJuYW1lRGF0YVNvdXJjZSA9IGFwaS5hZGRMYW1iZGFEYXRhU291cmNlKCdVc2VybmFtZURhdGFTb3VyY2UnLCB1c2VybmFtZUhhbmRsZXIpO1xyXG5cclxuICAgIC8vIFJlc29sdmVyc1xyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0NyZWF0ZVJvb21SZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2NyZWF0ZVJvb20nLFxyXG4gICAgfSk7XHJcblxyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0pvaW5Sb29tUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdqb2luUm9vbScsXHJcbiAgICB9KTtcclxuXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0Um9vbVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0Um9vbScsXHJcbiAgICB9KTtcclxuXHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0TXlSb29tc1Jlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0TXlSb29tcycsXHJcbiAgICB9KTtcclxuXHJcbiAgICB2b3RlRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignVm90ZVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAndm90ZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBtYXRjaERhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldE15TWF0Y2hlc1Jlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0TXlNYXRjaGVzJyxcclxuICAgIH0pO1xyXG5cclxuICAgIHVzZXJuYW1lRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0VXNlcm5hbWVFbWFpbFJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0VXNlcm5hbWVFbWFpbCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICB1c2VybmFtZURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0RlbGV0ZVVzZXJBY2NvdW50UmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdkZWxldGVVc2VyQWNjb3VudCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTdWJzY3JpcHRpb24gcmVzb2x2ZXJzIChuby1vcCByZXNvbHZlcnMgZm9yIHRyaWdnZXJpbmcgc3Vic2NyaXB0aW9ucylcclxuICAgIC8vIENSSVRJQ0FMIEZJWDogUmV0dXJuIGNvbXBsZXRlIG9iamVjdCBmcm9tIGFyZ3VtZW50cywgbm90IGZyb20gcmVzdWx0XHJcbiAgICAvLyBBcHBTeW5jIHN1YnNjcmlwdGlvbnMgbmVlZCB0aGUgZnVsbCBvYmplY3QgdG8gdHJpZ2dlciBwcm9wZXJseVxyXG4gICAgYXBpLmNyZWF0ZVJlc29sdmVyKCdQdWJsaXNoUm9vbU1hdGNoUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdwdWJsaXNoUm9vbU1hdGNoJyxcclxuICAgICAgZGF0YVNvdXJjZTogYXBpLmFkZE5vbmVEYXRhU291cmNlKCdOb25lRGF0YVNvdXJjZScpLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcInJvb21JZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5yb29tSWRcIixcclxuICAgICAgICAgICAgXCJtYXRjaElkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaElkXCIsXHJcbiAgICAgICAgICAgIFwibW92aWVJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubW92aWVJZFwiLFxyXG4gICAgICAgICAgICBcIm1vdmllVGl0bGVcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1vdmllVGl0bGVcIixcclxuICAgICAgICAgICAgXCJwb3N0ZXJQYXRoXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5wb3N0ZXJQYXRoXCIsXHJcbiAgICAgICAgICAgIFwibWF0Y2hlZFVzZXJzXCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoZWRVc2VycyksXHJcbiAgICAgICAgICAgIFwidGltZXN0YW1wXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS50aW1lc3RhbXBcIixcclxuICAgICAgICAgICAgXCJtYXRjaERldGFpbHNcIjogJHV0aWwudG9Kc29uKCRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hEZXRhaWxzKVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjIyBDUklUSUNBTDogUmV0dXJuIHRoZSBjb21wbGV0ZSBvYmplY3QgZnJvbSB0aGUgcmVxdWVzdCBhcmd1bWVudHNcclxuICAgICAgICAjIyBUaGlzIGlzIHdoYXQgdHJpZ2dlcnMgdGhlIHN1YnNjcmlwdGlvbiB3aXRoIHRoZSBmdWxsIGRhdGFcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInJvb21JZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5yb29tSWRcIixcclxuICAgICAgICAgIFwibWF0Y2hJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hJZFwiLFxyXG4gICAgICAgICAgXCJtb3ZpZUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tb3ZpZUlkXCIsXHJcbiAgICAgICAgICBcIm1vdmllVGl0bGVcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1vdmllVGl0bGVcIixcclxuICAgICAgICAgIFwicG9zdGVyUGF0aFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEucG9zdGVyUGF0aFwiLFxyXG4gICAgICAgICAgXCJtYXRjaGVkVXNlcnNcIjogJHV0aWwudG9Kc29uKCRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hlZFVzZXJzKSxcclxuICAgICAgICAgIFwidGltZXN0YW1wXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS50aW1lc3RhbXBcIixcclxuICAgICAgICAgIFwibWF0Y2hEZXRhaWxzXCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoRGV0YWlscylcclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgYXBpLmNyZWF0ZVJlc29sdmVyKCdQdWJsaXNoVXNlck1hdGNoUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdwdWJsaXNoVXNlck1hdGNoJyxcclxuICAgICAgZGF0YVNvdXJjZTogYXBpLmFkZE5vbmVEYXRhU291cmNlKCdOb25lRGF0YVNvdXJjZTInKSxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5hcmd1bWVudHMudXNlcklkXCIsXHJcbiAgICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5yb29tSWRcIixcclxuICAgICAgICAgICAgXCJtYXRjaElkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tYXRjaElkXCIsXHJcbiAgICAgICAgICAgIFwibW92aWVJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubW92aWVJZFwiLFxyXG4gICAgICAgICAgICBcIm1vdmllVGl0bGVcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1vdmllVGl0bGVcIixcclxuICAgICAgICAgICAgXCJwb3N0ZXJQYXRoXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5wb3N0ZXJQYXRoXCIsXHJcbiAgICAgICAgICAgIFwibWF0Y2hlZFVzZXJzXCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoZWRVc2VycyksXHJcbiAgICAgICAgICAgIFwidGltZXN0YW1wXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS50aW1lc3RhbXBcIixcclxuICAgICAgICAgICAgXCJtYXRjaERldGFpbHNcIjogJHV0aWwudG9Kc29uKCRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hEZXRhaWxzKVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjIyBDUklUSUNBTDogUmV0dXJuIHRoZSBjb21wbGV0ZSBvYmplY3QgZnJvbSB0aGUgcmVxdWVzdCBhcmd1bWVudHNcclxuICAgICAgICAjIyBUaGlzIGlzIHdoYXQgdHJpZ2dlcnMgdGhlIHN1YnNjcmlwdGlvbiB3aXRoIHRoZSBmdWxsIGRhdGFcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy51c2VySWRcIixcclxuICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5yb29tSWRcIixcclxuICAgICAgICAgIFwibWF0Y2hJZFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hJZFwiLFxyXG4gICAgICAgICAgXCJtb3ZpZUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS5tb3ZpZUlkXCIsXHJcbiAgICAgICAgICBcIm1vdmllVGl0bGVcIjogXCIkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1vdmllVGl0bGVcIixcclxuICAgICAgICAgIFwicG9zdGVyUGF0aFwiOiBcIiRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEucG9zdGVyUGF0aFwiLFxyXG4gICAgICAgICAgXCJtYXRjaGVkVXNlcnNcIjogJHV0aWwudG9Kc29uKCRjb250ZXh0LmFyZ3VtZW50cy5tYXRjaERhdGEubWF0Y2hlZFVzZXJzKSxcclxuICAgICAgICAgIFwidGltZXN0YW1wXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLm1hdGNoRGF0YS50aW1lc3RhbXBcIixcclxuICAgICAgICAgIFwibWF0Y2hEZXRhaWxzXCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMubWF0Y2hEYXRhLm1hdGNoRGV0YWlscylcclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0c1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dyYXBoUUxFbmRwb2ludCcsIHtcclxuICAgICAgdmFsdWU6IGFwaS5ncmFwaHFsVXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0dyYXBoUUwgQVBJIEVuZHBvaW50JyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHcmFwaFFMQXBpS2V5Jywge1xyXG4gICAgICB2YWx1ZTogYXBpLmFwaUtleSB8fCAnTi9BJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdHcmFwaFFMIEFQSSBLZXknLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7XHJcbiAgICAgIHZhbHVlOiB1c2VyUG9vbC51c2VyUG9vbElkLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIElEJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbENsaWVudElkJywge1xyXG4gICAgICB2YWx1ZTogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcclxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBDbGllbnQgSUQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1JlZ2lvbicsIHtcclxuICAgICAgdmFsdWU6IHRoaXMucmVnaW9uLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FXUyBSZWdpb24nLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19