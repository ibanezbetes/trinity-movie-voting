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
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const cognito = __importStar(require("aws-cdk-lib/aws-cognito"));
const appsync = __importStar(require("aws-cdk-lib/aws-appsync"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const path = __importStar(require("path"));
class TrinityStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Create DynamoDB Tables
        this.createDynamoDBTables();
        // Create Cognito User Pool
        this.createCognitoUserPool();
        // Create AppSync GraphQL API
        this.createAppSyncAPI();
        // Create Lambda Functions
        this.createLambdaFunctions();
        // Create AppSync Resolvers
        this.createResolvers();
        // Output important values
        this.createOutputs();
    }
    createDynamoDBTables() {
        // TrinityRooms Table
        this.roomsTable = new dynamodb.Table(this, 'TrinityRooms', {
            tableName: 'TrinityRooms',
            partitionKey: {
                name: 'id',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For development
            pointInTimeRecovery: true,
            timeToLiveAttribute: 'ttl',
        });
        // Global Secondary Index for room code lookup
        this.roomsTable.addGlobalSecondaryIndex({
            indexName: 'code-index',
            partitionKey: {
                name: 'code',
                type: dynamodb.AttributeType.STRING,
            },
        });
        // Global Secondary Index for host-based room queries
        this.roomsTable.addGlobalSecondaryIndex({
            indexName: 'hostId-createdAt-index',
            partitionKey: {
                name: 'hostId',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'createdAt',
                type: dynamodb.AttributeType.STRING,
            },
        });
        // TrinityVotes Table
        this.votesTable = new dynamodb.Table(this, 'TrinityVotes', {
            tableName: 'TrinityVotes',
            partitionKey: {
                name: 'roomId',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'userMovieId',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
        });
        // Global Secondary Index for user-based vote queries
        this.votesTable.addGlobalSecondaryIndex({
            indexName: 'userId-timestamp-index',
            partitionKey: {
                name: 'userId',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'timestamp',
                type: dynamodb.AttributeType.STRING,
            },
        });
        // TrinityMatches Table
        this.matchesTable = new dynamodb.Table(this, 'TrinityMatches', {
            tableName: 'TrinityMatches',
            partitionKey: {
                name: 'roomId',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'movieId',
                type: dynamodb.AttributeType.NUMBER,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
        });
        // Local Secondary Index for timestamp-based queries
        this.matchesTable.addLocalSecondaryIndex({
            indexName: 'timestamp-index',
            sortKey: {
                name: 'timestamp',
                type: dynamodb.AttributeType.STRING,
            },
        });
        // CRITICAL: Add Global Secondary Index for user-based match queries
        // This allows efficient querying of matches by user ID
        this.matchesTable.addGlobalSecondaryIndex({
            indexName: 'userId-timestamp-index',
            partitionKey: {
                name: 'userId',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'timestamp',
                type: dynamodb.AttributeType.STRING,
            },
        });
        // TrinityUsers Table
        this.usersTable = new dynamodb.Table(this, 'TrinityUsers', {
            tableName: 'TrinityUsers',
            partitionKey: {
                name: 'id',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
        });
    }
    createCognitoUserPool() {
        // Create User Pool
        this.userPool = new cognito.UserPool(this, 'TrinityUserPool', {
            userPoolName: 'trinity-user-pool',
            selfSignUpEnabled: true,
            signInAliases: {
                email: true,
            },
            // Remove email verification requirement
            autoVerify: {
            // email: true, // Commented out to disable email verification
            },
            standardAttributes: {
                email: {
                    required: true,
                    mutable: true,
                },
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: false,
                requireUppercase: false,
                requireDigits: false,
                requireSymbols: false,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            // Add Lambda trigger to auto-confirm users
            lambdaTriggers: {
                preSignUp: new lambda.Function(this, 'PreSignUpTrigger', {
                    runtime: lambda.Runtime.NODEJS_20_X,
                    handler: 'index.handler',
                    code: lambda.Code.fromInline(`
            exports.handler = async (event) => {
              console.log('PreSignUp trigger event:', JSON.stringify(event, null, 2));
              
              // Auto-confirm all users and skip email verification
              event.response.autoConfirmUser = true;
              event.response.autoVerifyEmail = true;
              
              console.log('PreSignUp response:', JSON.stringify(event.response, null, 2));
              return event;
            };
          `),
                    timeout: cdk.Duration.seconds(10),
                }),
            },
        });
        // Create User Pool Client
        this.userPoolClient = new cognito.UserPoolClient(this, 'TrinityUserPoolClient', {
            userPool: this.userPool,
            userPoolClientName: 'trinity-mobile-client',
            generateSecret: false, // Required for mobile apps
            authFlows: {
                userSrp: true,
                userPassword: true,
                adminUserPassword: true, // Add this for admin operations
                custom: false,
            },
            preventUserExistenceErrors: true,
            // Add explicit token validity
            accessTokenValidity: cdk.Duration.hours(1),
            idTokenValidity: cdk.Duration.hours(1),
            refreshTokenValidity: cdk.Duration.days(30),
        });
    }
    createAppSyncAPI() {
        // Create AppSync GraphQL API
        this.api = new appsync.GraphqlApi(this, 'TrinityAPI', {
            name: 'trinity-api',
            definition: appsync.Definition.fromFile(path.join(__dirname, '../schema.graphql')),
            authorizationConfig: {
                defaultAuthorization: {
                    authorizationType: appsync.AuthorizationType.USER_POOL,
                    userPoolConfig: {
                        userPool: this.userPool,
                    },
                },
            },
            logConfig: {
                fieldLogLevel: appsync.FieldLogLevel.ALL,
            },
            xrayEnabled: true,
        });
    }
    createLambdaFunctions() {
        // Common Lambda configuration
        const commonLambdaProps = {
            runtime: lambda.Runtime.NODEJS_20_X,
            timeout: cdk.Duration.seconds(30),
            memorySize: 512,
            environment: {
                TMDB_API_KEY: process.env.TMDB_API_KEY || '',
                TMDB_READ_TOKEN: process.env.TMDB_READ_TOKEN || '',
                TMDB_BASE_URL: process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3',
                ROOMS_TABLE: this.roomsTable.tableName,
                VOTES_TABLE: this.votesTable.tableName,
                MATCHES_TABLE: this.matchesTable.tableName,
                USERS_TABLE: this.usersTable.tableName,
                GRAPHQL_ENDPOINT: '', // Will be set after API creation
            },
        };
        // TMDB Integration Lambda
        this.tmdbLambda = new lambda.Function(this, 'TMDBLambda', {
            ...commonLambdaProps,
            functionName: 'trinity-tmdb-handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/tmdb')),
            handler: 'index.handler',
            description: 'TMDB API integration with Latin script filtering',
        });
        // Room Handler Lambda
        this.roomLambda = new lambda.Function(this, 'RoomLambda', {
            ...commonLambdaProps,
            functionName: 'trinity-room-handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/room')),
            handler: 'index.handler',
            description: 'Room creation and joining logic',
        });
        // Vote Handler Lambda
        this.voteLambda = new lambda.Function(this, 'VoteLambda', {
            ...commonLambdaProps,
            functionName: 'trinity-vote-handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/vote')),
            handler: 'index.handler',
            description: 'Vote processing and match detection',
        });
        // Match Handler Lambda
        this.matchLambda = new lambda.Function(this, 'MatchLambda', {
            ...commonLambdaProps,
            functionName: 'trinity-match-handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/match')),
            handler: 'index.handler',
            description: 'Match creation and history management',
        });
        // Update Lambda environment variables with cross-references
        this.roomLambda.addEnvironment('TMDB_LAMBDA_ARN', this.tmdbLambda.functionArn);
        this.voteLambda.addEnvironment('MATCH_LAMBDA_ARN', this.matchLambda.functionArn);
        // Add GraphQL endpoint to Vote Lambda for subscription notifications
        this.voteLambda.addEnvironment('GRAPHQL_ENDPOINT', this.api.graphqlUrl);
        // Grant DynamoDB permissions
        this.grantDynamoDBPermissions();
        // Grant Lambda invoke permissions
        this.grantLambdaPermissions();
    }
    grantDynamoDBPermissions() {
        // Grant read/write permissions to all tables for all lambdas
        const lambdas = [this.tmdbLambda, this.roomLambda, this.voteLambda, this.matchLambda];
        const tables = [this.roomsTable, this.votesTable, this.matchesTable, this.usersTable];
        lambdas.forEach(lambdaFn => {
            tables.forEach(table => {
                table.grantReadWriteData(lambdaFn);
            });
        });
    }
    grantLambdaPermissions() {
        // Allow Room Lambda to invoke TMDB Lambda
        this.tmdbLambda.grantInvoke(this.roomLambda);
        // Allow Vote Lambda to invoke Match Lambda
        this.matchLambda.grantInvoke(this.voteLambda);
    }
    createResolvers() {
        // Create Lambda data sources
        const roomDataSource = this.api.addLambdaDataSource('RoomDataSource', this.roomLambda);
        const voteDataSource = this.api.addLambdaDataSource('VoteDataSource', this.voteLambda);
        const matchDataSource = this.api.addLambdaDataSource('MatchDataSource', this.matchLambda);
        // Mutation Resolvers
        // createRoom mutation
        roomDataSource.createResolver('CreateRoomResolver', {
            typeName: 'Mutation',
            fieldName: 'createRoom',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "createRoom",
            "userId": "$context.identity.sub",
            "input": $util.toJson($context.arguments.input)
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        // joinRoom mutation
        roomDataSource.createResolver('JoinRoomResolver', {
            typeName: 'Mutation',
            fieldName: 'joinRoom',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "joinRoom",
            "userId": "$context.identity.sub",
            "code": "$context.arguments.code"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        // vote mutation
        voteDataSource.createResolver('VoteResolver', {
            typeName: 'Mutation',
            fieldName: 'vote',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "vote",
            "userId": "$context.identity.sub",
            "input": $util.toJson($context.arguments.input)
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        // Query Resolvers
        // getRoom query - reuse room data source
        roomDataSource.createResolver('GetRoomResolver', {
            typeName: 'Query',
            fieldName: 'getRoom',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "getRoom",
            "userId": "$context.identity.sub",
            "roomId": "$context.arguments.id"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        // getMyRooms query
        roomDataSource.createResolver('GetMyRoomsResolver', {
            typeName: 'Query',
            fieldName: 'getMyRooms',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "getMyRooms",
            "userId": "$context.identity.sub"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        // getMyMatches query
        matchDataSource.createResolver('GetMyMatchesResolver', {
            typeName: 'Query',
            fieldName: 'getMyMatches',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "getUserMatches",
            "userId": "$context.identity.sub"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.matches)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        // checkRoomMatch query
        matchDataSource.createResolver('CheckRoomMatchResolver', {
            typeName: 'Query',
            fieldName: 'checkRoomMatch',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "checkRoomMatch",
            "roomId": "$context.arguments.roomId"
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.match)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        // createMatch mutation
        matchDataSource.createResolver('CreateMatchResolver', {
            typeName: 'Mutation',
            fieldName: 'createMatch',
            requestMappingTemplate: appsync.MappingTemplate.fromString(`
        {
          "version": "2017-02-28",
          "operation": "Invoke",
          "payload": {
            "operation": "createMatch",
            "input": $util.toJson($context.arguments.input)
          }
        }
      `),
            responseMappingTemplate: appsync.MappingTemplate.fromString(`
        #if($context.error)
          $util.error($context.error.message, $context.error.type)
        #end
        #if($context.result.statusCode == 200)
          $util.toJson($context.result.body.match)
        #else
          $util.error($context.result.body.error, "BadRequest")
        #end
      `),
        });
        console.log('AppSync resolvers created successfully');
    }
    createOutputs() {
        // Output values needed for mobile app configuration
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: this.userPool.userPoolId,
            description: 'Cognito User Pool ID',
            exportName: 'TrinityUserPoolId',
        });
        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: this.userPoolClient.userPoolClientId,
            description: 'Cognito User Pool Client ID',
            exportName: 'TrinityUserPoolClientId',
        });
        new cdk.CfnOutput(this, 'GraphQLEndpoint', {
            value: this.api.graphqlUrl,
            description: 'AppSync GraphQL API Endpoint',
            exportName: 'TrinityGraphQLEndpoint',
        });
        new cdk.CfnOutput(this, 'AWSRegion', {
            value: this.region,
            description: 'AWS Region',
            exportName: 'TrinityAWSRegion',
        });
        // Table names for Lambda functions
        new cdk.CfnOutput(this, 'RoomsTableName', {
            value: this.roomsTable.tableName,
            description: 'DynamoDB Rooms Table Name',
        });
        new cdk.CfnOutput(this, 'VotesTableName', {
            value: this.votesTable.tableName,
            description: 'DynamoDB Votes Table Name',
        });
        new cdk.CfnOutput(this, 'MatchesTableName', {
            value: this.matchesTable.tableName,
            description: 'DynamoDB Matches Table Name',
        });
        new cdk.CfnOutput(this, 'UsersTableName', {
            value: this.usersTable.tableName,
            description: 'DynamoDB Users Table Name',
        });
    }
}
exports.TrinityStack = TrinityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJpbml0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3RyaW5pdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLG1FQUFxRDtBQUNyRCxpRUFBbUQ7QUFDbkQsaUVBQW1EO0FBQ25ELCtEQUFpRDtBQUlqRCwyQ0FBNkI7QUFFN0IsTUFBYSxZQUFhLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFlekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qix5QkFBeUI7UUFDekIsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUM7UUFFNUIsMkJBQTJCO1FBQzNCLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBRTdCLDZCQUE2QjtRQUM3QixJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztRQUV4QiwwQkFBMEI7UUFDMUIsSUFBSSxDQUFDLHFCQUFxQixFQUFFLENBQUM7UUFFN0IsMkJBQTJCO1FBQzNCLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUV2QiwwQkFBMEI7UUFDMUIsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO0lBQ3ZCLENBQUM7SUFFTyxvQkFBb0I7UUFDMUIscUJBQXFCO1FBQ3JCLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDekQsU0FBUyxFQUFFLGNBQWM7WUFDekIsWUFBWSxFQUFFO2dCQUNaLElBQUksRUFBRSxJQUFJO2dCQUNWLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU07YUFDcEM7WUFDRCxXQUFXLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxlQUFlO1lBQ2pELGFBQWEsRUFBRSxHQUFHLENBQUMs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QUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxTQUFTO1lBQ2hDLFdBQVcsRUFBRSwyQkFBMkI7U0FDekMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxTQUFTO1lBQ2xDLFdBQVcsRUFBRSw2QkFBNkI7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxTQUFTO1lBQ2hDLFdBQVcsRUFBRSwyQkFBMkI7U0FDekMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBMWxCRCxvQ0EwbEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcclxuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XHJcbmltcG9ydCAqIGFzIGFwcHN5bmMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwcHN5bmMnO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCAqIGFzIGxhbWJkYU5vZGVqcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcclxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XHJcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XHJcblxyXG5leHBvcnQgY2xhc3MgVHJpbml0eVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBwdWJsaWMgdXNlclBvb2w6IGNvZ25pdG8uVXNlclBvb2w7XHJcbiAgcHVibGljIHVzZXJQb29sQ2xpZW50OiBjb2duaXRvLlVzZXJQb29sQ2xpZW50O1xyXG4gIHB1YmxpYyBhcGk6IGFwcHN5bmMuR3JhcGhxbEFwaTtcclxuICBwdWJsaWMgcm9vbXNUYWJsZTogZHluYW1vZGIuVGFibGU7XHJcbiAgcHVibGljIHZvdGVzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xyXG4gIHB1YmxpYyBtYXRjaGVzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xyXG4gIHB1YmxpYyB1c2Vyc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcclxuICBcclxuICAvLyBMYW1iZGEgRnVuY3Rpb25zXHJcbiAgcHVibGljIHRtZGJMYW1iZGE6IGxhbWJkYS5GdW5jdGlvbjtcclxuICBwdWJsaWMgcm9vbUxhbWJkYTogbGFtYmRhLkZ1bmN0aW9uO1xyXG4gIHB1YmxpYyB2b3RlTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247XHJcbiAgcHVibGljIG1hdGNoTGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247XHJcblxyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xyXG5cclxuICAgIC8vIENyZWF0ZSBEeW5hbW9EQiBUYWJsZXNcclxuICAgIHRoaXMuY3JlYXRlRHluYW1vREJUYWJsZXMoKTtcclxuICAgIFxyXG4gICAgLy8gQ3JlYXRlIENvZ25pdG8gVXNlciBQb29sXHJcbiAgICB0aGlzLmNyZWF0ZUNvZ25pdG9Vc2VyUG9vbCgpO1xyXG4gICAgXHJcbiAgICAvLyBDcmVhdGUgQXBwU3luYyBHcmFwaFFMIEFQSVxyXG4gICAgdGhpcy5jcmVhdGVBcHBTeW5jQVBJKCk7XHJcbiAgICBcclxuICAgIC8vIENyZWF0ZSBMYW1iZGEgRnVuY3Rpb25zXHJcbiAgICB0aGlzLmNyZWF0ZUxhbWJkYUZ1bmN0aW9ucygpO1xyXG4gICAgXHJcbiAgICAvLyBDcmVhdGUgQXBwU3luYyBSZXNvbHZlcnNcclxuICAgIHRoaXMuY3JlYXRlUmVzb2x2ZXJzKCk7XHJcblxyXG4gICAgLy8gT3V0cHV0IGltcG9ydGFudCB2YWx1ZXNcclxuICAgIHRoaXMuY3JlYXRlT3V0cHV0cygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVEeW5hbW9EQlRhYmxlcygpIHtcclxuICAgIC8vIFRyaW5pdHlSb29tcyBUYWJsZVxyXG4gICAgdGhpcy5yb29tc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdUcmluaXR5Um9vbXMnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ1RyaW5pdHlSb29tcycsXHJcbiAgICAgIHBhcnRpdGlvbktleToge1xyXG4gICAgICAgIG5hbWU6ICdpZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIEZvciBkZXZlbG9wbWVudFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdsb2JhbCBTZWNvbmRhcnkgSW5kZXggZm9yIHJvb20gY29kZSBsb29rdXBcclxuICAgIHRoaXMucm9vbXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ2NvZGUtaW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAnY29kZScsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHbG9iYWwgU2Vjb25kYXJ5IEluZGV4IGZvciBob3N0LWJhc2VkIHJvb20gcXVlcmllc1xyXG4gICAgdGhpcy5yb29tc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnaG9zdElkLWNyZWF0ZWRBdC1pbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleToge1xyXG4gICAgICAgIG5hbWU6ICdob3N0SWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBzb3J0S2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ2NyZWF0ZWRBdCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBUcmluaXR5Vm90ZXMgVGFibGVcclxuICAgIHRoaXMudm90ZXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVHJpbml0eVZvdGVzJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUcmluaXR5Vm90ZXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAncm9vbUlkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgc29ydEtleToge1xyXG4gICAgICAgIG5hbWU6ICd1c2VyTW92aWVJZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHbG9iYWwgU2Vjb25kYXJ5IEluZGV4IGZvciB1c2VyLWJhc2VkIHZvdGUgcXVlcmllc1xyXG4gICAgdGhpcy52b3Rlc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAndXNlcklkLXRpbWVzdGFtcC1pbmRleCcsXHJcbiAgICAgIHBhcnRpdGlvbktleToge1xyXG4gICAgICAgIG5hbWU6ICd1c2VySWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBzb3J0S2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ3RpbWVzdGFtcCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBUcmluaXR5TWF0Y2hlcyBUYWJsZVxyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1RyaW5pdHlNYXRjaGVzJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdUcmluaXR5TWF0Y2hlcycsXHJcbiAgICAgIHBhcnRpdGlvbktleToge1xyXG4gICAgICAgIG5hbWU6ICdyb29tSWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBzb3J0S2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ21vdmllSWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSLFxyXG4gICAgICB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTG9jYWwgU2Vjb25kYXJ5IEluZGV4IGZvciB0aW1lc3RhbXAtYmFzZWQgcXVlcmllc1xyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUuYWRkTG9jYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ3RpbWVzdGFtcC1pbmRleCcsXHJcbiAgICAgIHNvcnRLZXk6IHtcclxuICAgICAgICBuYW1lOiAndGltZXN0YW1wJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIENSSVRJQ0FMOiBBZGQgR2xvYmFsIFNlY29uZGFyeSBJbmRleCBmb3IgdXNlci1iYXNlZCBtYXRjaCBxdWVyaWVzXHJcbiAgICAvLyBUaGlzIGFsbG93cyBlZmZpY2llbnQgcXVlcnlpbmcgb2YgbWF0Y2hlcyBieSB1c2VyIElEXHJcbiAgICB0aGlzLm1hdGNoZXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ3VzZXJJZC10aW1lc3RhbXAtaW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcclxuICAgICAgICBuYW1lOiAndXNlcklkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgc29ydEtleToge1xyXG4gICAgICAgIG5hbWU6ICd0aW1lc3RhbXAnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVHJpbml0eVVzZXJzIFRhYmxlXHJcbiAgICB0aGlzLnVzZXJzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1RyaW5pdHlVc2VycycsIHtcclxuICAgICAgdGFibGVOYW1lOiAnVHJpbml0eVVzZXJzJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ2lkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVDb2duaXRvVXNlclBvb2woKSB7XHJcbiAgICAvLyBDcmVhdGUgVXNlciBQb29sXHJcbiAgICB0aGlzLnVzZXJQb29sID0gbmV3IGNvZ25pdG8uVXNlclBvb2wodGhpcywgJ1RyaW5pdHlVc2VyUG9vbCcsIHtcclxuICAgICAgdXNlclBvb2xOYW1lOiAndHJpbml0eS11c2VyLXBvb2wnLFxyXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcclxuICAgICAgc2lnbkluQWxpYXNlczoge1xyXG4gICAgICAgIGVtYWlsOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgICAvLyBSZW1vdmUgZW1haWwgdmVyaWZpY2F0aW9uIHJlcXVpcmVtZW50XHJcbiAgICAgIGF1dG9WZXJpZnk6IHtcclxuICAgICAgICAvLyBlbWFpbDogdHJ1ZSwgLy8gQ29tbWVudGVkIG91dCB0byBkaXNhYmxlIGVtYWlsIHZlcmlmaWNhdGlvblxyXG4gICAgICB9LFxyXG4gICAgICBzdGFuZGFyZEF0dHJpYnV0ZXM6IHtcclxuICAgICAgICBlbWFpbDoge1xyXG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXHJcbiAgICAgICAgICBtdXRhYmxlOiB0cnVlLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICAgIHBhc3N3b3JkUG9saWN5OiB7XHJcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxyXG4gICAgICAgIHJlcXVpcmVMb3dlcmNhc2U6IGZhbHNlLFxyXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IGZhbHNlLFxyXG4gICAgICAgIHJlcXVpcmVEaWdpdHM6IGZhbHNlLFxyXG4gICAgICAgIHJlcXVpcmVTeW1ib2xzOiBmYWxzZSxcclxuICAgICAgfSxcclxuICAgICAgYWNjb3VudFJlY292ZXJ5OiBjb2duaXRvLkFjY291bnRSZWNvdmVyeS5FTUFJTF9PTkxZLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgICAvLyBBZGQgTGFtYmRhIHRyaWdnZXIgdG8gYXV0by1jb25maXJtIHVzZXJzXHJcbiAgICAgIGxhbWJkYVRyaWdnZXJzOiB7XHJcbiAgICAgICAgcHJlU2lnblVwOiBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdQcmVTaWduVXBUcmlnZ2VyJywge1xyXG4gICAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXHJcbiAgICAgICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXHJcbiAgICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tSW5saW5lKGBcclxuICAgICAgICAgICAgZXhwb3J0cy5oYW5kbGVyID0gYXN5bmMgKGV2ZW50KSA9PiB7XHJcbiAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1ByZVNpZ25VcCB0cmlnZ2VyIGV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XHJcbiAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgLy8gQXV0by1jb25maXJtIGFsbCB1c2VycyBhbmQgc2tpcCBlbWFpbCB2ZXJpZmljYXRpb25cclxuICAgICAgICAgICAgICBldmVudC5yZXNwb25zZS5hdXRvQ29uZmlybVVzZXIgPSB0cnVlO1xyXG4gICAgICAgICAgICAgIGV2ZW50LnJlc3BvbnNlLmF1dG9WZXJpZnlFbWFpbCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1ByZVNpZ25VcCByZXNwb25zZTonLCBKU09OLnN0cmluZ2lmeShldmVudC5yZXNwb25zZSwgbnVsbCwgMikpO1xyXG4gICAgICAgICAgICAgIHJldHVybiBldmVudDtcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIGApLFxyXG4gICAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIFVzZXIgUG9vbCBDbGllbnRcclxuICAgIHRoaXMudXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnVHJpbml0eVVzZXJQb29sQ2xpZW50Jywge1xyXG4gICAgICB1c2VyUG9vbDogdGhpcy51c2VyUG9vbCxcclxuICAgICAgdXNlclBvb2xDbGllbnROYW1lOiAndHJpbml0eS1tb2JpbGUtY2xpZW50JyxcclxuICAgICAgZ2VuZXJhdGVTZWNyZXQ6IGZhbHNlLCAvLyBSZXF1aXJlZCBmb3IgbW9iaWxlIGFwcHNcclxuICAgICAgYXV0aEZsb3dzOiB7XHJcbiAgICAgICAgdXNlclNycDogdHJ1ZSxcclxuICAgICAgICB1c2VyUGFzc3dvcmQ6IHRydWUsXHJcbiAgICAgICAgYWRtaW5Vc2VyUGFzc3dvcmQ6IHRydWUsIC8vIEFkZCB0aGlzIGZvciBhZG1pbiBvcGVyYXRpb25zXHJcbiAgICAgICAgY3VzdG9tOiBmYWxzZSxcclxuICAgICAgfSxcclxuICAgICAgcHJldmVudFVzZXJFeGlzdGVuY2VFcnJvcnM6IHRydWUsXHJcbiAgICAgIC8vIEFkZCBleHBsaWNpdCB0b2tlbiB2YWxpZGl0eVxyXG4gICAgICBhY2Nlc3NUb2tlblZhbGlkaXR5OiBjZGsuRHVyYXRpb24uaG91cnMoMSksXHJcbiAgICAgIGlkVG9rZW5WYWxpZGl0eTogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxyXG4gICAgICByZWZyZXNoVG9rZW5WYWxpZGl0eTogY2RrLkR1cmF0aW9uLmRheXMoMzApLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZUFwcFN5bmNBUEkoKSB7XHJcbiAgICAvLyBDcmVhdGUgQXBwU3luYyBHcmFwaFFMIEFQSVxyXG4gICAgdGhpcy5hcGkgPSBuZXcgYXBwc3luYy5HcmFwaHFsQXBpKHRoaXMsICdUcmluaXR5QVBJJywge1xyXG4gICAgICBuYW1lOiAndHJpbml0eS1hcGknLFxyXG4gICAgICBkZWZpbml0aW9uOiBhcHBzeW5jLkRlZmluaXRpb24uZnJvbUZpbGUocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NjaGVtYS5ncmFwaHFsJykpLFxyXG4gICAgICBhdXRob3JpemF0aW9uQ29uZmlnOiB7XHJcbiAgICAgICAgZGVmYXVsdEF1dGhvcml6YXRpb246IHtcclxuICAgICAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcHBzeW5jLkF1dGhvcml6YXRpb25UeXBlLlVTRVJfUE9PTCxcclxuICAgICAgICAgIHVzZXJQb29sQ29uZmlnOiB7XHJcbiAgICAgICAgICAgIHVzZXJQb29sOiB0aGlzLnVzZXJQb29sLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgICBsb2dDb25maWc6IHtcclxuICAgICAgICBmaWVsZExvZ0xldmVsOiBhcHBzeW5jLkZpZWxkTG9nTGV2ZWwuQUxMLFxyXG4gICAgICB9LFxyXG4gICAgICB4cmF5RW5hYmxlZDogdHJ1ZSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVMYW1iZGFGdW5jdGlvbnMoKSB7XHJcbiAgICAvLyBDb21tb24gTGFtYmRhIGNvbmZpZ3VyYXRpb25cclxuICAgIGNvbnN0IGNvbW1vbkxhbWJkYVByb3BzID0ge1xyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxyXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgVE1EQl9BUElfS0VZOiBwcm9jZXNzLmVudi5UTURCX0FQSV9LRVkgfHwgJycsXHJcbiAgICAgICAgVE1EQl9SRUFEX1RPS0VOOiBwcm9jZXNzLmVudi5UTURCX1JFQURfVE9LRU4gfHwgJycsXHJcbiAgICAgICAgVE1EQl9CQVNFX1VSTDogcHJvY2Vzcy5lbnYuVE1EQl9CQVNFX1VSTCB8fCAnaHR0cHM6Ly9hcGkudGhlbW92aWVkYi5vcmcvMycsXHJcbiAgICAgICAgUk9PTVNfVEFCTEU6IHRoaXMucm9vbXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgVk9URVNfVEFCTEU6IHRoaXMudm90ZXNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgTUFUQ0hFU19UQUJMRTogdGhpcy5tYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIFVTRVJTX1RBQkxFOiB0aGlzLnVzZXJzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEdSQVBIUUxfRU5EUE9JTlQ6ICcnLCAvLyBXaWxsIGJlIHNldCBhZnRlciBBUEkgY3JlYXRpb25cclxuICAgICAgfSxcclxuICAgIH07XHJcblxyXG4gICAgLy8gVE1EQiBJbnRlZ3JhdGlvbiBMYW1iZGFcclxuICAgIHRoaXMudG1kYkxhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1RNREJMYW1iZGEnLCB7XHJcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxyXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0cmluaXR5LXRtZGItaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vc3JjL2hhbmRsZXJzL3RtZGInKSksXHJcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdUTURCIEFQSSBpbnRlZ3JhdGlvbiB3aXRoIExhdGluIHNjcmlwdCBmaWx0ZXJpbmcnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUm9vbSBIYW5kbGVyIExhbWJkYVxyXG4gICAgdGhpcy5yb29tTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnUm9vbUxhbWJkYScsIHtcclxuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RyaW5pdHktcm9vbS1oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zcmMvaGFuZGxlcnMvcm9vbScpKSxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1Jvb20gY3JlYXRpb24gYW5kIGpvaW5pbmcgbG9naWMnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVm90ZSBIYW5kbGVyIExhbWJkYVxyXG4gICAgdGhpcy52b3RlTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnVm90ZUxhbWJkYScsIHtcclxuICAgICAgLi4uY29tbW9uTGFtYmRhUHJvcHMsXHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ3RyaW5pdHktdm90ZS1oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9zcmMvaGFuZGxlcnMvdm90ZScpKSxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZvdGUgcHJvY2Vzc2luZyBhbmQgbWF0Y2ggZGV0ZWN0aW9uJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE1hdGNoIEhhbmRsZXIgTGFtYmRhXHJcbiAgICB0aGlzLm1hdGNoTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnTWF0Y2hMYW1iZGEnLCB7XHJcbiAgICAgIC4uLmNvbW1vbkxhbWJkYVByb3BzLFxyXG4gICAgICBmdW5jdGlvbk5hbWU6ICd0cmluaXR5LW1hdGNoLWhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQocGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL3NyYy9oYW5kbGVycy9tYXRjaCcpKSxcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ01hdGNoIGNyZWF0aW9uIGFuZCBoaXN0b3J5IG1hbmFnZW1lbnQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVXBkYXRlIExhbWJkYSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgd2l0aCBjcm9zcy1yZWZlcmVuY2VzXHJcbiAgICB0aGlzLnJvb21MYW1iZGEuYWRkRW52aXJvbm1lbnQoJ1RNREJfTEFNQkRBX0FSTicsIHRoaXMudG1kYkxhbWJkYS5mdW5jdGlvbkFybik7XHJcbiAgICB0aGlzLnZvdGVMYW1iZGEuYWRkRW52aXJvbm1lbnQoJ01BVENIX0xBTUJEQV9BUk4nLCB0aGlzLm1hdGNoTGFtYmRhLmZ1bmN0aW9uQXJuKTtcclxuICAgIFxyXG4gICAgLy8gQWRkIEdyYXBoUUwgZW5kcG9pbnQgdG8gVm90ZSBMYW1iZGEgZm9yIHN1YnNjcmlwdGlvbiBub3RpZmljYXRpb25zXHJcbiAgICB0aGlzLnZvdGVMYW1iZGEuYWRkRW52aXJvbm1lbnQoJ0dSQVBIUUxfRU5EUE9JTlQnLCB0aGlzLmFwaS5ncmFwaHFsVXJsKTtcclxuXHJcbiAgICAvLyBHcmFudCBEeW5hbW9EQiBwZXJtaXNzaW9uc1xyXG4gICAgdGhpcy5ncmFudER5bmFtb0RCUGVybWlzc2lvbnMoKTtcclxuXHJcbiAgICAvLyBHcmFudCBMYW1iZGEgaW52b2tlIHBlcm1pc3Npb25zXHJcbiAgICB0aGlzLmdyYW50TGFtYmRhUGVybWlzc2lvbnMoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZ3JhbnREeW5hbW9EQlBlcm1pc3Npb25zKCkge1xyXG4gICAgLy8gR3JhbnQgcmVhZC93cml0ZSBwZXJtaXNzaW9ucyB0byBhbGwgdGFibGVzIGZvciBhbGwgbGFtYmRhc1xyXG4gICAgY29uc3QgbGFtYmRhcyA9IFt0aGlzLnRtZGJMYW1iZGEsIHRoaXMucm9vbUxhbWJkYSwgdGhpcy52b3RlTGFtYmRhLCB0aGlzLm1hdGNoTGFtYmRhXTtcclxuICAgIGNvbnN0IHRhYmxlcyA9IFt0aGlzLnJvb21zVGFibGUsIHRoaXMudm90ZXNUYWJsZSwgdGhpcy5tYXRjaGVzVGFibGUsIHRoaXMudXNlcnNUYWJsZV07XHJcblxyXG4gICAgbGFtYmRhcy5mb3JFYWNoKGxhbWJkYUZuID0+IHtcclxuICAgICAgdGFibGVzLmZvckVhY2godGFibGUgPT4ge1xyXG4gICAgICAgIHRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShsYW1iZGFGbik7XHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGdyYW50TGFtYmRhUGVybWlzc2lvbnMoKSB7XHJcbiAgICAvLyBBbGxvdyBSb29tIExhbWJkYSB0byBpbnZva2UgVE1EQiBMYW1iZGFcclxuICAgIHRoaXMudG1kYkxhbWJkYS5ncmFudEludm9rZSh0aGlzLnJvb21MYW1iZGEpO1xyXG4gICAgXHJcbiAgICAvLyBBbGxvdyBWb3RlIExhbWJkYSB0byBpbnZva2UgTWF0Y2ggTGFtYmRhXHJcbiAgICB0aGlzLm1hdGNoTGFtYmRhLmdyYW50SW52b2tlKHRoaXMudm90ZUxhbWJkYSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZVJlc29sdmVycygpIHtcclxuICAgIC8vIENyZWF0ZSBMYW1iZGEgZGF0YSBzb3VyY2VzXHJcbiAgICBjb25zdCByb29tRGF0YVNvdXJjZSA9IHRoaXMuYXBpLmFkZExhbWJkYURhdGFTb3VyY2UoJ1Jvb21EYXRhU291cmNlJywgdGhpcy5yb29tTGFtYmRhKTtcclxuICAgIGNvbnN0IHZvdGVEYXRhU291cmNlID0gdGhpcy5hcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnVm90ZURhdGFTb3VyY2UnLCB0aGlzLnZvdGVMYW1iZGEpO1xyXG4gICAgY29uc3QgbWF0Y2hEYXRhU291cmNlID0gdGhpcy5hcGkuYWRkTGFtYmRhRGF0YVNvdXJjZSgnTWF0Y2hEYXRhU291cmNlJywgdGhpcy5tYXRjaExhbWJkYSk7XHJcblxyXG4gICAgLy8gTXV0YXRpb24gUmVzb2x2ZXJzXHJcbiAgICBcclxuICAgIC8vIGNyZWF0ZVJvb20gbXV0YXRpb25cclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdDcmVhdGVSb29tUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnTXV0YXRpb24nLFxyXG4gICAgICBmaWVsZE5hbWU6ICdjcmVhdGVSb29tJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiY3JlYXRlUm9vbVwiLFxyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmlkZW50aXR5LnN1YlwiLFxyXG4gICAgICAgICAgICBcImlucHV0XCI6ICR1dGlsLnRvSnNvbigkY29udGV4dC5hcmd1bWVudHMuaW5wdXQpXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gam9pblJvb20gbXV0YXRpb25cclxuICAgIHJvb21EYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdKb2luUm9vbVJlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ011dGF0aW9uJyxcclxuICAgICAgZmllbGROYW1lOiAnam9pblJvb20nLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJqb2luUm9vbVwiLFxyXG4gICAgICAgICAgICBcInVzZXJJZFwiOiBcIiRjb250ZXh0LmlkZW50aXR5LnN1YlwiLFxyXG4gICAgICAgICAgICBcImNvZGVcIjogXCIkY29udGV4dC5hcmd1bWVudHMuY29kZVwiXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gdm90ZSBtdXRhdGlvblxyXG4gICAgdm90ZURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ1ZvdGVSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ3ZvdGUnLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJ2b3RlXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCIsXHJcbiAgICAgICAgICAgIFwiaW5wdXRcIjogJHV0aWwudG9Kc29uKCRjb250ZXh0LmFyZ3VtZW50cy5pbnB1dClcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keSlcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBRdWVyeSBSZXNvbHZlcnNcclxuXHJcbiAgICAvLyBnZXRSb29tIHF1ZXJ5IC0gcmV1c2Ugcm9vbSBkYXRhIHNvdXJjZVxyXG4gICAgcm9vbURhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0dldFJvb21SZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldFJvb20nLFxyXG4gICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICB7XHJcbiAgICAgICAgICBcInZlcnNpb25cIjogXCIyMDE3LTAyLTI4XCIsXHJcbiAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcIkludm9rZVwiLFxyXG4gICAgICAgICAgXCJwYXlsb2FkXCI6IHtcclxuICAgICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJnZXRSb29tXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCIsXHJcbiAgICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLmlkXCJcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keSlcclxuICAgICAgICAjZWxzZVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQucmVzdWx0LmJvZHkuZXJyb3IsIFwiQmFkUmVxdWVzdFwiKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgYCksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBnZXRNeVJvb21zIHF1ZXJ5XHJcbiAgICByb29tRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignR2V0TXlSb29tc1Jlc29sdmVyJywge1xyXG4gICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcclxuICAgICAgZmllbGROYW1lOiAnZ2V0TXlSb29tcycsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImdldE15Um9vbXNcIixcclxuICAgICAgICAgICAgXCJ1c2VySWRcIjogXCIkY29udGV4dC5pZGVudGl0eS5zdWJcIlxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5KVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIGdldE15TWF0Y2hlcyBxdWVyeVxyXG4gICAgbWF0Y2hEYXRhU291cmNlLmNyZWF0ZVJlc29sdmVyKCdHZXRNeU1hdGNoZXNSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2dldE15TWF0Y2hlcycsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImdldFVzZXJNYXRjaGVzXCIsXHJcbiAgICAgICAgICAgIFwidXNlcklkXCI6IFwiJGNvbnRleHQuaWRlbnRpdHkuc3ViXCJcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIGApLFxyXG4gICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LmVycm9yKVxyXG4gICAgICAgICAgJHV0aWwuZXJyb3IoJGNvbnRleHQuZXJyb3IubWVzc2FnZSwgJGNvbnRleHQuZXJyb3IudHlwZSlcclxuICAgICAgICAjZW5kXHJcbiAgICAgICAgI2lmKCRjb250ZXh0LnJlc3VsdC5zdGF0dXNDb2RlID09IDIwMClcclxuICAgICAgICAgICR1dGlsLnRvSnNvbigkY29udGV4dC5yZXN1bHQuYm9keS5tYXRjaGVzKVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIGNoZWNrUm9vbU1hdGNoIHF1ZXJ5XHJcbiAgICBtYXRjaERhdGFTb3VyY2UuY3JlYXRlUmVzb2x2ZXIoJ0NoZWNrUm9vbU1hdGNoUmVzb2x2ZXInLCB7XHJcbiAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxyXG4gICAgICBmaWVsZE5hbWU6ICdjaGVja1Jvb21NYXRjaCcsXHJcbiAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIFwidmVyc2lvblwiOiBcIjIwMTctMDItMjhcIixcclxuICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiSW52b2tlXCIsXHJcbiAgICAgICAgICBcInBheWxvYWRcIjoge1xyXG4gICAgICAgICAgICBcIm9wZXJhdGlvblwiOiBcImNoZWNrUm9vbU1hdGNoXCIsXHJcbiAgICAgICAgICAgIFwicm9vbUlkXCI6IFwiJGNvbnRleHQuYXJndW1lbnRzLnJvb21JZFwiXHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICBgKSxcclxuICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGFwcHN5bmMuTWFwcGluZ1RlbXBsYXRlLmZyb21TdHJpbmcoYFxyXG4gICAgICAgICNpZigkY29udGV4dC5lcnJvcilcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LmVycm9yLm1lc3NhZ2UsICRjb250ZXh0LmVycm9yLnR5cGUpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICAgICNpZigkY29udGV4dC5yZXN1bHQuc3RhdHVzQ29kZSA9PSAyMDApXHJcbiAgICAgICAgICAkdXRpbC50b0pzb24oJGNvbnRleHQucmVzdWx0LmJvZHkubWF0Y2gpXHJcbiAgICAgICAgI2Vsc2VcclxuICAgICAgICAgICR1dGlsLmVycm9yKCRjb250ZXh0LnJlc3VsdC5ib2R5LmVycm9yLCBcIkJhZFJlcXVlc3RcIilcclxuICAgICAgICAjZW5kXHJcbiAgICAgIGApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gY3JlYXRlTWF0Y2ggbXV0YXRpb25cclxuICAgIG1hdGNoRGF0YVNvdXJjZS5jcmVhdGVSZXNvbHZlcignQ3JlYXRlTWF0Y2hSZXNvbHZlcicsIHtcclxuICAgICAgdHlwZU5hbWU6ICdNdXRhdGlvbicsXHJcbiAgICAgIGZpZWxkTmFtZTogJ2NyZWF0ZU1hdGNoJyxcclxuICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogYXBwc3luYy5NYXBwaW5nVGVtcGxhdGUuZnJvbVN0cmluZyhgXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgXCJ2ZXJzaW9uXCI6IFwiMjAxNy0wMi0yOFwiLFxyXG4gICAgICAgICAgXCJvcGVyYXRpb25cIjogXCJJbnZva2VcIixcclxuICAgICAgICAgIFwicGF5bG9hZFwiOiB7XHJcbiAgICAgICAgICAgIFwib3BlcmF0aW9uXCI6IFwiY3JlYXRlTWF0Y2hcIixcclxuICAgICAgICAgICAgXCJpbnB1dFwiOiAkdXRpbC50b0pzb24oJGNvbnRleHQuYXJndW1lbnRzLmlucHV0KVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgYCksXHJcbiAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiBhcHBzeW5jLk1hcHBpbmdUZW1wbGF0ZS5mcm9tU3RyaW5nKGBcclxuICAgICAgICAjaWYoJGNvbnRleHQuZXJyb3IpXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5lcnJvci5tZXNzYWdlLCAkY29udGV4dC5lcnJvci50eXBlKVxyXG4gICAgICAgICNlbmRcclxuICAgICAgICAjaWYoJGNvbnRleHQucmVzdWx0LnN0YXR1c0NvZGUgPT0gMjAwKVxyXG4gICAgICAgICAgJHV0aWwudG9Kc29uKCRjb250ZXh0LnJlc3VsdC5ib2R5Lm1hdGNoKVxyXG4gICAgICAgICNlbHNlXHJcbiAgICAgICAgICAkdXRpbC5lcnJvcigkY29udGV4dC5yZXN1bHQuYm9keS5lcnJvciwgXCJCYWRSZXF1ZXN0XCIpXHJcbiAgICAgICAgI2VuZFxyXG4gICAgICBgKSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKCdBcHBTeW5jIHJlc29sdmVycyBjcmVhdGVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVPdXRwdXRzKCkge1xyXG4gICAgLy8gT3V0cHV0IHZhbHVlcyBuZWVkZWQgZm9yIG1vYmlsZSBhcHAgY29uZmlndXJhdGlvblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sSWQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgSUQnLFxyXG4gICAgICBleHBvcnROYW1lOiAnVHJpbml0eVVzZXJQb29sSWQnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1VzZXJQb29sQ2xpZW50SWQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQ2xpZW50IElEJyxcclxuICAgICAgZXhwb3J0TmFtZTogJ1RyaW5pdHlVc2VyUG9vbENsaWVudElkJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdHcmFwaFFMRW5kcG9pbnQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmFwaS5ncmFwaHFsVXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FwcFN5bmMgR3JhcGhRTCBBUEkgRW5kcG9pbnQnLFxyXG4gICAgICBleHBvcnROYW1lOiAnVHJpbml0eUdyYXBoUUxFbmRwb2ludCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQVdTUmVnaW9uJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5yZWdpb24sXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVdTIFJlZ2lvbicsXHJcbiAgICAgIGV4cG9ydE5hbWU6ICdUcmluaXR5QVdTUmVnaW9uJyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFRhYmxlIG5hbWVzIGZvciBMYW1iZGEgZnVuY3Rpb25zXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUm9vbXNUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnJvb21zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIFJvb21zIFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1ZvdGVzVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy52b3Rlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBWb3RlcyBUYWJsZSBOYW1lJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdNYXRjaGVzVGFibGVOYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5tYXRjaGVzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIE1hdGNoZXMgVGFibGUgTmFtZScsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlcnNUYWJsZU5hbWUnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJzVGFibGUudGFibGVOYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIFVzZXJzIFRhYmxlIE5hbWUnLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19